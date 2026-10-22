import test from 'node:test';
import assert from 'node:assert/strict';
import { saleTaxPercent } from './taxes.js';
import { normalizeMarketData } from './market-data.js';
import { backtest } from './engine.js';

test('sale tax uses confirmed execution-date transitions, including year-end settlement boundaries',()=>{
 for(const market of ['KOSPI','KOSDAQ']){
  assert.equal(saleTaxPercent('2024-12-26',market),.18);assert.equal(saleTaxPercent('2024-12-27',market),.15);
  assert.equal(saleTaxPercent('2025-12-26',market),.15);assert.equal(saleTaxPercent('2025-12-29',market),.20);
  assert.equal(saleTaxPercent('2026-10-21',market),.20);
 }
 assert.throws(()=>saleTaxPercent('2027-01-02','KOSPI'));assert.throws(()=>saleTaxPercent('2026-01-02','ETF'));
});
test('tax-only run charges zero fees and slippage, taxes only sales and itemizes total costs',()=>{
 const dates=['2025-12-23','2025-12-24','2025-12-26','2025-12-29','2025-12-30'];
 const data=normalizeMarketData({format:'krx-stock-compact-v1',dates,stocks:[{code:'000001',name:'테스트',market:'KOSPI',bars:dates.map((_,i)=>[i,100+i,101+i,1000])}]});
 const result=backtest(data,{ma:2,lookback:2,maxHold:1,rebalance:1,initial:100000,fee:0,tax:.2,slippage:0,taxMode:'krx-2024-2026',period:'all',allowRaw:true});
 assert.equal(result.totalCommission,0);assert.equal(result.totalSlippage,0);assert.equal(result.totalCosts,result.totalTax);
 assert.ok(result.trades.filter(t=>t.side==='매수').every(t=>t.tax===0));
 assert.ok(result.trades.filter(t=>t.side==='매도').every(t=>t.taxPercent===.2&&Math.abs(t.tax-t.qty*t.price*.002)<1e-9));
});
