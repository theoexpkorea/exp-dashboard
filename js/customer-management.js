/* ============================================================
   theo 대시보드 — 고객관리 (js/customer-management.js)
   exp-crm과 동일한 매물장필터뷰 Apps Script(mode=crmList/crmUpdate/crmCreate)를
   그대로 재사용합니다. 대시보드 자체 백엔드가 아님 — 새 배포 불필요.
   다음연락일(next)은 항상 시트 수식이 전담 — 이 파일에서 절대 직접 계산해 쓰지 않습니다
   (연락완료 저장 시 서버가 재계산한 nextContact를 그대로 받아서 반영).
   ============================================================ */

const CRM_DATA_URL = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';
const CRM_CAT_ORDER = ['SALE', 'LEAD', 'CONTRACT'];
const CRM_CAT_LABEL = { SALE: '매도임대', LEAD: '가망고객', CONTRACT: '계약고객' };
const CRM_NEXT_DAYS_DEFAULT = { SALE: 20, CONTRACT: 30 };
const CRM_LEAD_TEMP_DAYS = { hot: 7, warm: 14, cold: 30 };
const EXP_MAEMUL_URL = 'https://theoexpkorea.github.io/exp-maemul/';

const SALE_STATUS_COLOR = {
  '접수': { bg: '#E8F5E9', fg: '#1B5E20' }, '광고중': { bg: '#E3F2FD', fg: '#0D47A1' },
  '광고보류': { bg: '#FFF8E1', fg: '#F57F17' }, '광고만료': { bg: '#FBE9E7', fg: '#BF360C' },
  '계약완료': { bg: '#EDE7F6', fg: '#4527A0' }, '종료': { bg: '#F5F5F5', fg: '#9E9E9E' }
};
const LEAD_STATUS_COLOR = {
  hot: { bg: '#FDECEC', fg: '#C0392B' }, warm: { bg: '#FBF1E2', fg: '#9A5B14' }, cold: { bg: '#EAF2FE', fg: '#1D5FBF' },
  '계약완료': { bg: '#EDE7F6', fg: '#4527A0' }, '종료': { bg: '#F5F5F5', fg: '#9E9E9E' },
  '보류': { bg: '#F1F5F9', fg: '#64748B' }
};
const CONTRACT_STATUS_COLOR = {
  '사후관리': { bg: '#E3F2FD', fg: '#0D47A1' }, '재계약예정': { bg: '#FFF8E1', fg: '#F57F17' },
  '재계약완료': { bg: '#EDE7F6', fg: '#4527A0' }, '종료': { bg: '#F5F5F5', fg: '#9E9E9E' }
};
const CRM_STATUS_COLOR = { SALE: SALE_STATUS_COLOR, LEAD: LEAD_STATUS_COLOR, CONTRACT: CONTRACT_STATUS_COLOR };
function crmStatusColor(cat, status) {
  const map = CRM_STATUS_COLOR[cat];
  return (map && map[status]) ? map[status] : null;
}

function $(id) { return document.getElementById(id); }
function crmToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}
function crmEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function crmEscAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function crmOpenSms(tel) {
  if (!tel) return;
  location.href = 'sms:' + tel;
}

function crmCopyKakaoMessage(name) {
  const msg = (name ? name + '님, ' : '') + '안녕하세요, 연락드립니다.';
  const done = () => crmToast('메시지가 복사됐어요. · 카톡에서 붙여넣고 수정 후 보내세요.');
  const fail = () => crmToast('복사에 실패했어요. 잠시 후 다시 시도해 주세요.');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(msg).then(done).catch(fail);
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = msg; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) { fail(); }
  }
}

function crmCopyTel(tel) {
  if (!tel) return;
  const done = () => crmToast('번호가 복사됐어요. · 카톡에서 붙여넣으세요.');
  const fail = () => crmToast('복사에 실패했어요. 번호를 길게 눌러 복사해 주세요.');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(tel).then(done).catch(fail);
  } else {
    try {
      const ta = document.createElement('textarea');
      ta.value = tel; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) { fail(); }
  }
}

/* ===== 날짜 유틸 (exp-crm과 동일 로직) ===== */
function crmTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function crmAddDays(dateStr, n) {
  const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  base.setDate(base.getDate() + n);
  return base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0') + '-' + String(base.getDate()).padStart(2, '0');
}
function crmDDay(nextStr) {
  if (!nextStr) return null;
  const t = new Date(crmTodayStr() + 'T00:00:00');
  const n = new Date(nextStr + 'T00:00:00');
  return Math.round((n - t) / 86400000);
}
function crmDDayBadge(nextStr) {
  const d = crmDDay(nextStr);
  if (d === null) return '';
  if (d < 0) return '<span class="cust-dday-badge overdue">D+' + (-d) + ' 지남</span>';
  if (d === 0) return '<span class="cust-dday-badge today">오늘</span>';
  return '<span class="cust-dday-badge upcoming">D-' + d + '</span>';
}
function crmEstimateNext(cat, status) {
  if (cat === 'LEAD') {
    if (status === '보류') return null;
    const d = CRM_LEAD_TEMP_DAYS[status] || 30;
    return crmAddDays(crmTodayStr(), d);
  }
  return crmAddDays(crmTodayStr(), CRM_NEXT_DAYS_DEFAULT[cat] || 20);
}
function crmNextHidden(it) { return it.cat === 'LEAD' && it.status === '보류'; }

/* ===== "당일 고정" 표시 로직 =====
   오늘 연락완료 처리한 항목은 서버가 이미 실제 다음연락일(미래 날짜, 시트 수식 그대로)로
   갱신해뒀지만, 화면(캘린더/오늘처리 뱃지/패널)에는 "오늘 하루 동안"은 계속 오늘 날짜에
   고정해서 보여준다 — 엑셀마스터 CRM 이력을 이 화면 보고 정리하기 위함.
   내일이 되면(crmTodayStr()가 바뀌면) 이 조건이 자동으로 꺼지면서 실제 다음연락일 기준으로
   저절로 되돌아간다 — 별도 저장/타이머 불필요. */
function crmIsDoneToday(it) { return it.lastContact === crmTodayStr(); }
function crmDisplayDate(it) { return crmIsDoneToday(it) ? crmTodayStr() : it.nextContact; }
function crmDisplayDDay(it) { return crmDDay(crmDisplayDate(it)); }

/* ===== JSONP (exp-crm과 동일한 방식, 같은 Apps Script 엔드포인트) ===== */
function crmJsonp(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cb = '__crmdash_cb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    const s = document.createElement('script');
    let done = false;
    window[cb] = data => { done = true; cleanup(); resolve(data); };
    function cleanup() { try { delete window[cb]; } catch (e) {} if (s.parentNode) s.parentNode.removeChild(s); }
    s.onerror = () => { if (!done) { cleanup(); reject(new Error('load fail')); } };
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    s.src = url + sep + 'callback=' + cb;
    document.head.appendChild(s);
    setTimeout(() => { if (!done) { cleanup(); reject(new Error('timeout')); } }, timeoutMs || 25000);
  });
}
async function crmJsonpRetry(url, timeoutMs) {
  try { return await crmJsonp(url, timeoutMs); }
  catch (e) { await new Promise(r => setTimeout(r, 800)); return await crmJsonp(url, timeoutMs); }
}

