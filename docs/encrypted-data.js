const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function decryptBundle(payload,keyText) {
  if(payload?.schema!=='daily.encrypted.v1'||typeof keyText!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(keyText))throw Error('전용 접속 링크가 필요합니다.');
  const key=await crypto.subtle.importKey('raw',from64(keyText.replaceAll('-','+').replaceAll('_','/')+'='),{name:'AES-GCM'},false,['decrypt']);
  const zipped=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(payload.iv)},key,from64(payload.data));
  const bundle=JSON.parse(await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  if(bundle.snapshot?.schema!=='momentum.daily.v1'||!Array.isArray(bundle.snapshot.candidates)||!Array.isArray(bundle.snapshot.quotes))throw Error('분석 파일 형식이 올바르지 않습니다.');
  return bundle;
}
export async function loadPublishedBundle() {
  const storageKey='kr-lab-analysis-key:'+new URL('./',import.meta.url).pathname;
  const fragment=new URLSearchParams(location.hash.slice(1)),provided=fragment.get('access');
  let saved=null;try{saved=localStorage.getItem(storageKey);}catch{}
  const key=provided||saved;
  if(!key)throw Error('처음 한 번은 전달받은 전용 접속 링크로 열어주세요.');
  try {
    const response=await fetch('./data/analysis.enc.json',{cache:'no-store'});
    if(!response.ok)throw Error();
    const bundle=await decryptBundle(await response.json(),key);
    if(provided){try{localStorage.setItem(storageKey,provided);}catch{}history.replaceState(null,'',location.pathname+location.search);}
    return bundle;
  }catch{throw Error('분석 자료를 열지 못했습니다. 연결 상태를 확인하거나 전용 접속 링크로 다시 열어주세요.');}
}
