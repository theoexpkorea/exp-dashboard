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
  '계약완료': { bg: '#EDE7F6', fg: '#4527A0' }, '종료': { bg: '#F5F5F5', fg: '#9E9E9E' }
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
    const d = CRM_LEAD_TEMP_DAYS[status] || 30;
    return crmAddDays(crmTodayStr(), d);
  }
  return crmAddDays(crmTodayStr(), CRM_NEXT_DAYS_DEFAULT[cat] || 20);
}

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
    setTimeout(() => { if (!done) { cleanup(); reject(new Error('timeout')); } }, timeoutMs || 15000);
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
    crmToast('불러오기 실패 — 네트워크를 확인해줘');
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
  const todayCount = crmAllItems.filter(it => { const x = crmDisplayDDay(it); return x !== null && x <= 0; }).length;
  $('statToday').textContent = todayCount + '건';
  $('statSale').textContent = crmAllItems.filter(it => it.cat === 'SALE').length + '건';
  $('statLead').textContent = crmAllItems.filter(it => it.cat === 'LEAD').length + '건';
  $('statContract').textContent = crmAllItems.filter(it => it.cat === 'CONTRACT').length + '건';
}
$('statGrid').addEventListener('click', e => {
  if (e.target.closest('#statTodayCard')) {
    crmOpenTodayPanel();
  }
});

/* ===== 일별 상세 패널 ===== */
const crmOverlay = $('overlay');
const crmDayPanel = $('dayPanel');
const crmWeekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
let crmPanelKey = null, crmPanelYmd = [0, 0, 0];
let crmPanelMode = 'date'; // 'date' | 'today' — 저장 후 패널을 어떤 기준으로 다시 그릴지 구분