/* ===== state ===== */
const crmToday = new Date();
let crmViewYear = crmToday.getFullYear();
let crmViewMonth = crmToday.getMonth();
let crmAllItems = [];
let crmStatusOptions = {};
let crmScope = 'all'; // all | SALE | LEAD | CONTRACT
let crmEventsByDate = {};
let crmHolidays = new Map(); // 'YYYY-MM-DD' -> 명칭 — 구글시트 '공휴일' 탭 A열(날짜)/B열(명칭)

function crmScopeMatch(it) { return crmScope === 'all' || it.cat === crmScope; }
function crmBucket() {
  crmEventsByDate = {};
  crmAllItems.filter(crmScopeMatch).forEach(it => {
    if (crmNextHidden(it) && !crmIsDoneToday(it)) return; // 보류 상태는 다음연락일을 화면에 표시하지 않음 (단, 오늘 처리한 건은 오늘 칸에 표시)
    const d = crmDisplayDate(it); // 오늘 처리한 항목은 오늘 날짜에 고정, 아니면 실제 다음연락일
    if (!d) return;
    if (!crmEventsByDate[d]) crmEventsByDate[d] = [];
    crmEventsByDate[d].push(it);
  });
}

/* ===== 로컬 캐시 (화면은 캐시로 즉시, 네트워크는 조용히 뒤에서 — 파밍현황/추천매물과 동일 원칙) ===== */
const CRM_CACHE_KEY = 'theo_dashboard_crm_cache_v1';
function crmReadCache() {
  try { const raw = localStorage.getItem(CRM_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function crmWriteCache(items, statusOptions, holidays) {
  try { localStorage.setItem(CRM_CACHE_KEY, JSON.stringify({ items: items || [], statusOptions: statusOptions || {}, holidays: holidays ? Array.from(holidays.entries()) : [], savedAt: Date.now() })); } catch (e) {}
}

async function crmLoadData(silent) {
  if (!silent) $('calLoading').style.display = 'flex';
  try {
    const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=crmList', 20000);
    if (res && res.items) {
      crmAllItems = res.items;
      crmStatusOptions = res.statusOptions || {};
      crmHolidays = new Map((res.holidays || []).filter(function (h) { return h && h.date; }).map(function (h) { return [h.date, h.name || '']; }));
      crmBucket();
      crmRenderCalendar();
      crmWriteCache(crmAllItems, crmStatusOptions, crmHolidays);
      if (!silent) crmToast('불러오기 완료');
    } else if (!silent) {
      crmToast('불러오기 실패 — 네트워크를 확인해줘');
    }
  } catch (e) {
    if (!silent) crmToast('불러오기 실패 — 네트워크를 확인해줘');
  } finally {
    $('calLoading').style.display = 'none';
  }
}

/* ===== 스코프 탭 ===== */
$('scopeTabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-scope]'); if (!btn) return;
  crmScope = btn.dataset.scope;
  document.querySelectorAll('#scopeTabs .rec-filter-chip').forEach(b => b.classList.toggle('active', b === btn));
  crmBucket();
  crmRenderCalendar();
});

/* 계약관리(contract-management)에서 "?maemul=매물번호"로 넘어온 경우
   해당 매물번호를 가진 계약고객을 찾아 스코프 전환 + 수정 폼 자동 오픈 */
function crmHandleMaemulDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const maemul = (params.get('maemul') || '').trim();
  if (!maemul) return;
  crmScope = 'CONTRACT';
  document.querySelectorAll('#scopeTabs .rec-filter-chip').forEach(b => b.classList.toggle('active', b.dataset.scope === 'CONTRACT'));
  crmBucket();
  crmRenderCalendar();
  crmOpenCatPanel('CONTRACT', maemul);
  // 초기 데이터 로딩이 이 시점에 아직 안 끝났을 수 있어서, 잠시 후 패널을 한 번 더 갱신
  // (그 사이 사용자가 다른 패널로 이동했으면 건드리지 않음)
  setTimeout(() => { if (crmPanelMode === 'cat:CONTRACT') crmOpenCatPanel('CONTRACT', maemul); }, 1200);
}

/* ===== 모바일 판별 (도트 렌더링 전환) ===== */
function crmIsMobile() { return window.matchMedia('(max-width: 760px)').matches; }
let __crmLastMobile = crmIsMobile();
let __crmResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(__crmResizeTimer);
  __crmResizeTimer = setTimeout(() => {
    const nowMobile = crmIsMobile();
    if (nowMobile !== __crmLastMobile) { __crmLastMobile = nowMobile; crmRenderCalendar(); }
  }, 150);
});

/* ===== 캘린더 렌더 ===== */
function crmPad(n) { return String(n).padStart(2, '0'); }
function crmYmd(y, m, d) { return y + '-' + crmPad(m + 1) + '-' + crmPad(d); }

