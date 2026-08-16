/* ============================================================
   theo 대시보드 — 권리금검증
   상가_권리금_검증시트(엑셀) 로직을 그대로 이식한 순수 프론트 계산기.
   저장 기능 없음(1안 확정) — sessionStorage에 임시 초안만 유지해서
   새로고침/실수 이동 시 입력값이 날아가지 않게만 함(브라우저 탭 종료 시 소멸, 이력 아님).
   ============================================================ */

const PV_DRAFT_KEY = 'theo_pv_draft_v1';

const PV_MULTIPLIER_REF = [
  { biz: '한식/일반음식', range: '10~12개월', note: '안정 업종, 표준 배수' },
  { biz: '카페/디저트', range: '12~18개월', note: '단골 충성도 높으면 상향' },
  { biz: '주점/호프/바', range: '8~12개월', note: '경기·트렌드 민감' },
  { biz: '편의점/소매', range: '10~15개월', note: '입지·매출 안정성 높음' },
  { biz: '프랜차이즈(외식)', range: '12~18개월', note: '브랜드 가치 반영' },
  { biz: '미용/네일/피부', range: '6~12개월', note: '단골·원장 의존도 큰 편' },
  { biz: '학원/교습', range: '6~12개월', note: '원생·강사 인계 의존' },
  { biz: '일반 서비스/소매', range: '6~10개월', note: '보수적 적용 권장' },
];

const PV_COST_RATE_DEFAULTS = {
  '한식/일반음식': 38,
  '카페/디저트': 30,
  '주점/호프/바': 33,
  '프랜차이즈(외식)': 40,
  '편의점/소매': 75,
  '미용/네일/피부': 15,
};

const PV_PAYBACK_REF = [
  { label: '★★★ 매우 우수', range: '12개월 이내', note: '1년 안에 권리금 회수' },
  { label: '★★ 양호', range: '12~24개월', note: '인수자 설득 용이' },
  { label: '★ 보통', range: '24~36개월', note: '검토 필요, 협상 여지' },
  { label: '☆ 부담 큼', range: '36개월 초과', note: '과도 신호, 재산정 권장' },
];

const PV_GAP_REF = [
  { label: '✅ 적정', range: '20% 이내', note: '협상 정상범위' },
  { label: '△ 다소 과다', range: '20~50%', note: '근거 확인 후 협상' },
  { label: '⛔ 과다', range: '50% 초과', note: '증빙 요구 후 재산정' },
];

