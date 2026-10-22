import { demoData, backtest } from './engine.js';
import { normalizeMarketData } from './market-data.js';
import { setupResearch } from './research-ui.js';

let data = demoData();
const form = document.querySelector('#strategy');
const $ = selector => document.querySelector(selector);
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
const won = n => Math.round(n).toLocaleString('ko-KR');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let result;
let history = [];
try {
  const saved = JSON.parse(localStorage.getItem('kr-lab-history') || '[]');
  if (Array.isArray(saved)) history = saved.filter(x => x && typeof x.label === 'string' && Number.isFinite(x.ret) && Number.isFinite(x.mdd)).slice(0,8);
} catch {}

function save() {
  try { localStorage.setItem('kr-lab-history', JSON.stringify(history)); } catch {}
}

function drawHistory() {
  const root = $('#history');
  root.replaceChildren();
  if (!history.length) { root.textContent = '아직 저장된 실험이 없습니다.'; return; }
  for (const h of history) {
    const row = document.createElement('div'); row.className = 'item';
    const label = document.createElement('span'); label.textContent = h.label;
    if (h.dataset) {
      const detail = document.createElement('small');
      detail.textContent = `${h.dataset} · ${h.start} ~ ${h.end}`;
      label.append(detail);
    }
    const stat = document.createElement('strong');
    stat.textContent = `${pct(h.ret)} / MDD ${pct(h.mdd)}`;
    stat.className = h.ret >= 0 ? 'positive' : 'negative';
    row.append(label, stat); root.append(row);
  }
}

