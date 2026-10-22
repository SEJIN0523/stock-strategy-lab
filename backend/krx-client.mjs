import { isoDate, normalizeMarketData } from '../market-data.js';
import { collectionRange } from './fsc-client.mjs';

export const KRX_APIS = Object.freeze({KOSPI:'stk_bydd_trd',KOSDAQ:'ksq_bydd_trd'});

export async function requestKrxDay({key,date,market,fetchImpl=fetch}) {
  if(!key?.trim())throw new Error('KRX_API_KEY가 설정되지 않았습니다.');
  if(!KRX_APIS[market])throw new Error('지원하지 않는 시장입니다.');
  const day=isoDate(date);
  const url=new URL(`https://data-dbg.krx.co.kr/svc/apis/sto/${KRX_APIS[market]}`);
  url.searchParams.set('basDd',day.replaceAll('-',''));
  let response;
  try {response=await fetchImpl(url,{headers:{AUTH_KEY:key.trim()},signal:AbortSignal.timeout(30000),redirect:'error'});}
  catch {throw new Error(`KRX ${market} ${day} 연결 실패. 네트워크 또는 서비스 상태를 확인하세요.`);}
  if(!response.ok)throw new Error(`KRX ${market} HTTP ${response.status}. 인증키와 해당 API 이용 승인을 확인하세요.`);
  let json;
  try{json=await response.json();}catch{throw new Error('KRX가 JSON 데이터를 반환하지 않았습니다.');}
  if(!Array.isArray(json?.OutBlock_1))throw new Error('KRX 응답에 매매정보가 없습니다. 인증키 및 서비스 이용 승인을 확인하세요.');
  const identities=new Set();
  for(const row of json.OutBlock_1) {
    if(isoDate(row.BAS_DD)!==day)throw new Error('KRX 응답 기준일이 요청한 날짜와 다릅니다.');
    if(identities.has(row.ISU_CD))throw new Error('KRX 일별 자료에 중복 종목이 있습니다.');
    identities.add(row.ISU_CD);
  }
  return json.OutBlock_1;
}

export async function collectKrx({key,start,end,fetchImpl=fetch,onProgress=()=>{},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if(!key?.trim())throw new Error('KRX_API_KEY가 설정되지 않았습니다.');
  const {from,to}=collectionRange(start,end);
  const markets=Object.keys(KRX_APIS).map(market=>({market,records:[]}));
  const emptyDates=[];
  for(let time=Date.parse(from);time<=Date.parse(to);time+=86400000) {
    const date=new Date(time).toISOString().slice(0,10);
    for(const target of markets) {
      const rows=await requestKrxDay({key,date,market:target.market,fetchImpl});
      target.records.push(...rows);
      if(!rows.length)emptyDates.push({date,market:target.market});
      onProgress({date,market:target.market,rows:rows.length});
      await pause(150);
    }
  }
  const payload={format:'krx-stock-daily-v1',collectedAt:new Date().toISOString(),requestedRange:{start:from,end:to},markets,emptyDates};
  normalizeMarketData(payload);
  return payload;
}
