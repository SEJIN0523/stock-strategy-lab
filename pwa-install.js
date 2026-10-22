const panel=document.querySelector('#pwa-install'),button=document.querySelector('#pwa-install-button'),message=document.querySelector('#pwa-install-status');
let promptEvent=null;
const standalone=window.matchMedia('(display-mode: standalone)');
function installed(){panel.hidden=true;promptEvent=null;}
if(standalone.matches||navigator.standalone===true)installed();
standalone.addEventListener('change',e=>{if(e.matches)installed();});
window.addEventListener('appinstalled',installed);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;panel.hidden=false;button.textContent='앱 설치';message.textContent='홈 화면 아이콘으로 열고 주소창 없이 사용할 수 있습니다.';});
button.addEventListener('click',async()=>{
 if(!promptEvent){message.textContent='Chrome에서 메뉴(⋮) → 홈 화면에 추가 → 설치를 선택하세요. 앱 안의 브라우저라면 먼저 Chrome으로 열어주세요. 설치 메뉴는 브라우저 상태에 따라 다를 수 있습니다.';return;}
 const event=promptEvent;promptEvent=null;button.disabled=true;
 try{await event.prompt();const choice=await event.userChoice;message.textContent=choice.outcome==='accepted'?'설치 요청을 보냈습니다. 설치가 끝나면 홈 화면에서 열어주세요.':'설치를 취소했습니다. Chrome 메뉴에서도 설치할 수 있습니다.';}catch{message.textContent='설치 창을 열지 못했습니다. Chrome 메뉴에서 홈 화면에 추가를 선택하세요.';}
 finally{button.disabled=false;button.textContent='설치 안내';}
});
