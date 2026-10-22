import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMarketDb, dbSummary } from './market-db.mjs';

// Original repository is an input only. All output stays in this workspace.
const sourceRoot=path.resolve(process.argv[2] || 'C:/Users/jsj52/Documents/close-score');
const marketRoot=path.join(sourceRoot,'research/market-v1');
const outputRoot=fileURLToPath(new URL('../private-data/',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function inside(root,relative) {
  if(typeof relative!=='string'||path.isAbsolute(relative))throw Error('Invalid relative source path');
  const resolved=path.resolve(root,relative.replaceAll('\\',path.sep));
  const rel=path.relative(root,resolved);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Source path leaves its root');
  return resolved;
}
async function json(file) { return JSON.parse(await readFile(file,'utf8')); }
const pointer=await json(path.join(marketRoot,'local-data/market-current.json'));
const manifestBytes=await readFile(inside(marketRoot,pointer.file));
if(hash(manifestBytes)!==pointer.sha256)throw Error('Market manifest hash mismatch');
const manifest=JSON.parse(manifestBytes);
if(!Array.isArray(manifest.securities)||!Array.isArray(manifest.calendar))throw Error('Invalid market manifest');
let bytes=0;
const failures=[];
for(const security of manifest.securities) {
  try {
    const content=await readFile(inside(marketRoot,security.file));
    if(hash(content)!==security.sha256)failures.push({code:security.code,reason:'hash_mismatch'});
    bytes+=content.length;
  }catch(error) {
    failures.push({code:security.code,reason:error.code==='ENOENT'?'missing_file':'unreadable_or_invalid_path'});
  }
}
const population=await json(path.join(marketRoot,'population-summary.json'));
const coverage=await json(path.join(marketRoot,'coverage.json'));
const verification=await json(path.join(marketRoot,'verification.json'));
const localDbPath=path.join(outputRoot,'market.sqlite');
const db=openMarketDb(localDbPath,true);
let local;
try { local={...dbSummary(db),bytes:(await stat(localDbPath)).size}; }finally{db.close();}
const report={
  createdAt:new Date().toISOString(),purpose:'Input inventory and byte integrity only; no strategy replay or profitability claim',
  originalRepositoryReadOnly:true,networkRequests:0,
  originalMarket:{manifestSha256:pointer.sha256,manifestVerified:true,filesChecked:manifest.securities.length,failedFiles:failures,allSecurityFilesVerified:failures.length===0,bytes,calendarSessions:manifest.calendar.length,first:manifest.calendar[0],last:manifest.calendar.at(-1),reportedRows:population.observedRows,reportedCodes:population.uniqueCodes,reportedFullOperationalInputCoverage:coverage.strictFullOperationalInputCoverage,reportedFullMarket404020Validated:verification.fullMarket404020Validated},
  currentWorkspaceDatabase:local,
  reuseDecision:failures.length?'blocked_by_integrity_failure':'price_source_candidate_only',
  nextGates:['Reconcile overlap with local KRX bars and identify date/market/code conflicts','Verify historical security types, session calendar, and source lineage','Resolve held corporate actions, delisting settlements and dividend entitlements','Assemble financials and sectors available at each signal date before exact Claude replay'],
  strategyEnabled:false,recommendationsEnabled:false,ordersEnabled:false,
  limitations:['Hashes verify byte identity, not source correctness or complete historical coverage','Source summary and coverage claims are read from existing reports, not independently recomputed','No data imported or merged into the current database','Existing research periods were already inspected; they are retrospective rather than untouched validation']
};
await mkdir(outputRoot,{recursive:true});
await writeFile(path.join(outputRoot,'research-source-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
