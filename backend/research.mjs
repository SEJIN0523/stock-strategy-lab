import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeMarketData } from '../market-data.js';
import { backtest } from '../engine.js';

const root=new URL('../private-data/',import.meta.url);
const summarize=result=>({start:result.start,end:result.end,return:result.return,cagr:result.cagr,mdd:result.mdd,costs:result.totalCosts,commission:result.totalCommission,tax:result.totalTax,slippage:result.totalSlippage,trades:result.trades.length,blockedOrders:result.blockedOrders,staleValuations:result.staleValuations,largeGapExposures:result.largeGapExposures,terminalUntradable:result.terminalUntradable,benchmarkReturn:result.benchmarkReturn});
try {
  const planText=await readFile(new URL('../research-plan.json',import.meta.url),'utf8');
  const plan=JSON.parse(planText);
  const raw=await readFile(new URL('latest.json',root));
  const payload=JSON.parse(raw.toString('utf8'));
  if(payload.requestedRange?.start!==plan.requestedStart||payload.requestedRange?.end!==plan.requestedEnd)throw new Error('수집 범위가 사전에 정한 연구 계획과 다릅니다.');
  const data=normalizeMarketData(payload);
  const split=Math.floor(data.dates.length*plan.trainingFraction);
  if(split-plan.commonWarmup<60||data.dates.length-split<60)throw new Error('개발·검증 구간에 각각 60거래일 이상 필요합니다.');
  const base={rebalance:plan.rebalanceTradingDays,initial:plan.initialCapital,...plan.assumedCostsPercent,taxMode:plan.taxMode||'fixed',allowRaw:true};
  const candidates=[];
  for(const ma of plan.movingAverages)for(const lookback of plan.lookbacks)for(const maxHold of plan.maxHoldings) {
    const params={...base,ma,lookback,maxHold};
    const result=backtest(data,{...params,period:'train',range:{start:plan.commonWarmup,end:split}});
    const candidate={id:`S${String(candidates.length+1).padStart(2,'0')}`,params,training:summarize(result)};
    candidates.push(candidate);
    console.log(`${candidate.id} MA${ma} / 상승률${lookback} / ${maxHold}종목: 개발 수익률 ${(result.return*100).toFixed(2)}%, MDD ${(result.mdd*100).toFixed(2)}%`);
  }
  const eligible=candidates.filter(c=>c.training.mdd>=-plan.maximumTrainingDrawdown);
  eligible.sort((a,b)=>b.training.return-a.training.return||b.training.mdd-a.training.mdd||a.id.localeCompare(b.id));
  const selected=eligible[0]||null;
  // Selection is irrevocably finalized before the holdout is evaluated.
  const baseline=candidates.find(c=>Object.entries(plan.baseline).every(([key,value])=>c.params[key]===value));
  const evaluate=params=>backtest(data,{...params,period:'validation',range:{start:split,end:data.dates.length}});
  const selectedResult=selected?evaluate(selected.params):null;
  const baselineResult=selected?.id===baseline.id?selectedResult:evaluate(baseline.params);
  const stress=selected&&plan.stressCostsPercent?evaluate({...selected.params,...plan.stressCostsPercent}):null;
  const baselineStressResult=plan.stressCostsPercent?(selected?.id===baseline.id?stress:evaluate({...baseline.params,...plan.stressCostsPercent})):null;
  const monthly=[];
  if(selectedResult) {
    let previous=plan.initialCapital;
    for(const point of selectedResult.curve) {
      const month=point.date.slice(0,7);
      if(monthly.at(-1)?.month!==month)monthly.push({month,startValue:previous,endValue:point.equity});
      else monthly.at(-1).endValue=point.equity;
      previous=point.equity;
    }
    for(const row of monthly)row.return=row.endValue/row.startValue-1;
  }
  const report={
    createdAt:new Date().toISOString(),planHash:createHash('sha256').update(planText).digest('hex'),dataHash:createHash('sha256').update(raw).digest('hex'),
    plan,data:{source:data.meta.source,stocks:data.stocks.length,days:data.dates.length,first:data.dates[0],last:data.dates.at(-1),quality:data.meta.report,emptyMarketDates:data.meta.emptyDates.length},
    windows:{training:{start:data.dates[plan.commonWarmup],end:data.dates[split-1],days:split-plan.commonWarmup},validation:{start:data.dates[split],end:data.dates.at(-1),days:data.dates.length-split}},
    candidates,eligibleCount:eligible.length,selected:selected?{id:selected.id,params:selected.params,training:selected.training,validation:summarize(selectedResult),stress:stress?summarize(stress):null,monthly}:null,
    baseline:{id:baseline.id,params:baseline.params,training:baseline.training,validation:summarize(baselineResult),stress:baselineStressResult?summarize(baselineStressResult):null},
    chart:(selectedResult||baselineResult).curve,
    qualityDecision:{status:'preliminary_only',liveTradingAllowed:false,trainingGapEvents:selected?.training.largeGapExposures.length||0,validationGapEvents:selectedResult?.largeGapExposures.length||0,reason:'가격 보정·상장폐지·실제 체결 제약을 검증하기 전에는 운용 적합성을 판단할 수 없습니다.'},
    caveats:plan.limitations
  };
  await writeFile(new URL('research-results.json.tmp',root),JSON.stringify(report));
  await rename(new URL('research-results.json.tmp',root),new URL('research-results.json',root));
  const percent=value=>`${(value*100).toFixed(2)}%`;
  const lines=[
    '# KRX 최초 예비 백테스트',
    '',`생성: ${report.createdAt}`,`데이터: ${report.data.first} ~ ${report.data.last}, ${report.data.stocks}종목, ${report.data.days}거래일`,
    `개발: ${report.windows.training.start} ~ ${report.windows.training.end} (${report.windows.training.days}거래일)`,
    `검증: ${report.windows.validation.start} ~ ${report.windows.validation.end} (${report.windows.validation.days}거래일)`,
    '', '비수정 가격을 사용한 예비 연구입니다. 기업행사 및 체결 제약을 보완하기 전에는 실전 운용에 사용할 수 없습니다.',
    '',`비용: 수수료 ${base.fee}%, 체결가격 차이 ${base.slippage}%, 세금 방식 ${base.taxMode}.`,plan.validationStatus||'최초 고정 검증 구간 평가',
    '', '| 후보 | MA | 상승률 | 종목 수 | 개발 수익률 | 개발 MDD |', '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...candidates.map(c=>`| ${c.id} | ${c.params.ma} | ${c.params.lookback} | ${c.params.maxHold} | ${percent(c.training.return)} | ${percent(c.training.mdd)} |`),
    '',selected?`선정: ${selected.id}. 개발 MDD 30% 이하 후보 중 개발 수익률 최대.`:'MDD 기준을 만족한 후보가 없어 전략을 선정하지 않았습니다.',
    '', '| 검증 대상 | 수익률 | MDD | 비용 | 체결 건수 |', '| --- | ---: | ---: | ---: | ---: |',
    ...(selected?[`| 선정 전략 ${selected.id} | ${percent(selectedResult.return)} | ${percent(selectedResult.mdd)} | ${Math.round(selectedResult.totalCosts).toLocaleString('ko-KR')}원 | ${selectedResult.trades.length} |`]:[]),
    ...(stress?[`| 선정 전략 · 비용 스트레스 | ${percent(stress.return)} | ${percent(stress.mdd)} | ${Math.round(stress.totalCosts).toLocaleString('ko-KR')}원 | ${stress.trades.length} |`]:[]),
    `| 사전 기본 전략 ${baseline.id} | ${percent(baselineResult.return)} | ${percent(baselineResult.mdd)} | ${Math.round(baselineResult.totalCosts).toLocaleString('ko-KR')}원 | ${baselineResult.trades.length} |`,
    ...(baselineStressResult?[`| 사전 기본 전략 · 비용 스트레스 | ${percent(baselineStressResult.return)} | ${percent(baselineStressResult.mdd)} | ${Math.round(baselineStressResult.totalCosts).toLocaleString('ko-KR')}원 | ${baselineStressResult.trades.length} |`]:[]),
    '', '개발·검증은 동일 초기 현금에서 각각 시작했습니다. 수익률을 이어 붙인 연속 운용 결과가 아닙니다. 모든 후보는 동일 개발 구간을 사용했습니다.',
    '',`전체 시세의 40% 초과 종가 변동: ${report.data.quality.largeMoves}건. 신규 상장·거래정지·수집 누락으로 생긴 종목별 빈 칸: ${report.data.quality.missingBars}개.`,
    ...(selected?[`선정 전략 개발 중 보유 종목의 40% 초과 시가 갭: ${selected.training.largeGapExposures.length}건.`,`선정 전략 검증 중 보유 종목의 40% 초과 시가 갭: ${selectedResult.largeGapExposures.length}건 / 미체결 ${selectedResult.blockedOrders}건 / 과거 종가 평가 ${selectedResult.staleValuations}종목·일 / 마지막 날 거래 불가 보유 ${selectedResult.terminalUntradable.length}종목.`,'','| 검증 월 (양끝은 부분 월) | 수익률 |','| --- | ---: |',...monthly.map(row=>`| ${row.month} | ${percent(row.return)} |`)]:[]),
    '',...plan.limitations.map(text=>`- ${text}`),
    '',`계획 SHA256: ${report.planHash}`,`데이터 SHA256: ${report.dataHash}`
  ];
  await writeFile(new URL('research-report.md',root),lines.join('\n')+'\n');
  console.log(JSON.stringify({completed:true,selected:selected?.id||null,validation:selected?report.selected.validation:null,baseline:report.baseline.validation}));
}catch(error){console.error(error.message);process.exitCode=1;}