const PV_DOC_GROUPS = [
  {
    title: '① 영업권리금 ─ 매출 증빙 (신뢰도 높은 순)',
    items: [
      { name: '카드매출 정산내역', source: 'VAN사·카드사 발급', verify: '제시 매출의 실재성 (카드분)', rel: '최상', type: '필수', point: '카드사 직접 발급분 → 조작 거의 불가. 음식·소매업 기준점' },
      { name: '배달앱 정산내역', source: '배민·쿠팡이츠 사장님 앱', verify: '배달 매출 (제시 매출 보완)', rel: '최상', type: '권장', point: '배달 비중 큰 업종은 누락 시 매출 절반을 못 봄' },
      { name: '부가가치세 신고서/과세표준증명원', source: '홈택스 발급', verify: '신고 매출의 하한선', rel: '상', type: '필수', point: '낮게 신고했으면 매도인 주장과 충돌 → 매도인에 불리한 증빙' },
      { name: '소득금액증명원', source: '홈택스 (종합소득세 기반)', verify: '신고된 순소득', rel: '상', type: '권장', point: '순이익 주장과 직접 비교 가능' },
      { name: '통장 입금내역', source: '매도인 보유/거래은행', verify: '실제 입금 흐름', rel: '상', type: '권장', point: '사적 입금 섞여 지저분하나 가장 정직한 숫자' },
      { name: 'POS 매출 원본', source: '매장 POS 시스템', verify: '월별 매출 추이', rel: '중', type: '권장', point: '성수기 한 달만 보여주는 함정 → 반드시 최근 6~12개월 평균' },
    ],
  },
  {
    title: '② 영업권리금 ─ 비용 증빙 (순이익 부풀리기 차단)',
    items: [
      { name: '급여대장/4대보험 가입자명부', source: '매도인/공단 확인', verify: '실제 인건비', rel: '상', type: '필수', point: '본인·가족 무급노동을 비용에서 빼 순이익 키우는 수법 차단' },
      { name: '원천징수영수증', source: '홈택스/매도인', verify: '신고 인건비', rel: '상', type: '권장', point: '급여대장과 교차 확인' },
      { name: '전기·가스·수도 고지서', source: '고지서/검침', verify: '가동률 역산 (가스↔매출)', rel: '중', type: '권장', point: '에너지 사용량과 매출 주장이 안 맞으면 신호' },
      { name: '거래처 세금계산서/매입내역', source: '홈택스/매도인', verify: '재료비·매입 규모', rel: '중', type: '권장', point: '원가율 검증' },
      { name: '임대차계약서 + 관리비 고지서', source: '임대인/관리사무소', verify: '월세·관리비 (고정비)', rel: '상', type: '필수', point: '중개사가 임대인 통해 직접 확인 가능' },
    ],
  },
  {
    title: '③ 시설권리금 증빙',
    items: [
      { name: '인테리어·시설 공사 계약서/견적서', source: '매도인 보유', verify: '초기 투자비 (감가 산정 출발점)', rel: '상', type: '필수', point: '신품가로 부풀려 부르는지 점검' },
      { name: '공사·집기 세금계산서', source: '매도인/홈택스', verify: '투자비 실재성', rel: '상', type: '권장', point: '계약서 금액과 실제 지급액 일치 확인' },
      { name: '시설 설치·개업 일자 자료', source: '사업자등록·계약서', verify: '경과연수 → 감가폭', rel: '중', type: '필수', point: '경과연수가 곧 감가. 노후 시설은 가치 급감' },
    ],
  },
  {
    title: '④ 중개사 직접 확인 공적서류 (매도인 협조 불필요)',
    items: [
      { name: '등기부등본', source: '인터넷등기소', verify: '임대인·근저당 확인', rel: '최상', type: '필수', point: '권리관계 기본. 직접 발급' },
      { name: '건축물대장', source: '정부24', verify: '위반건축물 여부 → 영업허가 영향', rel: '최상', type: '필수', point: '위반건축물이면 영업 자체가 위태' },
      { name: '영업신고증/허가증', source: '매도인/관할 구청', verify: '양도 가능 여부·업종 제한', rel: '상', type: '필수', point: '양도 불가 업종이면 권리금 의미 상실' },
      { name: '임대인 재계약·권리금 회수 협조 의사', source: '임대인 면담', verify: '권리금 실현 가능성 자체', rel: '최상', type: '필수', point: '임대인이 새 임차인 거부 시 권리금 공중분해 → 최우선 확인' },
    ],
  },
];

const PV_FIELD_IDS = [
  'pvShop', 'pvBiz', 'pvArea', 'pvDeposit', 'pvRent', 'pvMgmtFee', 'pvAskPremium',
  'pvFacConstruction', 'pvFacEquip', 'pvFacYears', 'pvFacLifespan', 'pvFacResidual',
  'pvOpCard', 'pvOpDelivery', 'pvOpTaxSales', 'pvOpCost', 'pvOpLabor', 'pvOpMgmt', 'pvOpMonths',
  'pvCostRateRef',
  'pvFloorPrice',
];

