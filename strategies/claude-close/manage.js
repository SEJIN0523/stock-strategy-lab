// Research order intents only. This module has no broker or network integration.
function stopState(position,close,config) {
  const fraction=position.stopFraction??config.stop.returnFraction;
  if(!Number.isFinite(fraction)||fraction>=0||fraction<=-1)throw new Error('손절률을 확인하세요.');
  const highestClose=Math.max(position.highestClose||position.averagePrice,close);
  const stopPrice=Math.max(position.stopPrice||0,Math.max(position.averagePrice,highestClose)*(1+fraction));
  return {...position,highestClose,stopPrice,stopFraction:fraction};
}

export function manage(position,signal,context,config) {
  if(!Number.isInteger(context.sessionIndex)||context.sessionIndex<0||!Number.isFinite(context.cashAvailable)||context.cashAvailable<0)throw new Error('세션·현금 설정을 확인하세요.');
  const result=(reason,nextPosition=position,order=null,cancelPending=false)=>({reason,nextPosition,order,cancelPending});
  if(!Number.isFinite(signal.close)||signal.close<=0)return result('NO_VALID_CLOSE');
  const validRank=signal.rankStatus==='valid'&&Number.isFinite(signal.topPercent)&&signal.topPercent>=0&&signal.topPercent<=100;
  let state=position?stopState(position,signal.close,config):null;
  if(state&&validRank&&signal.topPercent<=config.exit.resetPartialLatchAtOrBelowTopPercent)state={...state,partialExitLatched:false};
  const order=(side,qty,reason,budget=0,targetValue=state?.targetValue)=>({id:`${signal.code}:${context.sessionIndex}:${reason}`,code:signal.code,side,qty,reason,signalSession:context.sessionIndex,executeSession:context.sessionIndex+1,reservedCash:budget,targetValue});
  if(state&&signal.close<=state.stopPrice)return result('STOP',state,order('SELL',state.qty,'STOP'),Boolean(context.pendingSide));
  if(state&&signal.rankStatus==='ineligible')return result('VERIFIED_UNIVERSE_EXIT',state,order('SELL',state.qty,'VERIFIED_UNIVERSE_EXIT'),Boolean(context.pendingSide));
  if(state&&validRank&&signal.topPercent>config.exit.fullExitAboveTopPercent)return result('RANK_FULL_EXIT',state,order('SELL',state.qty,'RANK_FULL_EXIT'),Boolean(context.pendingSide));
  if(context.pendingSide)return result('ORDER_ALREADY_PENDING',state);
  if(!validRank)return result('RANK_DATA_UNAVAILABLE',state);
  if(state&&signal.topPercent>config.exit.holdThroughTopPercent&&!state.partialExitLatched&&state.qty>=2&&state.qty*signal.close>state.targetValue*config.exit.partialSellMinimumValueRatio) {
    return result('RANK_HALF_EXIT',state,order('SELL',Math.floor(state.qty*config.exit.partialSellFraction),'RANK_HALF_EXIT'));
  }
  if(!signal.entryEligible||signal.topPercent>config.recommendation.maximumTopPercent||!Number.isFinite(signal.dailyReturn)||signal.dailyReturn<=config.recommendation.blockedDailyReturnAtOrBelow)return result('HOLD_OR_NO_ENTRY',state);
  if(state&&(signal.close-state.stopPrice)/signal.close<=config.stop.noAddWithinDistanceFraction)return result('STOP_TOO_CLOSE_TO_ADD',state);
  if(!state&&(!Number.isInteger(context.positionSlotsAvailable)||!Number.isInteger(context.sectorSlotsAvailable)||context.positionSlotsAvailable<=0||context.sectorSlotsAvailable<=0))return result('PORTFOLIO_LIMIT',state);
  const targetValue=state?.targetValue??context.entryTargetValue;
  if(!Number.isFinite(targetValue)||targetValue<=0)throw new Error('목표 투자금이 필요합니다.');
  if(state) {
    if(state.buyCount>=config.entry.tranches)return result('MAX_BUYS_REACHED',state);
    if(!Number.isInteger(state.buyCount)||state.buyCount<1||!Number.isInteger(state.firstFillSession)||!Number.isInteger(state.lastFillSession))throw new Error('매수 체결 이력을 확인하세요.');
    if(context.sessionIndex-state.lastFillSession<config.entry.minimumSessionsFromLastFill||context.sessionIndex-state.firstFillSession<config.entry.earliestTradingSessionsFromFirstFill[state.buyCount])return result('WAIT_SCALE_IN_SESSION',state);
    if(state.qty*signal.close>=targetValue*config.entry.maximumTargetFillRatioBeforeAdd)return result('TARGET_ALREADY_FILLED',state);
  }
  const remaining=targetValue-(state?.qty||0)*signal.close;
  const budget=Math.min(targetValue/config.entry.tranches,remaining,context.cashAvailable);
  const qty=Math.floor(budget/signal.close);
  if(qty<1)return result('INSUFFICIENT_CASH_OR_TARGET',state);
  const reason=state?'SCALE_IN':'INITIAL_ENTRY';
  return result(reason,state,order('BUY',qty,reason,budget,targetValue));
}

export function confirmResearchFill(position,intent,fill,config) {
  const prior=position?.confirmedOrders?.find(record=>record.id===intent.id);
  if(prior){if(prior.price!==fill.price||prior.qty!==fill.qty||prior.sessionIndex!==fill.sessionIndex||prior.side!==intent.side)throw new Error('같은 주문의 체결 내용이 다릅니다.');return position;}
  if(fill.sessionIndex!==intent.executeSession||!Number.isFinite(fill.price)||fill.price<=0||!Number.isInteger(fill.qty)||fill.qty!==intent.qty)throw new Error('이 연구 어댑터는 예정 세션의 전량 체결 확인만 지원합니다.');
  if(intent.side==='BUY') {
    if(fill.price*fill.qty>intent.reservedCash+1e-8)throw new Error('예약 예산 초과: 체결로 기록하지 않습니다.');
    if((position?.buyCount||0)>=config.entry.tranches)throw new Error('최대 매수 횟수를 초과했습니다.');
    const qty=(position?.qty||0)+fill.qty;
    const averagePrice=((position?.qty||0)*(position?.averagePrice||0)+fill.qty*fill.price)/qty;
    return stopState({...position,qty,averagePrice,targetValue:position?.targetValue??intent.targetValue,buyCount:(position?.buyCount||0)+1,firstFillSession:position?.firstFillSession??fill.sessionIndex,lastFillSession:fill.sessionIndex,partialExitLatched:position?.partialExitLatched||false,confirmedOrders:[...(position?.confirmedOrders||[]),{id:intent.id,side:intent.side,...fill}]},fill.price,config);
  }
  if(intent.side!=='SELL'||!position||fill.qty>position.qty)throw new Error('매도 체결 수량이 보유량을 초과합니다.');
  if(fill.qty===position.qty)return null;
  return {...position,qty:position.qty-fill.qty,lastFillSession:fill.sessionIndex,partialExitLatched:intent.reason==='RANK_HALF_EXIT'?true:position.partialExitLatched,confirmedOrders:[...(position.confirmedOrders||[]),{id:intent.id,side:intent.side,...fill}]};
}
