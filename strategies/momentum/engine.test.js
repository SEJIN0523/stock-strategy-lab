import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percentile,feature,rankFeatures,simulate } from './engine.js';
const original=JSON.parse(readFileSync(new URL('./plan.json',import.meta.url)));
function fixture() {
  // Synthetic weekdays and prices, never used as real performance evidence.
  const calendar=[];
  for(let d=new Date('2023-01-02T00:00:00Z');calendar.length<420;d.setUTCDate(d.getUTCDate()+1))if(![0,6].includes(d.getUTCDay()))calendar.push(d.toISOString().slice(0,10));
  const stocks=['000001','000002'].map((code,n)=>({code,bars:calendar.map((date,i)=>{const p=100+i*(n?.15:.2);return [date,p,p,p,p,1e6,p*1e6,1e12,1e6,'KOSPI',1,'synthetic'];})}));
  const plan=structuredClone(original);Object.assign(plan.universe,{minimumPrice:0,minimumTurnover20:0});Object.assign(plan.portfolio,{maximumPositions:1,newEntryTopRanks:1});
  return {data:{calendar,stocks},plan,from:calendar[270],to:calendar[283]};
}
const run=(f,extra={})=>simulate(f.data,f.plan,f.plan.candidates[0],{from:f.from,to:f.to,...extra});
test('momentum percentiles use average ties, singleton neutrality and reject missing factors',()=>{
  assert.deepEqual(percentile([1,1,3]),[25,25,100]);assert.deepEqual(percentile([1]),[50]);assert.throws(()=>percentile([null]));
});
test('features use correct momentum lags and reject missing or sparse historical bars',()=>{
  const f=fixture(),s=f.data.stocks[0],v=feature(s,270,f.plan);
  assert.equal(v.mom6,s.bars[270][4]/s.bars[144][4]-1);assert.equal(v.mom12,s.bars[249][4]/s.bars[18][4]-1);
  assert.ok(feature(s,251,f.plan).excluded);delete s.bars[200];assert.equal(feature(s,270,f.plan).excluded,'missing_history');
});
test('M2 changes only the volatility term over the same eligible features',()=>{
  const f=fixture(),features=[{code:'A',price:1,mom6:1,mom12:1,lowVol:-1},{code:'B',price:1,mom6:1,mom12:1,lowVol:-.1}];
  assert.equal(rankFeatures(features,f.plan.candidates[0])[0].code,'A');assert.equal(rankFeatures(features,f.plan.candidates[1])[0].code,'B');
});
test('orders execute at next close with signal-fixed quantities, zero fees and no same-close fill',()=>{
  const f=fixture();f.data.stocks[0].bars[271][4]=f.data.stocks[0].bars[270][4];const r=run(f),fill=r.log.find(x=>x.event==='fill');
  assert.equal(fill.signalDate,f.from);assert.equal(fill.date,f.data.calendar[271]);assert.equal(fill.price,f.data.stocks[0].bars[271][4]);
  assert.equal(fill.intendedQty,Math.floor(f.plan.initialCash*.1/f.data.stocks[0].bars[270][4]));assert.equal(fill.qty,Math.min(fill.intendedQty,Math.floor(f.data.stocks[0].bars[271][5]*.01)));assert.equal(r.commission,0);assert.equal(r.slippage,0);assert.equal(r.curve[0].equity,f.plan.initialCash);
});
test('a fill-day gap beyond reserved cash cancels rather than resizing with future close',()=>{
  const f=fixture();f.to=f.data.calendar[273];f.data.stocks[0].bars[271][4]*=1.2;const r=run(f);
  assert.equal(r.log.filter(x=>x.event==='fill').length,0);assert.ok(r.log.some(x=>x.event==='cancel'));assert.equal(r.curve.at(-1).cash,f.plan.initialCash);
});
test('future suffix price and share changes cannot alter earlier signals or account history',()=>{
  const f=fixture(),a=run(f);for(const s of f.data.stocks)for(let i=284;i<s.bars.length;i++){s.bars[i][4]*=5;s.bars[i][8]*=2;}
  assert.deepEqual(run(f),a);
});
test('held share change censors the account without deleting its historical trades or reporting full metrics',()=>{
  const f=fixture();f.data.stocks[0].bars[271][4]=f.data.stocks[0].bars[270][4];f.data.stocks[0].bars[272][8]*=2;
  const r=run(f);assert.equal(r.failure.date,f.data.calendar[272]);assert.equal(r.fullPeriodMetrics,null);assert.ok(r.log.some(x=>x.event==='fill'));assert.equal(r.curve.at(-1).date,f.data.calendar[271]);
});
test('unknown share change on pending buy cancels purchase instead of manufacturing holder units',()=>{
  const f=fixture();f.to=f.data.calendar[273];f.data.stocks[0].bars[271][8]*=2;const r=run(f);
  assert.equal(r.failure,null);assert.ok(r.log.some(x=>x.reason==='buy_share_basis_unresolved'));assert.equal(r.holdings.length,0);
});
test('missing held valuation censors instead of silently forward-filling a disappearing stock',()=>{
  const f=fixture();f.data.stocks[0].bars[271][4]=f.data.stocks[0].bars[270][4];f.data.stocks[0].bars[272]=null;
  const r=run(f);assert.match(r.failure.reason,/valuation/);assert.equal(r.fullPeriodMetrics,null);
});
test('stop is checked after close and sale is next close with dated sales tax',()=>{
  const f=fixture();f.to=f.data.calendar[275];f.data.stocks[0].bars[271][4]=f.data.stocks[0].bars[270][4];
  f.data.stocks[0].bars[272][4]=200;f.data.stocks[0].bars[273][4]=160;f.data.stocks[0].bars[274][4]=150;
  const r=run(f),sale=r.log.find(x=>x.event==='fill'&&x.side==='sell');assert.equal(sale.signalDate,f.data.calendar[273]);assert.equal(sale.date,f.data.calendar[274]);assert.equal(sale.tax,sale.qty*150*.0018);assert.equal(sale.reason,'stop');
});
test('volume cap permits partial sells and carries residual quantity',()=>{
  const f=fixture();f.to=f.data.calendar[276];f.data.stocks[0].bars[271][4]=f.data.stocks[0].bars[270][4];
  f.data.stocks[0].bars[272][4]=100;f.data.stocks[0].bars[273][4]=100;f.data.stocks[0].bars[273][5]=100;
  const r=run(f),sales=r.log.filter(x=>x.event==='fill'&&x.side==='sell');assert.equal(sales[0].qty,1);assert.ok(sales[1].date>sales[0].date);assert.ok(sales[1].qty>1);
});
test('untradable sale is deferred and cannot fund another stock in the same auction',()=>{
  const f=fixture();Object.assign(f.plan.portfolio,{initialPositionFraction:1,selectionEverySessions:1});
  // Keep first fill price unchanged so the reserved full-capital quantity can execute.
  f.data.stocks[0].bars[271][4]=f.data.stocks[0].bars[270][4];f.data.stocks[0].bars[272][4]=100;f.data.stocks[0].bars[273][10]=0;
  const r=run(f);assert.ok(r.log.some(x=>x.event==='defer'));const firstSale=r.log.find(x=>x.side==='sell'&&x.event==='fill');
  assert.ok(firstSale);assert.ok(!r.log.some(x=>x.code==='000002'&&x.event==='fill'&&x.date<=firstSale.date));
});