function pvNum_(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const raw = String(el.value).replace(/,/g, '');
  const v = parseFloat(raw);
  return isNaN(v) ? 0 : v;
}
function pvFormatMoneyInput_(el) {
  const raw = el.value.replace(/[^\d]/g, '');
  const withComma = raw ? Number(raw).toLocaleString('ko-KR') : '';
  el.value = withComma;
}
function pvWon_(n) {
  const r = Math.round(n || 0);
  return r.toLocaleString('ko-KR') + '원';
}
function pvSetText_(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function pvCalc() {
  // 기본정보
  const area = pvNum_('pvArea');
  const rent = pvNum_('pvRent');
  const askPremium = pvNum_('pvAskPremium');
  const biz = document.getElementById('pvBiz').value;
  pvSetText_('pvAreaPyeong', area ? (area / 3.3058).toFixed(1) + ' 평' : '0 평');

  // ① 시설권리금
  const facConstruction = pvNum_('pvFacConstruction');
  const facEquip = pvNum_('pvFacEquip');
  const facInvestTotal = facConstruction + facEquip;
  const facYears = pvNum_('pvFacYears');
  const facLifespan = pvNum_('pvFacLifespan');
  const facResidualRate = pvNum_('pvFacResidual');
  let facResult = 0;
  if (facInvestTotal > 0) {
    const byResidual = facInvestTotal * facResidualRate / 100;
    const byStraightLine = facLifespan > 0 ? facInvestTotal * (1 - facYears / facLifespan) : byResidual;
    facResult = Math.max(byResidual, byStraightLine, 0);
  }
  pvSetText_('pvFacInvestTotal', pvWon_(facInvestTotal));
  pvSetText_('pvFacResult', pvWon_(facResult));

  // ② 영업권리금 — 매출 증빙
  const opCard = pvNum_('pvOpCard');
  const opDelivery = pvNum_('pvOpDelivery');
  const opTaxSales = pvNum_('pvOpTaxSales');
  const opCash = Math.max(0, opTaxSales - opCard - opDelivery);
  const opSalesTotal = opCard + opDelivery + opCash;
  pvSetText_('pvOpCash', pvWon_(opCash));
  pvSetText_('pvOpSalesTotal', pvWon_(opSalesTotal));

  // ② 영업권리금 — 비용 증빙
  const opCost = pvNum_('pvOpCost');
  const opLabor = pvNum_('pvOpLabor');
  const opMgmt = pvNum_('pvOpMgmt');
  const opRent = rent;
  const opNetProfit = opSalesTotal - opCost - opLabor - opRent - opMgmt;
  pvSetText_('pvOpRent', pvWon_(opRent));
  pvSetText_('pvOpNetProfit', pvWon_(opNetProfit));

  const opMonths = pvNum_('pvOpMonths');
  const opResult = Math.max(0, opNetProfit) * opMonths;
  pvSetText_('pvOpResult', pvWon_(opResult));

  const opWarnBox = document.getElementById('pvOpWarn');
  if (opWarnBox) opWarnBox.style.display = opNetProfit <= 0 ? 'block' : 'none';

  // 재료비 교차검증
  const costRateRef = pvNum_('pvCostRateRef');
  const costRateCalc = opSalesTotal * (costRateRef / 100);
  const costRateDiff = opCost - costRateCalc;
  pvSetText_('pvCostRateCalc', pvWon_(costRateCalc));
  pvSetText_('pvCostRateDiff', (costRateDiff >= 0 ? '+' : '') + pvWon_(costRateDiff));

  const verdictEl = document.getElementById('pvCostRateVerdict');
  if (verdictEl) {
    if (opSalesTotal === 0) {
      verdictEl.className = 'pv-verdict muted';
      verdictEl.textContent = '업종과 매출·재료비를 입력하면 판정이 표시됩니다.';
    } else if (opCost === 0) {
      verdictEl.className = 'pv-verdict muted';
      verdictEl.textContent = 'ⓘ 재료비 미입력 → 재료비를 입력하면 원가율 판정이 표시됩니다.';
    } else if (costRateRef <= 0) {
      verdictEl.className = 'pv-verdict muted';
      verdictEl.textContent = 'ⓘ 업종 평균 원가율 미입력 → 값을 입력하면 판정이 표시됩니다.';
    } else {
      const rate = opCost / opSalesTotal;
      const refRate = costRateRef / 100;
      if (refRate > 0 && rate < refRate * 0.7) {
        verdictEl.className = 'pv-verdict warn';
        verdictEl.textContent = '⚠ 제시 원가율이 평균보다 크게 낮음 → 순이익 과대 가능성';
      } else if (refRate > 0 && rate > refRate * 1.3) {
        verdictEl.className = 'pv-verdict warn';
        verdictEl.textContent = '△ 제시 원가율이 평균보다 높음 → 수익성 점검';
      } else {
        verdictEl.className = 'pv-verdict good';
        verdictEl.textContent = '✅ 원가율 정상 범위';
      }
    }
  }

  // ③ 바닥권리금
  const floorPrice = pvNum_('pvFloorPrice');
  pvSetText_('pvFloorResult', pvWon_(floorPrice));

  // ★ 종합 검증 결과
  const sumCalc = facResult + opResult + floorPrice;
  const diff = askPremium - sumCalc;
  const gapRate = sumCalc !== 0 ? diff / sumCalc : 0;
  const payback = opNetProfit > 0 ? (askPremium / opNetProfit) : null;

  pvSetText_('rSumCalc', pvWon_(sumCalc));
  pvSetText_('rAskPremium', pvWon_(askPremium));
  pvSetText_('rDiff', (diff >= 0 ? '+' : '') + pvWon_(diff));
  pvSetText_('rGapRate', sumCalc !== 0 ? (gapRate * 100).toFixed(1) + '%' : '-');
  pvSetText_('rPayback', payback !== null ? payback.toFixed(1) + '개월' : '수익없음');

  const gapVerdictEl = document.getElementById('rGapVerdict');
  const paybackVerdictEl = document.getElementById('rPaybackVerdict');

  if (askPremium === 0 && sumCalc === 0) {
    gapVerdictEl.className = 'pv-verdict muted';
    gapVerdictEl.textContent = '기본 정보를 입력하면 판정이 표시됩니다.';
    paybackVerdictEl.style.display = 'none';
  } else if (opNetProfit <= 0) {
    gapVerdictEl.className = 'pv-verdict bad';
    gapVerdictEl.textContent = '⚠ 순이익이 없거나 음수 → 영업권리금 정당화 불가. 시설가치만 검토';
    paybackVerdictEl.style.display = 'none';
  } else {
    let cls, text;
    if (gapRate <= 0) { cls = 'good'; text = '✅ 적정 (제시액이 산출액 이하 — 무난/유리)'; }
    else if (gapRate <= 0.2) { cls = 'good'; text = '✅ 적정 범위 (괴리율 20% 이내)'; }
    else if (gapRate <= 0.5) { cls = 'warn'; text = '△ 다소 과다 — 협상 여지 / 근거 확인 필요'; }
    else { cls = 'bad'; text = '⛔ 과다 (괴리율 50% 초과) — 산정 근거 강하게 검증 권장'; }
    gapVerdictEl.className = 'pv-verdict ' + cls;
    gapVerdictEl.textContent = text;

    let pCls, pText;
    if (payback <= 12) { pCls = 'good'; pText = '회수기간 판정: 매우 우수 (12개월 이내)'; }
    else if (payback <= 24) { pCls = 'good'; pText = '회수기간 판정: 양호 (12~24개월)'; }
    else if (payback <= 36) { pCls = 'warn'; pText = '회수기간 판정: 보통 (24~36개월)'; }
    else { pCls = 'bad'; pText = '회수기간 판정: 부담 큼 (36개월 초과)'; }
    paybackVerdictEl.className = 'pv-verdict ' + pCls;
    paybackVerdictEl.textContent = pText;
    paybackVerdictEl.style.display = 'block';
  }

  // 참고지표
  pvSetText_('rRatioMultiple', rent > 0 ? (askPremium / rent).toFixed(1) + '배' : '-');
  pvSetText_('rRatioSales', opSalesTotal > 0 ? ((askPremium / opSalesTotal) * 100).toFixed(0) + '%' : '-');
  pvSetText_('rRatioMargin', opSalesTotal > 0 ? ((opNetProfit / opSalesTotal) * 100).toFixed(1) + '%' : '-');
}

function pvSaveDraft_() {
  try {
    const data = {};
    PV_FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) data[id] = el.value;
    });
    sessionStorage.setItem(PV_DRAFT_KEY, JSON.stringify(data));
  } catch (e) {}
}
function pvRestoreDraft_() {
  try {
    const raw = sessionStorage.getItem(PV_DRAFT_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    PV_FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el && data[id] !== undefined) el.value = data[id];
    });
  } catch (e) {}
}
function pvResetAll_() {
  if (!confirm('입력한 모든 값을 초기화할까요?')) return;
  PV_FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'pvFacLifespan') el.value = '5';
    else if (id === 'pvFacResidual') el.value = '10';
    else if (id === 'pvOpMonths') el.value = '12';
    else if (id === 'pvBiz') el.value = '';
    else el.value = '';
  });
  try { sessionStorage.removeItem(PV_DRAFT_KEY); } catch (e) {}
  pvCalc();
}

