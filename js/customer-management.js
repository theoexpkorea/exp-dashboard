/* ============================================================
   theo 대시보드 — 고객관리 (js/customer-management.js)
   exp-crm과 동일한 매물장필터뷰 Apps Script(mode=crmList/crmUpdate/crmCreate)를
   그대로 재사용합니다. 대시보드 자체 백엔드가 아님 — 새 배포 불필요.
   다음연락일(next)은 항상 시트 수식이 전담 — 이 파일에서 절대 직접 계산해 쓰지 않습니다
   (연락완료 저장 시 서버가 재계산한 nextContact를 그대로 받아서 반영).
   ============================================================ */

const CRM_DATA_URL = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';

/* 통화기록 모드 상태 — 파일 맨 위로 옮김. crmRenderStats() 등 캘린더쪽 코드가 페이지 로드
   초반(캐시된 데이터로 즉시 렌더할 때)에 이미 이 값을 참조하는데, let 선언은 실제 선언 줄이
   실행되기 전까지 "일시적 사각지대(TDZ)"에 걸려 ReferenceError가 나므로, 반드시 다른 코드보다
   먼저 선언되어야 함. (2026-09-05 버그 수정: 이 선언이 파일 아래쪽에 있어서 초기 로드 시
   전체 스크립트가 죽는 문제가 있었음) */
let callLogMode = false;
let callLogRawList = [];
let callLogFilterScope = 'all';
let callLogOnlyUnresolved = false;
let callLogSearchQuery = '';
let callLogSortKey = 'newest'; // 'newest' | 'oldest' — 통화일시 기준
const CALL_LOG_PAGE_SIZE = 30; // 건수가 쌓여도 한 번에 다 그리지 않고 "더보기"로 나눠서 렌더
let callLogVisibleCount = CALL_LOG_PAGE_SIZE;
let clRealCalCard = null; // 실제 캘린더 카드 DOM을 최초 1회만 캐싱 — 통화기록 컨테이너 삽입 이후엔
                          // querySelector('.farm-cal-card')가 컨테이너 자신과 섞일 수 있어 재조회하지 않음

const CRM_CAT_ORDER = ['SALE', 'LEAD', 'CONTRACT'];
const CRM_CAT_LABEL = { SALE: '매도임대', LEAD: '가망고객', CONTRACT: '계약고객' };
const CRM_SORT_ID_LABEL = { SALE: '매물번호순', LEAD: '고객코드순', CONTRACT: '고객코드순' }; // 정렬 드롭다운 2번째 옵션 라벨(카테고리별 명칭 차이)
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
  if (callLogMode) return; // 통화기록 모드일 때는 이 함수가 KPI를 덮어쓰면 안 됨 (updateCallLogKpi_가 그 자리를 쓰는 중)
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
let crmCatSortKey = 'dday'; // cat 패널 정렬 기준: 'dday'(다음연락일순, 기본) | 'id'(매물번호순·고객코드순, 카테고리별 라벨만 다름)
let crmCatSortCat = '';     // 정렬 상태가 어느 카테고리에 대한 것인지 (카테고리 전환 시 기본값으로 리셋하기 위함)

