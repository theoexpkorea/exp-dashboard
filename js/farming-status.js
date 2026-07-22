/* ============================================================
   theo 대시보드 — 파밍현황 (js/farming-status.js)
   파밍서치(exp-farming) 실제 Apps Script를 그대로 재사용합니다.
   (대시보드 자체 백엔드가 아닌, exp-farming의 doGet 엔드포인트)
   mode=data(읽기) / add / update / status / delete (쓰기, 전부 JSONP)
   ============================================================ */

const FARM_DATA_URL = "https://script.google.com/macros/s/AKfycbzzJs4Y8_iNMYtXQjcBmKCgJkHrAR2YvFFAKJI4Xx0ujgjLkbIZGvXcWeM5B1WPN7kD/exec";
const FARM_STATUS_CLASS = { '파밍예정': 'plan', '파밍완료': 'done', '파밍보류': 'hold', '파밍취소': 'cancel' };

function $(id) { return document.getElementById(id); }
function farmPad(n) { return String(n).padStart(2, '0'); }
function farmYmd(y, m, d) { return y + '-' + farmPad(m + 1) + '-' + farmPad(d); }
function farmToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function farmFmtNum(v) {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? '-' : n.toLocaleString('ko-KR');
}

/* ===== JSONP ===== */
function farmJsonp(params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cb = "__farmdash_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    const s = document.createElement('script');
    let done = false;
    window[cb] = data => { done = true; cleanup(); resolve(data); };
    function cleanup() { try { delete window[cb]; } catch (e) {} if (s.parentNode) s.parentNode.removeChild(s); }
    s.onerror = () => { if (!done) { cleanup(); reject(new Error('load fail')); } };
    const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k])).join('&');
    const sep = FARM_DATA_URL.indexOf('?') >= 0 ? '&' : '?';
    s.src = FARM_DATA_URL + sep + qs + '&callback=' + cb;
    document.head.appendChild(s);
    setTimeout(() => { if (!done) { cleanup(); reject(new Error('timeout')); } }, timeoutMs || 15000);
  });
}
async function farmJsonpRetry(params, timeoutMs) {
  try { return await farmJsonp(params, timeoutMs); }
  catch (e) { await new Promise(r => setTimeout(r, 800)); return await farmJsonp(params, timeoutMs); }
}

/* ===== state ===== */
const farmToday = new Date();
let farmViewYear = farmToday.getFullYear();
let farmViewMonth = farmToday.getMonth();
let farmProperties = [];
let farmCustomers = [];
let farmHolidays = new Set(); // 'YYYY-MM-DD' — Apps Script mode=data 응답의 holidays 필드 (있을 때만)
let farmScope = 'all'; // all | routine | customer

function farmScopeMatch(p) {
  if (farmScope === 'routine') return !p.고객ID;
  if (farmScope === 'customer') return !!p.고객ID;
  return true;
}

function farmBucket() {
  farmEventsByDate = {};
  farmProperties.filter(farmScopeMatch).forEach(p => {
    const d = p.파밍일자;
    if (!d) return;
    if (!farmEventsByDate[d]) farmEventsByDate[d] = [];
    farmEventsByDate[d].push(p);
  });
}
let farmEventsByDate = {};

function farmCustName(id) {
  const c = farmCustomers.find(x => x.고객ID === id);
  return c ? c.고객명 : id;
}

async function farmLoadData(silent) {
  if (!silent) $('calLoading').style.display = 'flex';
  try {
    const d = await farmJsonpRetry({ mode: 'data' });
    farmProperties = d.properties || [];
    farmCustomers = d.customers || [];
    farmHolidays = new Set((d.holidays || []).filter(Boolean));
    farmBucket();
    farmRenderCalendar();
    if (!silent) farmToast('불러오기 완료');
  } catch (e) {
    farmToast('불러오기 실패 — 네트워크를 확인해줘');
  } finally {
    $('calLoading').style.display = 'none';
  }
}