function pvRenderRefTables_() {
  const multBody = document.getElementById('pvRefMultiplierBody');
  if (multBody) {
    multBody.innerHTML = PV_MULTIPLIER_REF.map((r) =>
      `<tr><td>${r.biz}</td><td class="center">${r.range}</td><td>${r.note}</td></tr>`
    ).join('');
  }
  const paybackBody = document.getElementById('pvRefPaybackBody');
  if (paybackBody) {
    paybackBody.innerHTML = PV_PAYBACK_REF.map((r) =>
      `<tr><td>${r.label}</td><td class="center">${r.range}</td><td>${r.note}</td></tr>`
    ).join('');
  }
  const gapBody = document.getElementById('pvRefGapBody');
  if (gapBody) {
    gapBody.innerHTML = PV_GAP_REF.map((r) =>
      `<tr><td>${r.label}</td><td class="center">${r.range}</td><td>${r.note}</td></tr>`
    ).join('');
  }
}

/* ---------------- 검토서류 체크리스트 (확보여부는 세션 내 상태만, 저장 안 함) ---------------- */
const pvDocStatus = {}; // key: "그룹idx-아이템idx" -> '확보' | '미확보' | '거부'

function pvDocKey_(gi, ii) { return gi + '-' + ii; }

function pvRenderDocList_() {
  const wrap = document.getElementById('pvDocList');
  if (!wrap) return;
  let html = '';
  PV_DOC_GROUPS.forEach((group, gi) => {
    html += `<div class="pv-doc-group-title">${group.title}</div>`;
    group.items.forEach((item, ii) => {
      const key = pvDocKey_(gi, ii);
      const cur = pvDocStatus[key] || '';
      html += `
        <div class="pv-doc-card">
          <div class="pv-doc-top">
            <div>
              <div class="pv-doc-name">${item.name}</div>
              <div class="pv-doc-source">${item.source}</div>
            </div>
            <div class="pv-doc-badges">
              <span class="pv-doc-badge rel-${item.rel}">${item.rel}</span>
              <span class="pv-doc-badge type-${item.type}">${item.type}</span>
            </div>
          </div>
          <div class="pv-doc-verify">검증 항목: ${item.verify}</div>
          <div class="pv-doc-point">${item.point}</div>
          <div class="pv-doc-bottom">
            <div class="pv-doc-status" data-key="${key}">
              ${['확보', '미확보', '거부'].map((s) =>
                `<button type="button" class="pv-doc-status-btn${cur === s ? ' sel-' + s : ''}" data-status="${s}">${s}</button>`
              ).join('')}
            </div>
          </div>
        </div>`;
    });
  });
  wrap.innerHTML = html;

  wrap.querySelectorAll('.pv-doc-status').forEach((row) => {
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('.pv-doc-status-btn');
      if (!btn) return;
      const key = row.getAttribute('data-key');
      const status = btn.getAttribute('data-status');
      pvDocStatus[key] = pvDocStatus[key] === status ? '' : status;
      pvRenderDocList_();
      pvRenderDocSummary_();
    });
  });
}