function chart(rows) {
  let low = Infinity, high = -Infinity;
  for (const row of rows) { low = Math.min(low,row.equity,row.benchmark); high = Math.max(high,row.equity,row.benchmark); }
  low *= .98; high *= 1.02;
  if (low === high) high = low + 1;
  const x = i => 65 + i / (rows.length - 1) * 715;
  const y = v => 225 - (v - low) / (high - low) * 200;
  let svg = '';
  for (let i=0;i<4;i++) {
    const v = low + (high-low)*i/3;
    svg += `<line x1="65" x2="780" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f5"/><text x="0" y="${y(v)+4}" fill="#8d9aab" font-size="11">${(v/10000).toFixed(0)}만</text>`;
  }
  for (const [field,color] of [['benchmark','#a8b3c3'],['equity','#188a74']]) {
    svg += `<polyline points="${rows.map((r,i)=>`${x(i)},${y(r[field])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${field==='equity'?3:2}" stroke-linejoin="round"/>`;
  }
  svg += `<text x="65" y="252" fill="#8d9aab" font-size="11">${escape(rows[0].date)}</text><text x="780" y="252" text-anchor="end" fill="#8d9aab" font-size="11">${escape(rows.at(-1).date)}</text>`;
  $('#chart').innerHTML = svg;
}

function clearResults() {
  result = undefined;
  for (const id of ['#metrics','#chart','#picks','#trades']) $(id).replaceChildren();
  $('#range').textContent = '분석 대기';
  $('#execution-quality').textContent = '';
  $('#export').disabled = true;
}

function describeData() {
  const real = data.meta.kind === 'real';
  $('#data-title').textContent = real ? '실제 일별 데이터 · 예비 연구' : '예제 데이터 실험실';
  $('#data-notice').textContent = real ? `${data.meta.source}. 비수정 가격과 누락 자료의 한계가 있는 탐색용 결과입니다. 증권사 미연결.` : '실제 종목·시세가 아닌 가상 24개 종목입니다. 성과와 선정 결과는 투자 판단에 사용할 수 없습니다. 증권사 미연결.';
  $('#data-quality').hidden = !real;
  $('#allow-raw').checked = false;
  form.elements.taxMode.value=real?'krx-2024-2026':'fixed';
  $('#picks-mode').textContent = real ? '실제 데이터 · 연구 신호' : '가상 종목';
  $('#dataset-summary').textContent = `${data.meta.source} · ${data.stocks.length.toLocaleString()}종목 · ${data.dates.length.toLocaleString()}거래일 · ${data.dates[0]} ~ ${data.dates.at(-1)}`;
  $('#data-warnings').replaceChildren();
  for (const warning of data.meta.warnings) {
    const li = document.createElement('li'); li.textContent = warning; $('#data-warnings').append(li);
  }
  if (real) {
    const r = data.meta.report;
    const li = document.createElement('li');
    li.textContent = `데이터 점검: 종목별 누락 ${r.missingBars.toLocaleString()}칸 / 0 가격·0 거래량 ${r.untradable.toLocaleString()}행 / 확인 종가 간 40% 초과 변동 ${r.largeMoves.toLocaleString()}건. 누락은 신규 상장·정지·폐지·수집 실패를 구분하지 못합니다.`;
    $('#data-warnings').append(li);
  }
}

function run(record=true) {
  try {
    const p = Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,['period','taxMode'].includes(k)?v:Number(v)]));
    p.allowRaw = $('#allow-raw').checked;
    result = backtest(data,p);
    $('#error').textContent = '';
    $('#range').textContent = `${result.start} — ${result.end}`;
    const metrics = [
      ['누적 수익률',result.return,data.meta.kind==='real'?'비용 반영 · 비수정 가격':'비용 반영 · 가상 데이터'],
      ['연환산 수익률',result.cagr,'달력 일수 기준'],
      ['최대 손실폭',result.mdd,'직전 자산 최고점 대비'],
      ['매매 비용',null,`${result.trades.length}건 체결 · 가격 차이 포함`]
    ];
    $('#metrics').innerHTML = metrics.map(([label,value,help])=>`<div class="metric"><span>${label}</span><strong class="${value===null?'':value>=0?'positive':'negative'}">${value===null?`${won(result.totalCosts)}원`:pct(value)}</strong><small>${help}</small></div>`).join('');
    chart(result.curve);
    $('#execution-quality').textContent = `시가 부재로 미체결 ${result.blockedOrders}건 · 마지막 확인 종가로 평가한 보유 종목·일 ${result.staleValuations}건. 상하한가·호가·유동성에 따른 실제 체결 제약은 미반영입니다.`;
    $('#picks').innerHTML = result.picks.length ? result.picks.map((s,i)=>`<div class="item"><span>${i+1}. ${escape(s.name)}<small>${escape(s.code)} · ${data.meta.kind==='real'?'예비 연구':'예제'} 신호</small></span><strong class="positive">${pct(s.momentum)}</strong></div>`).join('') : '<p class="help">조건을 충족하는 종목이 없습니다. 현금으로 대기합니다.</p>';
    $('#trades').innerHTML = result.trades.slice(-20).reverse().map(t=>`<tr><td>${escape(t.date)}</td><td>${escape(t.name)}</td><td class="${t.side==='매수'?'positive':'negative'}">${t.side}</td><td>${won(t.qty)}주</td><td>${won(t.price)}원</td></tr>`).join('');
    $('#export').disabled = false;
    if (record) {
      history.unshift({label:`MA ${p.ma} · 상승률 ${p.lookback} · ${p.maxHold}종목 · ${p.period==='validation'?'검증':p.period==='train'?'개발':'전체'}`,ret:result.return,mdd:result.mdd,settings:p,dataset:`${data.meta.kind==='real'?'실제·비수정':'가상'} ${data.stocks.length}종목`,start:result.start,end:result.end,collectedAt:data.meta.collectedAt || null});
      history = history.slice(0,8); save();
    }
    drawHistory();
  } catch (e) { clearResults(); $('#error').textContent = e.message; }
}