function crmRenderCalendar() {
  $('monthLabel').textContent = crmViewYear + '년 ' + (crmViewMonth + 1) + '월';
  const grid = $('calGrid');
  grid.innerHTML = '';

  const firstDay = new Date(crmViewYear, crmViewMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(crmViewYear, crmViewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(crmViewYear, crmViewMonth, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'farm-cal-cell';
    const col = i % 7;
    if (col === 0) cell.classList.add('sun');
    if (col === 6) cell.classList.add('sat');

    let dateNum, cellY, cellM, isOutside = false;
    if (i < startWeekday) {
      dateNum = daysInPrevMonth - startWeekday + i + 1;
      cellY = crmViewMonth === 0 ? crmViewYear - 1 : crmViewYear;
      cellM = crmViewMonth === 0 ? 11 : crmViewMonth - 1;
      isOutside = true;
    } else if (i >= startWeekday + daysInMonth) {
      dateNum = i - startWeekday - daysInMonth + 1;
      cellY = crmViewMonth === 11 ? crmViewYear + 1 : crmViewYear;
      cellM = crmViewMonth === 11 ? 0 : crmViewMonth + 1;
      isOutside = true;
    } else {
      dateNum = i - startWeekday + 1;
      cellY = crmViewYear; cellM = crmViewMonth;
    }
    if (isOutside) cell.classList.add('outside');

    const key = crmYmd(cellY, cellM, dateNum);
    const isToday = (cellY === crmToday.getFullYear() && cellM === crmToday.getMonth() && dateNum === crmToday.getDate());
    if (isToday) cell.classList.add('today');
    const holidayName = crmHolidays.get(key);
    if (holidayName !== undefined) cell.classList.add('holiday');

    const numEl = document.createElement('div');
    numEl.className = 'farm-date-num';
    numEl.textContent = dateNum;
    cell.appendChild(numEl);

    if (holidayName) {
      const hLabel = document.createElement('div');
      hLabel.className = 'farm-holiday-label';
      hLabel.textContent = holidayName;
      hLabel.title = holidayName;
      cell.appendChild(hLabel);
    }

    const events = isOutside ? [] : (crmEventsByDate[key] || []);
    const isOverdue = crmDDay(key) < 0;

    if (crmIsMobile()) {
      if (events.length) {
        const dotRow = document.createElement('div');
        dotRow.className = 'farm-dot-row';
        const maxDots = 6;
        events.slice(0, maxDots).forEach(ev => {
          const dot = document.createElement('span');
          dot.className = 'cust-dot cat-' + ev.cat + (isOverdue ? ' overdue' : '');
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
        pill.className = 'cust-pill cat-' + ev.cat + (isOverdue ? ' overdue' : '');
        let label = ev.name || '(이름없음)';
        if (ev.cat === 'SALE') label = ev.id || label;
        else if (ev.cat === 'LEAD') label = ev.name2 || ev.name || '(이름없음)';
        pill.textContent = label;
        pill.title = CRM_CAT_LABEL[ev.cat] + ' · ' + label;
        cell.appendChild(pill);
      });
      if (events.length > maxShow) {
        const more = document.createElement('div');
        more.className = 'farm-more';
        more.textContent = '+' + (events.length - maxShow) + '개 더보기';
        cell.appendChild(more);
      }
    }

    cell.addEventListener('click', ((k, yy, mo, dd, evs) => () => crmOpenDayPanel(k, yy, mo, dd, evs))(key, cellY, cellM, dateNum, events));

    grid.appendChild(cell);
  }

  crmRenderStats();
}

function crmRenderStats() {
  const todayCount = crmAllItems.filter(it => { if (crmNextHidden(it) && !crmIsDoneToday(it)) return false; const x = crmDisplayDDay(it); return x !== null && x <= 0; }).length;
  $('statToday').textContent = todayCount + '건';
  $('statSale').textContent = crmAllItems.filter(it => it.cat === 'SALE').length + '건';
  $('statLead').textContent = crmAllItems.filter(it => it.cat === 'LEAD').length + '건';
  $('statContract').textContent = crmAllItems.filter(it => it.cat === 'CONTRACT').length + '건';
}
$('statGrid').addEventListener('click', e => {
  if (e.target.closest('#statTodayCard')) {
    crmOpenTodayPanel();
    return;
  }
  const catCard = e.target.closest('[data-cat]');
  if (catCard) {
    crmOpenCatPanel(catCard.dataset.cat);
  }
});

/* ===== 일별 상세 패널 ===== */
const crmOverlay = $('overlay');
const crmDayPanel = $('dayPanel');
const crmWeekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
let crmPanelKey = null, crmPanelYmd = [0, 0, 0];
let crmPanelMode = 'date'; // 'date' | 'today' | 'cat:SALE'|'cat:LEAD'|'cat:CONTRACT' — 저장 후 패널을 어떤 기준으로 다시 그릴지 구분
let crmPanelMaemulFilter = ''; // cat 패널이 특정 매물번호로 필터링된 상태인지 (딥링크 진입 시)
let crmCatSortKey = 'dday'; // cat 패널 정렬 기준: 'dday'(다음연락일순, 기본) | 'maemul'(매물번호순, SALE 전용)
let crmCatSortCat = '';     // 정렬 상태가 어느 카테고리에 대한 것인지 (카테고리 전환 시 기본값으로 리셋하기 위함)

function crmSortCatList(list, cat) {
  const sorted = list.slice();
  if (cat === 'SALE' && crmCatSortKey === 'maemul') {
    sorted.sort((a, b) => (a.id || '').localeCompare(b.id || '', 'ko', { numeric: true, sensitivity: 'base' }));
  } else {
    sorted.sort((a, b) => { const x = crmDisplayDDay(a), y = crmDisplayDDay(b); return (x === null ? 9999 : x) - (y === null ? 9999 : y); });
  }
  return sorted;
}

function crmOpenDayPanel(key, y, m, d, events) {
  crmPanelMode = 'date';
  crmPanelKey = key;
  crmPanelYmd = [y, m, d];
  const sortRow0 = $('dpSortRow'); if (sortRow0) sortRow0.style.display = 'none';
  const wd = crmWeekdayNames[new Date(y, m, d).getDay()];
  $('dpTitle').textContent = y + '년 ' + (m + 1) + '월 ' + d + '일 (' + wd + ')';
  $('dpSub').textContent = events.length ? events.length + '건의 다음연락 예정' : '기록 없음';
  const body = $('dpBody');
  body.innerHTML = '';
  if (events.length === 0) {
    body.innerHTML = '<div class="farm-dp-empty">이 날짜가 다음연락일인 고객이 없습니다.</div>';
  } else {
    events.forEach(ev => body.appendChild(crmBuildItemEl(ev)));
  }
  crmOverlay.classList.add('open');
  crmDayPanel.classList.add('open');
}

// "오늘 처리" 카드 클릭 전용 — 오늘이 정확히 next인 것뿐 아니라 지난(연체) 것까지 전부 모아서 보여줌
// (statToday 뱃지 집계와 동일한 기준: crmDDay(nextContact) <= 0)
function crmOpenTodayPanel() {
  crmPanelMode = 'today';
  const sortRow0 = $('dpSortRow'); if (sortRow0) sortRow0.style.display = 'none';
  const list = crmAllItems
    .filter(it => { if (crmNextHidden(it) && !crmIsDoneToday(it)) return false; const x = crmDisplayDDay(it); return x !== null && x <= 0; })
    .sort((a, b) => (crmDisplayDate(a) || '').localeCompare(crmDisplayDate(b) || ''));
  $('dpTitle').textContent = '오늘 처리';
  $('dpSub').textContent = list.length ? list.length + '건 (오늘 + 지난 연락 예정 포함)' : '처리할 항목이 없습니다';
  const body = $('dpBody');
  body.innerHTML = '';
  if (list.length === 0) {
    body.innerHTML = '<div class="farm-dp-empty">오늘 처리할 고객이 없습니다.</div>';
  } else {
    list.forEach(ev => body.appendChild(crmBuildItemEl(ev)));
  }
  crmOverlay.classList.add('open');
  crmDayPanel.classList.add('open');
}
// 매도임대/가망고객/계약고객 카드 클릭 — 다음연락일과 무관하게 해당 카테고리 전체를 보여줌
// (statSale/statLead/statContract 뱃지 집계와 동일한 기준: it.cat === cat)
function crmOpenCatPanel(cat, maemulFilter, keepSort) {
  crmPanelMode = 'cat:' + cat;
  crmPanelMaemulFilter = maemulFilter || '';
  if (!keepSort || crmCatSortCat !== cat) crmCatSortKey = 'dday'; // 카테고리 바뀌면 정렬 기본값(다음연락일순)으로 리셋
  crmCatSortCat = cat;

  let list = crmSortCatList(crmAllItems.filter(it => it.cat === cat), cat);

  let filtered = false;
  if (maemulFilter) {
    const matched = list.filter(it => (it.maemulNo || '').trim() === maemulFilter.trim());
    if (matched.length > 0) { list = matched; filtered = true; }
  }

  $('dpTitle').textContent = filtered ? CRM_CAT_LABEL[cat] + ' · ' + maemulFilter : CRM_CAT_LABEL[cat];
  $('dpSub').textContent = list.length
    ? (list.length + '건' + (maemulFilter && !filtered ? ' (일치 고객 없음 · 전체 표시)' : ''))
    : '등록된 고객이 없습니다';

  // 매도임대(SALE)만 매물번호순/다음연락일순 정렬 드롭다운 노출
  const sortRow = $('dpSortRow');
  if (sortRow) {
    if (cat === 'SALE') {
      sortRow.style.display = '';
      const label = crmCatSortKey === 'maemul' ? '매물번호순' : '다음연락일순';
      $('dpSortLabel').textContent = label;
      sortRow.querySelectorAll('.cust-sort-opt').forEach(o => o.classList.toggle('sel', o.dataset.sort === crmCatSortKey));
    } else {
      sortRow.style.display = 'none';
      sortRow.classList.remove('open');
    }
  }

  const body = $('dpBody');
  body.innerHTML = '';
  if (list.length === 0) {
    body.innerHTML = '<div class="farm-dp-empty">등록된 고객이 없습니다.</div>';
  } else {
    list.forEach(ev => body.appendChild(crmBuildItemEl(ev)));
  }
  crmOverlay.classList.add('open');
  crmDayPanel.classList.add('open');
}

// 정렬 드롭다운 — 패널 자체는 유지한 채 목록만 다시 정렬해서 그림
const crmDpSortRow = $('dpSortRow');
const crmDpSortBtn = $('dpSortBtn');
if (crmDpSortRow && crmDpSortBtn) {
  crmDpSortBtn.addEventListener('click', e => {
    e.stopPropagation();
    crmDpSortRow.classList.toggle('open');
  });
  crmDpSortRow.addEventListener('click', e => {
    const opt = e.target.closest('.cust-sort-opt');
    if (!opt) return;
    crmDpSortRow.classList.remove('open');
    if (opt.dataset.sort === crmCatSortKey) return;
    crmCatSortKey = opt.dataset.sort;
    crmOpenCatPanel(crmCatSortCat, crmPanelMaemulFilter, true);
  });
  document.addEventListener('click', () => crmDpSortRow.classList.remove('open'));
}
function crmCloseDayPanel() { crmOverlay.classList.remove('open'); crmDayPanel.classList.remove('open'); }
crmOverlay.addEventListener('click', () => { crmCloseDayPanel(); crmCloseForm(); });
$('dpClose').addEventListener('click', crmCloseDayPanel);

/* ===== 신규상담(구글시트 '신규문의' 탭) — 읽기 전용, 기존 일별 상세 패널(#overlay/#dayPanel)을
   그대로 재사용해서 새 모달 CSS 없이 구현. exp-client/contact.html 접수 데이터를 최신순으로만 보여줌. ===== */
function crmConsultTypeClass(type) {
  const t = type || '';
  if (t.indexOf('매도') > -1 || t.indexOf('임대') > -1) return 'type-sell';
  if (t.indexOf('매수') > -1 || t.indexOf('임차') > -1) return 'type-buy';
  return '';
}

function crmConsultBuildEl(it) {
  const item = document.createElement('div');
  item.className = 'farm-dp-item';
  const specs = [it.propType, it.region, it.size, it.budget].filter(Boolean).join(' · ');
  const viewIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
  item.innerHTML =
    '<div class="farm-dp-item-top">' +
      '<div class="cust-tags-left">' +
        '<span class="cust-tag cat-LEAD">신규상담</span>' +
        (it.type ? '<span class="cust-status-tag ' + crmConsultTypeClass(it.type) + '">' + crmEsc(it.type) + '</span>' : '') +
      '</div>' +
      '<div class="cust-tags-right">' +
        '<span class="farm-dp-sub2" style="margin:0;">' + crmEsc(it.date || '-') + '</span>' +
        '<button type="button" class="cust-edit-btn" data-consult-view aria-label="조회">' + viewIcon + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="cust-name-row">' + crmEsc(it.name || '(이름없음)') + '</div>' +
    '<div class="cust-sub-row">' +
      (it.tel
        ? '<a href="tel:' + it.tel + '">' + crmEsc(it.tel) + '</a>' +
          '<button type="button" class="tel-action-btn" data-sms-tel="' + crmEsc(it.tel) + '" aria-label="문자 보내기">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
          '</button>' +
          '<button type="button" class="tel-action-btn" data-kakao-name="' + crmEscAttr(it.name || '') + '" aria-label="카톡 메시지 복사">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '</button>'
        : '연락처 없음') +
    '</div>' +
    (specs ? '<div class="farm-dp-sub2">' + crmEsc(specs) + '</div>' : '') +
    (it.request ? '<div class="farm-dp-sub2">' + crmEsc(it.request) + '</div>' : '') +
    '<div class="farm-dp-specs"><span>마케팅동의 <b>' + crmEsc(it.marketingAgree || '-') + '</b></span></div>';

  const viewBtn = item.querySelector('[data-consult-view]');
  if (viewBtn) viewBtn.addEventListener('click', e => { e.stopPropagation(); crmOpenConsultEditForm(it); });

  const smsBtn = item.querySelector('[data-sms-tel]');
  if (smsBtn) smsBtn.addEventListener('click', e => { e.stopPropagation(); crmOpenSms(smsBtn.dataset.smsTel); });

  const kakaoBtn = item.querySelector('[data-kakao-name]');
  if (kakaoBtn) kakaoBtn.addEventListener('click', e => { e.stopPropagation(); crmCopyKakaoMessage(kakaoBtn.dataset.kakaoName); });

  return item;
}

async function crmOpenConsultPanel() {
  crmPanelMode = 'consult';
  const sortRow0 = $('dpSortRow'); if (sortRow0) sortRow0.style.display = 'none';
  $('dpTitle').textContent = '신규상담';
  $('dpSub').textContent = '불러오는 중...';
  const body = $('dpBody');
  body.innerHTML = '<div class="farm-dp-empty">불러오는 중...</div>';
  crmOverlay.classList.add('open');
  crmDayPanel.classList.add('open');
  try {
    const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=consultList', 25000);
    const list = (res && res.items) || [];
    $('dpSub').textContent = list.length ? (list.length + '건 · 최신순') : '신규상담 없음';
    body.innerHTML = '';
    if (list.length === 0) {
      body.innerHTML = '<div class="farm-dp-empty">접수된 신규상담이 없습니다.</div>';
    } else {
      list.forEach(it => body.appendChild(crmConsultBuildEl(it)));
    }
  } catch (e) {
    $('dpSub').textContent = '불러오기 실패';
    body.innerHTML = '<div class="farm-dp-empty">불러오지 못했어요. 다시 시도해 주세요.</div>';
  }
}
$('consultBtn').addEventListener('click', crmOpenConsultPanel);

/* ===== 신규상담 수정/삭제 — 전용 모달(#consultFormOverlay) 재사용,
   crmField()/crmFv()는 아래쪽 CRM 등록/수정 폼 섹션에 정의돼 있지만 function 선언이라 호이스팅되어 여기서도 바로 사용 가능 ===== */
const crmConsultFormOverlay = $('consultFormOverlay');
let crmConsultEditItem = null;

function crmConsultFieldsHtml(it) {
  return crmField('접수일', '<input type="text" id="cf_date" value="' + crmEscAttr(it.date || '') + '" placeholder="yyyy-mm-dd">')
    + crmField('구분', '<input type="text" id="cf_type" value="' + crmEscAttr(it.type || '') + '">')
    + crmField('이름', '<input type="text" id="cf_name" value="' + crmEscAttr(it.name || '') + '">')
    + crmField('연락처', '<input type="text" id="cf_tel" value="' + crmEscAttr(it.tel || '') + '">')
    + crmField('매물유형', '<input type="text" id="cf_propType" value="' + crmEscAttr(it.propType || '') + '">')
    + crmField('희망지역/주소', '<input type="text" id="cf_region" value="' + crmEscAttr(it.region || '') + '">')
    + crmField('면적', '<input type="text" id="cf_size" value="' + crmEscAttr(it.size || '') + '">')
    + crmField('예산/희망가격', '<input type="text" id="cf_budget" value="' + crmEscAttr(it.budget || '') + '">')
    + crmField('요청사항', '<textarea id="cf_request">' + crmEsc(it.request || '') + '</textarea>')
    + crmField('마케팅동의', '<input type="text" id="cf_marketingAgree" value="' + crmEscAttr(it.marketingAgree || '') + '">');
}

function crmOpenConsultEditForm(it) {
  crmConsultEditItem = it;
  $('consultFormFields').innerHTML = crmConsultFieldsHtml(it);
  $('consultFormError').textContent = '';
  crmConsultFormOverlay.classList.add('show');
}
function crmCloseConsultForm() { crmConsultFormOverlay.classList.remove('show'); crmConsultEditItem = null; }
$('consultFormClose').addEventListener('click', crmCloseConsultForm);
$('consultFormCancel').addEventListener('click', crmCloseConsultForm);
crmConsultFormOverlay.addEventListener('click', e => { if (e.target === crmConsultFormOverlay) crmCloseConsultForm(); });

$('consultFormSave').addEventListener('click', async () => {
  if (!crmConsultEditItem) return;
  const payload = {
    row: crmConsultEditItem.row,
    date: crmFv('cf_date'), type: crmFv('cf_type'), name: crmFv('cf_name'), tel: crmFv('cf_tel'),
    propType: crmFv('cf_propType'), region: crmFv('cf_region'), size: crmFv('cf_size'),
    budget: crmFv('cf_budget'), request: crmFv('cf_request'), marketingAgree: crmFv('cf_marketingAgree')
  };
  const qs = Object.keys(payload).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(payload[k])).join('&');
  const saveBtn = $('consultFormSave');
  saveBtn.disabled = true; saveBtn.textContent = '저장 중...';
  try {
    const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=consultUpdate&' + qs, 25000);
    if (res && res.ok) {
      crmToast('수정됐어요.');
      crmCloseConsultForm();
      crmOpenConsultPanel(); // 목록 새로고침
    } else {
      $('consultFormError').textContent = '수정에 실패했어요. 다시 시도해 주세요.';
    }
  } catch (e) {
    $('consultFormError').textContent = '연결이 원활하지 않아요. 다시 시도해 주세요.';
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = '저장';
  }
});

$('consultFormDelete').addEventListener('click', async () => {
  if (!crmConsultEditItem) return;
  if (!confirm((crmConsultEditItem.name || '이 상담') + ' 내역을 삭제할까요?')) return;
  const delBtn = $('consultFormDelete');
  delBtn.disabled = true;
  try {
    const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=consultDelete&row=' + encodeURIComponent(crmConsultEditItem.row)
      + '&name=' + encodeURIComponent(crmConsultEditItem.name || '')
      + '&tel=' + encodeURIComponent(crmConsultEditItem.tel || '')
      + '&date=' + encodeURIComponent(crmConsultEditItem.date || ''), 25000);
    if (res && res.ok) {
      crmToast('삭제됐어요.');
      crmCloseConsultForm();
      crmOpenConsultPanel(); // 목록 새로고침 (건수/빈상태 문구 갱신 포함)
    } else {
      crmToast('삭제에 실패했어요. 다시 시도해 주세요.');
    }
  } catch (e) {
    crmToast('연결이 원활하지 않아요. 다시 시도해 주세요.');
  } finally {
    delBtn.disabled = false;
  }
});


function crmBuildItemEl(ev) {
  const key = ev.cat + '_' + ev.row;
  const item = document.createElement('div');
  item.className = 'farm-dp-item';

  let titleText = ev.name || '(이름없음)';
  let subText = ev.id;
  if (ev.cat === 'SALE') { titleText = ev.id; subText = ev.name || '(이름없음)'; }
  else if (ev.cat === 'LEAD') { titleText = ev.name2 || ev.name || '(이름없음)'; subText = ev.id + (ev.name2 ? ' · ' + ev.name : ''); }

  const linkIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 17 17 7M8 7h9v9"/></svg>';
  const nameHtml = ev.cat === 'SALE'
    ? '<a href="' + EXP_MAEMUL_URL + '?q=' + encodeURIComponent(ev.id) + '" target="_blank">' + crmEsc(titleText) + linkIcon + '</a>'
    : crmEsc(titleText);
  const telHtml = ev.tel ? '<a href="tel:' + ev.tel + '">' + crmEsc(ev.tel) + '</a>' : '';
  const kakaoNameArg = crmEscAttr(ev.name || '');
  const telActionsHtml = ev.tel
    ? '<button type="button" class="tel-action-btn" data-sms-tel="' + crmEsc(ev.tel) + '" aria-label="문자 보내기">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      '</button>' +
      '<button type="button" class="tel-action-btn" data-kakao-name="' + kakaoNameArg + '" aria-label="카톡 메시지 복사">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
      '</button>'
    : '';
  const contactRowHtml = ev.tel ? '<div class="cust-contact-row">' + telHtml + telActionsHtml + '</div>' : '';

  let noteHtml = '';
  if (ev.cat === 'SALE') {
    const parts = [ev.bldg, ev.addr].filter(Boolean);
    if (parts.length) noteHtml = '<div class="farm-dp-sub2">' + crmEsc(parts.join(' · ')) + '</div>';
  } else if ((ev.cat === 'LEAD' || ev.cat === 'CONTRACT') && ev.remark) {
    noteHtml = '<div class="farm-dp-sub2">' + crmEsc(ev.remark) + '</div>';
  }

  const sc = crmStatusColor(ev.cat, ev.status);
  const statusStyle = sc ? ' style="background:' + sc.bg + ';color:' + sc.fg + '"' : '';

  const isDone = crmIsDoneToday(ev);
  const statusOpts = crmStatusOptions[ev.cat] || [];
  const contractDocLink = (ev.cat === 'CONTRACT' && ev.maemulNo)
    ? '<a class="cust-doc-link" href="contract-management.html?maemul=' + encodeURIComponent(ev.maemulNo) + '">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
        '계약서 보기' +
      '</a>'
    : '';
  const editIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  item.innerHTML =
    '<div class="farm-dp-item-top">' +
      '<div class="cust-tags-left">' +
        '<span class="cust-tag cat-' + ev.cat + '">' + CRM_CAT_LABEL[ev.cat] + '</span>' +
        (ev.status ? '<span class="cust-status-tag"' + statusStyle + '>' + crmEsc(ev.status) + '</span>' : '') +
      '</div>' +
      '<div class="cust-tags-right">' +
        '<button type="button" class="cust-edit-btn" data-editbtn="1" aria-label="정보 수정">' + editIcon + '</button>' +
        (crmNextHidden(ev) && !isDone ? '' : (isDone ? '<span class="cust-dday-badge done">오늘 처리완료</span>' : crmDDayBadge(ev.nextContact))) +
      '</div>' +
    '</div>' +
    '<div class="cust-name-row">' + nameHtml + '</div>' +
    contactRowHtml +
    '<div class="cust-sub-row">' + crmEsc(subText) + (ev.cat === 'CONTRACT' && ev.maemulNo
      ? ' · 매물 <a class="cust-maemul-link" href="' + EXP_MAEMUL_URL + '?q=' + encodeURIComponent(ev.maemulNo) + '" target="_blank" rel="noopener"><b>' + crmEsc(ev.maemulNo) + '</b>' + linkIcon + '</a>'
      : '') + '</div>' +
    noteHtml +
    '<div class="farm-dp-specs">' +
      '<span>last <b>' + (ev.lastContact || '-') + '</b></span>' +
      (crmNextHidden(ev) ? '<span style="color:#9E9E9E;font-size:12px;">보류 · 다음연락 없음</span>' : '<span>next <b>' + (ev.nextContact || '-') + '</b></span>') +
    '</div>' +
    contractDocLink +
    '<button type="button" class="cust-done-btn' + (isDone ? ' done' : '') + '" data-toggle="' + key + '">' + (isDone ? '연락완료' : '연락예정') + '</button>' +
    '<div class="cust-contact-panel" id="panel_' + key + '">' +
      '<div class="rec-field"><label>상태</label><select id="sel_' + key + '" data-dash-select>' +
        statusOpts.map(o => '<option value="' + crmEscAttr(o) + '"' + (o === ev.status ? ' selected' : '') + '>' + crmEsc(o) + '</option>').join('') +
      '</select></div>' +
      '<div class="cust-contact-preview" id="preview_' + key + '">' +
        (crmEstimateNext(ev.cat, ev.status) ? '다음 연락일은 저장하면 <b>' + crmEstimateNext(ev.cat, ev.status) + '</b>(으)로 자동 계산돼요.' : '보류 상태로 저장하면 다음 연락일이 표시되지 않아요.') +
      '</div>' +
      '<div class="rec-field"><label>메모 추가 (선택)</label><textarea id="memo_' + key + '" placeholder="통화 내용을 간단히 남겨보세요."></textarea></div>' +
      '<div class="cust-contact-actions">' +
        '<button type="button" class="cust-contact-cancel" data-cancel="' + key + '">취소</button>' +
        '<button type="button" class="cust-contact-save" data-save="' + key + '" data-cat="' + ev.cat + '" data-row="' + ev.row + '">저장</button>' +
      '</div>' +
    '</div>';

  // native select를 대시보드 커스텀 드롭다운으로 감싸기 (기존 값 로직은 안 건드림)
  const selectEl = item.querySelector('#sel_' + key);
  if (selectEl && window.DashUI) {
    DashUI.wrapNativeSelect(selectEl);
    selectEl.addEventListener('change', () => {
      const prev = item.querySelector('#preview_' + key);
      const est = crmEstimateNext(ev.cat, selectEl.value);
      if (prev) prev.innerHTML = est ? '다음 연락일은 저장하면 <b>' + est + '</b>(으)로 자동 계산돼요.' : '보류 상태로 저장하면 다음 연락일이 표시되지 않아요.';
    });
  }

  const editBtn = item.querySelector('[data-editbtn]');
  if (editBtn) editBtn.addEventListener('click', e => { e.stopPropagation(); crmOpenEditForm(ev); });

  const smsBtn = item.querySelector('[data-sms-tel]');
  if (smsBtn) smsBtn.addEventListener('click', e => { e.stopPropagation(); crmOpenSms(smsBtn.dataset.smsTel); });

  const kakaoBtn = item.querySelector('[data-kakao-name]');
  if (kakaoBtn) kakaoBtn.addEventListener('click', e => { e.stopPropagation(); crmCopyKakaoMessage(kakaoBtn.dataset.kakaoName); });

  return item;
}

$('dpBody').addEventListener('click', e => {
  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn) {
    const key = toggleBtn.dataset.toggle;
    document.querySelectorAll('.cust-contact-panel.show').forEach(p => { if (p.id !== 'panel_' + key) p.classList.remove('show'); });
    const p = $('panel_' + key);
    if (p) p.classList.toggle('show');
    return;
  }
  const cancelBtn = e.target.closest('[data-cancel]');
  if (cancelBtn) {
    const p = $('panel_' + cancelBtn.dataset.cancel);
    if (p) p.classList.remove('show');
    return;
  }
  const saveBtn = e.target.closest('[data-save]');
  if (saveBtn) {
    crmSaveContact(saveBtn.dataset.cat, saveBtn.dataset.row, saveBtn.dataset.save, saveBtn);
    return;
  }
});