function pvRenderDocSummary_() {
  const wrap = document.getElementById('pvDocSummary');
  if (!wrap) return;
  const total = PV_DOC_GROUPS.reduce((n, g) => n + g.items.length, 0);
  const values = Object.values(pvDocStatus);
  const secured = values.filter((v) => v === '확보').length;
  const refused = values.filter((v) => v === '거부').length;
  wrap.innerHTML = `
    <div class="pv-ratio-box" style="flex:1;"><div class="v">${secured}/${total}</div><div class="l">확보</div></div>
    <div class="pv-ratio-box" style="flex:1;"><div class="v">${refused}</div><div class="l">거부</div></div>
  `;
}

/* ---------------- PDF 저장 (브라우저 인쇄 → PDF로 저장 방식) ----------------
   jsPDF의 text() 기반 렌더링은 한글 폰트 임베딩 없이는 깨지므로(계약서 라이브러리 사진→PDF와 달리
   여긴 텍스트 리포트라 그 방식이 안 맞음), 브라우저 네이티브 인쇄를 이용해 한글이 항상 정확히 나오게 함. */

function pvRowVal_(id, kind, unit) {
  const el = document.getElementById(id);
  if (!el) return '-';
  if (kind === 'readout') {
    const t = el.textContent.trim();
    return t || '-';
  }
  const v = el.value;
  if (!v) return '-';
  return v + (unit || '');
}

