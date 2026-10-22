import test from 'node:test';
import assert from 'node:assert/strict';
import { demoData, backtest } from './engine.js';
import { normalizeMarketData } from './market-data.js';

function compact() {
  return {format:'krx-stock-compact-v1',dates:['2024-01-02','2024-01-03','2024-01-04','2024-01-05'],stocks:[
    {code:'000001',name:'기존 종목',market:'KOSPI',bars:[[0,100,101,1000],[1,102,103,1000],[2,104,105,1000],[3,106,107,1000]]},
    {code:'000002',name:'신규 종목',market:'KOSDAQ',bars:[[2,200,201,1000],[3,202,203,1000]]}
  ]};
}
const p={ma:20,lookback:20,maxHold:5,rebalance:20,initial:10000000,fee:.015,tax:.2,slippage:.1,period:'train',range:{start:120,end:500}};
test('compact projection preserves prices, missing history, attribution and diagnostics',()=>{
  const data=normalizeMarketData(compact());
  assert.equal(data.stocks.length,2);assert.equal(data.stocks[1].bars[0],null);
  assert.equal(data.meta.report.missingBars,2);assert.equal(data.stocks[0].bars[0].close,101);assert.equal(data.meta.provider,'KRX');
});
test('compact projection rejects duplicate dates, invalid tuple order and duplicate codes',()=>{
  const a=compact();a.dates[1]=a.dates[0];assert.throws(()=>normalizeMarketData(a));
  const b=compact();b.stocks[0].bars[1][0]=0;assert.throws(()=>normalizeMarketData(b));
  const c=compact();c.stocks[1].code=c.stocks[0].code;assert.throws(()=>normalizeMarketData(c));
});
test('different lookbacks use exactly the same explicitly selected evaluation window',()=>{
  const data=demoData();
  const a=backtest(data,p),b=backtest(data,{...p,ma:120,lookback:60});
  assert.equal(a.start,b.start);assert.equal(a.end,b.end);assert.equal(a.curve.length,b.curve.length);
  assert.throws(()=>backtest(data,{...p,ma:120,range:{start:20,end:500}}),/구간/);
});
test('future holdout prices cannot change any training result',()=>{
  const data=demoData(),a=backtest(data,p);
  for(const stock of data.stocks)for(let i=500;i<data.dates.length;i++){stock.bars[i].open*=7;stock.bars[i].close*=8;}
  assert.deepEqual(a,backtest(data,p));
});
test('large overnight gaps and terminal untradable holdings are audited without removing losses',()=>{
  const data=demoData();data.stocks=data.stocks.slice(0,1);
  data.stocks[0].bars=data.dates.map((date,i)=>({date,open:i<5?100+i:30,close:i<5?101+i:30,volume:1000}));
  const end=data.dates.length-1;data.stocks[0].bars[end]={date:data.dates[end],open:0,close:0,volume:0};
  const r=backtest(data,{...p,ma:2,lookback:2,maxHold:1,rebalance:9999,period:'all',range:{start:2,end:data.dates.length}});
  assert.equal(r.largeGapExposures.length,1);assert.ok(r.return<-.5);assert.equal(r.terminalUntradable.length,1);assert.ok(r.staleValuations>0);
});
