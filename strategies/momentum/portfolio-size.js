export function withPositionCount(base,n) {
  if(!Number.isInteger(n)||n<1||n>30)throw Error('보유 상한은 1~30 정수여야 합니다.');
  const plan=structuredClone(base);
  plan.portfolio.maximumPositions=n;
  plan.portfolio.newEntryTopRanks=n;
  plan.portfolio.initialPositionFraction=1/n;
  return plan;
}
export function workload(run,through=run.curve.at(-1)?.date) {
  const curve=run.curve.filter(r=>r.date<=through),byDay=new Map(curve.map(r=>[r.date,new Set()]));
  const fills=run.log.filter(r=>r.date<=through&&r.event==='fill');
  for(const r of run.log)if(r.date<=through&&byDay.has(r.date))byDay.get(r.date).add(`${r.code}|${r.side}|${r.signalDate}|${r.reason}`);
  const counts=[...byDay.values()].map(s=>s.size).sort((a,b)=>a-b),mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  return {observedSessions:curve.length,meanHoldings:mean(curve.map(r=>r.positions)),maximumHoldings:curve.length?Math.max(...curve.map(r=>r.positions)):0,meanDailyOrderAttempts:mean(counts),p95DailyOrderAttempts:counts.length?counts[Math.ceil(.95*counts.length)-1]:0,maximumDailyOrderAttempts:counts.at(-1)||0,daysWithOrderAttempts:counts.filter(n=>n>0).length,filledOrders:fills.length,meaning:'일별 주문 시도·보유 수는 업무량 대용지표이며 실제 소요시간이 아닙니다.'};
}
