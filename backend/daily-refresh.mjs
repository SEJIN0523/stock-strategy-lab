import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,writeFile,rename,mkdir,open,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { refreshDaily } from './daily-refresh-core.mjs';
const run=promisify(execFile),root=new URL('../private-data/daily/',import.meta.url),args=process.argv.slice(2);
if(args.some(a=>a!=='--cached')||args.length>1)throw Error('사용: node backend/daily-refresh.mjs [--cached]');
await mkdir(root,{recursive:true});
let lock;
try {
  lock=await open(new URL('refresh.lock',root),'wx');
}catch(error) {
  if(error.code==='EEXIST'){console.error('갱신 작업이 실행 중이거나 이전 작업 잠금이 남아 있습니다. 중복 실행하지 않습니다.');process.exit(2);}
  throw error;
}
await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
const saveStatus=async state=>{
  const temp=new URL('refresh-status.json.tmp',root);
  await writeFile(temp,JSON.stringify(state,null,2));await rename(temp,new URL('refresh-status.json',root));
};
try {
  const status=await refreshDaily({
    cached:args.includes('--cached'),saveStatus,
    runStage:async stage=>{
      console.log(stage==='prices'?'새 시세와 최근 정정을 확인합니다.':'매매 노트 후보를 계산합니다.');
      const script=stage==='prices'?'db-update.mjs':'daily-snapshot.mjs';
      try {
        await run(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,timeout:240000,maxBuffer:2000000});
        return {code:0};
      }catch{return {code:1};}
    },
    readSnapshot:async()=>JSON.parse(await readFile(new URL('latest.json',root),'utf8'))
  });
  console.log(JSON.stringify(status));
  if(status.state==='failed')process.exitCode=1;
}finally{await lock.close();await unlink(new URL('refresh.lock',root));}
