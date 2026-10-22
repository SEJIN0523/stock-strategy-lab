import { readFile,writeFile,rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openMarketDb,exportCompact } from './market-db.mjs';
import { normalizeMarketData } from '../market-data.js';
const root=new URL('../private-data/',import.meta.url);
const db=openMarketDb(fileURLToPath(new URL('market.sqlite',root)),true);
try {
  const plan=JSON.parse(await readFile(new URL('../research-plan.json',import.meta.url),'utf8'));
  const [start=plan.requestedStart,end=plan.requestedEnd]=process.argv.slice(2);
  const payload=exportCompact(db,{start,end});normalizeMarketData(payload);
  await writeFile(new URL('latest.json.tmp',root),JSON.stringify(payload));
  await rename(new URL('latest.json.tmp',root),new URL('latest.json',root));
  console.log(JSON.stringify({completed:true,source:'SQLite (외부 API 요청 없음)',start,end,stocks:payload.stocks.length,days:payload.dates.length}));
}catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
