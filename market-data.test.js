import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFsc, isoDate, FSC_ENDPOINT } from './market-data.js';
import { collectionRange, readFscPage, collectFsc } from './backend/fsc-client.mjs';
import { backtest } from './engine.js';

const makeRow=(code,date,price=100,market='KOSPI')=>({srtnCd:code,basDt:date,itmsNm:`테스트 ${code}`,mrktCtg:market,mkp:String(price),clpr:String(price+2),trqu:'1000'});
const rows=Array.from({length:12},(_,i)=>makeRow('000001',`202401${String(i+1).padStart(2,'0')}`,100+i));
const payload=records=>({format:'fsc-stock-price-v2',records});
const settings={ma:2,lookback:2,maxHold:1,rebalance:1,initial:100000,fee:0,tax:0,slippage:0,period:'all',allowRaw:true};

test('real data sorts dates, preserves codes, filters markets, and leaves missing dates empty',()=>{
  const data=normalizeFsc(payload([...rows].reverse().concat([makeRow('000002','20240105'),makeRow('000003','20240105',100,'KONEX')])));
  assert.equal(data.stocks.length,2);assert.equal(data.stocks[0].code,'000001');assert.equal(data.dates[0],'2024-01-01');
  assert.equal(data.stocks[1].bars[0],null);assert.equal(data.meta.report.excludedMarket,1);assert.equal(data.meta.report.missingBars,11);
});
test('rejects invalid dates, invalid prices, conflicting duplicates, and unsupported formats',()=>{
  assert.throws(()=>isoDate('20240230'));
  assert.throws(()=>normalizeFsc(payload([...rows,{...rows[0],mkp:'garbage'}])));
  assert.throws(()=>normalizeFsc(payload([...rows,{...rows[0],mkp:'999'}])),/중복/);
  assert.throws(()=>normalizeFsc({records:rows}));
});
test('non-adjusted real data requires explicit preliminary analysis flag',()=>{
  const data=normalizeFsc(payload(rows));
  assert.throws(()=>backtest(data,{...settings,allowRaw:false}),/비수정/);
  assert.ok(Number.isFinite(backtest(data,settings).return));
});
test('new listings are not backfilled or bought before sufficient history',()=>{
  const data=normalizeFsc(payload([...rows,...rows.slice(6).map(row=>({...row,srtnCd:'000002',mkp:'200',clpr:String(Number(row.clpr)+100)}))]));
  const r=backtest(data,{...settings,maxHold:2});
  assert.ok(r.trades.filter(t=>t.code==='000002').every(t=>t.date>='2024-01-09'));
});
test('missing opening price blocks liquidation and stale holdings are reported',()=>{
  const missing=rows.map((row,i)=>i>=5?{...row,mkp:'0',clpr:'0',trqu:'0'}:row);
  const r=backtest(normalizeFsc(payload(missing)),settings);
  assert.ok(r.blockedOrders>0);assert.ok(r.staleValuations>0);assert.equal(r.holdings,1);
  assert.ok(r.trades.every(t=>t.date<'2024-01-06'));assert.ok(r.curve.every(p=>Number.isFinite(p.equity)));
});
test('opening decisions do not use the same-day closing price or volume',()=>{
  const data=normalizeFsc(payload(rows));const a=backtest(data,settings);
  const first=data.dates.indexOf(a.start);data.stocks[0].bars[first].close=0;data.stocks[0].bars[first].volume=0;
  const b=backtest(data,settings);assert.deepEqual(a.trades.filter(t=>t.date===a.start),b.trades.filter(t=>t.date===b.start));
});
test('API singleton/empty pages accepted; errors and truncation rejected without echoing secrets',()=>{
  assert.equal(readFscPage({response:{header:{resultCode:'00'},body:{totalCount:'1',items:{item:rows[0]}}}}).records.length,1);
  assert.deepEqual(readFscPage({response:{header:{resultCode:'00'},body:{totalCount:'0',items:''}}}).records,[]);
  assert.throws(()=>readFscPage({response:{header:{resultCode:'30',resultMsg:'secret-key'}}}),e=>!e.message.includes('secret-key'));
  assert.throws(()=>readFscPage({response:{header:{resultCode:'00'},body:{totalCount:'2'}}}));
});
test('collector uses V2, pages both markets, encodes key once, and filters inclusive requested dates',async()=>{
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(new URL(url));const market=url.searchParams.get('mrktCls'),page=Number(url.searchParams.get('pageNo'));
    const item=market==='KOSPI'?(page===1?rows.slice(0,6):rows.slice(6)):[makeRow('000002','20240113',150,'KOSDAQ')];
    return {ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{totalCount:market==='KOSPI'?12:1,items:{item}}}})};
  };
  const result=await collectFsc({key:'abc%2B%2F%3D',start:'2024-01-01',end:'2024-01-12',fetchImpl,pause:async()=>{}});
  assert.equal(result.records.length,12);assert.equal(calls.length,3);
  assert.equal(calls[0].origin+calls[0].pathname,FSC_ENDPOINT);
  assert.equal(calls[0].searchParams.get('serviceKey'),'abc+/=');
  assert.equal(calls[0].searchParams.get('endBasDt'),'20240113');
});
test('collector detects repeated pages, changed counts, missing keys, and oversized date ranges',async()=>{
  assert.throws(()=>collectionRange('2024-01-01','2026-01-01'));
  await assert.rejects(collectFsc({key:'',start:'2024-01-01',end:'2024-01-12'}),/SERVICE_KEY/);
  const fetchImpl=async()=>({ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{totalCount:24,items:{item:rows}}}})});
  await assert.rejects(collectFsc({key:'test',start:'2024-01-01',end:'2024-01-12',fetchImpl,pause:async()=>{}}),/중복/);
});
