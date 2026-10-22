import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccount,recordCash,recordTrade,decisions } from './daily-decision.js';
function fixture() {
  const q={code:'000001',name:'가상종목',date:'2026-10-21',price:100,ma60:90,historyFirst:'2025-01-01',lastShareChangeDate:null,rank:1,tradable:true,recentCloses:[100,100]};
  return {snapshot:{schema:'momentum.daily.v1',asOf:'2026-10-21',selectionDue:true,recentDates:['2026-10-20','2026-10-21'],settings:{maxPositions:10,positionFraction:.1,stopFraction:.15,retainThroughRank:20},quotes:[q],candidates:[{...q}]},account:{cash:10000,positions:[],log:[]}};
}
const position=extra=>({code:'000001',qty:10,avg:100,highWater:100,entryDate:'2026-10-20',...extra});
test('cash and trade records alter a cloned ledger; duplicate IDs are idempotent',()=>{
  const empty={cash:0,positions:[],log:[]},a=recordCash(empty,{id:'deposit',date:'2026-10-21',type:'deposit',amount:10000});
  const trade={id:'buy',date:'2026-10-21',code:'000001',side:'buy',price:100,qty:10,market:'KOSPI'},b=recordTrade(a,trade);
  assert.equal(empty.cash,0);assert.equal(a.positions.length,0);assert.equal(b.cash,9000);assert.equal(b.positions[0].avg,100);assert.equal(recordTrade(b,trade),b);assert.throws(()=>recordTrade(b,{...trade,qty:11}));
  const c=recordTrade(b,{...trade,id:'sell',side:'sell',price:110,qty:5});assert.equal(c.positions[0].qty,5);assert.equal(c.cash,9000+550-550*.002);assert.equal(c.log.at(-1).tax,1.1);
});
test('insufficient cash, excess sells, retroactive records and malformed restored logs are rejected',()=>{
  const {account}=fixture();assert.throws(()=>recordTrade(account,{id:'x',date:'2026-10-21',code:'000001',side:'buy',price:1000,qty:11}));
  assert.throws(()=>recordTrade(account,{id:'x',date:'2026-10-21',code:'000001',side:'sell',price:100,qty:1}));
  const a=recordCash(account,{id:'x',date:'2026-10-22',type:'deposit',amount:1});assert.throws(()=>recordCash(a,{id:'y',date:'2026-10-21',type:'deposit',amount:1}));
  assert.throws(()=>validateAccount({...account,log:[{id:'x',date:'2026-10-21',cashAfter:1,side:'buy',code:'000001',price:1,qty:'<img>'}]}));
});
test('proposals reserve current cash and do not mutate an actual portfolio or generate orders',()=>{
  const f=fixture(),r=decisions(f.snapshot,f.account,'2026-10-22');assert.equal(r.actions[0].qty,10);assert.equal(r.unreservedCash,9000);assert.equal(r.ordersGenerated,false);assert.equal(f.account.positions.length,0);
});
test('anticipated sale proceeds and scheduled exits cannot fund new purchases',()=>{
  const f=fixture();f.account={cash:0,positions:[position()],log:[]};f.snapshot.quotes[0].price=70;
  f.snapshot.candidates=[{code:'000002',name:'새종목',rank:1,price:10}];const r=decisions(f.snapshot,f.account,'2026-10-22');assert.equal(r.actions.length,1);assert.equal(r.actions[0].side,'sell');assert.equal(r.unreservedCash,0);
});
test('daily stops operate on non-selection days while new entries wait for selection',()=>{
  const f=fixture();f.snapshot.selectionDue=false;assert.equal(decisions(f.snapshot,f.account,'2026-10-22').actions.length,0);
  f.account.positions=[position({highWater:150})];assert.equal(decisions(f.snapshot,f.account,'2026-10-22').actions[0].side,'sell');
});
test('known daily closing history restores missed peaks and ratchets stops without lowering',()=>{
  const f=fixture();f.account.positions=[position()];f.snapshot.quotes[0].recentCloses=[150,100];const a=decisions(f.snapshot,f.account,'2026-10-22');
  assert.equal(a.updatedAccount.positions[0].highWater,150);assert.equal(a.updatedAccount.positions[0].stop,127.5);assert.equal(a.actions[0].side,'sell');
  f.snapshot.quotes[0].recentCloses=[100,100];const b=decisions(f.snapshot,a.updatedAccount,'2026-10-22');assert.equal(b.updatedAccount.positions[0].stop,127.5);
});
test('unresolved holdings get manual review while independent healthy exits remain available',()=>{
  const f=fixture();f.snapshot.quotes.push({...f.snapshot.quotes[0],code:'000002',price:70});f.snapshot.quotes[0].lastShareChangeDate='2026-10-21';
  f.account.positions=[position(),position({code:'000002'})];const r=decisions(f.snapshot,f.account,'2026-10-22');assert.equal(r.equity,null);assert.equal(r.incompleteValuation,true);assert.equal(r.actions.length,1);assert.equal(r.actions[0].code,'000002');assert.equal(r.actions[0].side,'sell');assert.ok(r.reviews.some(x=>x.kind==='manual'));
});
test('stale quotes, post-snapshot purchases and missing values never masquerade as current recommendations',()=>{
  const f=fixture();assert.equal(decisions(f.snapshot,f.account,'2026-10-27').actions.length,0);
  f.account.positions=[position({entryDate:'2026-10-22'})];assert.equal(decisions(f.snapshot,f.account,'2026-10-22').incompleteValuation,true);
  f.account.positions=[position({code:'000003'})];assert.equal(decisions(f.snapshot,f.account,'2026-10-22').equity,null);
});
test('a holding beyond the retained quote window is reviewed instead of inventing a high-water mark',()=>{
  const f=fixture();f.account.positions=[position({entryDate:'2026-09-01'})];const r=decisions(f.snapshot,f.account,'2026-10-22');assert.equal(r.incompleteValuation,true);assert.equal(r.actions.length,0);
});
test('candidate list length does not override entry rank, holding cap or per-position cash budget',()=>{
  const f=fixture();Object.assign(f.snapshot.settings,{maxPositions:3,entryTopRank:3,positionFraction:1/3});
  f.snapshot.candidates=Array.from({length:15},(_,i)=>({code:String(i+1).padStart(6,'0'),rank:i+1,name:'가상',price:100}));
  const r=decisions(f.snapshot,f.account,'2026-10-22');assert.equal(r.actions.length,3);assert.ok(r.actions.every(a=>a.qty===33));assert.ok(r.unreservedCash>=-.000001);
  f.account.positions=[position(),position({code:'000002'}),position({code:'000003'}),position({code:'000004'})];
  assert.ok(!decisions(f.snapshot,f.account,'2026-10-22').actions.some(a=>a.side==='buy'));
});