async function crmSaveContact(cat, row, key, btnEl) {
  const selectEl = $('sel_' + key);
  const memoEl = $('memo_' + key);
  const statusVal = selectEl ? selectEl.value : '';
  const memoVal = memoEl ? memoEl.value.trim() : '';

  // 원본 요청과 자동 재시도가 서버 입장에서 "같은 요청"임을 구분할 수 있도록 매번 새 reqId 발급
  // (한 번 만든 reqId는 이 저장 시도(원본+재시도) 동안 그대로 재사용됨 — crmJsonpRetry가 같은 url을 재사용하기 때문)
  const reqId = Date.now() + '_' + Math.random().toString(36).slice(2);
  const url = CRM_DATA_URL + '?mode=crmUpdate&sheet=' + encodeURIComponent(cat)
    + '&row=' + encodeURIComponent(row)
    + '&lastDate=' + encodeURIComponent(crmTodayStr())
    + (memoVal ? '&memo=' + encodeURIComponent(memoVal) : '')
    + (statusVal ? '&status=' + encodeURIComponent(statusVal) : '')
    + '&reqId=' + encodeURIComponent(reqId);

  btnEl.disabled = true; btnEl.textContent = '저장 중...';
  try {
    const res = await crmJsonpRetry(url, 25000);
    if (res && res.ok) {
      const it = crmAllItems.find(x => x.cat === cat && String(x.row) === String(row));
      if (it) {
        it.lastContact = crmTodayStr();
        it.nextContact = res.nextContact || it.nextContact;
        if (statusVal) it.status = statusVal;
        if (memoVal) {
          const tag = new Date().toISOString().slice(0, 10);
          it.memo = (it.memo ? it.memo + '\n' : '') + tag + ' ' + memoVal;
        }
      }
      crmWriteCache(crmAllItems, crmStatusOptions);
      crmBucket();
      crmRenderCalendar();
      crmToast('저장됐어요 · 다음 연락일 ' + (res.nextContact || ''));
      // 패널을 열었던 기준으로 다시 그림 — 날짜별 패널이면 그 날짜 기준, "오늘 처리" 통합 패널이면 최신 기준으로 재필터링
      // (저장 즉시 next는 미래로 바뀌지만, 화면 표시는 crmDisplayDate()가 "오늘"로 고정해주므로
      //  오늘 처리 목록/캘린더 오늘 칸에는 그대로 남아있고, 내일이 되면 자동으로 실제 next 날짜로 이동함)
      if (crmPanelMode === 'today') {
        crmOpenTodayPanel();
      } else if (crmPanelMode.indexOf('cat:') === 0) {
        crmOpenCatPanel(crmPanelMode.slice(4), crmPanelMaemulFilter, true);
      } else {
        crmOpenDayPanel(crmPanelKey, ...crmPanelYmd, crmEventsByDate[crmPanelKey] || []);
      }
    } else {
      crmToast('저장에 실패했어요. 다시 시도해 주세요.');
    }
  } catch (e) {
    crmToast('연결이 원활하지 않아요. 다시 시도해 주세요.');
  } finally {
    btnEl.disabled = false; btnEl.textContent = '저장';
  }
}