/* ===== 스코프 탭 (전체/루틴/고객) ===== */
document.getElementById('scopeTabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-scope]'); if (!btn) return;
  farmScope = btn.dataset.scope;
  document.querySelectorAll('#scopeTabs .rec-filter-chip').forEach(b => b.classList.toggle('active', b === btn));
  farmBucket();
  farmRenderCalendar();
});

/* ===== 모바일 판별 (도트 렌더링 전환용) ===== */
function farmIsMobile() { return window.matchMedia('(max-width: 760px)').matches; }
let __farmLastMobile = farmIsMobile();
let __farmResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(__farmResizeTimer);
  __farmResizeTimer = setTimeout(() => {
    const nowMobile = farmIsMobile();
    if (nowMobile !== __farmLastMobile) { __farmLastMobile = nowMobile; farmRenderCalendar(); }
  }, 150);
});

/* ===== 캘린더 렌더 ===== */
function farmRenderCalendar() {
  $('monthLabel').textContent = farmViewYear + '년 ' + (farmViewMonth + 1) + '월';
  const grid = $('calGrid');
  grid.innerHTML = '';

  const firstDay = new Date(farmViewYear, farmViewMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(farmViewYear, farmViewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(farmViewYear, farmViewMonth, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  let monthCount = 0, doneCount = 0, planCount = 0, todayCount = 0;

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'farm-cal-cell';
    const col = i % 7;
    if (col === 0) cell.classList.add('sun');
    if (col === 6) cell.classList.add('sat');

    let dateNum, cellY, cellM, isOutside = false;
    if (i < startWeekday) {
      dateNum = daysInPrevMonth - startWeekday + i + 1;
      cellY = farmViewMonth === 0 ? farmViewYear - 1 : farmViewYear;
      cellM = farmViewMonth === 0 ? 11 : farmViewMonth - 1;
      isOutside = true;
    } else if (i >= startWeekday + daysInMonth) {
      dateNum = i - startWeekday - daysInMonth + 1;
      cellY = farmViewMonth === 11 ? farmViewYear + 1 : farmViewYear;
      cellM = farmViewMonth === 11 ? 0 : farmViewMonth + 1;
      isOutside = true;
    } else {
      dateNum = i - startWeekday + 1;
      cellY = farmViewYear; cellM = farmViewMonth;
    }
    if (isOutside) cell.classList.add('outside');

    const key = farmYmd(cellY, cellM, dateNum);
    const isToday = (cellY === farmToday.getFullYear() && cellM === farmToday.getMonth() && dateNum === farmToday.getDate());
    if (isToday) cell.classList.add('today');
    if (farmHolidays.has(key)) cell.classList.add('holiday');

    const numEl = document.createElement('div');
    numEl.className = 'farm-date-num';
    numEl.textContent = dateNum;
    cell.appendChild(numEl);

    const events = farmEventsByDate[key] || [];
    if (!isOutside) {
      monthCount += events.length;
      events.forEach(ev => {
        if (ev.파밍여부 === '파밍완료') doneCount++;
        else if (ev.파밍여부 !== '파밍취소') planCount++;
      });
      if (isToday) todayCount = events.length;
    }

    if (farmIsMobile()) {
      // 폰 화면 — 텍스트 대신 상태 도트만 (칸이 찌그러지지 않도록)
      if (events.length) {
        const dotRow = document.createElement('div');
        dotRow.className = 'farm-dot-row';
        const maxDots = 6;
        events.slice(0, maxDots).forEach(ev => {
          const dot = document.createElement('span');
          dot.className = 'farm-dot ' + (FARM_STATUS_CLASS[ev.파밍여부] || 'plan');
          dotRow.appendChild(dot);
        });
        if (events.length > maxDots) {
          const more = document.createElement('span');
          more.className = 'farm-dot-more';
          more.textContent = '+' + (events.length - maxDots);
          dotRow.appendChild(more);
        }
        cell.appendChild(dotRow);
      }
    } else {
      const maxShow = 3;
      events.slice(0, maxShow).forEach(ev => {
        const pill = document.createElement('div');
        pill.className = 'farm-pill ' + (FARM_STATUS_CLASS[ev.파밍여부] || 'plan');
        const label = ev.건물명 || ev.주소 || '(이름없음)';
        pill.textContent = label;
        pill.title = label;
        cell.appendChild(pill);
      });
      if (events.length > maxShow) {
        const more = document.createElement('div');
        more.className = 'farm-more';
        more.textContent = '+' + (events.length - maxShow) + '개 더보기';
        cell.appendChild(more);
      }
    }

    cell.addEventListener('click', ((k, yy, mo, dd, evs) => () => farmOpenDayPanel(k, yy, mo, dd, evs))(key, cellY, cellM, dateNum, events));

    grid.appendChild(cell);
  }

  $('statThisMonth').textContent = monthCount + '건';
  $('statDone').textContent = doneCount + '건';
  $('statPlan').textContent = planCount + '건';
  $('statToday').textContent = todayCount + '건';
}

/* ===== 일별 상세 패널 ===== */
const farmOverlay = $('overlay');
const farmDayPanel = $('dayPanel');
const farmWeekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
let farmCurrentPanelKey = null;

function farmOpenDayPanel(key, y, m, d, events) {
  farmCurrentPanelKey = key;
  const wd = farmWeekdayNames[new Date(y, m, d).getDay()];
  $('dpTitle').textContent = y + '년 ' + (m + 1) + '월 ' + d + '일 (' + wd + ')';
  $('dpSub').textContent = events.length ? events.length + '건의 파밍 기록' : '기록 없음';
  const body = $('dpBody');
  body.innerHTML = '';
  if (events.length === 0) {
    body.innerHTML = '<div class="farm-dp-empty">이 날짜에 등록된 파밍 기록이 없습니다.</div>';
  } else {
    events.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'farm-dp-item';
      const cls = FARM_STATUS_CLASS[ev.파밍여부] || 'plan';
      item.innerHTML =
        '<div class="farm-dp-item-top">' +
          '<span class="farm-dp-tag ' + cls + '">' + (ev.파밍여부 || '파밍예정') + '</span>' +
          (ev.고객ID ? '<span class="farm-cust-tag">' + farmCustName(ev.고객ID) + '</span>' : '') +
          '<button class="farm-dp-edit-btn" data-edit="' + (ev.매물ID || '') + '" style="margin-left:auto;">수정</button>' +
        '</div>' +
        '<div class="farm-dp-addr">' + (ev.건물명 || ev.주소 || '(이름없음)') + '</div>' +
        (ev.건물명 && ev.주소 ? '<div class="farm-dp-sub2">' + ev.주소 + '</div>' : '') +
        '<div class="farm-dp-specs">' +
          (ev.유형 ? '<span><b>' + ev.유형 + '</b></span>' : '') +
          (ev.거래유형 ? '<span><b>' + ev.거래유형 + '</b></span>' : '') +
          (ev.전용면적 ? '<span>평수 <b>' + ev.전용면적 + '평</b></span>' : '') +
          (ev.보증금매매가 ? '<span>보증금 <b>' + farmFmtNum(ev.보증금매매가) + '</b></span>' : '') +
          (ev.월세 ? '<span>월세 <b>' + farmFmtNum(ev.월세) + '</b></span>' : '') +
        '</div>' +
        (ev.메모 ? '<div class="farm-dp-memo">' + ev.메모 + '</div>' : '') +
        (ev.파밍메모 ? '<div class="farm-dp-memo">파밍메모 · ' + ev.파밍메모 + '</div>' : '');
      body.appendChild(item);
    });
  }
  farmOverlay.classList.add('open');
  farmDayPanel.classList.add('open');
}
function farmCloseDayPanel() { farmOverlay.classList.remove('open'); farmDayPanel.classList.remove('open'); }
farmOverlay.addEventListener('click', () => { farmCloseDayPanel(); farmCloseForm(); });
$('dpClose').addEventListener('click', farmCloseDayPanel);
$('dpBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-edit]'); if (!btn) return;
  const id = btn.dataset.edit;
  const p = farmProperties.find(x => x.매물ID === id);
  if (p) farmOpenForm(p);
});
$('dpAdd').addEventListener('click', () => farmOpenForm(null, farmCurrentPanelKey));

