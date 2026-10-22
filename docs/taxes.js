// Combined exchange sale taxes (KOSPI includes rural special tax), by execution date.
// Applicability is limited to ordinary KOSPI/KOSDAQ exchange transactions in 2024–2026.
export const TAX_SOURCES=[
  'https://www.kakaopaysec.com/stocknotice/instocknotice/dynamicBoardPageDetail.do?id=6384',
  'https://www.samsungpop.com/ux/kor/customer/notice/notice/noticeViewContent.do?MenuSeqNo=23435',
  'https://m.nhsec.com/static/MNHSI0194'
];
export function saleTaxPercent(date,market) {
  if(!['KOSPI','KOSDAQ'].includes(market)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'2024-01-01'||date>'2026-12-31')throw new Error('거래일별 세율은 2024~2026 코스피·코스닥만 지원합니다.');
  if(date>='2025-12-29')return .20;
  if(date>='2024-12-27')return .15;
  return .18;
}