/* ===== 등록/수정 모달 ===== */
const crmFormOverlay = $('formOverlay');
let crmFormCat = 'SALE';
let crmEditItem = null; // null=등록, item객체=수정
let crmFormBaseDate = '';
let crmFormReqId = ''; // 등록 폼 하나당 고유값 — 자동 재시도/수동 재클릭이 같은 요청인지 서버가 구분하기 위함
function crmFv(id) { const el = $(id); return el ? el.value.trim() : ''; }

function crmField(labelText, innerHtml) {
  return '<div class="rec-form-grid full"><div class="rec-field"><label>' + labelText + '</label>' + innerHtml + '</div></div>';
}
function crmStatusFieldHtml(cat, curVal) {
  const opts = crmStatusOptions[cat] || [];
  const label = cat === 'LEAD' ? '온도' : '상태';
  return crmField(label, '<select id="f_status" data-dash-select>' +
    opts.map(o => '<option value="' + crmEscAttr(o) + '"' + (o === curVal ? ' selected' : '') + '>' + crmEsc(o) + '</option>').join('') +
    '</select>');
}
function crmBaseFieldHtml(cat) {
  const label = cat === 'CONTRACT' ? '계약일' : '접수일';
  return crmField(label, '<button type="button" class="dash-picker-btn" id="f_baseBtn"><span data-role="label" id="f_baseLabel">' + crmFormBaseDate + '</span><span class="car">▾</span></button>');
}