/* ===== 등록/수정 폼 ===== */
const farmFormOverlay = $('formOverlay');
let farmEditingId = null;

function farmPopulateCustSelect(selectedId) {
  const sel = $('fCust');
  const sorted = [...farmCustomers].sort((a, b) => String(a.고객ID).localeCompare(String(b.고객ID)));
  sel.innerHTML = '<option value="">고객 선택</option>' +
    sorted.map(c => '<option value="' + c.고객ID + '">' + c.고객ID + ' · ' + (c.고객명 || '') + '</option>').join('');
  sel.value = selectedId || '';
}

function farmOpenForm(existing, dateForNew) {
  farmEditingId = existing ? existing.매물ID : null;
  $('formTitle').textContent = existing ? '파밍 수정' : '파밍 등록';
  $('formError').textContent = '';
  $('formDelete').classList.toggle('hidden', !existing);

  const isCustScope = existing ? !!existing.고객ID : (farmScope === 'customer');
  $('fScopeRoutine').checked = !isCustScope;
  $('fScopeCustomer').checked = isCustScope;
  $('custPickWrap').classList.toggle('hidden', !isCustScope);
  farmPopulateCustSelect(existing ? existing.고객ID : '');

  $('fDate').value = existing ? existing.파밍일자 : (dateForNew || farmYmd(farmToday.getFullYear(), farmToday.getMonth(), farmToday.getDate()));
  $('fStatus').value = existing ? (existing.파밍여부 || '파밍예정') : '파밍예정';
  $('fName').value = existing ? (existing.건물명 || '') : '';
  $('fAddr').value = existing ? (existing.주소 || '') : '';
  $('fType').value = existing ? (existing.유형 || '사무실') : '사무실';
  $('fDeal').value = existing ? (existing.거래유형 || '월세') : '월세';
  $('fDepositLabel').textContent = $('fDeal').value === '매매' ? '매매가' : '보증금';
  $('fFloor').value = existing ? (existing.층수 || '') : '';
  $('fFloorAll').value = existing ? (existing.총층 || '') : '';
  $('fArea').value = existing ? (existing.전용면적 || '') : '';
  $('fDeposit').value = existing ? (existing.보증금매매가 || '') : '';
  $('fRent').value = existing ? (existing.월세 || '') : '';
  $('fMgmt').value = existing ? (existing.관리비 || '') : '';
  $('fLink').value = existing ? (existing.매물링크 || '') : '';
  $('fLedger').value = existing ? (existing.매물장번호 || '') : '';
  $('fMemo').value = existing ? (existing.메모 || '') : '';
  $('fFarmMemo').value = existing ? (existing.파밍메모 || '') : '';
  farmCloseDayPanel();
  farmFormOverlay.classList.add('show');
}
function farmCloseForm() { farmFormOverlay.classList.remove('show'); }
$('formClose').addEventListener('click', farmCloseForm);
$('formCancel').addEventListener('click', farmCloseForm);
$('addBtn').addEventListener('click', () => { if (!$('addBtn').dataset.justDragged) farmOpenForm(null, null); });

