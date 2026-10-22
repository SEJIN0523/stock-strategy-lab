import {loadPublishedBundle} from './encrypted-data.js';
import { decisions,recordTrade,recordCash,validateAccount } from './daily-decision.js';
const $=s=>document.querySelector(s),key='kr-lab-daily-account-v1',today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const won=n=>Math.round(n).toLocaleString('ko-KR'),pct=n=>`${(n*100).toFixed(1)}%`,esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let account={cash:0,positions:[],log:[]},snapshot=null,storageError=false;
try{const saved=localStorage.getItem(key);if(saved)account=validateAccount(JSON.parse(saved));}catch{storageError=true;$('#daily-message').textContent='장부를 읽지 못했습니다. 기존 기록을 덮어쓰지 않습니다. 백업을 복원하세요.';}
function save() {if(storageError)throw Error('기존 장부를 먼저 복원하세요.');localStorage.setItem(key,JSON.stringify(account));}
function commit(next) {if(storageError)throw Error('기존 장부를 먼저 복원하세요.');localStorage.setItem(key,JSON.stringify(next));account=next;}
function showError(error){$('#daily-message').textContent=error.message;}
function render() {
  const drawLog=()=>{$('#daily-log').innerHTML=(account.log||[]).slice(-8).reverse().map(x=>`<p class="help">${esc(x.date)} · ${x.type?`${x.type==='deposit'?'입금':'출금'} ${won(x.amount)}원`:`${esc(x.code)} ${x.side==='buy'?'매수':'매도'} ${x.qty}주 · ${won(x.price)}원`}</p>`).join('');};
  if(!snapshot){$('#daily-balance').textContent=`현금 ${won(account.cash)}원 · 보유 ${account.positions.length}종목 · 시세 불러오기 대기`;drawLog();return;}
  const r=decisions(snapshot,account,today());account=r.updatedAccount;
  if(!storageError)try{save();}catch{storageError=true;$('#daily-message').textContent='장부를 저장하지 못했습니다. 백업을 받아 보관하세요.';}
  $('#daily-balance').textContent=`현금 ${won(account.cash)}원 · 보유 ${account.positions.length}종목${r.equity!==null?` · 기준 평가자산 ${won(r.equity)}원`:' · 일부 평가 확인 필요'}`;
  $('#daily-notice').textContent=r.notice;
  $('#daily-actions').innerHTML=r.actions.length?r.actions.map(a=>`<article class="daily-card"><strong>${a.side==='buy'?'매수 검토':'매도 검토'} · ${esc(a.name)} ${a.qty.toLocaleString()}주</strong><p>${esc(a.reason)}</p><p class="help">${esc(a.execution)} · 기준가 ${won(a.referencePrice)}원</p><button type="button" data-record="${esc(a.code)}" data-side="${a.side}" data-qty="${a.qty}">체결 후 기록 입력</button></article>`).join(''):'<p class="help">현재 조건에서 제시할 매매 수량이 없습니다.</p>';
  $('#daily-holdings').innerHTML=r.reviews.length?r.reviews.map(p=>`<article class="daily-card"><strong>${esc(p.name||p.code)}</strong><p>${esc(p.reason)}${p.stop?` · 손절 참고 ${won(p.stop)}원`:''}</p></article>`).join(''):'<p class="help">보유 종목이 없거나 매도 검토 목록에 표시됐습니다.</p>';
  const candidateCard=c=>`<article class="daily-card"><strong>${c.rank}. ${esc(c.name)} <small>${esc(c.code)}</small></strong><p>${won(c.price)}원 · 6개월 ${pct(c.mom6)} · 12개월(최근 1개월 제외) ${pct(c.mom12)}</p></article>`;
  const top=snapshot.candidates.filter(c=>c.rank<=(snapshot.settings.entryTopRank??snapshot.settings.maxPositions)),extra=snapshot.candidates.filter(c=>c.rank>(snapshot.settings.entryTopRank??snapshot.settings.maxPositions));
  $('#daily-candidates').innerHTML=top.map(candidateCard).join('')+(extra.length?`<details><summary>추가 참고 후보 ${extra.length}개 펼치기</summary>${extra.map(candidateCard).join('')}</details>`:'')||'<p>조건에 맞는 후보가 없습니다.</p>';
  drawLog();
}
async function refresh() {
  $('#daily-refresh').disabled=true;
  try {
    const bundle=await loadPublishedBundle();const response={ok:true,json:async()=>bundle.snapshot};if(!response.ok)throw Error('아직 최신 분석 파일이 없습니다. 데스크톱에서 signals:daily를 실행하면 표시됩니다.');
    snapshot=await response.json();
    let updateLabel='';
    try {
      const statusResponse={ok:true,json:async()=>bundle.status};
      if(statusResponse.ok) {
        const s=await statusResponse.json();
        updateLabel=s.state==='failed'?' · 최근 갱신 실패(이전 자료)':s.state==='running'?' · 갱신 중(이전 자료)':s.state==='cached'?' · 보관 자료로 재계산':s.state==='completed'?' · 시세 확인 완료':'';
      }
    }catch{}

    $('#daily-status').textContent=`${snapshot.asOf} 종가 · 후보 ${snapshot.candidates.length}개 · 임시 보유 상한 ${snapshot.settings.maxPositions}개(최적 개수 미선정) · ${snapshot.selectionDue?'종목 재선정일':'보유 점검일'}${updateLabel}`;
    $('#daily-codes').innerHTML=snapshot.quotes.map(q=>`<option value="${esc(q.code)}">${esc(q.name)}</option>`).join('');render();
  }catch(error){$('#daily-status').textContent=error.message;}finally{$('#daily-refresh').disabled=false;}
}
$('#daily-refresh').onclick=refresh;
$('#daily-cash').onsubmit=e=>{e.preventDefault();try{if(storageError)throw Error('기존 장부를 먼저 복원하세요.');const f=new FormData(e.target);commit(recordCash(account,{id:crypto.randomUUID(),date:today(),type:f.get('type'),amount:Number(f.get('amount'))}));render();$('#daily-message').textContent='입출금을 기록했습니다.';e.target.reset();}catch(error){showError(error);}};
$('#daily-trade').onsubmit=e=>{e.preventDefault();try{if(storageError)throw Error('기존 장부를 먼저 복원하세요.');if(!snapshot)throw Error('분석 자료를 먼저 불러오세요.');const f=new FormData(e.target),code=f.get('code'),q=snapshot.quotes.find(q=>q.code===code);if(!q)throw Error('조회 가능한 종목 코드를 입력하세요.');commit(recordTrade(account,{id:crypto.randomUUID(),date:today(),code,market:q.market,side:f.get('side'),qty:Number(f.get('qty')),price:Number(f.get('price'))}));render();$('#daily-message').textContent='실제 체결을 기록했습니다. 주문은 전송되지 않습니다.';e.target.reset();}catch(error){showError(error);}};
$('#daily-actions').onclick=e=>{const b=e.target.closest('[data-record]');if(!b)return;const f=$('#daily-trade'),q=snapshot.quotes.find(q=>q.code===b.dataset.record);f.elements.code.value=b.dataset.record;f.elements.side.value=b.dataset.side;f.elements.qty.value=b.dataset.qty;f.elements.price.value=q.price;f.scrollIntoView({behavior:'smooth',block:'start'});$('#daily-message').textContent='실제 체결 가격과 수량으로 고친 뒤 기록하세요.';};
$('#daily-backup').onclick=()=>{if(storageError)return showError(Error('읽지 못한 기존 장부가 있어 현재 빈 장부를 백업하지 않습니다.'));const url=URL.createObjectURL(new Blob([JSON.stringify({schema:'kr-lab-account.v1',account},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`매매장부-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#daily-restore').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>2000000)throw Error('백업 파일이 너무 큽니다.');const j=JSON.parse(await f.text());if(j.schema!=='kr-lab-account.v1'||!Array.isArray(j.account?.log))throw Error('이 앱의 장부 백업이 아닙니다.');const restored=validateAccount(j.account);if(!confirm('현재 브라우저 장부를 백업 내용으로 교체할까요?'))return;account=restored;storageError=false;save();render();$('#daily-message').textContent='백업을 복원했습니다.';}catch(error){showError(error);}finally{e.target.value='';}};
render();refresh();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js');
