import { DatabaseSync } from 'node:sqlite';
import { isoDate } from '../market-data.js';
import { createHash } from 'node:crypto';

export function openMarketDb(path,readOnly=false) {
  const db=new DatabaseSync(path,{readOnly});
  db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
  if(!readOnly)db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS daily_bars (
      date TEXT NOT NULL, code TEXT NOT NULL, market TEXT NOT NULL CHECK(market IN ('KOSPI','KOSDAQ')),
      name TEXT NOT NULL, open REAL NOT NULL, high REAL, low REAL, close REAL NOT NULL,
      volume REAL NOT NULL, turnover REAL, market_cap REAL, listed_shares REAL,
      PRIMARY KEY(date,code)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS bars_code_date ON daily_bars(code,date);
    CREATE TABLE IF NOT EXISTS daily_fetch (
      date TEXT NOT NULL, market TEXT NOT NULL, row_count INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('data','empty')), fetched_at TEXT NOT NULL,
      source_hash TEXT NOT NULL, PRIMARY KEY(date,market)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS sector_history (
      code TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
      sector_code TEXT NOT NULL, sector_name TEXT NOT NULL, source TEXT NOT NULL,
      observed_at TEXT NOT NULL, PRIMARY KEY(code,effective_from,source)
    ) WITHOUT ROWID;
    PRAGMA user_version=1;
  `);
  return db;
}

function value(raw,optional=false) {
  if(optional&&(raw===undefined||raw===null||raw===''||raw==='-'))return null;
  if(raw==='-')return 0;
  if(raw===undefined||raw===null||raw==='')throw new Error('필수 가격·거래량이 없습니다.');
  const n=Number(String(raw).replaceAll(',',''));
  if(!Number.isFinite(n)||n<0)throw new Error('가격·거래량 형식이 올바르지 않습니다.');
  return n;
}

export function importSnapshot(db,{date,market,rows,fetchedAt=new Date().toISOString()}) {
  date=isoDate(date);
  if(!['KOSPI','KOSDAQ'].includes(market)||!Array.isArray(rows))throw new Error('지원하지 않는 일별 자료입니다.');
  const hash=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  if(db.prepare('SELECT source_hash FROM daily_fetch WHERE date=? AND market=?').get(date,market)?.source_hash===hash)return {changed:false,rows:rows.length};
  const insert=db.prepare('INSERT INTO daily_bars VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    // Replace one complete daily partition so upstream deletions are also reflected.
    db.prepare('DELETE FROM daily_bars WHERE date=? AND market=?').run(date,market);
    for(const row of rows) {
      if(isoDate(row.BAS_DD)!==date||!/^[0-9A-Z]{6}$/.test(row.ISU_CD)||typeof row.ISU_NM!=='string')throw new Error('KRX 종목 또는 날짜가 일치하지 않습니다.');
      insert.run(date,row.ISU_CD,market,row.ISU_NM,value(row.TDD_OPNPRC),value(row.TDD_HGPRC,true),value(row.TDD_LWPRC,true),value(row.TDD_CLSPRC),value(row.ACC_TRDVOL),value(row.ACC_TRDVAL,true),value(row.MKTCAP,true),value(row.LIST_SHRS,true));
    }
    db.prepare(`INSERT INTO daily_fetch VALUES(?,?,?,?,?,?) ON CONFLICT(date,market) DO UPDATE SET row_count=excluded.row_count,status=excluded.status,fetched_at=excluded.fetched_at,source_hash=excluded.source_hash`).run(date,market,rows.length,rows.length?'data':'empty',fetchedAt,hash);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {changed:true,rows:rows.length};
}

export function dbSummary(db) {
  return {...db.prepare('SELECT COUNT(*) AS rows,COUNT(DISTINCT code) AS stocks,COUNT(DISTINCT date) AS tradingDays,MIN(date) AS first,MAX(date) AS last FROM daily_bars').get(),...db.prepare('SELECT MAX(date) AS lastFetched,COUNT(*) AS dailyPartitions FROM daily_fetch').get(),sectorRecords:db.prepare('SELECT COUNT(*) AS count FROM sector_history').get().count};
}

export function exportCompact(db,{start,end}) {
  start=isoDate(start);end=isoDate(end);
  if(end<start)throw new Error('내보내기 기간을 확인하세요.');
  const partitions=db.prepare('SELECT date,market,row_count FROM daily_fetch WHERE date BETWEEN ? AND ? ORDER BY date,market').all(start,end);
  const expected=((Date.parse(end)-Date.parse(start))/86400000+1)*2;
  if(partitions.length!==expected)throw new Error('범위 안에 아직 수집하지 않은 날짜·시장이 있습니다.');
  const dates=db.prepare('SELECT DISTINCT date FROM daily_bars WHERE date BETWEEN ? AND ? ORDER BY date').all(start,end).map(row=>row.date);
  const index=new Map(dates.map((date,i)=>[date,i])),stocks=new Map();
  for(const row of db.prepare('SELECT date,code,name,market,open,close,volume FROM daily_bars WHERE date BETWEEN ? AND ? ORDER BY date,code').iterate(start,end)) {
    if(!stocks.has(row.code))stocks.set(row.code,{code:row.code,name:row.name,market:row.market,bars:[]});
    const stock=stocks.get(row.code);stock.name=row.name;stock.market=row.market;
    stock.bars.push([index.get(row.date),row.open,row.close,row.volume]);
  }
  return {format:'krx-stock-compact-v1',collectedAt:new Date().toISOString(),requestedRange:{start,end},dates,stocks:[...stocks.values()].sort((a,b)=>a.code.localeCompare(b.code)),emptyDates:partitions.filter(row=>row.row_count===0).map(({date,market})=>({date,market})),storage:'SQLite'};
}