function pvPrintRows_(rows) {
  return rows.map(([label, id, kind, unit]) => {
    const val = pvRowVal_(id, kind, unit);
    return `<tr><td>${label}</td><td>${val}</td></tr>`;
  }).join('');
}

function pvPrintSummary_() {
  const shop = document.getElementById('pvShop').value || '점포명 미입력';
  const now = new Date().toLocaleString('ko-KR');

  const basicRows = [
    ['점포명 / 소재지', 'pvShop', 'input'],
    ['업종', 'pvBiz', 'input'],
    ['전용면적', 'pvArea', 'input', '㎡'],
    ['평 환산', 'pvAreaPyeong', 'readout'],
    ['보증금', 'pvDeposit', 'input', '원'],
    ['월세', 'pvRent', 'input', '원'],
    ['관리비', 'pvMgmtFee', 'input', '원'],
    ['제시 권리금', 'pvAskPremium', 'input', '원'],
  ];
  const facRows = [
    ['인테리어·시설 공사비', 'pvFacConstruction', 'input', '원'],
    ['집기·장비 구입비', 'pvFacEquip', 'input', '원'],
    ['초기 투자비 합계', 'pvFacInvestTotal', 'readout'],
    ['시설 경과연수', 'pvFacYears', 'input', '년'],
    ['내용연수', 'pvFacLifespan', 'input', '년'],
    ['잔존가치율', 'pvFacResidual', 'input', '%'],
    ['시설권리금 평가액', 'pvFacResult', 'readout'],
  ];
  const opRows = [
    ['카드매출', 'pvOpCard', 'input', '원'],
    ['배달앱 매출', 'pvOpDelivery', 'input', '원'],
    ['부가세 신고매출', 'pvOpTaxSales', 'input', '원'],
    ['현금매출 (자동 역산)', 'pvOpCash', 'readout'],
    ['월매출 합계', 'pvOpSalesTotal', 'readout'],
    ['재료비·매출원가', 'pvOpCost', 'input', '원'],
    ['인건비', 'pvOpLabor', 'input', '원'],
    ['관리비·공과금·기타', 'pvOpMgmt', 'input', '원'],
    ['임차료 (자동)', 'pvOpRent', 'readout'],
    ['월 순이익', 'pvOpNetProfit', 'readout'],
    ['적용 개월수', 'pvOpMonths', 'input', '개월'],
    ['영업권리금 평가액', 'pvOpResult', 'readout'],
  ];
  const costRateRows = [
    ['업종 평균 원가율', 'pvCostRateRef', 'input', '%'],
    ['역산 재료비', 'pvCostRateCalc', 'readout'],
    ['제시값 대비 차이', 'pvCostRateDiff', 'readout'],
  ];
  const floorRows = [
    ['인근 시세 권리금', 'pvFloorPrice', 'input', '원'],
    ['바닥권리금 반영액', 'pvFloorResult', 'readout'],
  ];
  const resultRows = [
    ['산출 권리금 합계', 'rSumCalc', 'readout'],
    ['제시 권리금', 'rAskPremium', 'readout'],
    ['차액 (제시 − 산출)', 'rDiff', 'readout'],
    ['괴리율', 'rGapRate', 'readout'],
    ['투자 회수기간', 'rPayback', 'readout'],
    ['권리금/월세 배수', 'rRatioMultiple', 'readout'],
    ['권리금/월매출 비율', 'rRatioSales', 'readout'],
    ['순이익률', 'rRatioMargin', 'readout'],
  ];

  const opWarnBox = document.getElementById('pvOpWarn');
  const opWarnHtml = (opWarnBox && opWarnBox.style.display !== 'none')
    ? `<div class="pv-print-verdict">${opWarnBox.textContent.trim()}</div>` : '';

  const costVerdictText = document.getElementById('pvCostRateVerdict').textContent.trim();
  const gapVerdictText = document.getElementById('rGapVerdict').textContent.trim();
  const paybackVerdictBox = document.getElementById('rPaybackVerdict');
  const paybackVerdictHtml = (paybackVerdictBox && paybackVerdictBox.style.display !== 'none')
    ? `<div class="pv-print-verdict">${paybackVerdictBox.textContent.trim()}</div>` : '';

  const html = `
    <h1>권리금검증 결과 — ${shop}</h1>
    <div class="pv-print-sub">생성일시: ${now} · 이 리포트는 협상·검토용 추정치이며 법적 평가나 감정가가 아닙니다.</div>

    <h2>기본 정보</h2>
    <table class="pv-print-table">${pvPrintRows_(basicRows)}</table>

    <h2>① 시설권리금</h2>
    <table class="pv-print-table">${pvPrintRows_(facRows)}</table>

    <h2>② 영업권리금</h2>
    <table class="pv-print-table">${pvPrintRows_(opRows)}</table>
    ${opWarnHtml}
    <table class="pv-print-table" style="margin-top:6px;">${pvPrintRows_(costRateRows)}</table>
    <div class="pv-print-verdict">재료비 교차검증: ${costVerdictText}</div>

    <h2>③ 바닥(지역)권리금</h2>
    <table class="pv-print-table">${pvPrintRows_(floorRows)}</table>

    <h2>★ 종합 검증 결과</h2>
    <table class="pv-print-table">${pvPrintRows_(resultRows)}</table>
    <div class="pv-print-verdict">${gapVerdictText}</div>
    ${paybackVerdictHtml}
  `;

  document.getElementById('pvPrintArea').innerHTML = html;
  window.print();
}

