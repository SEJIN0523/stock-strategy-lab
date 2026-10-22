import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadMomentumSource, sha256 } from './momentum-source.mjs';
import { simulate, metrics } from '../strategies/momentum/engine.js';
import { saleTaxPercent } from '../taxes.js';
import path from 'node:path';
import { access } from 'node:fs/promises';

const out=new URL('../private-data/momentum-A-v1/',import.meta.url);
await mkdir(out,{recursive:true});
const planBytes=await readFile(new URL('../strategies/momentum/plan.json',import.meta.url)),plan=JSON.parse(planBytes);
const codeHashes=Object.fromEntries(await Promise.all(['../strategies/momentum/engine.js','./momentum-source.mjs','./momentum-research.mjs','../taxes.js'].map(async f=>[f,sha256(await readFile(new URL(f,import.meta.url)))])));
const originalRoot=process.argv[2]||'C:/Users/jsj52/Documents/close-score';
const data=await loadMomentumSource(originalRoot,p=>console.log(`검증한 가격 파일 ${p.files}/${p.total}`));
const sourceReport={createdAt:new Date().toISOString(),lineage:data.lineage,reconciliation:data.reconciliation};
await writeFile(new URL('source-check.json',out),JSON.stringify(sourceReport,null,2));
if(data.reconciliation.conflictingRows)throw Error('공유 기간 가격 충돌이 있어 전략 실행을 중단했습니다. source-check.json을 확인하세요.');

