import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { loadSettings } from './backend/settings.mjs';
import { fileURLToPath } from 'node:url';
import { openMarketDb, dbSummary } from './backend/market-db.mjs';
loadSettings();
const allowed = new Set(['index.html','daily.html','daily-ui.js','daily-decision.js','style.css','app.js','research-ui.js','engine.js','taxes.js','market-data.js','manifest.webmanifest','sw.js','icon.svg']);
const mime = {html:'text/html; charset=utf-8',css:'text/css',js:'text/javascript',webmanifest:'application/manifest+json',svg:'image/svg+xml'};
http.createServer(async (req,res) => {
  if(!['localhost:4173','127.0.0.1:4173'].includes(req.headers.host)) {res.writeHead(403);res.end();return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const name = new URL(req.url,'http://localhost').pathname.slice(1) || 'index.html';
  if(name==='api/daily-status') {
    let status={schema:'daily.refresh.v1',state:'not_run'};
    try{status=JSON.parse(await readFile(new URL('./private-data/daily/refresh-status.json',import.meta.url),'utf8'));}catch{}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(status));return;
  }
  if(name==='api/daily-snapshot') {
    try{const file=await readFile(new URL('./private-data/daily/latest.json',import.meta.url));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(file);}catch{res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'매매 노트 분석 파일이 없습니다.'}));}return;
  }
  if(name==='api/data-status') {
    let available=false;try{await stat(new URL('./private-data/latest.json',import.meta.url));available=true;}catch{}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({configured:Boolean(process.env.KRX_API_KEY?.trim()||process.env.DATA_GO_KR_SERVICE_KEY?.trim()),provider:process.env.KRX_API_KEY?.trim()?'KRX':process.env.DATA_GO_KR_SERVICE_KEY?.trim()?'FSC':null,available}));return;
  }
  if(name==='api/dataset') {
    try {const file=await readFile(new URL('./private-data/latest.json',import.meta.url));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(file);}catch{res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'수집한 데이터가 없습니다.'}));}return;
  }
  if(name==='api/research') {
    try{const file=await readFile(new URL('./private-data/research-results.json',import.meta.url));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(file);}catch{res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'연구 결과가 아직 없습니다.'}));}return;
  }
  if(name==='api/db-status') {
    let db;
    try{const path=new URL('./private-data/market.sqlite',import.meta.url);const info=await stat(path);db=openMarketDb(fileURLToPath(path),true);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({...dbSummary(db),bytes:info.size}));}catch{res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'DB가 아직 없습니다.'}));}finally{db?.close();}return;
  }
  if (!allowed.has(name)) {res.writeHead(404);res.end();return;}
  try {const file=await readFile(new URL(name,import.meta.url));res.writeHead(200,{'Content-Type':mime[name.split('.').pop()] || 'text/plain','Cache-Control':'no-cache'});res.end(file);} catch {res.writeHead(404);res.end();}
}).listen(4173,'127.0.0.1',()=>console.log('Local: http://localhost:4173'));
