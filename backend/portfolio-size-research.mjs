import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { loadMomentumSource,sha256 } from './momentum-source.mjs';
import { simulate,metrics } from '../strategies/momentum/engine.js';
import { withPositionCount,workload } from '../strategies/momentum/portfolio-size.js';

const out=new URL('../private-data/portfolio-size-v1/',import.meta.url);await mkdir(out,{recursive:true});
const baseBytes=await readFile(new URL('../strategies/momentum/plan.json',import.meta.url)),sizeBytes=await readFile(new URL('../strategies/momentum/portfolio-size-plan.json',import.meta.url));
const base=JSON.parse(baseBytes),design=JSON.parse(sizeBytes),candidate=base.candidates.find(c=>c.id===design.baseStrategy);
const data=await loadMomentumSource(process.argv[2]||'C:/Users/jsj52/Documents/close-score');
if(data.reconciliation.conflictingRows)throw Error('시세 충돌이 있어 실행하지 않습니다.');
const accounts=[],comparisons=[],cache=new Map();
for(const [period,[from,to]] of [['development',base.development],['retrospectiveValidation',base.retrospectiveValidation]]) {
  const runs=[];
  for(const n of design.positionCounts) {
    const run=simulate(data,withPositionCount(base,n),candidate,{from,to,featureCache:cache}),bytes=JSON.stringify(run),hash=sha256(bytes),file=`${period}-${n}-${hash}.json`;
    await writeFile(new URL(file,out),bytes);
    runs.push({n,run});
    accounts.push({period,count:n,status:run.status,failure:run.failure,fullPeriodMetrics:run.fullPeriodMetrics,workload:workload(run),artifact:{file,sha256:hash}});
  }
  const through=runs.map(r=>r.run.curve.at(-1)?.date).sort()[0];
  comparisons.push({period,through,completeWindow:runs.every(r=>r.run.fullPeriodMetrics!==null),rows:runs.map(({n,run})=>({count:n,metrics:metrics(run.curve.filter(r=>r.date<=through),base.initialCash),workload:workload(run,through)}))});
}
const codeHashes=Object.fromEntries(await Promise.all(['./portfolio-size-research.mjs','./momentum-source.mjs','../strategies/momentum/portfolio-size.js','../strategies/momentum/engine.js','../taxes.js'].map(async f=>[f,sha256(await readFile(new URL(f,import.meta.url)))])));
const report={createdAt:new Date().toISOString(),design,basePlanHash:sha256(baseBytes),designHash:sha256(sizeBytes),codeHashes,lineage:data.lineage,reconciliation:data.reconciliation,accounts,comparisons,selectedCount:null,selectionStatus:'not_enough_complete_evidence',userTimeMeasured:false};
await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));
const pct=n=>`${(n*100).toFixed(2)}%`,lines=['# 보유 종목 수와 관리 부담 첫 비교','','M1만 사용. 종목 수에 맞춰 신규 배분은1/N, 진입 후보는상위N. 나머지 규칙은 동일. 최적 종목 수 선정은 하지 않았다.','주문 시도는 체결·취소·매도 이월을 포함해 같은 날짜의 같은 주문을 한 번만 센 업무량 대용지표다. 실제 분 단위 시간은 측정하지 않았다.','','| 구간 | 보유 상한 | 공통 관측 일수 | 부분 수익률 | 부분 MDD | 일평균 주문 시도 | 하루 최대 주문 시도 |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
for(const c of comparisons)for(const r of c.rows)lines.push(`| ${c.period} | ${r.count} | ${r.workload.observedSessions} | ${pct(r.metrics.return)} | ${pct(r.metrics.mdd)} | ${r.workload.meanDailyOrderAttempts.toFixed(2)} | ${r.workload.maximumDailyOrderAttempts} |`);
lines.push('','계좌가 기업행사 자료에서 중단되면 전기간 수익률은 비어 있다. 위 짧은 공통 기간의 결과로 최적 개수나 장기 우열을 판단하지 않는다. 자세한 중단 사유와 개별 관측 기간은 report.json에 있다. 기존 연구 결과를 변경하지 않는다.');
await writeFile(new URL('report.md',out),lines.join('\n')+'\n');
console.log(JSON.stringify({accounts:accounts.length,selectedCount:null,comparisons:comparisons.map(c=>({period:c.period,through:c.through,completeWindow:c.completeWindow,observedSessions:c.rows[0].workload.observedSessions})),output:'private-data/portfolio-size-v1/report.json'}));
