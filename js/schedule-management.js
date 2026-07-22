/* ============================================================
   theo 대시보드 — 일정관리 (js/schedule-management.js)
   매물장필터뷰 Apps Script에 새로 추가된 mode=scheduleList/scheduleCreate/
   scheduleUpdate/scheduleDelete를 사용합니다 (일정관리 탭: 날짜/시간/이벤트타입/제목/메모).
   공휴일은 고객관리·파밍현황과 동일한 '공휴일' 탭(mode=crmList의 holidays 필드)을 재사용.
   ============================================================ */

const SCHED_DATA_URL = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';
const SCHED_TYPES = ['교육', '미팅', '투어', '가계약', '계약', '중도금', '잔금', '행사'];
const SCHED_TYPE_CLASS = {
  '교육': 'sched-type-edu', '미팅': 'sched-type-meeting', '투어': 'sched-type-tour',
  '가계약': 'sched-type-preterm', '계약': 'sched-type-contract',
  '중도금': 'sched-type-midpay', '잔금': 'sched-type-balance', '행사': 'sched-type-event'
};

function $(id) { return document.getElementById(id); }
function schedToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}
function schedEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function schedPad(n) { return String(n).padStart(2, '0'); }
function schedYmd(y, m, d) { return y + '-' + schedPad(m + 1) + '-' + schedPad(d); }
function schedTodayStr() {
  const d = new Date();
  return schedYmd(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ===== JSONP ===== */
function schedJsonp(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cb = '__scheddash_cb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
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
async function schedJsonpRetry(url, timeoutMs) {
  try { return await schedJsonp(url, timeoutMs); }
  catch (e) { await new Promise(r => setTimeout(r, 800)); return await schedJsonp(url, timeoutMs); }
}
function schedBuildUrl(mode, params) {
  const p = Object.assign({ mode: mode }, params || {});
  const qs = Object.keys(p).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p[k] == null ? '' : p[k])).join('&');
  return SCHED_DATA_URL + '?' + qs;
}

/* ===== state ===== */
const schedToday = new Date();
let schedViewYear = schedToday.getFullYear();
let schedViewMonth = schedToday.getMonth();
let schedAllItems = [];
let schedScope = 'all';
let schedEventsByDate = {};
let schedHolidays = new Map(); // 'YYYY-MM-DD' -> 명칭

function schedScopeMatch(it) { return schedScope === 'all' || it.type === schedScope; }
function schedBucket() {
  schedEventsByDate = {};
  schedAllItems.filter(schedScopeMatch).forEach(it => {
    if (!it.date) return;
    if (!schedEventsByDate[it.date]) schedEventsByDate[it.date] = [];
    schedEventsByDate[it.date].push(it);
  });
  Object.keys(schedEventsByDate).forEach(k => {
    schedEventsByDate[k].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  });
}

/* ===== 로컬 캐시 ===== */
const SCHED_CACHE_KEY = 'theo_dashboard_sched_cache_v1';
function schedReadCache() {
  try { const raw = localStorage.getItem(SCHED_CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function schedWriteCache(items, holidays) {
  try { localStorage.setItem(SCHED_CACHE_KEY, JSON.stringify({ items: items || [], holidays: holidays ? Array.from(holidays.entries()) : [], savedAt: Date.now() })); } catch (e) {}
}

async function schedLoadData(silent) {
  if (!silent) $('calLoading').style.display = 'flex';
  try {
    const [listRes, crmRes] = await Promise.all([
      schedJsonpRetry(schedBuildUrl('scheduleList'), 20000),
      schedJsonpRetry(schedBuildUrl('crmList'), 20000).catch(() => null) // 공휴일만 필요 — 실패해도 일정 자체엔 지장 없음
    ]);
    if (listRes && listRes.items) {
      schedAllItems = listRes.items;
      if (crmRes && crmRes.holidays) {
        schedHolidays = new Map(crmRes.holidays.filter(h => h && h.date).map(h => [h.date, h.name || '']));
      }
      schedBucket();
      schedRenderCalendar();
      schedWriteCache(schedAllItems, schedHolidays);
      if (!silent) schedToast('불러오기 완료');
    } else if (!silent) {
      schedToast('불러오기 실패 — 네트워크를 확인해줘');
    }
  } catch (e) {
    schedToast('불러오기 실패 — 네트워크를 확인해줘');
  } finally {
    $('calLoading').style.display = 'none';
  }
}

/* ===== 스코프 탭 ===== */
$('scopeTabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-scope]'); if (!btn) return;
  schedScope = btn.dataset.scope;
  document.querySelectorAll('#scopeTabs .rec-filter-chip').forEach(b => b.classList.toggle('active', b === btn));
  schedBucket();
  schedRenderCalendar();
});

/* ===== 모바일 판별 ===== */
function schedIsMobile() { return window.matchMedia('(max-width: 760px)').matches; }
let __schedLastMobile = schedIsMobile();
let __schedResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(__schedResizeTimer);
  __schedResizeTimer = setTimeout(() => {
    const nowMobile = schedIsMobile();
    if (nowMobile !== __schedLastMobile) { __schedLastMobile = nowMobile; schedRenderCalendar(); }
  }, 150);
});