function crmFieldsHtml(cat, item) {
  const idVal = item ? (item.id || '') : '';
  const nameVal = item ? (item.name || '') : '';
  const telVal = item ? (item.tel || '') : '';
  const name2Val = item ? (item.name2 || '') : '';
  const remarkVal = item ? (item.remark || '') : '';
  const memoVal = item ? (item.memo || '') : '';
  const statusVal = item ? item.status : '';
  const maemulVal = item ? (item.maemulNo || '') : '';

  const memoField = crmField('메모', '<textarea id="f_memo" placeholder="통화·연락 메모">' + crmEsc(memoVal) + '</textarea>');
  const idLabelSale = item ? '매물번호' : '매물번호 (선택 · 매물뷰 연동용)';

  if (cat === 'SALE') {
    return crmField(idLabelSale, '<input type="text" id="f_id" value="' + crmEscAttr(idVal) + '" placeholder="예: FS0002">')
      + crmField('성명', '<input type="text" id="f_name" value="' + crmEscAttr(nameVal) + '" placeholder="고객 성명">')
      + crmField('연락처', '<input type="text" id="f_tel" value="' + crmEscAttr(telVal) + '" placeholder="010-0000-0000">')
      + crmBaseFieldHtml(cat) + crmStatusFieldHtml(cat, statusVal) + memoField;
  }
  if (cat === 'LEAD') {
    return crmField('고객번호', '<input type="text" id="f_id" value="' + crmEscAttr(idVal) + '" placeholder="엑셀마스터 고객번호">')
      + crmField('고객명2 (카드 제목으로 표시)', '<input type="text" id="f_name2" value="' + crmEscAttr(name2Val) + '" placeholder="카드에 표시될 이름">')
      + crmField('성명', '<input type="text" id="f_name" value="' + crmEscAttr(nameVal) + '" placeholder="고객 성명">')
      + crmField('연락처', '<input type="text" id="f_tel" value="' + crmEscAttr(telVal) + '" placeholder="010-0000-0000">')
      + crmBaseFieldHtml(cat) + crmStatusFieldHtml(cat, statusVal)
      + crmField('비고', '<textarea id="f_remark" placeholder="특이사항을 남겨보세요.">' + crmEsc(remarkVal) + '</textarea>')
      + memoField;
  }
  return crmField('고객번호', '<input type="text" id="f_id" value="' + crmEscAttr(idVal) + '" placeholder="엑셀마스터 고객번호">')
    + crmField('성명', '<input type="text" id="f_name" value="' + crmEscAttr(nameVal) + '" placeholder="고객 성명">')
    + crmField('연락처', '<input type="text" id="f_tel" value="' + crmEscAttr(telVal) + '" placeholder="010-0000-0000">')
    + crmBaseFieldHtml(cat) + crmStatusFieldHtml(cat, statusVal)
    + crmField('매물번호 (선택 · 계약관리 연동용)', '<input type="text" id="f_maemul" value="' + crmEscAttr(maemulVal) + '" placeholder="예: FS0002">')
    + crmField('비고', '<textarea id="f_remark" placeholder="특이사항을 남겨보세요.">' + crmEsc(remarkVal) + '</textarea>')
    + memoField;
}

