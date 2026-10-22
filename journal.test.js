import test from 'node:test';
import assert from 'node:assert/strict';
import {accountSummary,importTrades,parseReceiptLines,parseTradeText,findStock} from './journal.js';
import {recordCash,recordTrade} from './daily-decision.js';
const quotes=[{code:'000001',name:'가상전자',market:'KOSPI',date:'2026-02-02',price:100},{code:'000002',name:'가상',market:'KOSDAQ',date:'2026-02-02',price:500}];
const blank=()=>({cash:0,positions:[],log:[]});
test('average cost, partial sale, tax and filtered history use all earlier purchases',()=>{
 let a=recordCash(blank(),{id:'d',date:'2026-01-01',amount:10000,type:'deposit'});
 for(const t of [{id:'b1',date:'2026-01-02',side:'buy',qty:10,price:100},{id:'b2',date:'2026-01-03',side:'buy',qty:10,price:200},{id:'s1',date:'2026-02-01',side:'sell',qty:5,price:300},{id:'s2',date:'2026-02-02',side:'sell',qty:15,price:100}])a=recordTrade(a,{...t,code:'000001',market:'KOSPI'});
 const s=accountSummary(a,{asOf:'2026-02-02',quotes},{from:'2026-02-01'});assert.equal(s.realized,-6);assert.equal(s.winRate,.5);assert.equal(s.tax,6);assert.equal(s.tradeCount,2);assert.equal(s.equity,9994);assert.deepEqual(s.curve.map(x=>x.value),[747,-6]);
});
test('unknown cost basis and prices before a purchase never create profit figures',()=>{
 const a={cash:100,positions:[{code:'000001',qty:1,avg:100,highWater:100,entryDate:'2026-02-03'}],log:[{id:'old',date:'2026-02-01',code:'000001',market:'KOSPI',side:'sell',qty:1,price:100,tax:.2,cashAfter:100}]};
 const s=accountSummary(a,{asOf:'2026-02-02',quotes});assert.equal(s.realized,null);assert.equal(s.unrealized,null);assert.equal(s.equity,null);assert.deepEqual(s.curve,[]);
});
test('photo batches are atomic, duplicate aware, chronological and idempotent',()=>{
 const a=recordCash(blank(),{id:'d',date:'2026-01-01',amount:1000,type:'deposit'}),r={date:'2026-01-02',code:'000001',name:'가상전자',market:'KOSPI',side:'buy',qty:1,price:100};
 assert.throws(()=>importTrades(a,[r,{...r,qty:100}],{batchId:'bad'}));assert.equal(a.cash,1000);assert.equal(a.positions.length,0);
 const b=importTrades(a,[r],{batchId:'batch'});assert.equal(b.cash,900);assert.equal(importTrades(b,[r],{batchId:'batch'}).cash,900);assert.throws(()=>importTrades(b,[r],{batchId:'new'}));assert.throws(()=>importTrades(a,[{...r,date:'2026-01-03'}],{batchId:'future',today:'2026-01-02'}));
});
test('receipt geometry associates separate price column and preserves missing quantity for review',()=>{
 const l=(text,x,y)=>({text,bbox:{x0:x,x1:x+120,y0:y,y1:y+20}});
 const rows=parseReceiptLines([l('1.02 가상전자',10,10),l('2주 구매 완료',50,42),l('주당 10,000원',240,20),l('가상회사',50,130),l('주 구매 완료',50,162),l('주당 20,000원',240,140)],quotes);
 assert.equal(rows.length,2);assert.equal(rows[0].code,'000001');assert.equal(rows[0].price,10000);assert.equal(rows[1].qty,0);assert.equal(rows[1].code,'');assert.equal(rows[1].price,20000);
 assert.equal(findStock('가상 전자',quotes).code,'000001');
});
test('plain text with an independently read price column keeps price order',()=>{
 const rows=parseTradeText('가상전자\n2주 구매 완료\n가상\n3주 구매 완료\n주당 10,000원\n주당 20,000원',quotes);assert.deepEqual(rows.map(r=>r.price),[10000,20000]);
});