function crmSortCatList(list, cat) {
  const sorted = list.slice();
  if (crmCatSortKey === 'id') {
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

  // 매도임대/가망고객/계약고객 전부 다음연락일순 / 매물번호·고객코드순 정렬 드롭다운 노출
  const sortRow = $('dpSortRow');
  if (sortRow) {
    sortRow.style.display = '';
    const idOpt = sortRow.querySelector('.cust-sort-opt[data-sort="id"]');
    if (idOpt) idOpt.textContent = CRM_SORT_ID_LABEL[cat] || '고객코드순';
    const label = crmCatSortKey === 'id' ? (CRM_SORT_ID_LABEL[cat] || '고객코드순') : '다음연락일순';
    $('dpSortLabel').textContent = label;
    sortRow.querySelectorAll('.cust-sort-opt').forEach(o => o.classList.toggle('sel', o.dataset.sort === crmCatSortKey));
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
$('refreshBtn').addEventListener('click', () => { if (callLogMode) fetchCallLogList_(); else crmLoadData(); });
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


/* ============================================================
   통화기록 UI - customer-management.js 맨 아래에 이어붙이는 모듈 (최종 정리본)
   2026-09-05

   전제: customer-management.js 로드 이후 실행되며 같은 전역 스코프를 공유하므로
   CRM_DATA_URL / crmJsonpRetry / crmToast / crmEsc / crmEscAttr / crmRenderStats / $
   등 기존 함수·상수를 그대로 재사용함 (재정의 없음).

   ===== 기능 =====
   - 조회: 툴바 "통화기록" 버튼 → 캘린더 자리에 카드리스트 표시
   - 필터: 기존 필터칩(전체/매도임대/가망고객/계약고객) 재사용 + "미반영만" 칩 추가
   - KPI: 기존 4개 카드 자리에 통화 관련 숫자로 바꿔치기 (모드 해제 시 원복)
   - 카드 펼치면: 메모(수정 가능) · 녹음재생 링크 · 전사보기(짧으면 수정도 가능) ·
     반영완료 버튼 · (미매칭/복수매칭 건만) 재분류 버튼

   ===== style.css에 추가해야 하는 것 =====
   .cl-tags-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
   .cl-cat-badge { font-size:10.5px; font-weight:800; padding:2px 7px; border-radius:6px; flex-shrink:0; }
   .cl-cat-badge[data-cat="매도임대"] { background:#DCEBFD; color:#1D5FBF; }
   .cl-cat-badge[data-cat="가망고객"] { background:#DCF3E9; color:#12805E; }
   .cl-cat-badge[data-cat="계약고객"] { background:#EBE3FB; color:#6A3FB0; }
   .cl-transcript-box { white-space:pre-wrap; font-size:12px; background:var(--bg); border-radius:var(--radius-sm); padding:10px; max-height:220px; overflow-y:auto; margin:8px 0; }
   .cl-recording-link { display:inline-block; margin:2px 0 8px; color:var(--accent); text-decoration:none; font-size:13px; font-weight:600; }
   .cl-detail-actions { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
   .cl-reclassify { margin-top:10px; padding:10px; background:#FBF1E2; border-radius:var(--radius-sm); }
   .cl-reclassify-label { font-size:11.5px; margin-bottom:6px; color:#9A5B14; }
   .cl-reclassify select, .cl-reclassify input, .cl-edit-textarea { margin-right:6px; padding:6px 8px; border-radius:6px; border:1px solid var(--border); font-family:inherit; font-size:12.5px; }
   .cl-edit-textarea { width:100%; min-height:64px; resize:vertical; margin:6px 0; }
   .cl-edit-note { font-size:11px; color:var(--text-muted); margin-top:4px; }
   .cl-chip--unresolved { }
   .farm-tool-btn.active { border-color:var(--accent); color:var(--accent); background:var(--accent-soft); }
   ============================================================ */

const CALL_LOG_CATEGORIES = ['SALE', 'LEAD', 'CONTRACT'];
const CALL_LOG_CAT_TO_SHEET_CAT = { SALE: '매도임대', LEAD: '가망고객', CONTRACT: '계약고객' };
const CALL_LOG_SHEET_CAT_TO_CAT = { '매도임대': 'SALE', '가망고객': 'LEAD', '계약고객': 'CONTRACT' };
const CALL_LOG_TRANSCRIPT_EDIT_MAX = 800; // 이보다 길면 대시보드에서 수정 불가 (URL 길이 제한 때문에 시트에서 직접 수정 유도)


/* ============================================================
   진입점: 툴바 버튼 + 컨테이너 삽입
   ============================================================ */
(function initCallLogUi() {
  const toolbar = document.querySelector('.farm-toolbar');
  const monthNav = document.querySelector('.farm-month-nav');
  if (!toolbar || !monthNav) return;

  const btn = document.createElement('button');
  btn.className = 'farm-tool-btn';
  btn.id = 'callLogBtn';
  btn.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2Z"/></svg>' +
    '통화기록';
  toolbar.insertBefore(btn, monthNav);

  const container = document.createElement('div');
  container.id = 'callLogContainer';
  container.className = 'cl-log-shell';
  container.style.display = 'none';
  container.style.padding = '0';

  // 검색/정렬 툴바 — 목록과 달리 리스트 리렌더링 때 다시 안 그림(값 유지)
  container.innerHTML =
    '<div class="cl-toolbar-row">' +
      '<input type="text" class="cl-search-input" id="clSearchInput" placeholder="이름 · 전화번호 · 고객코드/매물번호 검색" />' +
      '<div class="cust-sort-row" id="clSortRow" style="border-bottom:none;padding:0;">' +
        '<button type="button" class="cust-sort-btn" id="clSortBtn"><span id="clSortLabel">최신순</span><span class="cust-sort-car">▾</span></button>' +
        '<div class="cust-sort-pop" id="clSortPop">' +
          '<div class="cust-sort-opt sel" data-sort="newest">최신순</div>' +
          '<div class="cust-sort-opt" data-sort="oldest">오래된순</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="callLogListWrap"></div>';

  const calCard = document.querySelector('.farm-cal-card');
  clRealCalCard = calCard; // toggleCallLogMode_에서 재조회 대신 이 캐시를 씀
  calCard.parentNode.insertBefore(container, calCard);

  btn.addEventListener('click', () => {
    callLogMode = !callLogMode;
    toggleCallLogMode_(callLogMode);
  });

  // 검색
  const searchInput = container.querySelector('#clSearchInput');
  searchInput.addEventListener('input', () => {
    callLogSearchQuery = searchInput.value.trim();
    callLogVisibleCount = CALL_LOG_PAGE_SIZE;
    renderCallLogList_();
  });

  // 정렬 드롭다운
  const sortRow = container.querySelector('#clSortRow');
  const sortBtn = container.querySelector('#clSortBtn');
  const sortPop = container.querySelector('#clSortPop');
  sortBtn.addEventListener('click', e => { e.stopPropagation(); sortRow.classList.toggle('open'); });
  sortPop.addEventListener('click', e => {
    const opt = e.target.closest('.cust-sort-opt');
    if (!opt) return;
    sortRow.classList.remove('open');
    if (opt.dataset.sort === callLogSortKey) return;
    callLogSortKey = opt.dataset.sort;
    container.querySelector('#clSortLabel').textContent = opt.textContent;
    sortPop.querySelectorAll('.cust-sort-opt').forEach(o => o.classList.toggle('sel', o === opt));
    callLogVisibleCount = CALL_LOG_PAGE_SIZE;
    renderCallLogList_();
  });
  document.addEventListener('click', () => sortRow.classList.remove('open'));
})();

function toggleCallLogMode_(on) {
  const calCard = clRealCalCard; // 캐시된 실제 캘린더 참조 (컨테이너와 클래스 충돌 방지)
  const legend = document.querySelector('.farm-legend');
  const note = document.querySelector('.farm-note');
  const monthNav = document.querySelector('.farm-month-nav');
  const container = $('callLogContainer');
  const callBtn = $('callLogBtn');

  [calCard, legend, note, monthNav].forEach(el => { if (el) el.style.display = on ? 'none' : ''; });
  container.style.display = on ? '' : 'none';
  if (callBtn) callBtn.classList.toggle('active', on);

  ensureUnresolvedChip_(on);

  if (on) {
    fetchCallLogList_();
  } else {
    const todayLabel = document.querySelector('#statTodayCard .stat-label');
    if (todayLabel) todayLabel.textContent = '오늘 처리';
    crmRenderStats();
  }
}

function ensureUnresolvedChip_(show) {
  const tabs = $('scopeTabs');
  let chip = document.getElementById('callLogUnresolvedChip');
  if (show) {
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'callLogUnresolvedChip';
      chip.className = 'rec-filter-chip cl-chip--unresolved';
      chip.type = 'button';
      const setLabel = () => { chip.textContent = '반영대기만'; };
      setLabel();
      chip.addEventListener('click', () => {
        callLogOnlyUnresolved = !callLogOnlyUnresolved;
        chip.classList.toggle('active', callLogOnlyUnresolved);
        setLabel();
        if (callLogOnlyUnresolved) {
          // 독립된 필터로 동작 — 켜지면 카테고리 상관없이 반영대기 전부를 보여줌 (카테고리 칩은 선택 해제)
          callLogFilterScope = 'all';
          document.querySelectorAll('#scopeTabs .rec-filter-chip[data-scope]').forEach(b => b.classList.remove('active'));
        } else {
          // 끄면 "전체" 카테고리로 복귀
          callLogFilterScope = 'all';
          document.querySelectorAll('#scopeTabs .rec-filter-chip[data-scope]').forEach(b => b.classList.toggle('active', b.dataset.scope === 'all'));
        }
        callLogVisibleCount = CALL_LOG_PAGE_SIZE;
        renderCallLogList_();
      });
      tabs.appendChild(chip);
    }
    chip.style.display = '';
  } else if (chip) {
    chip.style.display = 'none';
  }
}


/* 기존 필터칩/KPI카드 클릭을 통화기록 모드일 때만 가로챔 (capture 단계 — 기존 핸들러보다 먼저 실행) */
document.addEventListener('DOMContentLoaded', () => {
  const scopeTabs = $('scopeTabs');
  if (scopeTabs) {
    scopeTabs.addEventListener('click', (e) => {
      if (!callLogMode) return;
      const btn = e.target.closest('[data-scope]');
      if (!btn) return;
      e.stopPropagation();
      callLogFilterScope = btn.dataset.scope;
      document.querySelectorAll('#scopeTabs .rec-filter-chip[data-scope]').forEach(b => b.classList.toggle('active', b === btn));
      // 카테고리를 고르면 "반영대기만" 독립 필터는 해제 — 두 그룹이 동시에 선택된 것처럼 보이지 않게 함
      if (callLogOnlyUnresolved) {
        callLogOnlyUnresolved = false;
        const unresolvedChip = document.getElementById('callLogUnresolvedChip');
        if (unresolvedChip) { unresolvedChip.classList.remove('active'); unresolvedChip.textContent = '반영대기만'; }
      }
      callLogVisibleCount = CALL_LOG_PAGE_SIZE;
      renderCallLogList_();
    }, true);
  }

  const statGrid = $('statGrid');
  if (statGrid) {
    statGrid.addEventListener('click', (e) => {
      if (!callLogMode) return;
      e.stopPropagation();
    }, true);
  }
});

/* ============================================================
   데이터 조회
   ============================================================ */
function fetchCallLogList_() {
  const listWrap = $('callLogListWrap');
  listWrap.innerHTML = '<div class="farm-cal-loading" style="position:static;display:flex;padding:30px 0;">불러오는 중...</div>';

  crmJsonpRetry(CRM_DATA_URL + '?mode=callList', 20000)
    .then(data => {
      callLogRawList = Array.isArray(data) ? data : [];
      callLogVisibleCount = CALL_LOG_PAGE_SIZE;
      renderCallLogList_();
    })
    .catch(() => {
      listWrap.innerHTML = '<div class="farm-dp-empty">통화기록을 불러오지 못했습니다. 새로고침 해주세요.</div>';
    });
}

function callLogSortCompare_(a, b) {
  const ta = new Date(a['통화일시'] || 0).getTime() || 0;
  const tb = new Date(b['통화일시'] || 0).getTime() || 0;
  return callLogSortKey === 'oldest' ? (ta - tb) : (tb - ta);
}

function parseCallMatchStatus_(text) {
  const t = String(text || '');
  if (t.indexOf('복수매칭') !== -1) return { type: 'ambiguous', label: '복수매칭', tagClass: 'hold' };
  if (t.indexOf('수동재분류') === 0) return { type: 'reclassified', label: '수동재분류', tagClass: 'plan' };
  if (t.indexOf('신규') === 0) return { type: 'unmatched', label: '신규(미매칭)', tagClass: 'cancel' };
  if (t.indexOf('기존고객') !== -1 || t.indexOf('이름매칭') !== -1) return { type: 'matched', label: '기존고객', tagClass: 'done' };
  return { type: 'unknown', label: t || '(정보없음)', tagClass: 'cancel' };
}

/* CRM매칭 텍스트 끝의 괄호 안에서 코드만 뽑아냄
   "기존고객(매도임대:A0001)" → "A0001" / "수동재분류(가망고객)(SH-0013)" → "SH-0013"
   확정된 코드가 있는 matched/reclassified 상태에서만 의미 있으므로 그 외에는 호출측에서 빈 값 취급 */
function extractCallCode_(text) {
  const m = String(text || '').match(/\(([^()]+)\)\s*$/);
  if (!m) return '';
  const inner = m[1];
  const code = inner.indexOf(':') !== -1 ? inner.split(':').pop().trim() : inner.trim();
  return code;
}

/* ============================================================
   목록 렌더링
   ============================================================ */
function renderCallLogList_() {
  const listWrap = $('callLogListWrap');
  if (!listWrap) return;
  listWrap.innerHTML = '';

  const q = callLogSearchQuery.trim();
  const filtered = callLogRawList.filter(item => {
    if (callLogFilterScope !== 'all' && item.category !== CALL_LOG_CAT_TO_SHEET_CAT[callLogFilterScope]) return false;
    if (callLogOnlyUnresolved && item['반영여부']) return false;
    if (q) {
      const hay = ((item['성명'] || '') + ' ' + (item['전화번호'] || '') + ' ' + (item['CRM매칭'] || '')).toLowerCase();
      if (hay.indexOf(q.toLowerCase()) === -1) return false;
    }
    return true;
  }).sort(callLogSortCompare_);

  updateCallLogKpi_();

  if (filtered.length === 0) {
    listWrap.innerHTML = '<div class="farm-dp-empty">해당하는 통화기록이 없습니다.</div>';
    return;
  }

  const visible = filtered.slice(0, callLogVisibleCount);

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';
  list.style.padding = '14px 20px';
  visible.forEach(item => list.appendChild(buildCallCard_(item)));
  listWrap.appendChild(list);

  if (filtered.length > visible.length) {
    const moreRow = document.createElement('div');
    moreRow.className = 'cl-loadmore-row';
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'cl-loadmore-btn';
    moreBtn.textContent = '더보기 (' + (filtered.length - visible.length) + '건 더 있음)';
    moreBtn.addEventListener('click', () => {
      callLogVisibleCount += CALL_LOG_PAGE_SIZE;
      renderCallLogList_();
    });
    moreRow.appendChild(moreBtn);
    listWrap.appendChild(moreRow);
  }
}

function buildCallCard_(item) {
  const status = parseCallMatchStatus_(item['CRM매칭']);
  const code = (status.type === 'matched' || status.type === 'reclassified') ? extractCallCode_(item['CRM매칭']) : '';
  const card = document.createElement('div');
  card.className = 'farm-dp-item';

  card.innerHTML =
    '<div class="cl-tags-row">' +
    '  <span class="cl-cat-badge" data-cat="' + crmEscAttr(item.category) + '">' + crmEsc(item.category) + '</span>' +
    '  <span class="farm-dp-tag ' + status.tagClass + '">' + crmEsc(status.label) + '</span>' +
    (code ? '  <span class="farm-dp-tag plan">' + crmEsc(code) + '</span>' : '') +
    (item['반영여부']
      ? '  <span class="farm-dp-tag done">반영완료</span>'
      : '  <span class="farm-dp-tag hold">반영대기</span>') +
    '</div>' +
    '<div class="farm-dp-addr cl-name-row"><span class="cl-name-display">' + crmEsc(item['성명'] || '(이름없음)') + '</span><button type="button" class="cl-name-edit-btn" title="이름 수정">✏️</button></div>' +
    '<div class="farm-dp-sub2">' + crmEsc(item['전화번호'] || '') + ' · ' + formatCallDatetime_(item['통화일시']) + '</div>' +
    '<div class="farm-dp-memo cl-memo-display">' + crmEsc(item['메모'] || '(메모 없음)') + '</div>' +
    '<div class="cl-card-detail" style="display:none"></div>';

  card.addEventListener('click', (e) => {
    if (e.target.closest('.cl-detail-actions, .cl-reclassify, .cl-btn--toggle-transcript, .cl-btn--edit-memo, .cl-btn--edit-transcript, .cl-btn--toggle-reclassify, .cl-name-row')) return;
    toggleCardDetail_(card, item);
  });

  wireNameEditBtn_(card, item);

  return card;
}

/* 카드 안 이름(cl-name-row)을 클릭-편집 가능하게 함. 저장/취소 후 다시 표시 모드로 돌아가면
   펜 아이콘이 innerHTML로 새로 그려져서 이벤트가 날아가므로, 그때마다 이 함수를 다시 호출해서 재연결함. */
function wireNameEditBtn_(card, item) {
  const btn = card.querySelector('.cl-name-edit-btn');
  if (!btn) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    const nameRow = card.querySelector('.cl-name-row');
    if (nameRow.querySelector('input')) return; // 이미 편집 중
    const original = item['성명'] || '';

    nameRow.innerHTML =
      '<input type="text" class="cl-name-edit-input" value="' + crmEscAttr(original) + '" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--border);font-family:inherit;font-size:inherit;font-weight:inherit;" /> ' +
      '<button type="button" class="btn-soft cl-btn--save-name" style="height:28px;padding:0 10px;font-size:11.5px;">저장</button> ' +
      '<button type="button" class="btn-soft cl-btn--cancel-name" style="height:28px;padding:0 10px;font-size:11.5px;">취소</button>';
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    nameRow.style.gap = '6px';

    const backToDisplay = (name) => {
      nameRow.innerHTML = '<span class="cl-name-display">' + crmEsc(name || '(이름없음)') + '</span><button type="button" class="cl-name-edit-btn" title="이름 수정">✏️</button>';
      nameRow.style.display = ''; nameRow.style.alignItems = ''; nameRow.style.gap = '';
      wireNameEditBtn_(card, item);
    };

    nameRow.querySelector('.cl-btn--cancel-name').addEventListener('click', (ev) => {
      ev.stopPropagation();
      backToDisplay(original);
    });
    nameRow.querySelector('.cl-btn--save-name').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const newName = nameRow.querySelector('.cl-name-edit-input').value.trim();
      const saveBtn = nameRow.querySelector('.cl-btn--save-name');
      saveBtn.disabled = true; saveBtn.textContent = '저장 중...';
      try {
        const qs = 'sheetName=' + encodeURIComponent(item.sheetName) + '&rowIndex=' + encodeURIComponent(item.rowIndex) + '&name=' + encodeURIComponent(newName);
        const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=callUpdateName&' + qs, 20000);
        if (res && res.ok) {
          item['성명'] = newName;
          backToDisplay(newName);
          crmToast('이름을 수정했어요.');
        } else {
          crmToast('저장에 실패했어요. 다시 시도해 주세요.');
          saveBtn.disabled = false; saveBtn.textContent = '저장';
        }
      } catch (err) {
        crmToast('연결이 원활하지 않아요. 다시 시도해 주세요.');
        saveBtn.disabled = false; saveBtn.textContent = '저장';
      }
    });
  };
}

