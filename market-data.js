export const FSC_SOURCE = 'https://www.data.go.kr/data/15094808/openapi.do';
export const FSC_ENDPOINT = 'https://apis.data.go.kr/1160100/GetStockSecuritiesInfoService_V2/getStockPriceInfo_V2';
export const KRX_SOURCE = 'https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd';

export function isoDate(value) {
  const raw = String(value ?? '').replaceAll('-', '');
  if (!/^\d{8}$/.test(raw)) throw new Error('날짜 형식이 올바르지 않습니다.');
  const date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`;
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('존재하지 않는 날짜입니다.');
  return date;
}

function number(value, field) {
  if (value === '' || value === null || value === undefined) throw new Error(`${field} 값이 없습니다.`);
  const parsed = Number(String(value).replaceAll(',', ''));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} 값이 올바르지 않습니다.`);
  return parsed;
}

// Only the stock-price operation is supported; ETF/ETN operations are never called.
export function normalizeFsc(payload) {
  if (payload?.format !== 'fsc-stock-price-v2' || !Array.isArray(payload.records)) throw new Error('지원하는 금융위원회 주식시세 데이터 파일이 아닙니다.');
  if (payload.records.length > 1000000) throw new Error('한 번에 100만 행까지만 불러올 수 있습니다.');
  const securities = new Map(), seen = new Map(), dates = new Set();
  const report = { excludedMarket: 0, missingBars: 0, untradable: 0, largeMoves: 0 };
  for (const row of payload.records) {
    if (!['KOSPI','KOSDAQ'].includes(row.mrktCtg)) { report.excludedMarket++; continue; }
    const code = String(row.srtnCd ?? '').replace(/^A(?=[0-9A-Z]{6}$)/, '');
    if (!/^[0-9A-Z]{6}$/.test(code) || typeof row.itmsNm !== 'string' || !row.itmsNm.trim() || row.itmsNm.length > 100) throw new Error('종목 코드 또는 이름이 올바르지 않습니다.');
    const date = isoDate(row.basDt);
    const bar = { date, open:number(row.mkp,'시가'), close:number(row.clpr,'종가'), volume:number(row.trqu,'거래량') };
    const key = `${code}:${date}`;
    if (seen.has(key)) {
      if (JSON.stringify(seen.get(key)) !== JSON.stringify(bar)) throw new Error(`중복된 종목·날짜의 가격이 다릅니다: ${code} ${date}`);
      continue;
    }
    seen.set(key,bar);
    if (!securities.has(code)) securities.set(code,{code,name:row.itmsNm,market:row.mrktCtg,rows:new Map(),nameDate:date});
    const stock = securities.get(code);
    if (date >= stock.nameDate) {stock.name=row.itmsNm;stock.nameDate=date;}
    stock.rows.set(date,bar); dates.add(date);
    if (!bar.open || !bar.close || !bar.volume) report.untradable++;
  }
  const calendar = [...dates].sort();
  if (calendar.length < 4) throw new Error('서로 다른 거래일 4일 이상이 필요합니다.');
  if (!securities.size) throw new Error('코스피·코스닥 개별 종목 데이터가 없습니다.');
  const stocks = [...securities.values()].sort((a,b)=>a.code.localeCompare(b.code)).map(stock=>{
    let previous;
    const bars=calendar.map(date=>{
      const bar=stock.rows.get(date) || null;
      if (!bar) report.missingBars++;
      if (bar?.close>0) {if(previous && Math.abs(bar.close/previous-1)>.4) report.largeMoves++;previous=bar.close;}
      return bar;
    });
    return {code:stock.code,name:stock.name,market:stock.market,bars};
  });
  return { dates:calendar,stocks,meta:{kind:'real',source:'금융위원회 주식시세정보 · KRX',sourceUrl:FSC_SOURCE,priceBasis:'raw',universe:'observed-history',collectedAt:payload.collectedAt || null,report,warnings:[
    '비수정 가격입니다. 액면분할·권리락·배당을 보정하지 않아 수익률이 왜곡될 수 있습니다.',
    '조회된 과거 종목을 사용하지만 상장폐지·거래정지·누락 자료의 완전성은 검증하지 않았습니다.',
    '유효한 시가가 있는 날만 주문합니다. 매도 불가 시 보유하며 마지막 확인 종가로 평가합니다. 이후 가격이 없는 종목의 손실은 과소평가될 수 있습니다.',
    '거래일은 수신된 날짜의 합집합입니다. 전체 시장 데이터가 빠진 날은 별도 거래소 달력 대조가 필요합니다.',
    '실제 데이터 탐색용 결과이며 실전 성과 검증이 아닙니다.'
  ]}};
}

