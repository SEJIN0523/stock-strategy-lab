import { readdir,readFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { openMarketDb,importSnapshot,dbSummary } from './market-db.mjs';

const root=new URL('../private-data/',import.meta.url);
await mkdir(root,{recursive:true});
const db=openMarketDb(fileURLToPath(new URL('market.sqlite',root)));
try {
  const cache=new URL('krx-cache/',root);
  const files=(await readdir(cache)).filter(name=>/^(KOSPI|KOSDAQ)-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(name)).sort();
  let changed=0;
  for(let i=0;i<files.length;i++) {
    const snapshot=JSON.parse(gunzipSync(await readFile(new URL(files[i],cache))).toString('utf8'));
    if(importSnapshot(db,snapshot).changed)changed++;
    if((i+1)%300===0)console.log(`DB 반영 ${i+1}/${files.length}개 일별 자료`);
  }
  db.exec('PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);');
  console.log(JSON.stringify({completed:true,changed,...dbSummary(db)}));
}catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
