import {STATIC_ASSETS,OCR_ASSETS} from './web-assets.mjs';
import { readFile,writeFile,mkdir,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve,relative } from 'node:path';
import { createHash,randomBytes } from 'node:crypto';
import { sealBundle } from './publish-crypto.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(root,'dist/site');
const snapshot=JSON.parse(await readFile(resolve(root,'private-data/daily/latest.json'),'utf8'));
if(snapshot.schema!=='momentum.daily.v1'||!Array.isArray(snapshot.quotes)||!Array.isArray(snapshot.candidates))throw Error('올바른 매매 노트 자료가 필요합니다.');
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const published=pick(snapshot,['schema','generatedAt','asOf','variant','priceKind','selectionDue','selectionCycleAnchor','recentDates','settings','candidateCount','limitations','ordersGenerated']);
published.quotes=snapshot.quotes.map(q=>pick(q,['code','name','market','date','price','tradable','ma60','historyFirst','lastShareChangeDate','recentCloses','rank']));
published.candidates=snapshot.candidates.map(c=>pick(c,['code','price','mom6','mom12','lowVol','momentum','score','rank','name','market']));
let status={state:'not_run'};
try {status=pick(JSON.parse(await readFile(resolve(root,'private-data/daily/refresh-status.json'),'utf8')),['schema','state','mode','startedAt','finishedAt','asOf','candidates']);}catch(error){if(error.code!=='ENOENT')throw error;}
const copied=STATIC_ASSETS;
const files=new Map(await Promise.all(copied.map(async name=>[name,await readFile(resolve(root,name))])));
const html=(await readFile(resolve(root,'daily.html'),'utf8')).replace('<a class="daily-link" href="./">연구 실험실</a>','<span class="help">매매 노트</span>');
files.set('index.html',html);files.set('daily.html',html);
let ui=await readFile(resolve(root,'daily-ui.js'),'utf8');
ui="import {loadPublishedBundle} from './encrypted-data.js';\n"+ui;
const source="const response=await fetch('./api/daily-snapshot',{cache:'no-store'});";
const statusSource="const statusResponse=await fetch('./api/daily-status',{cache:'no-store'});";
if(!ui.includes(source)||!ui.includes(statusSource))throw Error('분석 경로 변환 실패');
ui=ui.replace(source,'const bundle=await loadPublishedBundle();const response={ok:true,json:async()=>bundle.snapshot};');
ui=ui.replace(statusSource,'const statusResponse={ok:true,json:async()=>bundle.status};');
files.set('daily-ui.js',ui);
files.set('manifest.webmanifest',JSON.stringify({...JSON.parse(await readFile(resolve(root,'manifest.webmanifest'),'utf8')),start_url:'./'}));
const keyPath=resolve(root,'private-data/daily/publish-key.json');
let key;
try {key=JSON.parse(await readFile(keyPath,'utf8')).key;}catch(error){if(error.code!=='ENOENT')throw error;key=randomBytes(32).toString('base64url');await writeFile(keyPath,JSON.stringify({schema:'daily.publish-key.v1',key}),{flag:'wx'});}
if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))throw Error('배포 키 파일을 확인하세요.');
files.set('data/analysis.enc.json',JSON.stringify(sealBundle({snapshot:published,status},key)));
const assets=[...files.keys()].filter(p=>!p.startsWith('data/')&&!p.startsWith('vendor/')).map(p=>'./'+p);assets.push('./');
const version=createHash('sha256').update(Buffer.concat([...files.values()].map(v=>Buffer.isBuffer(v)?v:Buffer.from(v)))).digest('hex').slice(0,16);
files.set('sw.js',`const CACHE='kr-strategy-pages-${version}',ASSETS=${JSON.stringify(assets)},LAZY=${JSON.stringify(OCR_ASSETS.map(p=>'./'+p))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('kr-strategy-pages-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||![...ASSETS,...LAZY].some(path=>new URL(path,self.registration.scope).href===u.href))return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));});`);
files.set('.nojekyll','');
await mkdir(output,{recursive:true});
async function inspect(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,entry.name);if(entry.isSymbolicLink())throw Error('배포 폴더에 링크가 있습니다.');if(entry.isDirectory())await inspect(path);else if(!files.has(relative(output,path).replaceAll('\\','/')))throw Error('배포 폴더에 허용하지 않은 파일이 있습니다.');}}
await inspect(output);
for(const [name,body] of files){const path=resolve(output,name);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,body);}
console.log(JSON.stringify({directory:output,asOf:published.asOf,files:files.size,bytes:[...files.values()].reduce((n,v)=>n+Buffer.byteLength(v),0),candidateCount:published.candidates.length,personalLedgerIncluded:false,rawDatabaseIncluded:false}));