['fScopeRoutine', 'fScopeCustomer'].forEach(id => {
  $(id).addEventListener('change', () => {
    $('custPickWrap').classList.toggle('hidden', !$('fScopeCustomer').checked);
  });
});

$('fDeal').addEventListener('change', function () {
  $('fDepositLabel').textContent = this.value === '매매' ? '매매가' : '보증금';
});

$('formSave').addEventListener('click', async () => {
  const addr = $('fAddr').value.trim();
  const linkRaw = $('fLink').value.trim();
  if (!addr && !linkRaw) { $('formError').textContent = '주소 또는 매물링크를 입력해줘'; return; }
  const link = /^\d+$/.test(linkRaw) ? ('https://fin.land.naver.com/articles/' + linkRaw) : linkRaw;

  const payload = {
    mode: farmEditingId ? 'update' : 'add',
    파밍일자: $('fDate').value || farmYmd(farmToday.getFullYear(), farmToday.getMonth(), farmToday.getDate()),
    파밍여부: $('fStatus').value,
    건물명: $('fName').value.trim(),
    주소: addr,
    유형: $('fType').value,
    거래유형: $('fDeal').value,
    층수: $('fFloor').value.trim(),
    총층: $('fFloorAll').value.trim(),
    전용면적: $('fArea').value.trim(),
    보증금매매가: $('fDeposit').value.trim(),
    월세: $('fRent').value.trim(),
    관리비: $('fMgmt').value.trim(),
    매물링크: link,
    매물장번호: $('fLedger').value.trim(),
    메모: $('fMemo').value.trim(),
    파밍메모: $('fFarmMemo').value.trim(),
    고객ID: $('fScopeCustomer').checked ? $('fCust').value : '',
  };
  if (farmEditingId) payload.매물ID = farmEditingId;

  $('formSave').disabled = true;
  $('formSave').textContent = '저장 중...';
  try {
    await farmJsonp(payload);
    farmToast(farmEditingId ? '수정 완료' : '등록 완료');
    farmCloseForm();
    await farmLoadData(true);
  } catch (e) {
    farmToast('전송 실패 — 시트에 반영 안됐을 수 있음');
  } finally {
    $('formSave').disabled = false;
    $('formSave').textContent = '저장';
  }
});