/* ===== 캘린더 렌더 ===== */
function schedRenderCalendar() {
  $('monthLabel').textContent = schedViewYear + '년 ' + (schedViewMonth + 1) + '월';
  const grid = $('calGrid');
  grid.innerHTML = '';

  const firstDay = new Date(schedViewYear, schedViewMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(schedViewYear, schedViewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(schedViewYear, schedViewMonth, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  let todayCount = 0, weekCount = 0, monthCount = 0;
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'farm-cal-cell';
    const col = i % 7;
    if (col === 0) cell.classList.add('sun');
    if (col === 6) cell.classList.add('sat');

    let dateNum, cellY, cellM, isOutside = false;
    if (i < startWeekday) {
      dateNum = daysInPrevMonth - startWeekday + i + 1;
      cellY = schedViewMonth === 0 ? schedViewYear - 1 : schedViewYear;
      cellM = schedViewMonth === 0 ? 11 : schedViewMonth - 1;
      isOutside = true;
    } else if (i >= startWeekday + daysInMonth) {
      dateNum = i - startWeekday - daysInMonth + 1;
      cellY = schedViewMonth === 11 ? schedViewYear + 1 : schedViewYear;
      cellM = schedViewMonth === 11 ? 0 : schedViewMonth + 1;
      isOutside = true;
    } else {
      dateNum = i - startWeekday + 1;
      cellY = schedViewYear; cellM = schedViewMonth;
    }
    if (isOutside) cell.classList.add('outside');

    const key = schedYmd(cellY, cellM, dateNum);
    const isToday = (cellY === schedToday.getFullYear() && cellM === schedToday.getMonth() && dateNum === schedToday.getDate());
    if (isToday) cell.classList.add('today');
    const holidayName = schedHolidays.get(key);
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

    const events = isOutside ? [] : (schedEventsByDate[key] || []);
    if (!isOutside) {
      const cellDate = new Date(cellY, cellM, dateNum);
      monthCount += events.length;
      if (isToday) todayCount = events.length;
      if (cellDate >= weekStart && cellDate <= weekEnd) weekCount += events.length;
    }

    if (schedIsMobile()) {
      if (events.length) {
        const dotRow = document.createElement('div');
        dotRow.className = 'farm-dot-row';
        const maxDots = 6;
        events.slice(0, maxDots).forEach(ev => {
          const dot = document.createElement('span');
          dot.className = 'sched-dot ' + (SCHED_TYPE_CLASS[ev.type] || '');
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
        pill.className = 'sched-pill ' + (SCHED_TYPE_CLASS[ev.type] || '');
        const label = (ev.time ? ev.time + ' ' : '') + (ev.title || ev.type);
        pill.textContent = label;
        pill.title = ev.type + ' · ' + label;
        cell.appendChild(pill);
      });
      if (events.length > maxShow) {
        const more = document.createElement('div');
        more.className = 'farm-more';
        more.textContent = '+' + (events.length - maxShow) + '개 더보기';
        cell.appendChild(more);
      }
    }

    cell.addEventListener('click', ((k, yy, mo, dd, evs) => () => schedOpenDayPanel(k, yy, mo, dd, evs))(key, cellY, cellM, dateNum, events));

    grid.appendChild(cell);
  }

  $('statToday').textContent = todayCount + '건';
  $('statWeek').textContent = weekCount + '건';
  $('statMonth').textContent = monthCount + '건';
}

/* ===== 일별 상세 패널 ===== */
const schedOverlay = $('overlay');
const schedDayPanel = $('dayPanel');
const schedWeekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
let schedPanelKey = null;

function schedOpenDayPanel(key, y, m, d, events) {
  schedPanelKey = key;
  const wd = schedWeekdayNames[new Date(y, m, d).getDay()];
  $('dpTitle').textContent = y + '년 ' + (m + 1) + '월 ' + d + '일 (' + wd + ')';
  $('dpSub').textContent = events.length ? events.length + '건의 일정' : '일정 없음';
  const body = $('dpBody');
  body.innerHTML = '';
  if (events.length === 0) {
    body.innerHTML = '<div class="farm-dp-empty">이 날짜에 등록된 일정이 없습니다.</div>';
  } else {
    events.forEach(ev => body.appendChild(schedBuildItemEl(ev)));
  }
  schedOverlay.classList.add('open');
  schedDayPanel.classList.add('open');
}
function schedCloseDayPanel() { schedOverlay.classList.remove('open'); schedDayPanel.classList.remove('open'); }
schedOverlay.addEventListener('click', () => { schedCloseDayPanel(); schedCloseForm(); });
$('dpClose').addEventListener('click', schedCloseDayPanel);
$('dpAdd').addEventListener('click', () => schedOpenForm(null, schedPanelKey));

function schedBuildItemEl(ev) {
  const item = document.createElement('div');
  item.className = 'farm-dp-item';
  const cls = SCHED_TYPE_CLASS[ev.type] || '';
  item.innerHTML =
    '<div class="farm-dp-item-top">' +
      '<span class="sched-tag ' + cls + '">' + schedEsc(ev.type) + '</span>' +
      (ev.time ? '<span class="sched-time-chip">' + schedEsc(ev.time) + '</span>' : '') +
      '<button type="button" class="cust-edit-btn" data-editbtn="1" aria-label="수정" style="margin-left:auto;">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="farm-dp-addr">' + schedEsc(ev.title || '(제목없음)') + '</div>' +
    (ev.memo ? '<div class="farm-dp-memo">' + schedEsc(ev.memo) + '</div>' : '');

  const editBtn = item.querySelector('[data-editbtn]');
  if (editBtn) editBtn.addEventListener('click', e => { e.stopPropagation(); schedOpenForm(ev); });
  return item;
}

/* ===== 등록/수정 모달 ===== */
const schedFormOverlay = $('formOverlay');
let schedEditItem = null; // null=등록, item객체=수정
let schedFormDate = '';

$('fDateBtn').addEventListener('click', () => {
  DashUI.openCalendar(schedFormDate, dateStr => {
    schedFormDate = dateStr;
    $('fDateLabel').textContent = dateStr;
  });
});

function schedOpenForm(existing, dateForNew) {
  schedEditItem = existing || null;
  $('formTitle').textContent = existing ? '일정 수정' : '일정 등록';
  $('formError').textContent = '';
  $('formDelete').classList.toggle('hidden', !existing);

  schedFormDate = existing ? existing.date : (dateForNew || schedTodayStr());
  $('fDateLabel').textContent = schedFormDate;
  $('fTime').value = existing ? (existing.time || '') : '';
  $('fType').value = existing ? (existing.type || SCHED_TYPES[0]) : SCHED_TYPES[0];
  $('fTitle').value = existing ? (existing.title || '') : '';
  $('fMemo').value = existing ? (existing.memo || '') : '';

  // 동적으로 열리는 select라 dash-widgets.js의 자동 스캔(DOMContentLoaded 1회성)을 못 받음 —
  // 폼을 열 때마다 수동으로 커스텀 드롭다운 래핑 (등록/수정 폼 공통 패턴, 고객관리와 동일)
  if (window.DashUI) DashUI.wrapNativeSelect($('fType'));

  schedCloseDayPanel();
  schedFormOverlay.classList.add('show');
}
function schedCloseForm() { schedFormOverlay.classList.remove('show'); }
$('formClose').addEventListener('click', schedCloseForm);
$('formCancel').addEventListener('click', schedCloseForm);
$('addBtn').addEventListener('click', () => { if (!$('addBtn').dataset.justDragged) schedOpenForm(null, null); });

$('formSave').addEventListener('click', async () => {
  const title = $('fTitle').value.trim();
  if (!title) { $('formError').textContent = '제목을 입력해 주세요.'; return; }
  const payload = {
    date: schedFormDate || schedTodayStr(),
    time: $('fTime').value || '',
    type: $('fType').value || SCHED_TYPES[0],
    title: title,
    memo: $('fMemo').value.trim()
  };

  const saveBtn = $('formSave');
  saveBtn.disabled = true; saveBtn.textContent = '저장 중...';
  try {
    if (schedEditItem) {
      payload.row = schedEditItem.row;
      const res = await schedJsonpRetry(schedBuildUrl('scheduleUpdate', payload), 15000);
      if (res && res.ok) {
        const it = schedAllItems.find(x => x.row === schedEditItem.row);
        if (it) Object.assign(it, payload);
        schedWriteCache(schedAllItems, schedHolidays);
        schedBucket(); schedRenderCalendar();
        schedCloseForm();
        schedToast('수정됐어요.');
      } else {
        $('formError').textContent = '수정에 실패했어요. 다시 시도해 주세요.';
      }
    } else {
      const res = await schedJsonpRetry(schedBuildUrl('scheduleCreate', payload), 15000);
      if (res && res.ok && res.item) {
        schedAllItems.push(res.item);
        schedWriteCache(schedAllItems, schedHolidays);
        schedBucket(); schedRenderCalendar();
        schedCloseForm();
        schedToast('등록됐어요.');
      } else {
        $('formError').textContent = '등록에 실패했어요. 다시 시도해 주세요.';
      }
    }
  } catch (e) {
    $('formError').textContent = '연결이 원활하지 않아요. 다시 시도해 주세요.';
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = '저장';
  }
});

$('formDelete').addEventListener('click', async () => {
  if (!schedEditItem) return;
  if (!confirm('이 일정을 삭제할까요? 되돌릴 수 없습니다.')) return;
  const delBtn = $('formDelete');
  delBtn.disabled = true;
  try {
    const res = await schedJsonpRetry(schedBuildUrl('scheduleDelete', { row: schedEditItem.row }), 15000);
    if (res && res.ok) {
      schedAllItems = schedAllItems.filter(x => x.row !== schedEditItem.row);
      schedWriteCache(schedAllItems, schedHolidays);
      schedBucket(); schedRenderCalendar();
      schedCloseForm();
      schedToast('삭제됐어요.');
    } else {
      schedToast('삭제에 실패했어요.');
    }
  } catch (e) {
    schedToast('연결이 원활하지 않아요.');
  } finally {
    delBtn.disabled = false;
  }
});

/* ===== FAB 드래그 이동 ===== */
(function () {
  const fab = $('addBtn');
  const POS_KEY = 'theo_dashboard_sched_fab_pos';
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
  const card = document.querySelector('.farm-cal-card');
  if (!card) return;
  let startX = 0, startY = 0, tracking = false;
  card.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  card.addEventListener('touchend', function (e) {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) $('nextBtn').click(); else $('prevBtn').click();
    }
  }, { passive: true });
})();

/* ===== 네비게이션 ===== */
$('prevBtn').addEventListener('click', () => { schedViewMonth--; if (schedViewMonth < 0) { schedViewMonth = 11; schedViewYear--; } schedRenderCalendar(); });
$('nextBtn').addEventListener('click', () => { schedViewMonth++; if (schedViewMonth > 11) { schedViewMonth = 0; schedViewYear++; } schedRenderCalendar(); });
$('refreshBtn').addEventListener('click', () => schedLoadData());
$('todayBtn').addEventListener('click', () => { schedViewYear = schedToday.getFullYear(); schedViewMonth = schedToday.getMonth(); schedRenderCalendar(); });

/* 캐시 우선 렌더 후 백그라운드 최신화 */
(function schedInit() {
  const cached = schedReadCache();
  if (cached) {
    schedAllItems = cached.items || [];
    schedHolidays = new Map((cached.holidays || []).filter(h => Array.isArray(h) && h[0]));
    schedBucket();
    schedRenderCalendar();
    schedLoadData(true);
  } else {
    schedLoadData();
  }
})();
