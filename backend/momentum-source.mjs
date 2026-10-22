import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMarketDb } from './market-db.mjs';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function inside(root,relative) {
  if(typeof relative!=='string'||path.isAbsolute(relative))throw Error('Invalid relative source');
  const resolved=path.resolve(root,relative.replaceAll('\\',path.sep)),rel=path.relative(root,resolved);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Source outside root');
  return resolved;
}
export async function loadMomentumSource(originalRoot,onProgress=()=>{}) {
  const root=path.join(path.resolve(originalRoot),'research/market-v1');
  const pointer=JSON.parse(await readFile(path.join(root,'local-data/market-current.json'),'utf8'));
  const bytes=await readFile(inside(root,pointer.file));
  if(sha256(bytes)!==pointer.sha256)throw Error('Manifest hash mismatch');
  const m=JSON.parse(bytes),expected=['date','open','high','low','close','volume','turnover','marketCap','listedShares','market','tradable','sourceHash'];
  if(JSON.stringify(m.columns)!==JSON.stringify(expected)||!Array.isArray(m.calendar)||!Array.isArray(m.securities))throw Error('Unsupported manifest');
  const index=new Map(m.calendar.map((d,i)=>[d,i]));
  if(index.size!==m.calendar.length||m.calendar.some((d,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||(i&&d<=m.calendar[i-1])))throw Error('Invalid calendar');
  const db=openMarketDb(fileURLToPath(new URL('../private-data/market.sqlite',import.meta.url)),true);
  const query=db.prepare('SELECT date,open,high,low,close,volume,turnover,market_cap,listed_shares,market FROM daily_bars WHERE code=? ORDER BY date');
  const stocks=[],codes=new Set(),reconciliation={sharedRows:0,sourceOnlyRows:0,conflictingRows:0,conflictsByField:{},examples:[],comparison:'Shared code/date only; local-only securities and dates are not completeness-verified'};
  let observedRows=0;
  try {
    for(const s of m.securities) {
      if(!/^[0-9A-Z]{6}$/.test(s.code)||codes.has(s.code))throw Error('Invalid or duplicated security');codes.add(s.code);
      const content=await readFile(inside(root,s.file));
      if(sha256(content)!==s.sha256)throw Error('Price file hash mismatch: '+s.code);
      const records=JSON.parse(content),bars=new Array(m.calendar.length).fill(null),local=new Map(query.all(s.code).map(r=>[r.date,r]));
      let previous='';
      for(const r of records) {
        const t=index.get(r[0]);
        if(t===undefined||r[0]<=previous||r.length!==12||!r.slice(1,9).every(Number.isFinite)||!['KOSPI','KOSDAQ'].includes(r[9])||![0,1].includes(r[10])||typeof r[11]!=='string')throw Error('Invalid price tuple: '+s.code);
        if(r[4]<0||r[5]<0||r[6]<0||r[7]<0||r[8]<0)throw Error('Negative market input');
        if(r[10]===1&&!(r[1]>0&&r[3]>0&&r[5]>0&&r[2]>=Math.max(r[1],r[4])&&r[3]<=Math.min(r[1],r[4])))throw Error('Tradable OHLC contradiction: '+s.code);
        bars[t]=r;previous=r[0];observedRows++;
        const l=local.get(r[0]);if(!l){reconciliation.sourceOnlyRows++;continue;}
        reconciliation.sharedRows++;
        const fields=['open','high','low','close','volume','turnover','market_cap','listed_shares','market'];
        const different=fields.filter((f,j)=>l[f]!==r[j+1]);
        if(different.length) {
          reconciliation.conflictingRows++;
          for(const f of different)reconciliation.conflictsByField[f]=(reconciliation.conflictsByField[f]||0)+1;
          if(reconciliation.examples.length<10)reconciliation.examples.push({code:s.code,date:r[0],fields:different});
        }
      }
      stocks.push({code:s.code,names:s.names,bars});
      if(stocks.length%500===0)onProgress({files:stocks.length,total:m.securities.length});
    }
  }finally{db.close();}
  return {calendar:m.calendar,stocks,lineage:{manifestHash:pointer.sha256,filesVerified:stocks.length,observedRows,source:m.source,calendarValidation:'source observed sessions; independent official holiday and missing-market completeness not certified',securityClassification:'source name/board-screened common-stock candidates; not a verified historical security master'},reconciliation};
}
