import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {percentiles,priceFeatures,scoreUniverse} from './scoring.js';
import {manage,confirmResearchFill} from './manage.js';
const config=JSON.parse(readFileSync(new URL('./v1.json',import.meta.url),'utf8'));
const signal={code:'000001',close:100,topPercent:10,rankStatus:'valid',dailyReturn:0,entryEligible:true};
const context={sessionIndex:0,cashAvailable:10000,entryTargetValue:3000,positionSlotsAvailable:10,sectorSlotsAvailable:3};
const held={qty:10,averagePrice:100,highestClose:100,stopPrice:85,stopFraction:-.15,targetValue:3000,buyCount:1,firstFillSession:1,lastFillSession:1,partialExitLatched:false};
const snapshots=()=>Array.from({length:30},(_,i)=>({code:String(i+1).padStart(6,'0'),securityType:'stock',price:2000,marketCap:1e11+i*1e10,averageTurnover20:2e9,adjustedHistoryVerified:true,priceAvailableAtMs:1000,financialAvailableAtMs:1000,eps:100,bps:1000,rangePosition:i/30,momentum:i/100,largeMoveRisk:false,dailyReturn:0,sector:'산업 A',sectorAvailableAtMs:1000}));

test('percentiles handle ties and missing optional values without inventing data',()=>{
 assert.deepEqual(percentiles([10,20,20,30,null]),[0,50,50,100,50]);
 assert.deepEqual(percentiles([100]),[50]);
 assert.deepEqual(percentiles([1,10,100]),percentiles([0,Math.log(10),Math.log(100)]));
});
test('price features require 253 valid adjusted bars and skip the latest 21 sessions',()=>{
 const bars=Array.from({length:253},(_,i)=>({close:100+i,high:100+i,low:100+i}));
 const a=priceFeatures(bars);assert.equal(a.momentum,bars[231].close/bars[0].close-1);
 bars[252]={close:500,high:500,low:500};assert.equal(priceFeatures(bars).momentum,a.momentum);
 assert.throws(()=>priceFeatures(bars.slice(1)),/253/);
 const flat=Array.from({length:253},()=>({close:100,high:100,low:100}));assert.equal(priceFeatures(flat).rangePosition,.5);
 flat[252]={close:70,high:70,low:70};assert.equal(priceFeatures(flat).largeMoveRisk,true);
});
test('required financials and future data are excluded; missing growth alone is neutral',()=>{
 const rows=snapshots();rows[0].financialAvailableAtMs=6000;rows[1].eps=undefined;rows[2].priceAvailableAtMs=6000;
 const r=scoreUniverse(rows,{asOfMs:5000,config});assert.equal(r.excluded.length,3);assert.equal(r.universe.length,27);
 assert.ok(r.universe.every(row=>row.growthScore===50));
 const missing=scoreUniverse(rows.map(row=>({...row,financialAvailableAtMs:undefined})),{asOfMs:5000,config});assert.equal(missing.universe.length,0);assert.equal(missing.recommendations.length,0);
});
test('recommendations enforce sector cap, historical classification, and the exact -8% boundary',()=>{
 const rows=snapshots();rows[29].dailyReturn=-.08;rows[28].sectorAvailableAtMs=6000;
 const r=scoreUniverse(rows,{asOfMs:5000,config});assert.equal(r.recommendations.length,3);
 assert.ok(r.recommendations.every(row=>row.code!==rows[29].code&&row.code!==rows[28].code&&row.topPercent<=20));
});
test('first entry is one third and orders do not increment fills or use future prices',()=>{
 const d=manage(null,signal,context,config);assert.equal(d.order.qty,10);assert.equal(d.order.reservedCash,1000);assert.equal(d.order.executeSession,1);assert.equal(d.nextPosition,null);
 assert.throws(()=>confirmResearchFill(null,d.order,{price:101,qty:10,sessionIndex:1},config),/예약 예산/);
 const filled=confirmResearchFill(null,d.order,{price:100,qty:10,sessionIndex:1},config);assert.equal(filled.buyCount,1);assert.equal(filled.firstFillSession,1);
 assert.deepEqual(confirmResearchFill(filled,d.order,{price:100,qty:10,sessionIndex:1},config),filled);
});
test('second and third tranches wait from actual fills and cannot bypass the three-buy cap',()=>{
 assert.equal(manage(held,signal,{...context,sessionIndex:5},config).reason,'WAIT_SCALE_IN_SESSION');
 const second=manage(held,signal,{...context,sessionIndex:6},config);
 assert.equal(second.reason,'SCALE_IN');
 const p2=confirmResearchFill(second.nextPosition,second.order,{price:100,qty:10,sessionIndex:7},config);
 assert.equal(manage(p2,signal,{...context,sessionIndex:11},config).reason,'WAIT_SCALE_IN_SESSION');
 assert.equal(manage(p2,signal,{...context,sessionIndex:12},config).reason,'SCALE_IN');
 assert.equal(manage({...held,buyCount:3},signal,{...context,sessionIndex:30},config).reason,'MAX_BUYS_REACHED');
});
test('stop has priority over rank and cancels pending purchase intent',()=>{
 const d=manage(held,{...signal,close:80,topPercent:99},{...context,sessionIndex:20,pendingSide:'BUY'},config);
 assert.equal(d.reason,'STOP');assert.equal(d.order.qty,10);assert.equal(d.cancelPending,true);
});
test('stop does not fall and missing rank never invents a low rank',()=>{
 const existing={...held,stopPrice:95};
 const d=manage(existing,{...signal,close:100,rankStatus:'missing',topPercent:null},{...context,sessionIndex:20},config);
 assert.equal(d.nextPosition.stopPrice,95);assert.equal(d.reason,'RANK_DATA_UNAVAILABLE');assert.equal(d.order,null);
 const stopped=manage(existing,{...signal,close:90,rankStatus:'missing',topPercent:null},{...context,sessionIndex:20},config);assert.equal(stopped.reason,'STOP');
});
test('rank-half latch is set only on fill, suppresses repeat selling, and resets after recovery',()=>{
 const position={...held,qty:100,targetValue:10000};
 const d=manage(position,{...signal,topPercent:50,entryEligible:false},{...context,sessionIndex:20},config);
 assert.equal(d.reason,'RANK_HALF_EXIT');assert.equal(d.order.qty,50);assert.equal(d.nextPosition.partialExitLatched,false);
 const after=confirmResearchFill(d.nextPosition,d.order,{price:100,qty:50,sessionIndex:21},config);assert.equal(after.partialExitLatched,true);
 assert.equal(manage(after,{...signal,topPercent:50,entryEligible:false},{...context,sessionIndex:22},config).order,null);
 const recovered=manage(after,{...signal,topPercent:40,entryEligible:false},{...context,sessionIndex:23},config);assert.equal(recovered.nextPosition.partialExitLatched,false);
});
test('rank boundaries and portfolio limits are explicit',()=>{
 const position={...held,qty:100,targetValue:10000};
 assert.equal(manage(position,{...signal,topPercent:70,entryEligible:false},{...context,sessionIndex:20},config).reason,'RANK_HALF_EXIT');
 assert.equal(manage(position,{...signal,topPercent:70.01,entryEligible:false},{...context,sessionIndex:20},config).reason,'RANK_FULL_EXIT');
 assert.equal(manage(null,signal,{...context,sectorSlotsAvailable:0},config).reason,'PORTFOLIO_LIMIT');
 assert.equal(manage(null,signal,{...context,positionSlotsAvailable:undefined},config).reason,'PORTFOLIO_LIMIT');
 assert.equal(manage(null,{...signal,dailyReturn:-.08},context,config).order,null);
});
test('verified universe failure differs from missing data and proximity blocks averaging down',()=>{
 assert.equal(manage(held,{...signal,rankStatus:'ineligible',topPercent:null},{...context,sessionIndex:20},config).reason,'VERIFIED_UNIVERSE_EXIT');
 assert.equal(manage({...held,stopPrice:96},signal,{...context,sessionIndex:20},config).reason,'STOP_TOO_CLOSE_TO_ADD');
});
