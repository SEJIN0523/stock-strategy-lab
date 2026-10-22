const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=value=>`${value>=0?'+':''}${(value*100).toFixed(2)}%`;

export function setupResearch(onApply) {
  const host=document.querySelector('#research-body');
  const button=document.querySelector('#refresh-research');
  async function refresh() {
    button.disabled=true;
    try {
      const response=await fetch('./api/research',{cache:'no-store'});
      if(!response.ok)throw new Error('연구 결과 대기');
      const report=await response.json();
      if(!Array.isArray(report.candidates)||report.candidates.length>100||!report.windows?.validation)throw new Error('invalid');
      const selected=report.selected;
      const risk=selected?.validation;
      const labels=[...(selected?[[`개발 구간 선정 ${selected.id}`,selected.validation]]:[]),...(selected?.stress?[['선정 후보 · 비용 스트레스',selected.stress]]:[]),['사전 기본 전략',report.baseline.validation],...(report.baseline.stress?[['기본 전략 · 비용 스트레스',report.baseline.stress]]:[])];
      const cost=report.plan.assumedCostsPercent;
      const costDescription=report.plan.taxMode==='krx-2024-2026'?`수수료 ${cost.fee}% · 체결가격 차이 ${cost.slippage}% · 매도 거래세(코스피 농특세 포함)는 과거 체결일별 적용. 개인별 양도소득세·배당소득세는 미반영입니다.`:`비용 가정: 수수료 ${cost.fee}% · 매도세금 ${cost.tax}% · 체결가격 차이 ${cost.slippage}%. 실제 계좌 비용을 의미하지 않습니다.`;
      const quality=risk&&(selected.training.largeGapExposures.length||risk.largeGapExposures.length||risk.terminalUntradable.length||risk.staleValuations)?'보유 종목의 가격 급변·거래 불가·과거 가격 평가가 포함됩니다. 성과를 실전 검증으로 해석할 수 없습니다.':'기업행사 미보정·상하한가 및 유동성 제약 미반영인 예비 연구입니다.';
      host.innerHTML=`<p class="help">${escape(report.data.source)} · ${report.data.stocks.toLocaleString()}종목 · ${report.data.days}거래일 · ${escape(report.data.first)} ~ ${escape(report.data.last)}</p>
        <div class="research-windows"><span><strong>개발 70%</strong> ${escape(report.windows.training.start)} ~ ${escape(report.windows.training.end)} (${report.windows.training.days}일)</span><span><strong>검증 30%</strong> ${escape(report.windows.validation.start)} ~ ${escape(report.windows.validation.end)} (${report.windows.validation.days}일)</span></div>
        <p>${selected?`개발 구간에서 선정한 후보: <strong>${escape(selected.id)} · 이동평균 ${selected.params.ma}일 / 상승률 ${selected.params.lookback}개 종가 / ${selected.params.maxHold}종목</strong>`:'개발 최대 손실폭 30% 이내 후보가 없어 전략을 선정하지 않았습니다.'}</p>
        <p class="help">후보 ${report.candidates.length}개를 같은 개발 구간에서 비교했습니다. 선정 규칙은 개발 최대 손실폭 30% 이내 후보 중 수익률 최대이며, 검증 결과로 후보를 재선정하지 않습니다. 개발·검증 자금은 각각 1,000만원에서 시작합니다.</p>
        <div class="table-wrap"><table><thead><tr><th>검증 대상</th><th>검증 수익률</th><th>최대 손실폭</th><th>총 비용</th></tr></thead><tbody>${labels.map(([label,result])=>`<tr><td>${escape(label)}</td><td class="${result.return>=0?'positive':'negative'}">${pct(result.return)}</td><td>${pct(result.mdd)}</td><td>${Math.round(result.costs).toLocaleString()}원</td></tr>`).join('')}</tbody></table></div>
        <p class="research-warning">${quality}</p><p class="help">${escape(costDescription)}</p><p class="help">${escape(report.plan.validationStatus||'사전에 고정한 최초 검증 구간 평가')}</p>
        ${risk?`<p class="help">선정 전략의 40% 초과 보유 종목 시가 갭: 개발 ${selected.training.largeGapExposures.length}건 / 검증 ${risk.largeGapExposures.length}건. 검증 미체결 ${risk.blockedOrders}건 / 과거 종가 평가 ${risk.staleValuations}종목·일 / 마지막 날 거래 불가 보유 ${risk.terminalUntradable.length}종목</p>`:''}
        ${selected?.monthly?`<details><summary>선정 전략 · 검증 월별 수익률</summary><p class="help">첫 달과 마지막 달은 부분 월입니다.</p><div class="table-wrap"><table><thead><tr><th>월</th><th>수익률</th></tr></thead><tbody>${selected.monthly.map(row=>`<tr><td>${escape(row.month)}</td><td>${pct(row.return)}</td></tr>`).join('')}</tbody></table></div></details>`:''}
        <details><summary>개발 구간 후보 비교</summary><div class="table-wrap"><table><thead><tr><th>후보</th><th>MA / 상승률 / 종목</th><th>개발 수익률</th><th>개발 MDD</th></tr></thead><tbody>${report.candidates.map(c=>`<tr><td>${escape(c.id)}</td><td>${c.params.ma} / ${c.params.lookback} / ${c.params.maxHold}</td><td>${pct(c.training.return)}</td><td>${pct(c.training.mdd)}</td></tr>`).join('')}</tbody></table></div></details>
        ${selected?'<button class="text-button" id="apply-research" type="button">선정 조건을 아래 전략 설정에 적용 →</button>':''}`;
      document.querySelector('#apply-research')?.addEventListener('click',()=>onApply(selected.params));
    }catch{host.textContent='아직 완료된 연구 결과가 없습니다. 수집·분석이 끝나면 새로고침으로 확인할 수 있습니다.';}
    finally{button.disabled=false;}
  }
  button.addEventListener('click',refresh);
  refresh();
}
