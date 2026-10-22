import { readFile,writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { normalizeMarketData } from '../market-data.js';
import { backtest } from '../engine.js';
import { saleTaxPercent } from '../taxes.js';

try {
 const root=new URL('../private-data/',import.meta.url);
 const data=normalizeMarketData(JSON.parse(await readFile(new URL('latest.json',root),'utf8')));
 const report=JSON.parse(await readFile(new URL('research-results.json',root),'utf8'));
 const split=Math.floor(data.dates.length*report.plan.trainingFraction),byCode=new Map(data.stocks.map(s=>[s.code,s]));
 const snapshots=new Map(),audits=[];
 for(const [segment,start,end] of [['training',report.plan.commonWarmup,split],['validation',split,data.dates.length]]) {
  const params={...report.baseline.params,period:segment==='training'?'train':'validation',range:{start,end}};
  const result=backtest(data,params);
  let cash=params.initial,maxEquityDifference=0,maxFillDifference=0,checkedFills=0;
  const portfolio=new Map(),lastClose=new Map(),tradesByDate=new Map();
  for(const stock of data.stocks)for(let t=0;t<start;t++)if(stock.bars[t]?.close>0)lastClose.set(stock.code,stock.bars[t].close);
  for(const trade of result.trades){if(!tradesByDate.has(trade.date))tradesByDate.set(trade.date,[]);tradesByDate.get(trade.date).push(trade);}
  for(let t=start;t<end;t++) {
   const date=data.dates[t];
   for(const trade of tradesByDate.get(date)||[]) {
    if(!snapshots.has(date)) {
     const rows=[];
     for(const market of ['KOSPI','KOSDAQ'])rows.push(...JSON.parse(gunzipSync(await readFile(new URL(`krx-cache/${market}-${date}.json.gz`,root))).toString('utf8')).rows);
     snapshots.set(date,new Map(rows.map(row=>[row.ISU_CD,row])));
    }
    const source=snapshots.get(date).get(trade.code);
    if(!source)throw new Error('체결 종목이 원본 시세에 없습니다.');
    const open=Number(source.TDD_OPNPRC.replaceAll(',',''));
    const expected=open*(1+(trade.side==='매수'?1:-1)*params.slippage/100);
    maxFillDifference=Math.max(maxFillDifference,Math.abs(trade.price-expected));checkedFills++;
    const gross=trade.qty*expected,commission=gross*params.fee/100;
    if(trade.side==='매수'){cash-=gross+commission;portfolio.set(trade.code,(portfolio.get(trade.code)||0)+trade.qty);}
    else {
     if((portfolio.get(trade.code)||0)<trade.qty)throw new Error('보유량 초과 매도입니다.');
     const rate=params.taxMode==='krx-2024-2026'?saleTaxPercent(date,byCode.get(trade.code).market):params.tax;
     cash+=gross-commission-gross*rate/100;
     const left=portfolio.get(trade.code)-trade.qty;if(left)portfolio.set(trade.code,left);else portfolio.delete(trade.code);
    }
   }
   for(const stock of data.stocks)if(stock.bars[t]?.close>0)lastClose.set(stock.code,stock.bars[t].close);
   const independent=cash+[...portfolio].reduce((sum,[code,qty])=>sum+qty*lastClose.get(code),0);
   maxEquityDifference=Math.max(maxEquityDifference,Math.abs(independent-result.curve[t-start].equity));
  }
  if(maxEquityDifference>.01||maxFillDifference>1e-7)throw new Error('독립 원장 또는 체결가 검산 불일치');
  audits.push({segment,checkedFills,maxFillDifference,maxEquityDifference});
 }
 const audit={createdAt:new Date().toISOString(),planHash:report.planHash,dataHash:report.dataHash,passed:true,audits};
 await writeFile(new URL('ledger-audit.json',root),JSON.stringify(audit,null,2));
 console.log(JSON.stringify(audit));
}catch(error){console.error(error.message);process.exitCode=1;}
