import test from 'node:test';
import assert from 'node:assert/strict';
import { requestKrxDay, collectKrx } from './krx-client.mjs';
import { normalizeMarketData } from '../market-data.js';

const row=date=>({BAS_DD:date,ISU_CD:'000001',ISU_NM:'테스트 주권',TDD_OPNPRC:'1,000',TDD_CLSPRC:'1,050',ACC_TRDVOL:'5,000'});
test('KRX key is transmitted only as header to the fixed official endpoint',async()=>{
  let request;
  const records=await requestKrxDay({key:'private-test-key',date:'2024-01-02',market:'KOSPI',fetchImpl:async(url,options)=>{
    request={url,options};return {ok:true,json:async()=>({OutBlock_1:[row('20240102')]})};
  }});
  assert.equal(records.length,1);assert.equal(request.url.origin,'https://data-dbg.krx.co.kr');
  assert.equal(request.url.pathname,'/svc/apis/sto/stk_bydd_trd');
  assert.equal(request.options.headers.AUTH_KEY,'private-test-key');
  assert.ok(!request.url.href.includes('private-test-key'));assert.equal(request.options.redirect,'error');
});
test('KRX rejects authentication failures, mismatched dates, and duplicate tickers',async()=>{
  const call=json=>requestKrxDay({key:'test',date:'2024-01-02',market:'KOSPI',fetchImpl:async()=>({ok:true,json:async()=>json})});
  await assert.rejects(call({error:'private-test-key'}),e=>!e.message.includes('private-test-key'));
  await assert.rejects(call({OutBlock_1:[row('20240103')]}),/기준일/);
  await assert.rejects(call({OutBlock_1:[row('20240102'),row('20240102')]}),/중복/);
});
test('KRX collector covers both markets and keeps empty dates explicit',async()=>{
  const payload=await collectKrx({key:'test',start:'2024-01-01',end:'2024-01-05',pause:async()=>{},fetchImpl:async url=>{
    const date=url.searchParams.get('basDd');return {ok:true,json:async()=>({OutBlock_1:date==='20240101'?[]:[row(date)]})};
  }});
  assert.equal(payload.markets.length,2);assert.equal(payload.emptyDates.length,2);
  // Simulated markets intentionally share a code; evaluate one market to avoid conflating identities.
  const parsed=normalizeMarketData({...payload,markets:[payload.markets[0]]});
  assert.equal(parsed.meta.provider,'KRX');assert.equal(parsed.dates.length,4);assert.equal(parsed.stocks[0].bars[0].open,1000);
});
test('KRX normalization treats dash prices as unavailable and keeps source attribution',()=>{
  const records=Array.from({length:4},(_,i)=>({...row(`2024010${i+2}`),TDD_OPNPRC:i===0?'-':'100'}));
  const data=normalizeMarketData({format:'krx-stock-daily-v1',markets:[{market:'KOSPI',records}]});
  assert.equal(data.stocks[0].bars[0].open,0);assert.match(data.meta.source,/한국거래소 통계정보/);
});
