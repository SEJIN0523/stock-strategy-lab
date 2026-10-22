import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openMarketDb,dbSummary } from './market-db.mjs';

const root=new URL('../private-data/',import.meta.url);
await mkdir(root,{recursive:true});
const db=openMarketDb(fileURLToPath(new URL('market.sqlite',root)));
try {
 db.exec(`
  CREATE TABLE IF NOT EXISTS fundamental_snapshots (
    code TEXT NOT NULL, period_end TEXT NOT NULL, available_at_ms INTEGER NOT NULL,
    source_id TEXT NOT NULL, source_url TEXT NOT NULL, eps_ttm REAL NOT NULL, bps REAL NOT NULL,
    eps_growth REAL, split_adjusted_share_decline REAL, confirmed_dividend_growth REAL,
    calculation_version TEXT NOT NULL, evidence_hash TEXT NOT NULL,
    PRIMARY KEY(code,period_end,available_at_ms,source_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS fundamentals_asof ON fundamental_snapshots(code,available_at_ms);
  CREATE TABLE IF NOT EXISTS adjusted_bars (
    code TEXT NOT NULL, date TEXT NOT NULL, available_at_ms INTEGER NOT NULL,
    basis_version TEXT NOT NULL, open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL,close REAL NOT NULL,
    source TEXT NOT NULL, evidence_hash TEXT NOT NULL,
    PRIMARY KEY(code,date,available_at_ms,basis_version)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS corporate_actions (
    code TEXT NOT NULL, effective_date TEXT NOT NULL, available_at_ms INTEGER NOT NULL,
    action_type TEXT NOT NULL, quantity_factor REAL, cash_per_share REAL,
    source_id TEXT NOT NULL, evidence_hash TEXT NOT NULL,
    PRIMARY KEY(code,effective_date,available_at_ms,action_type,source_id)
  ) WITHOUT ROWID;
 `);
 const summary=dbSummary(db);
 const count=table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
 const coverage={fundamentalSnapshots:count('fundamental_snapshots'),adjustedBars:count('adjusted_bars'),corporateActions:count('corporate_actions'),sectorHistory:count('sector_history')};
 const missing=[];
 if(!coverage.fundamentalSnapshots)missing.push('공시 시점별 재무자료');
 if(!coverage.adjustedBars)missing.push('수정 OHLC와 보정 기준');
 if(!coverage.corporateActions)missing.push('기업행사 원천·처리 검증');
 if(!coverage.sectorHistory)missing.push('과거 업종 분류');
 const report={createdAt:new Date().toISOString(),strategyId:'claude-close-v1-research',rawDatabase:summary,coverage,missingRequiredData:missing,rawHistoryAtLeast253:db.prepare('SELECT COUNT(*) AS n FROM (SELECT code FROM daily_bars GROUP BY code HAVING COUNT(*)>=253)').get().n,possibleEvaluationSessionsAfterWarmup:Math.max(0,summary.tradingDays-253),fullBacktestEnabled:false,realRecommendationsEnabled:false,brokerOrderInterfaceEnabled:false,note:'행 존재 여부는 데이터 품질 검증 완료를 뜻하지 않습니다. 필수 자료가 없으므로 원본 전략 수익률·실제 추천을 생성하지 않습니다.'};
 await writeFile(new URL('scoring-readiness.json',root),JSON.stringify(report,null,2));
 db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
 console.log(JSON.stringify(report,null,2));
}finally{db.close();}
