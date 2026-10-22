import { mkdir,writeFile,rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { openMarketDb,importSnapshot,dbSummary } from './market-db.mjs';
import { requestKrxDay } from './krx-client.mjs';
import { loadSettings } from './settings.mjs';
import { isoDate } from '../market-data.js';

loadSettings();
const root=new URL('../private-data/',import.meta.url),cache=new URL('krx-cache/',root);
await mkdir(cache,{recursive:true});
const db=openMarketDb(fileURLToPath(new URL('market.sqlite',root)));
try {
  const yesterday=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10);
  const through=isoDate(process.argv[2]||yesterday);
  if(through>yesterday)throw new Error('당일 미확정 자료를 피하도록 전일까지 지정하세요.');
  if(!process.env.KRX_API_KEY?.trim())throw new Error('KRX_API_KEY가 없습니다.');
  const last=dbSummary(db).lastFetched;
  if(!last)throw new Error('먼저 db-import.mjs로 기존 캐시를 가져오세요.');
  const start=new Date(Date.parse(last)-3*86400000).toISOString().slice(0,10);
  if(through<last)throw new Error('최신 수집일 이전의 갱신 범위입니다.');
  let requests=0,changed=0;
  for(let time=Date.parse(start);time<=Date.parse(through);time+=86400000) {
    const date=new Date(time).toISOString().slice(0,10);
    for(const market of ['KOSPI','KOSDAQ']) {
      const rows=await requestKrxDay({key:process.env.KRX_API_KEY,date,market});requests++;
      // Keep the raw correction and DB partition in sync; a later import can recover a failed DB write.
      const file=new URL(`${market}-${date}.json.gz`,cache),temp=new URL(`${market}-${date}.json.gz.tmp`,cache);
      const snapshot={date,market,rows,fetchedAt:new Date().toISOString()};
      // Never replace a previously populated day with an unexplained empty response.
      if(!rows.length&&db.prepare('SELECT row_count FROM daily_fetch WHERE date=? AND market=?').get(date,market)?.row_count>0)throw new Error(`기존 자료가 빈 응답으로 바뀌었습니다: ${market} ${date}`);
      await writeFile(temp,gzipSync(JSON.stringify(snapshot)));await rename(temp,file);
      if(importSnapshot(db,snapshot).changed)changed++;
      console.log(`${date} ${market}: ${rows.length}행`);
      await new Promise(resolve=>setTimeout(resolve,150));
    }
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  console.log(JSON.stringify({completed:true,requests,changed,...dbSummary(db)}));
}catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
