import { FSC_ENDPOINT, isoDate, normalizeFsc } from '../market-data.js';

export function collectionRange(start,end) {
  const from=isoDate(start),to=isoDate(end);
  const days=(Date.parse(to)-Date.parse(from))/86400000;
  if(days<0 || days>366) throw new Error('한 번의 수집 범위는 1년 이내로 지정하세요.');
  if(to>new Date().toISOString().slice(0,10))throw new Error('미래 날짜는 수집할 수 없습니다.');
  return {from,to};
}

export function readFscPage(json) {
  const response=json?.response || json;
  if(String(response?.header?.resultCode)!=='00')throw new Error('공공데이터 API가 요청을 거부했습니다. 인증키·활용신청·호출 한도를 확인하세요.');
  const body=response.body;
  const total=Number(body?.totalCount);
  if(!Number.isInteger(total)||total<0)throw new Error('API 응답의 전체 행 수가 올바르지 않습니다.');
  const item=body.items?.item;
  const records=Array.isArray(item)?item:item&&typeof item==='object'?[item]:[];
  if(total && !records.length)throw new Error('API 응답이 일부 누락되었습니다. 수집을 중단합니다.');
  return {records,total};
}

export async function collectFsc({key,start,end,fetchImpl=fetch,onProgress=()=>{},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if(!key?.trim())throw new Error('DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. 나무증권 키와 별도의 공공데이터포털 키가 필요합니다.');
  const {from,to}=collectionRange(start,end);
  let serviceKey=key.trim();
  try{serviceKey=decodeURIComponent(serviceKey);}catch{throw new Error('인증키 인코딩을 확인하세요.');}
  const records=[];
  // endBasDt is documented as exclusive. Ask for the following day and filter again locally.
  const nextDay=new Date(Date.parse(to)+86400000).toISOString().slice(0,10).replaceAll('-','');
  for(const market of ['KOSPI','KOSDAQ']) {
    let page=1,expected=null,received=0;
    const pageKeys=new Set();
    do {
      const url=new URL(FSC_ENDPOINT);
      for(const [name,value] of Object.entries({serviceKey,resultType:'json',numOfRows:'1000',pageNo:String(page),beginBasDt:from.replaceAll('-',''),endBasDt:nextDay,mrktCls:market}))url.searchParams.set(name,value);
      let response;
      try{response=await fetchImpl(url,{signal:AbortSignal.timeout(30000),redirect:'error'});}catch{throw new Error('공공데이터 API 연결에 실패했습니다. 네트워크 또는 서비스 상태를 확인하세요.');}
      if(!response.ok)throw new Error(`공공데이터 API HTTP 오류 (${response.status})`);
      let parsed;
      try{parsed=readFscPage(await response.json());}catch(error){if(error.message.startsWith('API')||error.message.startsWith('공공데이터'))throw error;throw new Error('API가 JSON 시세 데이터를 반환하지 않았습니다. 인증키·서비스 승인을 확인하세요.');}
      if(expected!==null && parsed.total!==expected)throw new Error('수집 중 원본 행 수가 변경되었습니다. 다시 수집하세요.');
      expected=parsed.total;
      for(const row of parsed.records) {
        const identity=`${row.srtnCd}:${row.basDt}`;
        if(pageKeys.has(identity))throw new Error('API 페이지에 중복 행이 있습니다. 완전한 수집을 보장할 수 없습니다.');
        pageKeys.add(identity);
        const date=isoDate(row.basDt);
        if(date>=from&&date<=to&&row.mrktCtg===market)records.push(row);
      }
      received+=parsed.records.length;
      if(received>expected)throw new Error('API 전체 행 수와 수집 행 수가 일치하지 않습니다.');
      onProgress({market,page,received,total:expected});
      if(received>=expected)break;
      if(page>=1000)throw new Error('수집 한도에 도달했습니다. 기간을 줄이세요.');
      page++; await pause(250);
    }while(true);
  }
  const payload={format:'fsc-stock-price-v2',sourceUrl:'https://www.data.go.kr/data/15094808/openapi.do',collectedAt:new Date().toISOString(),requestedRange:{start:from,end:to},records};
  normalizeFsc(payload); // Reject invalid/empty input before writing anything to disk.
  return payload;
}