function formatCallDatetime_(raw) {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch (e) { return String(raw); }
}

/* ============================================================
   상세 패널
   ============================================================ */
function toggleCardDetail_(cardEl, item) {
  const detailEl = cardEl.querySelector('.cl-card-detail');
  const isOpen = detailEl.style.display !== 'none';
  if (isOpen) { detailEl.style.display = 'none'; return; }
  detailEl.style.display = '';
  detailEl.innerHTML = buildDetailHtml_(item);
  wireDetailActions_(detailEl, cardEl, item);
}

function buildDetailHtml_(item) {
  const status = parseCallMatchStatus_(item['CRM매칭']);
  const needsReclassify = (status.type === 'unmatched' || status.type === 'ambiguous'); // 이 상태면 재분류 박스를 처음부터 펼쳐서 보여줌
  const currentCat = CALL_LOG_SHEET_CAT_TO_CAT[item.category] || '';
  const existingCode = (status.type === 'matched' || status.type === 'reclassified') ? extractCallCode_(item['CRM매칭']) : '';
  const transcript = item['전사내용'] || '';
  const transcriptEditable = transcript.length > 0 && transcript.length <= CALL_LOG_TRANSCRIPT_EDIT_MAX;

  let html = '<div class="cl-edit-note" style="margin-bottom:10px;">CRM매칭: ' + crmEsc(item['CRM매칭'] || '(정보없음)') + '</div>';
  html += '<div class="cl-detail-topactions">';
  html += '<button class="btn-soft cl-btn--edit-memo" style="height:30px;padding:0 10px;font-size:12px;">✏️ 메모 수정</button>';
  html += '<button class="btn-soft cl-btn--toggle-transcript" style="height:30px;padding:0 10px;font-size:12px;">📄 전사 보기</button>';
  // 반영완료 여부와 무관하게 언제든 코드를 다시 고칠 수 있게 — needsReclassify가 아니어도(이미 매칭/재분류된 건도) 버튼은 항상 노출
  html += '<button class="btn-soft cl-btn--toggle-reclassify" style="height:30px;padding:0 10px;font-size:12px;">🔧 ' + (needsReclassify ? '재분류' : '코드 수정') + '</button>';
  html += '</div>';
  html += '<div class="cl-transcript-box" style="display:none">' + crmEsc(transcript || '(전사내용 없음)') + '</div>';
  html += '<div class="cl-transcript-edit-slot" style="display:none"></div>';

  if (item['녹음링크'] && /^https?:\/\//.test(item['녹음링크'])) {
    html += '<div class="cl-recording-row"><a class="cl-recording-link" href="' + crmEscAttr(item['녹음링크']) + '" target="_blank">🔊 녹음 파일 열기</a></div>';
  }

  html += '<div class="cl-detail-actions">';
  if (!item['반영여부']) {
    html += '<button class="btn-soft cl-btn--done" style="height:32px;padding:0 12px;font-size:12.5px;">반영완료 처리</button>';
  } else {
    html += '<span class="cl-edit-note">이미 반영완료 처리된 건이에요. 위 "코드 수정"으로 코드는 여전히 바꿀 수 있어요.</span>';
  }
  html += '</div>';

  html +=
    '<div class="cl-reclassify"' + (needsReclassify ? '' : ' style="display:none"') + '>' +
    '  <select class="cl-reclassify-select">' +
    CALL_LOG_CATEGORIES.map(cat =>
      '<option value="' + cat + '"' + (cat === currentCat ? ' selected' : '') + '>' + CALL_LOG_CAT_TO_SHEET_CAT[cat] + (cat === currentCat ? ' (현재)' : '') + '</option>'
    ).join('') +
    '  </select>' +
    '  <input class="cl-reclassify-code" type="text" value="' + crmEscAttr(existingCode) + '" placeholder="CRM코드(선택, 예: A0011)" />' +
    '  <button class="btn-soft cl-btn--reclassify" style="height:32px;padding:0 12px;font-size:12.5px;">' + (needsReclassify ? '재분류 확정' : '코드 다시 확정') + '</button>' +
    '</div>';

  html += '<input type="hidden" class="cl-transcript-editable-flag" value="' + (transcriptEditable ? '1' : '0') + '" />';

  return html;
}