function pvPrintDocChecklist_() {
  const total = PV_DOC_GROUPS.reduce((n, g) => n + g.items.length, 0);
  const values = Object.values(pvDocStatus);
  const secured = values.filter((v) => v === '확보').length;
  const refused = values.filter((v) => v === '거부').length;
  const now = new Date().toLocaleString('ko-KR');

  let itemsHtml = '';
  PV_DOC_GROUPS.forEach((group, gi) => {
    itemsHtml += `<h2>${group.title}</h2>`;
    group.items.forEach((item, ii) => {
      const key = pvDocKey_(gi, ii);
      const status = pvDocStatus[key] || '미확인';
      itemsHtml += `
        <div class="pv-print-doc-item">
          <span class="pdi-name">${item.name}</span>
          <span class="pdi-badges">[${item.rel}] [${item.type}]</span>
          <div class="pdi-meta">${item.source} · 검증항목: ${item.verify}</div>
          <div class="pdi-meta">${item.point}</div>
          <div class="pdi-status">확보여부: ${status}</div>
        </div>`;
    });
  });

  const html = `
    <h1>권리금검증 — 검토서류 체크리스트</h1>
    <div class="pv-print-sub">생성일시: ${now}</div>
    <div class="pv-print-doc-summary">확보 ${secured}/${total} · 거부 ${refused}건</div>
    ${itemsHtml}
  `;

  document.getElementById('pvPrintArea').innerHTML = html;
  window.print();
}

