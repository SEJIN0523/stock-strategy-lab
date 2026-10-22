// Inputs are point-in-time feature snapshots, not today's values copied into the past.
export function percentiles(values) {
  const valid=values.map((value,index)=>({value,index})).filter(row=>Number.isFinite(row.value)).sort((a,b)=>a.value-b.value);
  const output=values.map(()=>50);
  for(let start=0;start<valid.length;) {
    let end=start+1;while(end<valid.length&&valid[end].value===valid[start].value)end++;
    const score=valid.length===1?50:100*((start+end-1)/2)/(valid.length-1);
    for(let i=start;i<end;i++)output[valid[i].index]=score;
    start=end;
  }
  return output;
}

export function priceFeatures(bars) {
  const history=bars.slice(-253);
  if(history.length<253||history.some(bar=>!bar||![bar.close,bar.high,bar.low].every(v=>Number.isFinite(v)&&v>0)||bar.low>bar.close||bar.close>bar.high))throw new Error('보정 OHLC 253거래일이 필요합니다.');
  const high=Math.max(...history.slice(1).map(bar=>bar.high)),low=Math.min(...history.slice(1).map(bar=>bar.low));
  return {rangePosition:high===low?.5:(history.at(-1).close-low)/(high-low),momentum:history[231].close/history[0].close-1,largeMoveRisk:history.slice(1).some((bar,i)=>Math.abs(Math.log(bar.close/history[i].close))>.35)};
}

export function scoreUniverse(rows,{asOfMs,config}) {
  if(!Number.isFinite(asOfMs)||!config)throw new Error('평가 시점과 전략 설정이 필요합니다.');
  const seen=new Set(),excluded=[],pool=[];
  for(const row of rows) {
    if(seen.has(row.code))throw new Error('중복 종목 코드입니다.');seen.add(row.code);
    let reason;
    if(row.securityType!=='stock')reason='NOT_SINGLE_STOCK';
    else if(!row.adjustedHistoryVerified||!Number.isFinite(row.priceAvailableAtMs)||row.priceAvailableAtMs>asOfMs)reason='ADJUSTED_HISTORY_UNAVAILABLE';
    else if(!Number.isFinite(row.financialAvailableAtMs)||row.financialAvailableAtMs>asOfMs||!Number.isFinite(row.eps)||!Number.isFinite(row.bps))reason='FINANCIALS_UNAVAILABLE_AS_OF_SIGNAL';
    else if(!Number.isFinite(row.price)||row.price<config.baseUniverse.minimumPrice||row.eps===0||row.bps<=0||row.price/row.bps<config.baseUniverse.minimumPbr)reason='PRICE_OR_FINANCIAL_FILTER';
    else if(!Number.isFinite(row.averageTurnover20)||row.averageTurnover20<config.baseUniverse.minimumAverageTurnover20||!Number.isFinite(row.marketCap)||row.marketCap<=0)reason='SIZE_OR_LIQUIDITY_FILTER';
    else if(!Number.isFinite(row.rangePosition)||row.rangePosition<0||row.rangePosition>1||!Number.isFinite(row.momentum)||typeof row.largeMoveRisk!=='boolean')reason='PRICE_FEATURES_UNAVAILABLE';
    else if(row.largeMoveRisk)reason='LARGE_MOVE_RISK_FILTER';
    if(reason)excluded.push({code:row.code,reason});else pool.push(row);
  }
  const fields=['marketCap','rangePosition','momentum','epsGrowth','shareDecline','dividendGrowth'];
  const ranks=Object.fromEntries(fields.map(field=>[field,percentiles(pool.map(row=>row[field]))]));
  const universe=pool.map((row,i)=>{
    const size=ranks.marketCap[i],trend=(ranks.rangePosition[i]+ranks.momentum[i])/2,growth=(ranks.epsGrowth[i]+ranks.shareDecline[i]+ranks.dividendGrowth[i])/3;
    const score=size*config.weights.size+trend*config.weights.trend+growth*config.weights.growth;
    return {...row,sizeScore:size,trendScore:trend,growthScore:growth,score};
  });
  const totalPercentiles=percentiles(universe.map(row=>row.score));
  for(let i=0;i<universe.length;i++) {
    const row=universe[i];row.topPercent=100-totalPercentiles[i];
    row.entryEligible=row.topPercent<=config.recommendation.maximumTopPercent&&row.averageTurnover20>=config.recommendation.minimumAverageTurnover20&&row.marketCap>=config.recommendation.minimumMarketCap&&row.eps>0&&Number.isFinite(row.dailyReturn)&&row.dailyReturn>config.recommendation.blockedDailyReturnAtOrBelow&&typeof row.sector==='string'&&row.sector.length>0&&Number.isFinite(row.sectorAvailableAtMs)&&row.sectorAvailableAtMs<=asOfMs;
  }
  universe.sort((a,b)=>b.score-a.score||a.code.localeCompare(b.code));
  const sectors=new Map(),recommendations=[];
  for(const row of universe) {
    if(!row.entryEligible||(sectors.get(row.sector)||0)>=config.recommendation.maximumPerSector)continue;
    recommendations.push(row);sectors.set(row.sector,(sectors.get(row.sector)||0)+1);
    if(recommendations.length===config.recommendation.maximumCandidates)break;
  }
  return {asOfMs,universe,recommendations,excluded};
}