function wireDetailActions_(detailEl, cardEl, item) {
  /* --- 전사 보기/숨기기 --- */
  const toggleBtn = detailEl.querySelector('.cl-btn--toggle-transcript');
  toggleBtn.addEventListener('click', () => {
    const box = detailEl.querySelector('.cl-transcript-box');
    const shown = box.style.display !== 'none';
    box.style.display = shown ? 'none' : '';
    toggleBtn.textContent = shown ? '📄 전사 보기' : '📄 전사 숨기기';
    if (!shown) attachTranscriptEditButton_(detailEl, item);
    else detailEl.querySelector('.cl-transcript-edit-slot').innerHTML = '';
  });

  /* --- 재분류/코드 수정 박스 펼치기·접기 (반영완료 여부와 무관하게 항상 가능) --- */
  const toggleReclassifyBtn = detailEl.querySelector('.cl-btn--toggle-reclassify');
  if (toggleReclassifyBtn) {
    toggleReclassifyBtn.addEventListener('click', () => {
      const box = detailEl.querySelector('.cl-reclassify');
      box.style.display = box.style.display === 'none' ? '' : 'none';
    });
  }

  /* --- 메모 수정 --- */
  const editMemoBtn = detailEl.querySelector('.cl-btn--edit-memo');
  editMemoBtn.addEventListener('click', () => {
    const memoDisplay = cardEl.querySelector('.cl-memo-display');
    if (memoDisplay.querySelector('textarea')) return; // 이미 편집 중
    const original = item['메모'] || '';
    memoDisplay.innerHTML =
      '<textarea class="cl-edit-textarea">' + crmEsc(original) + '</textarea>' +
      '<div><button class="btn-soft cl-btn--save-memo" style="height:28px;padding:0 10px;font-size:11.5px;">저장</button> ' +
      '<button class="btn-soft cl-btn--cancel-memo" style="height:28px;padding:0 10px;font-size:11.5px;">취소</button></div>';

    memoDisplay.querySelector('.cl-btn--cancel-memo').addEventListener('click', () => {
      memoDisplay.textContent = original || '(메모 없음)';
    });
    memoDisplay.querySelector('.cl-btn--save-memo').addEventListener('click', async () => {
      const newMemo = memoDisplay.querySelector('textarea').value;
      const saveBtn = memoDisplay.querySelector('.cl-btn--save-memo');
      saveBtn.disabled = true; saveBtn.textContent = '저장 중...';
      try {
        const qs = 'sheetName=' + encodeURIComponent(item.sheetName) + '&rowIndex=' + encodeURIComponent(item.rowIndex) + '&memo=' + encodeURIComponent(newMemo);
        const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=callUpdateMemo&' + qs, 20000);
        if (res && res.ok) {
          item['메모'] = newMemo;
          memoDisplay.textContent = newMemo || '(메모 없음)';
          crmToast('메모를 수정했어요.');
        } else {
          crmToast('저장에 실패했어요. 다시 시도해 주세요.');
        }
      } catch (e) {
        crmToast('연결이 원활하지 않아요. 다시 시도해 주세요.');
      }
    });
  });

  /* --- 반영완료 --- */
  const doneBtn = detailEl.querySelector('.cl-btn--done');
  if (doneBtn) {
    doneBtn.addEventListener('click', async () => {
      doneBtn.disabled = true; doneBtn.textContent = '처리 중...';
      try {
        const qs = 'sheetName=' + encodeURIComponent(item.sheetName) + '&rowIndex=' + encodeURIComponent(item.rowIndex);
        const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=callMarkDone&' + qs, 20000);
        if (res && res.ok) { crmToast('반영완료 처리했어요.'); fetchCallLogList_(); }
        else { crmToast('처리에 실패했어요. 다시 시도해 주세요.'); doneBtn.disabled = false; doneBtn.textContent = '반영완료 처리'; }
      } catch (e) {
        crmToast('연결이 원활하지 않아요. 다시 시도해 주세요.');
        doneBtn.disabled = false; doneBtn.textContent = '반영완료 처리';
      }
    });
  }

  /* --- 재분류 --- */
  const reclassifyBtn = detailEl.querySelector('.cl-btn--reclassify');
  if (reclassifyBtn) {
    reclassifyBtn.addEventListener('click', async () => {
      const select = detailEl.querySelector('.cl-reclassify-select');
      const codeInput = detailEl.querySelector('.cl-reclassify-code');
      const targetCategory = CALL_LOG_CAT_TO_SHEET_CAT[select.value];
      const crmCode = codeInput.value.trim();
      const isSameCategory = targetCategory === item.category;
      const confirmMsg = isSameCategory
        ? (item.category + ' 안에서 코드 "' + (crmCode || '(미입력)') + '"(으)로 확정할까요?')
        : (item.category + ' → ' + targetCategory + '(으)로 재분류할까요?\n녹음파일도 함께 이동됩니다.');

      if (!confirm(confirmMsg)) return;

      reclassifyBtn.disabled = true; reclassifyBtn.textContent = '처리 중...';
      try {
        const qs = [
          'sheetName=' + encodeURIComponent(item.sheetName),
          'rowIndex=' + encodeURIComponent(item.rowIndex),
          'targetCategory=' + encodeURIComponent(targetCategory),
          'crmCode=' + encodeURIComponent(crmCode),
          'recordingLink=' + encodeURIComponent(item['녹음링크'] || '')
        ].join('&');
        const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=callReclassify&' + qs, 20000);
        if (res && res.ok) { crmToast('재분류 완료했어요.'); fetchCallLogList_(); }
        else { crmToast('재분류에 실패했어요. 다시 시도해 주세요.'); reclassifyBtn.disabled = false; reclassifyBtn.textContent = '재분류 확정'; }
      } catch (e) {
        crmToast('연결이 원활하지 않아요. 다시 시도해 주세요.');
        reclassifyBtn.disabled = false; reclassifyBtn.textContent = '재분류 확정';
      }
    });
  }
}