/* ---------------- 참고표 / 체크리스트 모달 ---------------- */
function pvOpenModal_(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('show');
}
function pvCloseModal_(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}
function pvInitModals_() {
  const refOpen = document.getElementById('pvRefOpenBtn');
  const refOverlay = document.getElementById('pvRefOverlay');
  const refClose = document.getElementById('pvRefClose');
  if (refOpen) refOpen.addEventListener('click', () => pvOpenModal_('pvRefOverlay'));
  if (refClose) refClose.addEventListener('click', () => pvCloseModal_('pvRefOverlay'));
  if (refOverlay) refOverlay.addEventListener('click', (e) => { if (e.target === refOverlay) pvCloseModal_('pvRefOverlay'); });

  const docOpen = document.getElementById('pvDocOpenBtn');
  const docOverlay = document.getElementById('pvDocOverlay');
  const docClose = document.getElementById('pvDocClose');
  if (docOpen) docOpen.addEventListener('click', () => pvOpenModal_('pvDocOverlay'));
  if (docClose) docClose.addEventListener('click', () => pvCloseModal_('pvDocOverlay'));
  if (docOverlay) docOverlay.addEventListener('click', (e) => { if (e.target === docOverlay) pvCloseModal_('pvDocOverlay'); });

  const printSummaryBtn = document.getElementById('pvPrintSummaryBtn');
  if (printSummaryBtn) printSummaryBtn.addEventListener('click', pvPrintSummary_);
  const printDocBtn = document.getElementById('pvPrintDocBtn');
  if (printDocBtn) printDocBtn.addEventListener('click', pvPrintDocChecklist_);
}

function pvInit() {
  pvRenderRefTables_();
  pvRenderDocList_();
  pvRenderDocSummary_();
  pvInitModals_();

  pvRestoreDraft_();

  // 업종 선택 시 원가율 참고값 자동 채움(직접 수정 가능)
  const bizEl = document.getElementById('pvBiz');
  if (bizEl) {
    bizEl.addEventListener('change', () => {
      const def = PV_COST_RATE_DEFAULTS[bizEl.value];
      const costRateEl = document.getElementById('pvCostRateRef');
      if (def !== undefined && costRateEl && !costRateEl.value) costRateEl.value = def;
      pvCalc();
      pvSaveDraft_();
    });
  }

  document.querySelectorAll('.pv-col-main input, .pv-col-main select').forEach((el) => {
    el.addEventListener('input', () => {
      if (el.classList.contains('pv-money')) pvFormatMoneyInput_(el);
      pvCalc();
      pvSaveDraft_();
    });
  });

  const resetBtn = document.getElementById('pvResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', pvResetAll_);

  pvCalc();
}

document.addEventListener('DOMContentLoaded', pvInit);
