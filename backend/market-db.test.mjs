import test from 'node:test';
import assert from 'node:assert/strict';
import { openMarketDb,importSnapshot,dbSummary,exportCompact } from './market-db.mjs';
import { normalizeMarketData } from '../market-data.js';

const row=(date,code='000001',close='110')=>({BAS_DD:date.replaceAll('-',''),ISU_CD:code,ISU_NM:'테스트 종목',TDD_OPNPRC:'100',TDD_CLSPRC:close,ACC_TRDVOL:'1000',TDD_HGPRC:'120',TDD_LWPRC:'90',ACC_TRDVAL:'100000'});
test('same snapshot import is idempotent and corrected partition removes obsolete rows',()=>{
 const db=openMarketDb(':memory:');try{
  const snapshot={date:'2024-01-02',market:'KOSPI',rows:[row('2024-01-02'),row('2024-01-02','000002')]};
  assert.equal(importSnapshot(db,snapshot).changed,true);assert.equal(importSnapshot(db,snapshot).changed,false);assert.equal(dbSummary(db).rows,2);
  importSnapshot(db,{...snapshot,rows:[row('2024-01-02','000001','115')]});
  assert.equal(dbSummary(db).rows,1);assert.equal(db.prepare('SELECT close FROM daily_bars').get().close,115);
 }finally{db.close();}
});
test('invalid correction rolls back prices and original source hash',()=>{
 const db=openMarketDb(':memory:');try{
  const snapshot={date:'2024-01-02',market:'KOSPI',rows:[row('2024-01-02')]};importSnapshot(db,snapshot);
  const hash=db.prepare('SELECT source_hash FROM daily_fetch').get().source_hash;
  assert.throws(()=>importSnapshot(db,{...snapshot,rows:[row('2024-01-02','000001','bad')]}));
  assert.equal(db.prepare('SELECT close FROM daily_bars').get().close,110);assert.equal(db.prepare('SELECT source_hash FROM daily_fetch').get().source_hash,hash);
 }finally{db.close();}
});
test('DB export requires full daily coverage and preserves null history',()=>{
 const db=openMarketDb(':memory:');try{
  for(let n=2;n<=5;n++){const date=`2024-01-0${n}`;importSnapshot(db,{date,market:'KOSPI',rows:[row(date)]});if(n>2)importSnapshot(db,{date,market:'KOSDAQ',rows:[]});}
  assert.throws(()=>exportCompact(db,{start:'2024-01-02',end:'2024-01-05'}),/수집하지 않은/);
  importSnapshot(db,{date:'2024-01-02',market:'KOSDAQ',rows:[]});
  const data=normalizeMarketData(exportCompact(db,{start:'2024-01-02',end:'2024-01-05'}));
  assert.equal(data.dates.length,4);assert.equal(data.stocks.length,1);assert.equal(data.stocks[0].bars[0].close,110);assert.equal(dbSummary(db).sectorRecords,0);
 }finally{db.close();}
});