function crmBuildForm() {
  crmFormBaseDate = crmEditItem ? (crmEditItem.baseDate || crmTodayStr()) : crmTodayStr();
  $('formFields').innerHTML = crmFieldsHtml(crmFormCat, crmEditItem);
  const baseBtn = $('f_baseBtn');
  if (baseBtn) {
    baseBtn.addEventListener('click', () => {
      DashUI.openCalendar(crmFormBaseDate, dateStr => {
        crmFormBaseDate = dateStr;
        $('f_baseLabel').textContent = dateStr;
      });
    });
  }
  // 상태/온도 select — 폼이 DOMContentLoaded 이후 동적으로 열리므로 dash-widgets.js의
  // 자동 스캔(autoWrapSelects)이 못 잡아냄. 매번 열 때 수동으로 커스텀 드롭다운 래핑.
  const statusSel = $('f_status');
  if (statusSel && window.DashUI) DashUI.wrapNativeSelect(statusSel);
}

$('fCatSeg').addEventListener('click', e => {
  const btn = e.target.closest('[data-v]'); if (!btn || crmEditItem) return; // 수정모드에선 카테고리 고정
  crmFormCat = btn.dataset.v;
  $('fCatSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
  crmBuildForm();
});

function crmOpenAddForm() {
  crmEditItem = null;
  crmFormCat = 'SALE';
  crmFormReqId = Date.now() + '_' + Math.random().toString(36).slice(2);  $('formTitle').textContent = '고객 등록';
  $('formError').textContent = '';
  $('fCatSeg').style.display = '';
  $('fCatSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === 'SALE'));
  crmBuildForm();
  crmFormOverlay.classList.add('show');
  if ($('formDelete')) $('formDelete').style.display = 'none';
}
function crmOpenEditForm(item) {
  crmEditItem = item;
  crmFormCat = item.cat;
  $('formTitle').textContent = '정보 수정';
  $('formError').textContent = '';
  $('fCatSeg').style.display = 'none';
  crmBuildForm();
  crmFormOverlay.classList.add('show');
  if ($('formDelete')) $('formDelete').style.display = '';
}
function crmCloseForm() { crmFormOverlay.classList.remove('show'); }
$('formClose').addEventListener('click', crmCloseForm);
$('formCancel').addEventListener('click', crmCloseForm);

/* ===== 삭제 버튼 (HTML 수정 없이 취소 버튼 앞에 동적으로 삽입) ===== */
(function () {
  const cancelBtn = $('formCancel');
  if (!cancelBtn || $('formDelete')) return;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.id = 'formDelete';
  delBtn.className = 'btn-danger-outline';
  delBtn.textContent = '삭제';
  delBtn.style.display = 'none';
  cancelBtn.parentNode.insertBefore(delBtn, cancelBtn);

  delBtn.addEventListener('click', async () => {
    if (!crmEditItem) return;
    if (!confirm('정말 삭제할까요? 되돌릴 수 없어요.')) return;
    delBtn.disabled = true; delBtn.textContent = '삭제 중...';
    try {
      const qs = 'sheet=' + encodeURIComponent(crmEditItem.cat) + '&row=' + encodeURIComponent(crmEditItem.row) + '&id=' + encodeURIComponent(crmEditItem.id || '');
      const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=crmDelete&' + qs, 25000);
      if (res && res.ok) {
        crmAllItems = crmAllItems.filter(x => !(x.cat === crmEditItem.cat && x.row === crmEditItem.row));
        crmWriteCache(crmAllItems, crmStatusOptions, crmHolidays);
        crmBucket(); crmRenderCalendar();
        crmCloseForm();
        crmToast('삭제됐어요.');
      } else {
        $('formError').textContent = '삭제에 실패했어요. 다시 시도해 주세요.';
      }
    } catch (e) {
      $('formError').textContent = '연결이 원활하지 않아요. 다시 시도해 주세요.';
    } finally {
      delBtn.disabled = false; delBtn.textContent = '삭제';
    }
  });
})();
$('addBtn').addEventListener('click', () => { if (!$('addBtn').dataset.justDragged) crmOpenAddForm(); });

$('formSave').addEventListener('click', async () => {
  const cat = crmFormCat;
  const name = crmFv('f_name');
  if (!name) { $('formError').textContent = '성명을 입력해 주세요.'; return; }
  const tel = crmFv('f_tel');
  const statusSel = $('f_status');
  const status = statusSel ? statusSel.value : '';

  const saveBtn = $('formSave');
  saveBtn.disabled = true; saveBtn.textContent = '저장 중...';

  if (!crmEditItem) {
   // 등록
    const payload = { sheet: cat, name: name, tel: tel, baseDate: crmFormBaseDate || crmTodayStr(), status: status, reqId: crmFormReqId };
    if (cat === 'SALE') {
      payload.id = crmFv('f_id');
    } else {
      const idVal = crmFv('f_id');
      if (!idVal) { $('formError').textContent = '고객번호를 입력해 주세요.'; saveBtn.disabled = false; saveBtn.textContent = '저장'; return; }
      payload.id = idVal;
    }
    if (cat === 'LEAD') { payload.name2 = crmFv('f_name2'); payload.remark = crmFv('f_remark'); }
    if (cat === 'CONTRACT') { payload.remark = crmFv('f_remark'); payload.maemulNo = crmFv('f_maemul'); }
    const memoVal = crmFv('f_memo');
    if (memoVal) payload.memoSet = crmTodayStr() + ' ' + memoVal;

    const qs = Object.keys(payload).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(payload[k])).join('&');
    try {
      const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=crmCreate&' + qs, 25000);
      if (res && res.ok && res.item) {
        crmAllItems.push(res.item);
        crmWriteCache(crmAllItems, crmStatusOptions);
        crmBucket(); crmRenderCalendar();
        crmCloseForm();
        crmToast(CRM_CAT_LABEL[cat] + ' 등록됐어요.');
      } else if (res && res.error === 'dup_id') {
        $('formError').textContent = '이미 있는 고객번호(매물번호)예요. 확인해 주세요.';
      } else {
        $('formError').textContent = '등록에 실패했어요. 다시 시도해 주세요.';
      }
    } catch (e) {
      $('formError').textContent = '연결이 원활하지 않아요. 다시 시도해 주세요.';
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = '저장';
    }
  } else {
    // 수정
    const row = crmEditItem.row;
    const idVal = crmFv('f_id');
    if (cat !== 'SALE' && !idVal) { $('formError').textContent = '고객번호를 입력해 주세요.'; saveBtn.disabled = false; saveBtn.textContent = '저장'; return; }
    const payload = { sheet: cat, row: row, name: name, tel: tel };
    if (idVal) payload.id = idVal;
    if (status) payload.status = status;
    if (crmFormBaseDate) payload.baseDate = crmFormBaseDate;
    if (cat === 'LEAD') { payload.name2 = crmFv('f_name2'); payload.remark = crmFv('f_remark'); }
    if (cat === 'CONTRACT') { payload.remark = crmFv('f_remark'); payload.maemulNo = crmFv('f_maemul'); }
    payload.memoSet = crmFv('f_memo');

    const qs = Object.keys(payload).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(payload[k])).join('&');
    try {
      const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=crmUpdate&' + qs, 25000);
      if (res && res.ok) {
        const it = crmAllItems.find(x => x.cat === cat && x.row === row);
        if (it) {
          it.name = name; it.tel = tel;
          if (idVal) it.id = idVal;
          if (status) it.status = status;
          if (crmFormBaseDate) it.baseDate = crmFormBaseDate;
          it.memo = payload.memoSet;
          if (cat === 'LEAD') { it.name2 = payload.name2; it.remark = payload.remark; }
          if (cat === 'CONTRACT') { it.remark = payload.remark; it.maemulNo = payload.maemulNo; }
          if (res.nextContact) it.nextContact = res.nextContact;
        }
        crmWriteCache(crmAllItems, crmStatusOptions);
        crmBucket(); crmRenderCalendar();
        crmCloseForm();
        crmToast('수정됐어요.');
      } else {
        $('formError').textContent = '수정에 실패했어요. 다시 시도해 주세요.';
      }
    } catch (e) {
      $('formError').textContent = '연결이 원활하지 않아요. 다시 시도해 주세요.';
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = '저장';
    }
  }
});