function crmOpenDayPanel(key, y, m, d, events) {
  crmPanelMode = 'date';
  crmPanelKey = key;
  crmPanelYmd = [y, m, d];
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
  const list = crmAllItems
    .filter(it => { const x = crmDisplayDDay(it); return x !== null && x <= 0; })
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
function crmCloseDayPanel() { crmOverlay.classList.remove('open'); crmDayPanel.classList.remove('open'); }
crmOverlay.addEventListener('click', () => { crmCloseDayPanel(); crmCloseForm(); });
$('dpClose').addEventListener('click', crmCloseDayPanel);

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
  const telHtml = ev.tel ? ' · <a href="tel:' + ev.tel + '">' + crmEsc(ev.tel) + '</a>' : '';

  let noteHtml = '';
  if (ev.cat === 'SALE') {
    const parts = [ev.bldg, ev.addr].filter(Boolean);
    if (parts.length) noteHtml = '<div class="farm-dp-sub2">' + crmEsc(parts.join(' · ')) + '</div>';
  } else if (ev.cat === 'LEAD' && ev.remark) {
    noteHtml = '<div class="farm-dp-sub2">' + crmEsc(ev.remark) + '</div>';
  }
  // 계약고객은 exp-crm과 동일하게 비고를 표시하지 않음

  const sc = crmStatusColor(ev.cat, ev.status);
  const statusStyle = sc ? ' style="background:' + sc.bg + ';color:' + sc.fg + '"' : '';

  const isDone = crmIsDoneToday(ev);
  const statusOpts = crmStatusOptions[ev.cat] || [];
  const editIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  item.innerHTML =
    '<div class="farm-dp-item-top">' +
      '<div class="cust-tags-left">' +
        '<span class="cust-tag cat-' + ev.cat + '">' + CRM_CAT_LABEL[ev.cat] + '</span>' +
        (ev.status ? '<span class="cust-status-tag"' + statusStyle + '>' + crmEsc(ev.status) + '</span>' : '') +
      '</div>' +
      '<div class="cust-tags-right">' +
        '<button type="button" class="cust-edit-btn" data-editbtn="1" aria-label="정보 수정">' + editIcon + '</button>' +
        (isDone ? '<span class="cust-dday-badge done">오늘 처리완료</span>' : crmDDayBadge(ev.nextContact)) +
      '</div>' +
    '</div>' +
    '<div class="cust-name-row">' + nameHtml + '</div>' +
    '<div class="cust-sub-row">' + crmEsc(subText) + telHtml + '</div>' +
    noteHtml +
    '<div class="farm-dp-specs">' +
      '<span>last <b>' + (ev.lastContact || '-') + '</b></span>' +
      '<span>next <b>' + (ev.nextContact || '-') + '</b></span>' +
    '</div>' +
    '<button type="button" class="cust-done-btn' + (isDone ? ' done' : '') + '" data-toggle="' + key + '">' + (isDone ? '연락완료' : '연락예정') + '</button>' +
    '<div class="cust-contact-panel" id="panel_' + key + '">' +
      '<div class="rec-field"><label>상태</label><select id="sel_' + key + '" data-dash-select>' +
        statusOpts.map(o => '<option value="' + crmEscAttr(o) + '"' + (o === ev.status ? ' selected' : '') + '>' + crmEsc(o) + '</option>').join('') +
      '</select></div>' +
      '<div class="cust-contact-preview" id="preview_' + key + '">다음 연락일은 저장하면 <b>' + crmEstimateNext(ev.cat, ev.status) + '</b>(으)로 자동 계산돼요.</div>' +
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
      if (prev) prev.innerHTML = '다음 연락일은 저장하면 <b>' + crmEstimateNext(ev.cat, selectEl.value) + '</b>(으)로 자동 계산돼요.';
    });
  }

  const editBtn = item.querySelector('[data-editbtn]');
  if (editBtn) editBtn.addEventListener('click', e => { e.stopPropagation(); crmOpenEditForm(ev); });

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

  const url = CRM_DATA_URL + '?mode=crmUpdate&sheet=' + encodeURIComponent(cat)
    + '&row=' + encodeURIComponent(row)
    + '&lastDate=' + encodeURIComponent(crmTodayStr())
    + (memoVal ? '&memo=' + encodeURIComponent(memoVal) : '')
    + (statusVal ? '&status=' + encodeURIComponent(statusVal) : '');

  btnEl.disabled = true; btnEl.textContent = '저장 중...';
  try {
    const res = await crmJsonpRetry(url, 15000);
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
  $('formTitle').textContent = '고객 등록';
  $('formError').textContent = '';
  $('fCatSeg').style.display = '';
  $('fCatSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === 'SALE'));
  crmBuildForm();
  crmFormOverlay.classList.add('show');
}
function crmOpenEditForm(item) {
  crmEditItem = item;
  crmFormCat = item.cat;
  $('formTitle').textContent = '정보 수정';
  $('formError').textContent = '';
  $('fCatSeg').style.display = 'none';
  crmBuildForm();
  crmFormOverlay.classList.add('show');
}
function crmCloseForm() { crmFormOverlay.classList.remove('show'); }
$('formClose').addEventListener('click', crmCloseForm);
$('formCancel').addEventListener('click', crmCloseForm);
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
    const payload = { sheet: cat, name: name, tel: tel, baseDate: crmFormBaseDate || crmTodayStr(), status: status };
    if (cat === 'SALE') {
      payload.id = crmFv('f_id');
    } else {
      const idVal = crmFv('f_id');
      if (!idVal) { $('formError').textContent = '고객번호를 입력해 주세요.'; saveBtn.disabled = false; saveBtn.textContent = '저장'; return; }
      payload.id = idVal;
    }
    if (cat === 'LEAD') { payload.name2 = crmFv('f_name2'); payload.remark = crmFv('f_remark'); }
    if (cat === 'CONTRACT') { payload.remark = crmFv('f_remark'); }
    const memoVal = crmFv('f_memo');
    if (memoVal) payload.memoSet = memoVal;

    const qs = Object.keys(payload).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(payload[k])).join('&');
    try {
      const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=crmCreate&' + qs, 15000);
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
    if (cat === 'CONTRACT') { payload.remark = crmFv('f_remark'); }
    payload.memoSet = crmFv('f_memo');

    const qs = Object.keys(payload).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(payload[k])).join('&');
    try {
      const res = await crmJsonpRetry(CRM_DATA_URL + '?mode=crmUpdate&' + qs, 15000);
      if (res && res.ok) {
        const it = crmAllItems.find(x => x.cat === cat && x.row === row);
        if (it) {
          it.name = name; it.tel = tel;
          if (idVal) it.id = idVal;
          if (status) it.status = status;
          if (crmFormBaseDate) it.baseDate = crmFormBaseDate;
          it.memo = payload.memoSet;
          if (cat === 'LEAD') { it.name2 = payload.name2; it.remark = payload.remark; }
          if (cat === 'CONTRACT') { it.remark = payload.remark; }
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
$('todayBtn').addEventListener('click', () => { crmViewYear = crmToday.getFullYear(); crmViewMonth = crmToday.getMonth(); crmRenderCalendar(); });

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
})();
