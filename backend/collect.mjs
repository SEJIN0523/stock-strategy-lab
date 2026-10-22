import { mkdir, writeFile, rename } from 'node:fs/promises';
import { collectFsc } from './fsc-client.mjs';
import { collectKrx } from './krx-client.mjs';
import { loadSettings } from './settings.mjs';
loadSettings();
const [start,end,requestedProvider]=process.argv.slice(2);
const provider=requestedProvider || (process.env.KRX_API_KEY?.trim()?'krx':'fsc');
if(!start||!end||!['krx','fsc'].includes(provider)) {console.error('사용법: node backend/collect.mjs 시작일 종료일 [krx|fsc] (YYYY-MM-DD)');process.exitCode=1;}
else try {
  const payload=provider==='krx'
    ? await collectKrx({key:process.env.KRX_API_KEY,start,end,onProgress:p=>console.log(`${p.date} ${p.market}: ${p.rows}행`)})
    : await collectFsc({key:process.env.DATA_GO_KR_SERVICE_KEY,start,end,onProgress:p=>console.log(`${p.market} ${p.page}페이지: ${p.received}/${p.total}`)});
  const dir=new URL('../private-data/',import.meta.url);
  await mkdir(dir,{recursive:true});
  await writeFile(new URL('latest.json.tmp',dir),JSON.stringify(payload));
  await rename(new URL('latest.json.tmp',dir),new URL('latest.json',dir));
  const count=payload.records?.length ?? payload.markets.reduce((sum,m)=>sum+m.records.length,0);
  console.log(`${provider.toUpperCase()} 수집 완료: ${count}행. 앱의 '수집 데이터 불러오기'로 확인하세요.`);
}catch(error){console.error(error.message);process.exitCode=1;}