/* 전사 보기를 켰을 때, 짧으면 "수정" 버튼을 붙여줌 (800자 초과면 안내 문구만) */
function attachTranscriptEditButton_(detailEl, item) {
  const slot = detailEl.querySelector('.cl-transcript-edit-slot');
  const editable = detailEl.querySelector('.cl-transcript-editable-flag').value === '1';
  slot.style.display = '';

  if (!editable) {
    slot.innerHTML = '<div class="cl-edit-note">전사 내용이 길어서 대시보드에서는 수정할 수 없어요. 구글시트에서 직접 고쳐주세요.</div>';
    return;
  }

  slot.innerHTML = '<button class="btn-soft cl-btn--edit-transcript" style="height:28px;padding:0 10px;font-size:11.5px;">✏️ 전사 수정</button>';
  slot.querySelector('.cl-btn--edit-transcript').addEventListener('click', () => {
    const box = detailEl.querySelector('.cl-transcript-box');
    const original = item['전사내용'] || '';
    box.innerHTML =
      '<textarea class="cl-edit-textarea" style="min-height:120px;">' + crmEsc(original) + '</textarea>' +
      '<div><button class="btn-soft cl-btn--save-transcript" style="height:28px;padding:0 10px;font-size:11.5px;">저장</button> ' +
      '<button class="btn-soft cl-btn--cancel-transcript" style="height:28px;padding:0 10px;font-size:11.5px;">취소</button></div>';

    box.querySelector('.cl-btn--cancel-transcript').addEventListener('click', () => {
      box.textContent = original || '(전사내용 없음)';
    });
    box.querySelector('.cl-btn--save-transcript').addEventListener('click', async () => {
      const newTranscript = box.querySelector('textarea').value;
      if (newTranscript.length > CALL_LOG_TRANSCRIPT_EDIT_MAX) {
        crmToast('너무 길어졌어요 (' + CALL_LOG_TRANSCRIPT_EDIT_MAX + '자 이내로 줄여주세요). 시트에서 직접 수정해 주세요.');
        return;
      }
      const saveBtn = box.querySelector('.cl-btn--save-transcript');
      saveBtn.disabled = true; saveBtn.textContent = '저장 중...';
      try {
        const qs = 'sheetName=' + encodeURIComponent(item.sheetName) + '&rowIndex=' + encodeURIComponent(item.rowIndex) + '&transcript=' + encodeURIComponent(newTranscript);
        const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=callUpdateTranscript&' + qs, 20000);
        if (res && res.ok) {
          item['전사내용'] = newTranscript;
          box.textContent = newTranscript || '(전사내용 없음)';
          crmToast('전사를 수정했어요.');
        } else {
          crmToast('저장에 실패했어요. 다시 시도해 주세요.');
        }
      } catch (e) {
        crmToast('연결이 원활하지 않아요. 다시 시도해 주세요.');
      }
    });
  });
}

/* ============================================================
   KPI 카드 (기존 4개 슬롯 재활용, 모드 해제 시 crmRenderStats()가 원복)
   ============================================================ */
function updateCallLogKpi_() {
  const unresolved = callLogRawList.filter(it => !it['반영여부']).length;
  const saleCount = callLogRawList.filter(it => it.category === '매도임대').length;
  const leadCount = callLogRawList.filter(it => it.category === '가망고객').length;
  const contractCount = callLogRawList.filter(it => it.category === '계약고객').length;

  const statToday = $('statToday'), statSale = $('statSale'), statLead = $('statLead'), statContract = $('statContract');
  if (statToday) statToday.textContent = unresolved + '건';
  if (statSale) statSale.textContent = saleCount + '건';
  if (statLead) statLead.textContent = leadCount + '건';
  if (statContract) statContract.textContent = contractCount + '건';

  const todayLabel = document.querySelector('#statTodayCard .stat-label');
  if (todayLabel) todayLabel.textContent = '통화 미반영';
}