$('formDelete').addEventListener('click', async () => {
  if (!farmEditingId) return;
  if (!confirm('이 파밍 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
  try {
    await farmJsonp({ mode: 'delete', 매물ID: farmEditingId });
    farmToast('삭제 완료');
    farmCloseForm();
    await farmLoadData(true);
  } catch (e) {
    farmToast('삭제 전송 실패');
  }
});

/* ===== FAB 드래그 이동 (파밍서치와 동일 방식: 뷰포트 기준 clamp + localStorage 저장) ===== */
(function () {
  const fab = $('addBtn');
  const POS_KEY = 'theo_dashboard_farm_fab_pos';
  const margin = 4;

  function clamp(left, top) {
    const w = fab.offsetWidth, h = fab.offsetHeight;
    const maxLeft = Math.max(margin, window.innerWidth - w - margin);
    const maxTop = Math.max(margin, window.innerHeight - h - margin);
    return { left: Math.min(Math.max(left, margin), maxLeft), top: Math.min(Math.max(top, margin), maxTop) };
  }
  function applyPos(left, top) {
    fab.style.left = left + 'px'; fab.style.top = top + 'px';
    fab.style.right = 'auto'; fab.style.bottom = 'auto';
  }
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY));
    if (saved && typeof saved.left === 'number') {
      const c = clamp(saved.left, saved.top);
      applyPos(c.left, c.top);
    }
  } catch (e) {}

  let dragging = false, moved = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
  fab.addEventListener('pointerdown', e => {
    dragging = true; moved = false;
    const r = fab.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY; origLeft = r.left; origTop = r.top;
    fab.setPointerCapture(e.pointerId);
  });
  fab.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    const c = clamp(origLeft + dx, origTop + dy);
    applyPos(c.left, c.top);
  });
  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      const r = fab.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top })); } catch (er) {}
      fab.dataset.justDragged = '1';
      setTimeout(() => { delete fab.dataset.justDragged; }, 80);
    }
  }
  fab.addEventListener('pointerup', onUp);
  fab.addEventListener('pointercancel', onUp);

  window.addEventListener('resize', () => {
    const r = fab.getBoundingClientRect();
    const c = clamp(r.left, r.top);
    applyPos(c.left, c.top);
  });
})();

