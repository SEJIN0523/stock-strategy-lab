import { saleTaxPercent } from './taxes.js';

const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const codeOk=c=>typeof c==='string'&&/^[0-9A-Z]{6}$/.test(c);
export function validateAccount(account) {
  if(!account||!Number.isFinite(account.cash)||account.cash<0||!Array.isArray(account.positions))throw Error('현금과 보유 기록을 확인하세요.');
  const seen=new Set();
  for(const p of account.positions) {
    if(!codeOk(p.code)||seen.has(p.code)||!Number.isSafeInteger(p.qty)||p.qty<=0||!(Number.isFinite(p.avg)&&p.avg>0)||!(Number.isFinite(p.highWater)&&p.highWater>0)||!validDate(p.entryDate)||(p.observedThrough!==undefined&&!validDate(p.observedThrough))||(p.stop!==undefined&&!(Number.isFinite(p.stop)&&p.stop>0)))throw Error('보유 종목의 코드·수량·평균단가·최고가격·매수일을 확인하세요.');
    seen.add(p.code);
  }
  if(account.log!==undefined) {
    if(!Array.isArray(account.log)||account.log.length>20000)throw Error('장부 기록 형식을 확인하세요.');
    const ids=new Set();let last='';
    for(const x of account.log) {
      if(!x||typeof x.id!=='string'||!x.id||ids.has(x.id)||!validDate(x.date)||x.date<last||!Number.isFinite(x.cashAfter)||x.cashAfter<0)throw Error('장부 기록의 ID·날짜·현금을 확인하세요.');
      ids.add(x.id);last=x.date;
      if(x.type) {if(!['deposit','withdraw'].includes(x.type)||!(Number.isFinite(x.amount)&&x.amount>0))throw Error('입출금 기록 형식이 잘못됐습니다.');}
      else if(!codeOk(x.code)||!['buy','sell'].includes(x.side)||!Number.isSafeInteger(x.qty)||x.qty<1||!(Number.isFinite(x.price)&&x.price>0)||!Number.isFinite(x.tax)||x.tax<0)throw Error('체결 기록 형식이 잘못됐습니다.');
    }
  }
  return account;
}
export function recordTrade(account,trade) {
  validateAccount(account);
  if(!codeOk(trade.code)||!['buy','sell'].includes(trade.side)||!validDate(trade.date)||!Number.isSafeInteger(trade.qty)||trade.qty<1||!(Number.isFinite(trade.price)&&trade.price>0)||!trade.id)throw Error('실제 체결한 종목·날짜·가격·정수 수량을 입력하세요.');
  const log=account.log||[],prior=log.find(x=>x.id===trade.id);
  if(prior) {
    if(['code','side','date','qty','price','market'].some(k=>prior[k]!==trade[k]))throw Error('같은 기록 ID의 체결 내용이 다릅니다.');
    return account;
  }
  if(log.some(x=>x.date>trade.date))throw Error('최근 기록보다 이전 날짜입니다. 시간순으로 기록하세요.');
  const result=structuredClone(account),p=result.positions.find(p=>p.code===trade.code),gross=trade.price*trade.qty;
  if(!Number.isFinite(gross)||p&&trade.side==='buy'&&!Number.isSafeInteger(p.qty+trade.qty))throw Error('체결 금액·수량이 너무 큽니다.');
  let tax=0;
  if(trade.side==='buy') {
    if(gross>result.cash)throw Error('현금이 부족합니다. 실제 입금을 먼저 기록하세요.');
    if(p) {p.avg=(p.avg*p.qty+gross)/(p.qty+trade.qty);p.qty+=trade.qty;p.highWater=Math.max(p.highWater,trade.price);}
    else result.positions.push({code:trade.code,qty:trade.qty,avg:trade.price,highWater:trade.price,entryDate:trade.date});
    result.cash-=gross;
  }else {
    if(!p||p.qty<trade.qty)throw Error('보유 수량보다 많이 매도할 수 없습니다.');
    tax=gross*saleTaxPercent(trade.date,trade.market)/100;
    p.qty-=trade.qty;if(!p.qty)result.positions=result.positions.filter(x=>x!==p);
    result.cash+=gross-tax;
  }
  result.log=[...log,{...trade,gross,tax,cashAfter:result.cash}];
  return result;
}
export function recordCash(account,{id,date,amount,type}) {
  validateAccount(account);
  if(!id||!validDate(date)||!['deposit','withdraw'].includes(type)||!(Number.isFinite(amount)&&amount>0))throw Error('입출금 날짜와 양수 금액을 입력하세요.');
  const log=account.log||[],prior=log.find(x=>x.id===id);
  if(prior) {if(prior.type!==type||prior.amount!==amount||prior.date!==date)throw Error('같은 기록 ID의 입출금 내용이 다릅니다.');return account;}
  if(log.some(x=>x.date>date))throw Error('시간순으로 기록하세요.');
  const cash=account.cash+(type==='deposit'?amount:-amount);
  if(!Number.isFinite(cash)||cash<0)throw Error('출금액 또는 현금 범위를 확인하세요.');
  return {...account,cash,log:[...log,{id,date,amount,type,cashAfter:cash}]};
}
export function decisions(snapshot,account,today) {
  validateAccount(account);
  if(snapshot?.schema!=='momentum.daily.v1'||!validDate(snapshot.asOf)||!validDate(today)||!Array.isArray(snapshot.quotes)||!Array.isArray(snapshot.candidates))throw Error('분석 자료 형식을 확인하세요.');
  const age=(Date.parse(today)-Date.parse(snapshot.asOf))/86400000;
  const stale=age<0||age>4,quotes=new Map(snapshot.quotes.map(q=>[q.code,q])),actions=[],reviews=[],updated=structuredClone(account);
  let value=0,incomplete=false;
  const settings=snapshot.settings;
  for(const p of updated.positions) {
    const q=quotes.get(p.code);
    if(!q||q.date!==snapshot.asOf||!(q.price>0)) {incomplete=true;reviews.push({code:p.code,kind:'manual',reason:'현재 평가가격 확인 필요'});continue;}
    value+=p.qty*q.price;
    if(p.entryDate>snapshot.asOf) {incomplete=true;reviews.push({code:p.code,kind:'manual',reason:'체결 이후 종가 갱신 대기'});continue;}
    if(p.observedThrough&&p.observedThrough>snapshot.asOf) {incomplete=true;reviews.push({code:p.code,kind:'manual',reason:'장부보다 이전 분석 자료입니다. 최신 자료를 불러오세요.'});continue;}
    if(p.entryDate<q.historyFirst||(q.lastShareChangeDate&&q.lastShareChangeDate>p.entryDate)) {incomplete=true;reviews.push({code:p.code,kind:'manual',reason:'보유 중 기업행사·가격 기준 확인 필요'});continue;}
    if(q.tradable===false) {reviews.push({code:p.code,kind:'manual',reason:'거래 가능 여부 확인 필요'});continue;}
    const since=p.observedThrough||p.entryDate,calendar=snapshot.recentDates||[];
    if(calendar.length&&since<calendar[0]) {incomplete=true;reviews.push({code:p.code,kind:'manual',reason:'고점 복원 기간을 넘어 과거 가격 확인 필요'});continue;}
    const known=(q.recentCloses||[]).filter((_,i)=>calendar[i]>=since);
    if(known.some(x=>!(x>0))) {incomplete=true;reviews.push({code:p.code,kind:'manual',reason:'보유 기간 가격 누락 확인 필요'});continue;}
    p.highWater=Math.max(p.highWater,q.price,...known);p.observedThrough=snapshot.asOf;
    p.stop=Math.max(p.stop||0,Math.max(p.avg,p.highWater)*(1-settings.stopFraction));
    const reason=q.price<=p.stop?'손절선 이하':q.ma60!==null&&q.price<q.ma60?'60일 평균선 하향 이탈':snapshot.selectionDue&&(!q.rank||q.rank>settings.retainThroughRank)?'선정 조건 또는 유지 순위 이탈':null;
    if(reason)actions.push({code:p.code,name:q.name,side:'sell',qty:p.qty,referencePrice:q.price,reason,signalDate:snapshot.asOf,execution:'다음 거래일 15:20~15:30 KRX 종가 동시호가 검토'});
    else reviews.push({code:p.code,name:q.name,kind:'hold',reason:'보유 조건 유지',stop:p.stop,referencePrice:q.price});
  }
  const equity=incomplete?null:updated.cash+value;
  let available=updated.cash,slots=settings.maxPositions-updated.positions.length;
  // Existing holdings count until an actual sale is recorded. Anticipated proceeds are unavailable.
  if(!stale&&!incomplete&&snapshot.selectionDue&&equity>0)for(const c of snapshot.candidates) {
    if(slots<=0)break;if(c.rank>(settings.entryTopRank??settings.maxPositions)||updated.positions.some(p=>p.code===c.code))continue;
    const budget=Math.min(equity*settings.positionFraction,available),qty=Math.floor(budget/c.price);
    if(qty<1)continue;
    actions.push({code:c.code,name:c.name,side:'buy',qty,referencePrice:c.price,reservedCash:budget,reason:`개발 기준 M1 ${c.rank}위`,signalDate:snapshot.asOf,execution:'다음 거래일 15:20~15:30 KRX 종가 동시호가 검토'});
    available-=budget;slots--;
  }
  return {asOf:snapshot.asOf,stale,incompleteValuation:incomplete,equity,cash:updated.cash,actions:stale?[]:actions,reviews,updatedAccount:updated,unreservedCash:available,mode:'development_manual_review',ordersGenerated:false,notice:stale?'자료가 오래되거나 날짜가 맞지 않아 매매 수량 안내를 보류합니다.':incomplete?'확인이 필요한 보유 종목이 있어 신규 매수 배분을 보류합니다.':!snapshot.selectionDue?'종목 재선정일이 아닙니다. 기존 보유의 매도 조건은 매일 점검합니다.':'미체결 매도대금은 신규 매수 예산에 포함하지 않습니다.'};
}