function audit(run) {
  let cash=plan.initialCash,tax=0;const qty=new Map(),dateIndex=new Map(data.calendar.map((d,i)=>[d,i])),stocks=new Map(data.stocks.map(s=>[s.code,s]));
  const fills=run.log.filter(r=>r.event==='fill');let cursor=0;
  for(const point of run.curve) {
    while(cursor<fills.length&&fills[cursor].date===point.date) {
      const f=fills[cursor++],r=stocks.get(f.code).bars[dateIndex.get(f.date)],before=qty.get(f.code)||0;
      if(!(f.signalDate<f.date)||!Number.isInteger(f.qty)||f.qty<=0||f.qty>f.intendedQty||f.price!==r[4]||f.qty>Math.floor(r[5]*plan.execution.dailyVolumeParticipation))throw Error('Fill audit failed');
      if(f.side==='buy') {
        if(before||f.gross>f.budget+1e-7)throw Error('Buy budget audit failed');
        cash-=f.qty*f.price;qty.set(f.code,f.qty);
      }else {
        const expected=f.qty*f.price*saleTaxPercent(f.date,r[9])/100;
        if(before<f.qty||Math.abs(expected-f.tax)>1e-7)throw Error('Sell tax audit failed');
        cash+=f.qty*f.price-expected;tax+=expected;
        if(before===f.qty)qty.delete(f.code);else qty.set(f.code,before-f.qty);
      }
      if(Math.abs(cash-f.cashAfter)>.01||cash<-.01||qty.size>plan.portfolio.maximumPositions)throw Error('Cash audit failed');
    }
    const e=cash+[...qty].reduce((s,[code,n])=>s+n*stocks.get(code).bars[dateIndex.get(point.date)][4],0);
    if(Math.abs(e-point.equity)>.01||Math.abs(cash-point.cash)>.01)throw Error('Daily equity audit failed');
  }
  if(cursor!==fills.length||Math.abs(tax-run.taxPaid)>.01||JSON.stringify([...qty].sort())!==JSON.stringify(run.holdings.map(p=>[p.code,p.qty]).sort()))throw Error('Terminal account audit failed');
  return {status:'PASS_CASH_QUANTITY_TAX_DAILY_EQUITY_ONLY',fills:fills.length};
}
const accounts=[],comparisons=[],featureCache=new Map();
for(const [period,window] of [['development',plan.development],['retrospectiveValidation',plan.retrospectiveValidation]]) {
  const runs=[];
  for(const candidate of plan.candidates) {
    const run=simulate(data,plan,candidate,{from:window[0],to:window[1],featureCache}),accountAudit=audit(run);
    const body=JSON.stringify(run),hash=sha256(body),file=`${period}-${candidate.id}-${hash}.json`;
    await writeFile(new URL(file,out),body,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const {curve,log,decisions,...summary}=run;
    accounts.push({period,...summary,audit:accountAudit,artifact:{file,sha256:hash},fills:log.filter(x=>x.event==='fill').length,cancellations:log.filter(x=>x.event==='cancel').length});runs.push(run);
    console.log(JSON.stringify({period,candidate:candidate.id,status:run.status,through:curve.at(-1)?.date,failure:run.failure,fills:accountAudit.fills}));
  }
  const through=runs.map(r=>r.curve.at(-1)?.date).sort()[0];
  comparisons.push({period,through,completeWindow:runs.every(r=>r.fullPeriodMetrics!==null),metrics:runs.map(r=>({candidate:r.candidate,...metrics(r.curve.filter(x=>x.date<=through),plan.initialCash)})),interpretation:'Common observed prefix only; no winner selection or long-term superiority claim'});
}
const eventQueue=[];
let inventory=null;
try {inventory=JSON.parse(await readFile(path.join(originalRoot,'research/market-v1/local-data/financial-inventory.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
for(const a of accounts.filter(a=>a.failure)) {
  const f=a.failure,stock=data.stocks.find(s=>s.code===f.code),i=data.calendar.indexOf(f.date),before=stock.bars[i-1],after=stock.bars[i];
  const docs=inventory?.records.filter(r=>r.stock_code===f.code&&r.year===Number(f.date.slice(0,4)))||[];
  const annualSourceCandidates=[];
  for(const doc of docs) {
    const url=`https://opendart.fss.or.kr/api/document.xml?rcept_no=${doc.rcept_no}`,cacheKey=sha256(url).slice(0,24);
    let cached=true;try{await access(path.join(originalRoot,'research/yahoo-pilot/local-data/dart/responses',cacheKey+'.raw'));}catch{cached=false;}
    annualSourceCandidates.push({receipt:doc.rcept_no,receiptDate:doc.rcept_dt,year:doc.year,cachedInKnownOriginalDocumentStore:cached});
  }
  eventQueue.push({period:a.period,candidate:a.candidate,...f,nameAtEvent:stock.names?.filter(n=>n.from<=f.date).at(-1)?.name||null,beforeShares:before?.[8]??null,afterShares:after?.[8]??null,beforePrice:before?.[4]??null,afterPrice:after?.[4]??null,beforePriceSourceHash:before?.[11]??null,afterPriceSourceHash:after?.[11]??null,annualSourceCandidates,resolutionStatus:'unresolved_not_a_split_classification',policy:'Confirm original corporate disclosure, effective date, existing-holder quantity/cash entitlement and basis. Post-event filings may reconcile accounting, never enter earlier trading signals. Missing annual cache does not prove all possible sources are unavailable.'});
}
await writeFile(new URL('event-review-queue.json',out),JSON.stringify(eventQueue,null,2));
const report={createdAt:new Date().toISOString(),plan,planHash:sha256(planBytes),codeHashes,source:sourceReport,accounts,comparisons,eventReviewQueue:'event-review-queue.json',selectedStrategy:null,liveRecommendationsEnabled:false,financialCandidate:{id:'M3',status:'deferred_missing_verified_point_in_time_financials'},caveats:['Price-return scenario: dividend cash and complete entitlements absent','All periods reused retrospective data, not untouched validation','A closing fill is a daily-price proxy, not a guaranteed auction fill; 1% daily volume does not verify auction capacity','Sector concentration uncontrolled because historical sector master absent','If an account censors, full-period metrics are null; partial performance must not be presented as full-period performance','M1/M2 are fixed first hypotheses, not optimized or adopted strategies']};
await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));
const pct=x=>x===null?'산출 안 함':`${(x*100).toFixed(2)}%`;
const lines=['# 모멘텀 A v1 최초 연구'];
lines.push('',`생성 ${report.createdAt}`,`계획 SHA256 ${report.planHash}`,'','실전 추천·전략 선정 없음. 배당 현금 미반영 가격수익 시나리오.','', '| 구간 | 후보 | 상태 | 관측 종료 | 중단 사유 | 전체 수익률 | 체결 건수 |','| --- | --- | --- | --- | --- | ---: | ---: |');
for(const a of accounts)lines.push(`| ${a.period} | ${a.candidate} | ${a.status} | ${a.observedPrefixMetrics?.to||'-'} | ${a.failure?`${a.failure.date} ${a.failure.code} ${a.failure.reason}`:'없음'} | ${a.fullPeriodMetrics?pct(a.fullPeriodMetrics.return):'산출 안 함'} | ${a.fills} |`);
lines.push('','## 공통 관측 기간 비교','', '| 구간 | 공통 종료 | 후보 | 부분 수익률 | 부분 MDD |','| --- | --- | --- | ---: | ---: |');
for(const c of comparisons)for(const m of c.metrics)lines.push(`| ${c.period} | ${c.through} | ${m.candidate} | ${pct(m.return)} | ${pct(m.mdd)} |`);
lines.push('',...report.caveats.map(x=>`- ${x}`),'','모든 계좌에서 현금·정수 수량·거래세·일별 평가액을 독립 재계산했습니다. 이 검사는 데이터 완전성이나 수익성을 인증하지 않습니다.');
await writeFile(new URL('report.md',out),lines.join('\n')+'\n');
console.log(JSON.stringify({completed:true,selected:null,comparisons,report:'private-data/momentum-A-v1/report.json'}));