/* ===== 고객조건 보기 (목록 ↔ 상세) ===== */
const farmCustOverlay = $('custOverlay');
function farmSortedCustomers() {
  return [...farmCustomers].sort((a, b) => String(a.고객ID).localeCompare(String(b.고객ID)));
}
function farmRenderCustList() {
  $('custModalTitle').textContent = '고객조건 보기';
  const list = farmSortedCustomers();
  $('custModalBody').innerHTML = list.length ? list.map(c =>
    '<div class="farm-cust-row" data-cust="' + c.고객ID + '">' +
      '<div class="farm-cust-name">' + c.고객ID + ' · ' + (c.고객명 || '') + '</div>' +
      '<div class="farm-cust-meta">' + [c.희망지역, c.희망거래유형, (c.평수최소 || '?') + '~' + (c.평수최대 || '?') + '평'].filter(Boolean).join(' · ') + (c.연락처 ? ' · ' + c.연락처 : '') + '</div>' +
    '</div>'
  ).join('') : '<div class="farm-cust-empty">등록된 고객이 없습니다.</div>';
}
function farmRenderCustDetail(id) {
  const c = farmCustomers.find(x => x.고객ID === id);
  if (!c) return;
  $('custModalTitle').textContent = c.고객ID;
  const tel = c.연락처 ? '<a href="tel:' + c.연락처 + '" style="color:var(--accent);font-weight:700;text-decoration:none;">' + c.연락처 + '</a>' : '-';
  const rows = [
    ['고객명', c.고객명 || '-'],
    ['연락처', tel, true],
    ['희망 지역', c.희망지역 || '-'],
    ['희망 거래유형', c.희망거래유형 || '-'],
    ['평수(최소)', c.평수최소 ? c.평수최소 + '평' : '-'],
    ['평수(최대)', c.평수최대 ? c.평수최대 + '평' : '-'],
    ['예산 보증금/매매가', c.예산보증금매매가 || '-'],
    ['예산 월세', c.예산월세 || '-'],
    ['희망 층수', c.희망층수 || '-'],
    ['기타 요청사항', c.기타요청 || '-'],
  ];
  $('custModalBody').innerHTML =
    '<button class="farm-cust-back" id="custBackBtn">← 목록으로</button>' +
    rows.map(([k, v, raw]) => '<div class="farm-cust-detail-row"><div class="k">' + k + '</div><div class="v">' + (raw ? v : v) + '</div></div>').join('');
  $('custBackBtn').addEventListener('click', farmRenderCustList);
}
$('custListBtn').addEventListener('click', () => { farmRenderCustList(); farmCustOverlay.classList.add('show'); });
$('custModalClose').addEventListener('click', () => farmCustOverlay.classList.remove('show'));
farmCustOverlay.addEventListener('click', e => { if (e.target === farmCustOverlay) farmCustOverlay.classList.remove('show'); });
$('custModalBody').addEventListener('click', e => {
  const row = e.target.closest('[data-cust]'); if (!row) return;
  farmRenderCustDetail(row.dataset.cust);
});

/* ===== 네비게이션 ===== */
$('prevBtn').addEventListener('click', () => { farmViewMonth--; if (farmViewMonth < 0) { farmViewMonth = 11; farmViewYear--; } farmRenderCalendar(); });
$('nextBtn').addEventListener('click', () => { farmViewMonth++; if (farmViewMonth > 11) { farmViewMonth = 0; farmViewYear++; } farmRenderCalendar(); });
$('todayBtn').addEventListener('click', () => { farmViewYear = farmToday.getFullYear(); farmViewMonth = farmToday.getMonth(); farmRenderCalendar(); });
$('refreshBtn').addEventListener('click', () => farmLoadData());

farmLoadData();