export function normalizeMarketData(payload) {
  if (payload?.format === 'krx-stock-compact-v1') return normalizeCompact(payload);
  if (payload?.format !== 'krx-stock-daily-v1') return normalizeFsc(payload);
  if (!Array.isArray(payload.markets) || payload.markets.some(m=>!['KOSPI','KOSDAQ'].includes(m.market)||!Array.isArray(m.records))) throw new Error('KRX 데이터 형식이 올바르지 않습니다.');
  const records = payload.markets.flatMap(m=>m.records.map(row=>({
    srtnCd:row.ISU_CD,basDt:row.BAS_DD,itmsNm:row.ISU_NM,mrktCtg:m.market,
    mkp:row.TDD_OPNPRC==='-'?'0':row.TDD_OPNPRC,
    clpr:row.TDD_CLSPRC==='-'?'0':row.TDD_CLSPRC,
    trqu:row.ACC_TRDVOL==='-'?'0':row.ACC_TRDVOL
  })));
  const normalized = normalizeFsc({format:'fsc-stock-price-v2',records,collectedAt:payload.collectedAt});
  normalized.meta.source = '한국거래소 통계정보 · KRX OPEN API';
  normalized.meta.sourceUrl = KRX_SOURCE;
  normalized.meta.provider = 'KRX';
  normalized.meta.emptyDates = payload.emptyDates || [];
  normalized.meta.warnings.push('빈 응답 날짜는 휴장·미제공·누락을 구분하지 못합니다. 공식 거래소 달력 대조 전 결과입니다.');
  return normalized;
}

export function normalizeCompact(payload) {
  if(!Array.isArray(payload.dates)||!Array.isArray(payload.stocks)||!payload.stocks.length||payload.stocks.length>5000||payload.dates.length<4||payload.dates.length>4000||payload.stocks.length*payload.dates.length>10000000)throw new Error('압축 시세 자료의 종목·날짜 배열 또는 크기를 확인하세요.');
  const dates=payload.dates.map(isoDate);
  if(dates.some((date,i)=>i>0&&date<=dates[i-1]))throw new Error('거래일이 중복되거나 시간순이 아닙니다.');
  const codes=new Set();
  const report={excludedMarket:0,missingBars:0,untradable:0,largeMoves:0};
  const stocks=payload.stocks.map(stock=>{
    if(!/^[0-9A-Z]{6}$/.test(stock.code)||codes.has(stock.code)||!['KOSPI','KOSDAQ'].includes(stock.market)||typeof stock.name!=='string'||stock.name.length>100||!Array.isArray(stock.bars))throw new Error('압축 시세 자료의 종목 정보가 올바르지 않습니다.');
    codes.add(stock.code);
    const bars=Array(dates.length).fill(null);
    let previousIndex=-1,previousClose;
    for(const tuple of stock.bars) {
      if(!Array.isArray(tuple)||tuple.length!==4)throw new Error('시세 행 형식이 올바르지 않습니다.');
      const [index,open,close,volume]=tuple;
      if(!Number.isInteger(index)||index<0||index>=dates.length||index<=previousIndex||![open,close,volume].every(v=>Number.isFinite(v)&&v>=0))throw new Error('시세 값 또는 거래일 순서가 올바르지 않습니다.');
      previousIndex=index;
      bars[index]={date:dates[index],open,close,volume};
      if(!open||!close||!volume)report.untradable++;
      if(close>0){if(previousClose&&Math.abs(close/previousClose-1)>.4)report.largeMoves++;previousClose=close;}
    }
    report.missingBars+=dates.length-stock.bars.length;
    return {code:stock.code,name:stock.name,market:stock.market,bars};
  });
  return {dates,stocks,meta:{kind:'real',provider:'KRX',source:'한국거래소 통계정보 · KRX OPEN API',sourceUrl:KRX_SOURCE,priceBasis:'raw',universe:'observed-history',collectedAt:payload.collectedAt||null,report,emptyDates:payload.emptyDates||[],warnings:[
    '비수정 가격입니다. 액면분할·권리락·배당을 보정하지 않아 수익률이 왜곡될 수 있습니다.',
    '과거 응답에 있던 종목을 포함합니다. 상장폐지·시장 이동·종목코드 재사용·전체 누락일의 완전성은 검증하지 않았습니다.',
    '시가가 없으면 주문을 체결하지 않습니다. 가격이 끊긴 보유 종목을 마지막 확인 종가로 평가하므로 손실이 과소평가될 수 있습니다.',
    '거래일은 수신 날짜의 합집합입니다. 빈 응답일은 휴장 여부를 별도 확인해야 합니다.',
    '예비 연구 결과이며 실제 체결·기업행사 처리를 갖춘 수익성 검증이 아닙니다.'
  ]}};
}
