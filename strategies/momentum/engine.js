import { saleTaxPercent } from '../../taxes.js';

// Input tuples: date,open,high,low,close,volume,turnover,cap,shares,market,tradable,sourceHash.
const finite=Number.isFinite;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
export function percentile(values) {
  if(values.some(v=>!finite(v)))throw Error('Nonfinite factor');
  const a=values.map((v,i)=>({v,i})).sort((x,y)=>x.v-y.v),out=[];
  for(let i=0;i<a.length;) {
    let j=i+1;while(j<a.length&&a[j].v===a[i].v)j++;
    const p=a.length===1?50:100*(i+j-1)/2/(a.length-1);
    for(let k=i;k<j;k++)out[a[k].i]=p;i=j;
  }
  return out;
}
export function feature(stock,t,plan) {
  const u=plan.universe,b=stock.bars,r=b[t];
  if(t<252||!r||r[10]!==1)return {excluded:'missing_current_or_short_history'};
  const h=Array.from(b.slice(t-252,t+1));
  if(h.some(x=>!x||!(x[4]>0)))return {excluded:'missing_history'};
  if(h.some((x,j)=>j&&(x[4]/h[j-1][4]>1+u.maximumRawUpMove||x[4]/h[j-1][4]<1-u.maximumRawDownMove)))return {excluded:'unadjusted_past_price_discontinuity'};
  const tv=mean(h.slice(-20).map(x=>x[6]));
  if(r[4]<u.minimumPrice||tv<u.minimumTurnover20||r[7]<u.minimumMarketCap)return {excluded:'price_liquidity_or_size'};
  const ma120=mean(h.slice(-120).map(x=>x[4])),mom6=r[4]/h.at(-127)[4]-1,mom12=h.at(-22)[4]/h[0][4]-1;
  if((u.priceAboveMA120&&r[4]<=ma120)||(u.positiveMomentum6And12_1&&!(mom6>0&&mom12>0)))return {excluded:'trend_or_momentum'};
  const v=h.slice(-61),lr=v.slice(1).map((x,j)=>Math.log(x[4]/v[j][4])),mu=mean(lr),vol=Math.sqrt(lr.reduce((s,x)=>s+(x-mu)**2,0)/(lr.length-1));
  return {code:stock.code,price:r[4],mom6,mom12,lowVol:-vol};
}
export function rankFeatures(features,candidate) {
  const rows=features.filter(x=>!x.excluded),m6=percentile(rows.map(x=>x.mom6)),m12=percentile(rows.map(x=>x.mom12)),lv=percentile(rows.map(x=>x.lowVol));
  return rows.map((r,i)=>({...r,momentum:(m6[i]+m12[i])/2,score:candidate.momentumWeight*(m6[i]+m12[i])/2+candidate.lowVolatilityWeight*lv[i]})).sort((a,b)=>b.score-a.score||a.code.localeCompare(b.code)).map((r,i)=>({...r,rank:i+1}));
}
export function metrics(curve,initial) {
  if(!curve.length)return null;
  let peak=initial,mdd=0;
  for(const r of curve){peak=Math.max(peak,r.equity);mdd=Math.min(mdd,r.equity/peak-1);}
  const last=curve.at(-1),years=(Date.parse(last.date)-Date.parse(curve[0].date))/86400000/365.25;
  return {from:curve[0].date,to:last.date,return:last.equity/initial-1,cagr:years>=1?(last.equity/initial)**(1/years)-1:null,mdd,finalEquity:last.equity,sessions:curve.length};
}
const shareChanged=(a,b,threshold)=>a&&b&&a[8]>0&&b[8]>0&&Math.abs(b[8]/a[8]-1)>threshold;
export function simulate(data,plan,candidate,{from,to,featureCache=new Map()}={}) {
  if(!from||!to||from>to||plan.execution.policy!=='A')throw Error('Unsupported window or policy');
  if(plan.universe.requiredSessions!==253||!Number.isInteger(plan.portfolio.selectionEverySessions)||plan.portfolio.selectionEverySessions<1||!Number.isInteger(plan.portfolio.maximumPositions)||plan.portfolio.maximumPositions<1||!(plan.initialCash>0)||!(plan.portfolio.initialPositionFraction>0&&plan.portfolio.initialPositionFraction<=1)||!(plan.exits.trailingStopFraction>0&&plan.exits.trailingStopFraction<1)||!(plan.execution.dailyVolumeParticipation>0&&plan.execution.dailyVolumeParticipation<=1)||plan.costs.commission!==0||plan.costs.slippage!==0||!finite(candidate.momentumWeight)||!finite(candidate.lowVolatilityWeight)||candidate.momentumWeight<0||candidate.lowVolatilityWeight<0||Math.abs(candidate.momentumWeight+candidate.lowVolatilityWeight-1)>1e-9)throw Error('Unsupported research parameters');
  const start=data.calendar.findIndex(d=>d>=from),end=data.calendar.findLastIndex(d=>d<=to);
  if(start<253||end<=start)throw Error('Insufficient evaluation history');
  const byCode=new Map(data.stocks.map(s=>[s.code,s])),positions=new Map(),pending=new Map(),curve=[],log=[],decisions=[];
  let cash=plan.initialCash,taxPaid=0,turnover=0,failure=null;
  const initial=plan.initialCash,pf=plan.portfolio,ex=plan.execution,gate=plan.dataGates;
  const bar=(code,t)=>byCode.get(code).bars[t];
  for(let t=start;t<=end;t++) {
    const date=data.calendar[t];
    // No historical removal of stocks because they will later have an event.
    for(const [code] of positions) {
      const r=bar(code,t);
      if(!r||!(r[4]>0)){failure={date,code,reason:'held_valuation_or_delisting_settlement_missing'};break;}
      if(shareChanged(bar(code,t-1),r,gate.heldShareChangeAboveFraction)){failure={date,code,reason:'held_share_entitlement_unresolved'};break;}
    }
    if(failure)break;
    const orders=[...pending.values()].sort((a,b)=>Number(a.side==='buy')-Number(b.side==='buy')||a.code.localeCompare(b.code));
    pending.clear();
    for(const od of orders) {
      if(!(od.signalDate<date))throw Error('Same-session execution');
      const r=bar(od.code,t),p=positions.get(od.code);
      if(od.side==='buy'&&shareChanged(bar(od.code,t-1),r,gate.heldShareChangeAboveFraction)) {log.push({...od,date,event:'cancel',reason:'buy_share_basis_unresolved'});continue;}
      if(!r||r[10]!==1||!(r[4]>0&&r[5]>0)) {
        log.push({...od,date,event:od.side==='buy'?'cancel':'defer',reason:'untradable'});
        if(od.side==='sell')pending.set(od.code,od);continue;
      }
      const cap=Math.floor(r[5]*ex.dailyVolumeParticipation),qty=Math.min(od.qty,cap),price=r[4];
      if(od.side==='buy') {
        // Price is observed at fill only; intended quantity is never recomputed using it.
        if(positions.has(od.code)||positions.size>=pf.maximumPositions||od.qty*price>od.budget+1e-7||od.qty*price>cash+1e-7||qty<1) {
          log.push({...od,date,event:'cancel',reason:'budget_gap_position_or_volume_limit'});continue;
        }
        const gross=qty*price;cash-=gross;turnover+=gross;
        positions.set(od.code,{qty,avg:price,high:price,stop:price*(1-plan.exits.trailingStopFraction)});
        log.push({...od,date,event:'fill',intendedQty:od.qty,qty,price,gross,tax:0,taxPercent:0,cashAfter:cash,sourceHash:r[11]});
        if(qty<od.qty)log.push({...od,date,event:'cancel',qty:od.qty-qty,reason:'buy_volume_remainder'});
      }else if(p) {
        const sellQty=Math.min(qty,p.qty);
        if(sellQty>0) {
          const rate=saleTaxPercent(date,r[9]),gross=sellQty*price,tax=gross*rate/100;
          cash+=gross-tax;taxPaid+=tax;turnover+=gross;p.qty-=sellQty;
          log.push({...od,date,event:'fill',intendedQty:od.qty,qty:sellQty,price,gross,tax,taxPercent:rate,cashAfter:cash,sourceHash:r[11]});
          if(!p.qty)positions.delete(od.code);
        }
        if(od.qty>sellQty)pending.set(od.code,{...od,qty:od.qty-sellQty});
      }
      if(cash<-.00001)throw Error('Negative cash');
    }
    const equity=cash+[...positions].reduce((s,[code,p])=>s+p.qty*bar(code,t)[4],0);
    curve.push({date,equity,cash,positions:positions.size,cashWeight:cash/equity});
    // Decisions at T close are executable no earlier than T+1.
    const cycle=(t-start)%pf.selectionEverySessions===0;
    let ranks;
    if(cycle) {
      if(!featureCache.has(t))featureCache.set(t,data.stocks.map(s=>feature(s,t,plan)));
      const features=featureCache.get(t);ranks=rankFeatures(features,candidate);
      decisions.push({date,eligible:ranks.length,excluded:features.filter(x=>x.excluded).reduce((s,x)=>(s[x.excluded]=(s[x.excluded]||0)+1,s),{}),top:ranks.slice(0,pf.newEntryTopRanks)});
    }
    const rankMap=ranks?new Map(ranks.map(r=>[r.code,r.rank])):null;
    for(const [code,p] of positions) {
      const r=bar(code,t);p.high=Math.max(p.high,r[4]);p.stop=Math.max(p.stop,p.high*(1-plan.exits.trailingStopFraction));
      if(pending.has(code))continue;
      const history=Array.from(byCode.get(code).bars.slice(t-59,t+1)),ma60=history.length===60&&history.every(x=>x?.[4]>0)?mean(history.map(x=>x[4])):null;
      const reason=r[4]<=p.stop?'stop':plan.exits.dailyBelowMA60&&ma60!==null&&r[4]<ma60?'MA60':cycle&&(!rankMap.has(code)||rankMap.get(code)>pf.retainThroughRank)?'selection_rank':null;
      if(reason&&t<end)pending.set(code,{code,side:'sell',qty:p.qty,signalDate:date,reason});
    }
    if(cycle&&t<end) {
      let available=cash; // No anticipated proceeds of pending sells.
      let slots=pf.maximumPositions-positions.size;
      for(const r of ranks.slice(0,pf.newEntryTopRanks)) {
        if(slots<=0)break;if(positions.has(r.code)||pending.has(r.code))continue;
        const budget=Math.min(equity*pf.initialPositionFraction,available),qty=Math.floor(budget/r.price);
        if(qty<1)continue;
        pending.set(r.code,{code:r.code,side:'buy',qty,budget,referencePrice:r.price,signalDate:date,reason:'rank_entry'});
        available-=budget;slots--;
      }
    }
  }
  const full=!failure&&curve.length===end-start+1,summary=metrics(curve,initial);
  return {candidate:candidate.id,requested:{from,to},status:full?'completed_price_return_scenario':'censored_data_failure',failure,fullPeriodMetrics:full?summary:null,observedPrefixMetrics:summary,taxPaid,commission:0,slippage:0,turnover,averageCashWeight:curve.length?mean(curve.map(r=>r.cashWeight)):null,curve,log,decisions,holdings:[...positions].map(([code,p])=>({code,...p})),pending:[...pending.values()],recommendationsEnabled:false};
}