function usePayload(payload) {
  const next = normalizeMarketData(payload);
  data = next; describeData(); clearResults();
  $('#error').textContent = '';
  $('#data-feedback').textContent = '데이터를 불러왔습니다. 한계를 확인하고 전략 설정에서 백테스트를 실행하세요. 데이터가 짧으면 이동평균 기간을 줄이세요.';
}

$('#load-real').addEventListener('click',async()=>{
  const button = $('#load-real'); button.disabled = true;
  try {
    const response = await fetch('./api/dataset',{cache:'no-store'});
    if (!response.ok) throw new Error('수집 데이터가 없습니다. 서버에 KRX 또는 공공데이터 키를 설정하고 수집기를 실행해야 합니다. GitHub Pages에서는 데이터 파일 열기를 사용하세요.');
    usePayload(await response.json());
  } catch (e) { $('#data-feedback').textContent = e instanceof SyntaxError ? '서버에서 올바른 데이터 파일을 받지 못했습니다.' : e.message; }
  finally { button.disabled = false; }
});
$('#data-file').addEventListener('change',async event=>{
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 80*1024*1024) throw new Error('파일 크기는 80MB 이하여야 합니다.');
    usePayload(JSON.parse(await file.text()));
  } catch (e) { $('#data-feedback').textContent = e instanceof SyntaxError ? 'JSON 형식이 올바르지 않습니다.' : e.message; }
  finally { event.target.value = ''; }
});
$('#use-demo').addEventListener('click',()=>{data=demoData();describeData();$('#data-feedback').textContent='예제 데이터로 전환했습니다.';run(false);});
form.addEventListener('submit',e=>{e.preventDefault();run();});
$('#allow-raw').addEventListener('change',()=>{if(!$('#allow-raw').checked&&data.meta.kind==='real')clearResults();});
$('#clear').addEventListener('click',()=>{history=[];save();drawHistory();});
$('#export').addEventListener('click',()=>{
  if (!result) return;
  const cell=value=>`"${String(value).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')}"`;
  const csv='\uFEFF일자,종목코드,종목,구분,수량,체결가\n'+result.trades.map(t=>[t.date,`'${t.code}`,t.name,t.side,t.qty,t.price.toFixed(2)].map(cell).join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${data.meta.kind==='real'?'preliminary-raw':'demo'}-backtest-trades.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
describeData(); run(false);
setupResearch(params=>{
  for(const [name,value] of Object.entries(params))if(form.elements[name])form.elements[name].value=value;
  form.elements.period.value='validation';
  clearResults();
  $('#data-feedback').textContent='선정 조건을 적용했습니다. 실제 수집 데이터를 불러온 뒤 한계를 확인하고 백테스트를 실행하세요. 아래 화면은 수동 실험이며 연구 결과를 재선정하지 않습니다.';
});
fetch('./api/data-status',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(s=>{
  $('#connection-status').textContent = `${s.configured?`${s.provider==='KRX'?'KRX':'공공데이터'} 인증키 설정됨`:'데이터 인증키 미설정'} · ${s.available?'수집 데이터 있음':'수집 데이터 없음'} · 나무증권 키와 별도입니다.`;
}).catch(()=>{$('#connection-status').textContent='수집 서버에 연결되지 않았습니다. 예제 데이터 또는 이 기기의 데이터 파일로 사용할 수 있습니다.';});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
fetch('./api/db-status',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(db=>{
  $('#database-status').textContent=`로컬 DB: ${db.rows.toLocaleString()}행 · ${db.stocks.toLocaleString()}종목 · ${db.last}까지 · ${(db.bytes/1048576).toFixed(1)}MiB. 백테스트 스냅샷의 종료일과 다를 수 있습니다. ${db.sectorRecords?'섹터 이력 있음':'섹터 분류 자료는 아직 미등록입니다.'}`;
}).catch(()=>{$('#database-status').textContent='로컬 DB 서버에 연결되지 않았습니다. 저장된 연구 결과나 파일로 분석할 수 있습니다.';});