/* 일별 패널 카드에서도 정보 수정 진입 가능하게: 이름 클릭이 아닌 별도 수정 진입점이 필요하면
   추후 카드에 연필 아이콘을 추가할 수 있음 — 1차 버전은 FAB 등록/일별 연락완료 처리 중심 */

/* ===== FAB 드래그 이동 (파밍현황과 동일 방식) ===== */
(function () {
  const fab = $('addBtn');
  const POS_KEY = 'theo_dashboard_crm_fab_pos';
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
    if (saved && typeof saved.left === 'number') { const c = clamp(saved.left, saved.top); applyPos(c.left, c.top); }
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
  window.addEventListener('resize', () => { const r = fab.getBoundingClientRect(); const c = clamp(r.left, r.top); applyPos(c.left, c.top); });
})();

/* ===== 캘린더 좌우 스와이프 → 월 이동 (모바일) ===== */
(function () {
  var card = document.querySelector('.farm-cal-card');
  if (!card) return;
  var startX = 0, startY = 0, tracking = false;
  card.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  card.addEventListener('touchend', function (e) {
    if (!tracking) return;
    tracking = false;
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) $('nextBtn').click(); else $('prevBtn').click();
    }
  }, { passive: true });
})();

/* ===== 네비게이션 ===== */
$('prevBtn').addEventListener('click', () => { crmViewMonth--; if (crmViewMonth < 0) { crmViewMonth = 11; crmViewYear--; } crmRenderCalendar(); });
$('nextBtn').addEventListener('click', () => { crmViewMonth++; if (crmViewMonth > 11) { crmViewMonth = 0; crmViewYear++; } crmRenderCalendar(); });
$('refreshBtn').addEventListener('click', () => crmLoadData());
$('todayBtn').addEventListener('click', () => {
  crmViewYear = crmToday.getFullYear();
  crmViewMonth = crmToday.getMonth();
  crmRenderCalendar();
  crmOpenTodayPanel();
});

/* 캐시 우선 렌더 후 백그라운드 최신화 (캐시 없을 때만 로딩 표시) */
(function crmInit() {
  const cached = crmReadCache();
  if (cached) {
    crmAllItems = cached.items || [];
    crmStatusOptions = cached.statusOptions || {};
    crmHolidays = new Map((cached.holidays || []).filter(function (h) { return Array.isArray(h) && h[0]; }));
    crmBucket();
    crmRenderCalendar();
    crmLoadData(true);
  } else {
    crmLoadData();
  }
  crmHandleMaemulDeepLink();
})();
