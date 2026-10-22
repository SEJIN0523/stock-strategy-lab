import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isoDate, normalizeMarketData } from '../market-data.js';
import { requestKrxDay } from './krx-client.mjs';
import { loadSettings } from './settings.mjs';

loadSettings();
const [fromArg,toArg]=process.argv.slice(2);
const root=new URL('../private-data/',import.meta.url);
const cacheRoot=new URL('krx-cache/',root);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const parseValue=value=>{
  if(value==='-')return 0;
  if(value===undefined||value===null||value==='')throw new Error('KRX 가격 또는 거래량 값이 없습니다.');
  const n=Number(String(value).replaceAll(',',''));
  if(!Number.isFinite(n)||n<0)throw new Error('KRX 가격 또는 거래량 값이 올바르지 않습니다.');
  return n;
};

try {
  const from=isoDate(fromArg),to=isoDate(toArg);
  const length=(Date.parse(to)-Date.parse(from))/86400000;
  if(length<0||length>1096||to>new Date().toISOString().slice(0,10))throw new Error('수집 기간은 과거 3년 이내 범위로 지정하세요.');
  if(!process.env.KRX_API_KEY?.trim())throw new Error('KRX_API_KEY가 없습니다.');
  await mkdir(cacheRoot,{recursive:true});
  const dates=[],stocks=new Map(),emptyDates=[];
  let requests=0,hits=0,rowsTotal=0;
  for(let time=Date.parse(from),dayNumber=0;time<=Date.parse(to);time+=86400000,dayNumber++) {
    const date=new Date(time).toISOString().slice(0,10);
    const dayRows=[];
    const fetched=await Promise.all(['KOSPI','KOSDAQ'].map(async market=>{
      const file=new URL(`${market}-${date}.json.gz`,cacheRoot);
      let rows;
      try {
        const cached=JSON.parse(gunzipSync(await readFile(file)).toString('utf8'));
        if(cached.market!==market||cached.date!==date||!Array.isArray(cached.rows))throw new Error('캐시 형식 오류');
        rows=cached.rows;hits++;
      } catch(error) {
        if(error.code!=='ENOENT')throw new Error(`캐시를 읽지 못했습니다: ${market} ${date}`);
        for(let attempt=0;attempt<3;attempt++) {
          try{rows=await requestKrxDay({key:process.env.KRX_API_KEY,date,market});requests++;break;}
          catch(error){requests++;if(attempt===2)throw error;await pause(1000*(attempt+1));}
        }
        // Preserve the original API rows privately; latest.json is a smaller research projection.
        const temporary=new URL(`${market}-${date}.json.gz.tmp`,cacheRoot);
        await writeFile(temporary,gzipSync(JSON.stringify({market,date,rows})));
        await rename(temporary,file);
        await pause(100);
      }
      return {market,rows};
    }));
    for(const {market,rows} of fetched) {
      if(!rows.length)emptyDates.push({date,market});
      for(const row of rows) {
        if(isoDate(row.BAS_DD)!==date)throw new Error('캐시 기준일이 일치하지 않습니다.');
        dayRows.push({market,row});
      }
    }
    if(dayRows.length) {
      const index=dates.length;dates.push(date);
      const todayCodes=new Set();
      for(const {market,row} of dayRows) {
        const code=String(row.ISU_CD);
        if(todayCodes.has(code))throw new Error(`같은 날짜에 중복 종목이 있습니다: ${date} ${code}`);
        todayCodes.add(code);
        if(!stocks.has(code))stocks.set(code,{code,name:row.ISU_NM,market,bars:[]});
        const stock=stocks.get(code);stock.name=row.ISU_NM;stock.market=market;
        stock.bars.push([index,parseValue(row.TDD_OPNPRC),parseValue(row.TDD_CLSPRC),parseValue(row.ACC_TRDVOL)]);
      }
      rowsTotal+=dayRows.length;
    }
    if(dayNumber%10===0||time===Date.parse(to))console.log(`${date} | ${dayNumber+1}/${length+1}일 | ${dates.length}거래일 | ${rowsTotal}행 | API ${requests} / 캐시 ${hits}`);
  }
  const payload={format:'krx-stock-compact-v1',collectedAt:new Date().toISOString(),requestedRange:{start:from,end:to},dates,stocks:[...stocks.values()].sort((a,b)=>a.code.localeCompare(b.code)),emptyDates};
  normalizeMarketData(payload);
  const text=JSON.stringify(payload);
  await writeFile(new URL('latest.json.tmp',root),text);
  await rename(new URL('latest.json.tmp',root),new URL('latest.json',root));
  console.log(JSON.stringify({completed:true,start:from,end:to,days:dates.length,stocks:stocks.size,rows:rowsTotal,megabytes:(Buffer.byteLength(text)/1024/1024).toFixed(1),requests,cacheHits:hits}));
} catch(error){console.error(error.message);process.exitCode=1;}
