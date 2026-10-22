import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadMomentumSource,sha256 } from './momentum-source.mjs';
import { openMarketDb } from './market-db.mjs';
import { feature,rankFeatures } from '../strategies/momentum/engine.js';

const root=new URL('../private-data/daily/',import.meta.url);
await mkdir(root,{recursive:true});
const planBytes=await readFile(new URL('../strategies/momentum/plan.json',import.meta.url)),plan=JSON.parse(planBytes);
const operating=JSON.parse(await readFile(new URL('../strategies/momentum/operating-config.json',import.meta.url)));
const maxPositions=operating.selectedMaxPositions??operating.temporaryMaxPositions;
if(!Number.isInteger(maxPositions)||maxPositions<1||maxPositions>30)throw Error('보유 상한 설정을 확인하세요.');
const data=await loadMomentumSource(process.argv[2]||'C:/Users/jsj52/Documents/close-score',p=>console.log(`읽은 가격 파일 ${p.files}/${p.total}`));
if(data.reconciliation.conflictingRows)throw Error('공유 시세 충돌을 먼저 확인하세요.');
const db=openMarketDb(fileURLToPath(new URL('../private-data/market.sqlite',import.meta.url)),true);
let appended=0;
try {
  const dates=db.prepare('SELECT DISTINCT date FROM daily_bars WHERE date>? ORDER BY date').all(data.calendar.at(-1));
  const byCode=new Map(data.stocks.map(s=>[s.code,s]));
  for(const {date} of dates) {
    const partitions=db.prepare('SELECT market,status,source_hash FROM daily_fetch WHERE date=?').all(date);
    if(partitions.length!==2||partitions.some(p=>p.status!=='data'))throw Error('두 시장의 새 일봉이 완전하지 않습니다.');
    const prior=data.calendar.at(-1),days=(Date.parse(date)-Date.parse(prior))/86400000;
    if(days>7)throw Error('시세 갱신 간격이 큽니다. 거래일 누락을 확인하세요.');
    const i=data.calendar.length;data.calendar.push(date);for(const s of data.stocks)s.bars.push(null);
    for(const r of db.prepare('SELECT * FROM daily_bars WHERE date=?').all(date)) {
      const s=byCode.get(r.code);if(!s)continue;
      s.bars[i]=[date,r.open,r.high,r.low,r.close,r.volume,r.turnover,r.market_cap,r.listed_shares,r.market,r.volume>0&&r.close>0&&r.open>0?1:0,partitions.find(p=>p.market===r.market).source_hash];
    }
    appended++;
  }
}finally{db.close();}
const t=data.calendar.length-1,ranked=rankFeatures(data.stocks.map(s=>feature(s,t,plan)),plan.candidates[0]),ranks=new Map(ranked.map(r=>[r.code,r]));
const quotes=data.stocks.map(s=>{
  const r=s.bars[t];if(!r||!(r[4]>0))return null;
  const h=Array.from(s.bars.slice(t-59,t+1)),ma60=h.length===60&&h.every(x=>x?.[4]>0)?h.reduce((n,x)=>n+x[4],0)/60:null;
  let lastShareChangeDate=null,historyFirst=null;
  for(let i=0;i<s.bars.length;i++) {
    const a=s.bars[i],b=s.bars[i-1];if(a&&!historyFirst)historyFirst=a[0];
    if(a&&b&&a[8]>0&&b[8]>0&&Math.abs(a[8]/b[8]-1)>.001)lastShareChangeDate=a[0];
  }
  return {code:s.code,name:s.names?.filter(n=>n.from<=r[0]).at(-1)?.name||s.code,market:r[9],date:r[0],price:r[4],tradable:r[10]===1,ma60,historyFirst,lastShareChangeDate,recentCloses:h.map(x=>x?.[4]>0?x[4]:null),rank:ranks.get(s.code)?.rank??null};
}).filter(Boolean);
const byCode=new Map(quotes.map(q=>[q.code,q]));
// Prospective operating cycle, separate from retrospective experiment window anchors.
const anchor='2026-10-21',anchorIndex=data.calendar.indexOf(anchor),selectionDue=anchorIndex>=0&&(t-anchorIndex)%plan.portfolio.selectionEverySessions===0;
const snapshot={schema:'momentum.daily.v1',generatedAt:new Date().toISOString(),asOf:data.calendar[t],variant:'M1_development_default_not_selected_winner',priceKind:'KRX_daily_close_not_realtime',selectionDue,selectionCycleAnchor:anchor,recentDates:data.calendar.slice(-60),settings:{maxPositions,entryTopRank:maxPositions,positionFraction:1/maxPositions,stopFraction:.15,retainThroughRank:20,positionCountStatus:operating.status},candidateCount:ranked.length,candidates:ranked.slice(0,operating.candidateDisplayCount).map(r=>({...r,name:byCode.get(r.code)?.name||r.code,market:byCode.get(r.code)?.market})),quotes,source:{...data.lineage,appendedDatabaseSessions:appended,planHash:sha256(planBytes)},limitations:['재무·업종 점수와 업종 한도는 첫 버전에서 제외','전기간 수익성 미검증 개발 기준 M1','과거 연구의 사건은 조사 대기열에 보존하며 개발 기능을 막지 않음','정수 수량은 기준 종가의 검토값이며 실제 주문가격·예산·체결 여부를 확인해야 함','장중 시세 및 서버 자동 갱신은 아직 미연결','거래일 달력 완전성과 기존 보유자 권리는 별도 확인 필요'],ordersGenerated:false};
const bytes=JSON.stringify(snapshot),hash=sha256(bytes);
await writeFile(new URL(`snapshot-${snapshot.asOf}-${hash}.json`,root),bytes,{flag:'wx'});
await writeFile(new URL('latest.json.tmp',root),bytes);await rename(new URL('latest.json.tmp',root),new URL('latest.json',root));
console.log(JSON.stringify({asOf:snapshot.asOf,eligible:ranked.length,candidates:snapshot.candidates.map(r=>({code:r.code,name:r.name,rank:r.rank})),selectionDue,appended,sha256:hash}));
