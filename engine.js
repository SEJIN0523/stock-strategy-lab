import { saleTaxPercent } from './taxes.js';
// Synthetic prices are deliberately unrelated to actual listed companies.
export function demoData() {
  let seed=197802;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const dates=[];
  for(let d=new Date('2022-01-03T00:00:00Z');dates.length<900;d.setUTCDate(d.getUTCDate()+1)) {
    if(d.getUTCDay()!==0&&d.getUTCDay()!==6) dates.push(d.toISOString().slice(0,10));
  }
  const stocks=Array.from({length:24},(_,n)=>{
    let close=10000+n*1700;
    return {code:`DEMO${String(n+1).padStart(2,'0')}`,name:`가상 종목 ${String(n+1).padStart(2,'0')}`,bars:dates.map((date,i)=>{
      const open=close*Math.exp((random()-.5)*.015);
      close=open*Math.exp(.00015+Math.sin(i/65+n)*.002+(random()-.5)*.045);
      return {date,open,close};
    })};
  });
  return {dates,stocks,meta:{kind:'demo',source:'재현 가능한 가상 24종목',warnings:[]}};
}
export function rank(data,t,p) {
  if(t<Math.max(p.lookback,p.ma)-1)return [];
  return data.stocks.map(s=>{
    const history=s.bars.slice(t-Math.max(p.ma,p.lookback)+1,t+1);
    if(history.some(bar=>!bar||bar.close<=0) || history.length<Math.max(p.ma,p.lookback) || s.bars[t].volume===0)return null;
    const price=s.bars[t].close;
    const average=s.bars.slice(t-p.ma+1,t+1).reduce((a,b)=>a+b.close,0)/p.ma;
    const momentum=price/s.bars[t-p.lookback+1].close-1;
    return {code:s.code,name:s.name,price,momentum,eligible:price>average&&momentum>0};
  }).filter(s=>s?.eligible).sort((a,b)=>b.momentum-a.momentum || a.code.localeCompare(b.code)).slice(0,p.maxHold);
}
export function backtest(data,p) {
  if(!Number.isInteger(p.lookback)||p.lookback<2||!Number.isInteger(p.ma)||p.ma<2||!Number.isInteger(p.maxHold)||p.maxHold<1||!Number.isInteger(p.rebalance)||p.rebalance<1||![p.initial,p.fee,p.tax,p.slippage].every(Number.isFinite)||p.initial<=0||p.fee<0||p.tax<0||p.slippage<0||p.slippage>=100||p.fee+p.tax>=100||!['train','validation','all'].includes(p.period))throw new Error('전략 설정을 확인하세요.');
  if(data.meta?.kind==='real'&&!p.allowRaw)throw new Error('비수정 가격의 한계를 확인하고 예비 분석에 동의해야 합니다.');
  if(p.taxMode&&!['fixed','krx-2024-2026'].includes(p.taxMode))throw new Error('지원하지 않는 세금 계산 방식입니다.');
  if(!data.stocks.length||data.stocks.some(s=>s.bars.length!==data.dates.length))throw new Error('종목별 거래일 배열이 맞지 않습니다.');
  const warmup=Math.max(p.lookback,p.ma);
  const split=Math.floor(data.dates.length*.7);
  const start=p.range?.start ?? (p.period==='validation'?Math.max(split,warmup):warmup);
  const end=p.range?.end ?? (p.period==='train'?split:data.dates.length);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<warmup||end>data.dates.length)throw new Error('백테스트 구간을 확인하세요.');
  if(end-start<2)throw new Error('검증에 필요한 데이터가 부족합니다.');
  let cash=p.initial,peak=p.initial,mdd=0,totalCosts=0,totalCommission=0,totalTax=0,totalSlippage=0,blockedOrders=0,staleValuations=0;
  const positions=new Map(),trades=[],curve=[],largeGapExposures=[];
  const byCode=new Map(data.stocks.map(s=>[s.code,s]));
  // Do not use the current day's closing price or total volume to decide an opening fill.
  const tradable=bar=>bar?.open>0;
  // Carry prices forward only after they have been observed; never backfill new listings.
  const lastPrices=new Map();
  for(const stock of data.stocks)for(let t=0;t<start;t++)if(stock.bars[t]?.close>0)lastPrices.set(stock.code,stock.bars[t].close);
  const benchmarkStocks=data.stocks.filter(s=>tradable(s.bars[start]));
  const benchmarkInitial=new Map(benchmarkStocks.map(s=>[s.code,s.bars[start].open]));
  for(let t=start;t<end;t++) {
    // Audit overnight gaps without using them to change the previous day's signal.
    for(const [code,pos] of positions) {
      const previous=lastPrices.get(code),open=byCode.get(code).bars[t]?.open;
      if(previous>0&&open>0&&Math.abs(open/previous-1)>.4)largeGapExposures.push({date:data.dates[t],code,name:byCode.get(code).name,gap:open/previous-1,qty:pos.qty});
    }
    // A close signal from t-1 can only execute at t's open.
    if((t-start)%p.rebalance===0) {
      const targets=rank(data,t-1,p);
      // Full portfolio rebalance; charge every sell and buy, including retained names.
      for(const [code,pos] of positions) {
        if(!tradable(byCode.get(code).bars[t])){blockedOrders++;continue;}
        const price=byCode.get(code).bars[t].open*(1-p.slippage/100);
        const rate=p.taxMode==='krx-2024-2026'?saleTaxPercent(data.dates[t],byCode.get(code).market):p.tax;
        const gross=pos.qty*price,commission=gross*p.fee/100,tax=gross*rate/100,cost=commission+tax;
        const slip=pos.qty*byCode.get(code).bars[t].open*p.slippage/100;
        cash+=gross-cost;totalCosts+=cost+slip;totalCommission+=commission;totalTax+=tax;totalSlippage+=slip;
        trades.push({date:data.dates[t],code,name:byCode.get(code).name,side:'매도',qty:pos.qty,price,commission,tax,taxPercent:rate});
        positions.delete(code);
      }
      const slots=Math.max(0,p.maxHold-positions.size);
      const budget=cash/Math.max(1,slots);
      let bought=0;
      for(const target of targets) {
        if(bought>=slots)break;
        if(positions.has(target.code))continue;
        if(!tradable(byCode.get(target.code).bars[t])){blockedOrders++;continue;}
        const open=byCode.get(target.code).bars[t].open,price=open*(1+p.slippage/100);
        const qty=Math.floor(budget/(price*(1+p.fee/100)));
        if(qty<1)continue;
        const gross=qty*price,cost=gross*p.fee/100;
        const slip=qty*open*p.slippage/100;
        cash-=gross+cost;totalCosts+=cost+slip;totalCommission+=cost;totalSlippage+=slip;
        positions.set(target.code,{qty});
        bought++;
        trades.push({date:data.dates[t],code:target.code,name:target.name,side:'매수',qty,price,commission:cost,tax:0,taxPercent:0});
      }
    }
    for(const stock of data.stocks)if(stock.bars[t]?.close>0)lastPrices.set(stock.code,stock.bars[t].close);
    const equity=cash+[...positions].reduce((a,[code,pos])=>{
      if(!(byCode.get(code).bars[t]?.close>0))staleValuations++;
      return a+pos.qty*lastPrices.get(code);
    },0);
    peak=Math.max(peak,equity);mdd=Math.min(mdd,equity/peak-1);
    const benchmark=benchmarkStocks.length?p.initial*benchmarkStocks.reduce((a,s)=>a+lastPrices.get(s.code)/benchmarkInitial.get(s.code),0)/benchmarkStocks.length:p.initial;
    curve.push({date:data.dates[t],equity,benchmark});
  }
  const last=curve.at(-1),years=(Date.parse(last.date)-Date.parse(data.dates[start]))/(365.25*86400000);
  const terminalUntradable=[...positions.keys()].filter(code=>!tradable(byCode.get(code).bars[end-1])||!(byCode.get(code).bars[end-1]?.close>0)||byCode.get(code).bars[end-1]?.volume===0);
  return {curve,trades,totalCosts,totalCommission,totalTax,totalSlippage,blockedOrders,staleValuations,largeGapExposures,terminalUntradable,return:last.equity/p.initial-1,benchmarkReturn:last.benchmark/p.initial-1,cagr:Math.pow(last.equity/p.initial,1/years)-1,mdd,cash,holdings:positions.size,start:data.dates[start],end:last.date,picks:rank(data,end-1,p)};
}
