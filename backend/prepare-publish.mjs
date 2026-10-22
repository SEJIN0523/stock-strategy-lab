import { readFile,writeFile,readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const args=process.argv.slice(2);if(args.some(a=>a!=='--refresh')||args.length>1)throw Error('사용: node backend/prepare-publish.mjs [--refresh]');
let refreshFailed=false;
async function stage(name){await run(process.execPath,[resolve(root,'backend',name)],{cwd:root,windowsHide:true,timeout:600000,maxBuffer:2000000});}
if(args.includes('--refresh')){try{await stage('daily-refresh.mjs');}catch{refreshFailed=true;}}
await stage('build-pages.mjs');
const allowed=new Set(['.nojekyll','daily-decision.js','daily-ui.js','daily.html','data/analysis.enc.json','encrypted-data.js','icon.svg','index.html','manifest.webmanifest','style.css','sw.js','taxes.js']);
const files=[],key=JSON.parse(await readFile(resolve(root,'private-data/daily/publish-key.json'),'utf8')).key;
async function walk(path,prefix=''){for(const entry of await readdir(path,{withFileTypes:true})){const name=prefix+entry.name,full=resolve(path,entry.name);if(entry.isSymbolicLink())throw Error('허용되지 않은 배포 링크');if(entry.isDirectory()){if(name!=='data')throw Error('허용되지 않은 배포 폴더');await walk(full,name+'/');}else{if(!allowed.has(name))throw Error('허용되지 않은 배포 파일');const content=await readFile(full,'utf8');if(content.includes(key))throw Error('접근 키가 배포 파일에 포함되어 있습니다.');const bytes=Buffer.from(content);files.push({path:'docs/'+name,mode:'100644',type:'blob',content,sha:createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex')});}}}
await walk(resolve(root,'dist/site'));
if(files.length!==allowed.size)throw Error('배포 파일이 누락되었습니다.');
const status=JSON.parse(await readFile(resolve(root,'private-data/daily/refresh-status.json'),'utf8'));
const snapshot=JSON.parse(await readFile(resolve(root,'private-data/daily/latest.json'),'utf8'));
const manifest={schema:'daily.publish.v1',preparedAt:new Date().toISOString(),asOf:snapshot.asOf,refreshState:status.state,refreshFailed,files};
await writeFile(resolve(root,'private-data/daily/publish-manifest.json'),JSON.stringify(manifest));
console.log(JSON.stringify({path:'private-data/daily/publish-manifest.json',asOf:manifest.asOf,refreshState:manifest.refreshState,refreshFailed,files:files.length}));
