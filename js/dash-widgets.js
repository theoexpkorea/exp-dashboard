/* ============================================================
   theo 대시보드 — 공용 커스텀 드롭다운 / 캘린더 위젯
   (파밍서치 sortpick-btn / cal-scrim 패턴을 대시보드 톤으로 재구현)
   모든 페이지에서 <script src=".../js/dash-widgets.js"></script>로 로드해서
   window.DashUI.initSelect(...) / window.DashUI.openCalendar(...) 로 사용
   ============================================================ */

(function () {
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  /* ===== 커스텀 셀렉트 (native select 대체) =====
     btnEl: 트리거 버튼(.dash-picker-btn), popEl: 옵션 목록(.dash-select-pop)
     options: 문자열 배열, initial: 초기 선택값, onChange(value): 선택 시 콜백
     반환값: { get(), set(value) } */
  function initSelect(btnEl, popEl, options, initial, onChange) {
    const labelEl = btnEl.querySelector('[data-role="label"]') || btnEl;

    // 같은 버튼/팝업 쌍에 대해 리스너는 최초 1회만 부착한다.
    // (옵션이 동적으로 바뀌는 드롭다운은 폼을 열 때마다 initSelect가 다시 호출되는데,
    //  매번 addEventListener를 새로 붙이면 예전 리스너가 그대로 누적돼
    //  클릭 한 번에 열기/닫기가 여러 번 겹쳐 실행되면서 "안 열리는" 것처럼 보이는 버그가 있었음)
    let state = btnEl._dashSelectState;
    if (!state) {
      state = { options: [], current: initial, onChange: onChange };
      btnEl._dashSelectState = state;

      function renderPop() {
        popEl.innerHTML = state.options.map(opt =>
          '<div class="opt ' + (opt === state.current ? 'sel' : '') + '" data-val="' + opt + '">' +
            '<span>' + opt + '</span><span class="ck">✓</span>' +
          '</div>'
        ).join('');
      }
      function close() { btnEl.classList.remove('open'); popEl.classList.remove('open'); }
      function open() {
        document.querySelectorAll('.dash-select-pop.open').forEach(p => { if (p !== popEl) { p.classList.remove('open'); p.previousElementSibling && p.previousElementSibling.classList.remove('open'); } });
        renderPop();
        btnEl.classList.add('open'); popEl.classList.add('open');
      }

      btnEl.addEventListener('click', e => {
        e.stopPropagation();
        popEl.classList.contains('open') ? close() : open();
      });
      popEl.addEventListener('click', e => {
        const opt = e.target.closest('[data-val]'); if (!opt) return;
        state.current = opt.dataset.val;
        labelEl.textContent = state.current;
        close();
        if (state.onChange) state.onChange(state.current);
      });
      document.addEventListener('click', e => {
        if (!btnEl.contains(e.target) && !popEl.contains(e.target)) close();
      });
    }

    // 재호출 시(옵션/초기값/콜백이 바뀔 수 있음)엔 상태만 갱신하고 리스너는 재부착하지 않음
    state.options = options;
    state.current = initial;
    state.onChange = onChange;
    labelEl.textContent = state.current || '';

    return {
      get: () => state.current,
      set: v => { state.current = v; labelEl.textContent = v || ''; }
    };
  }

  /* ===== 캘린더 팝업 (싱글톤 오버레이, 페이지에 한 번만 주입) ===== */
  let overlay = null, gridEl = null, titleEl = null, prevBtn = null, nextBtn = null;
  let calY = 0, calM = 0, selDate = '', onPick = null, markedDates = null;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'dash-cal-overlay';
    overlay.innerHTML =
      '<div class="dash-cal-box">' +
        '<div class="dash-cal-head"><button type="button" data-nav="prev">‹</button><span class="title"></span><button type="button" data-nav="next">›</button></div>' +
        '<div class="dash-cal-grid"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    gridEl = overlay.querySelector('.dash-cal-grid');
    titleEl = overlay.querySelector('.title');
    overlay.querySelector('[data-nav="prev"]').addEventListener('click', () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCal(); });
    overlay.querySelector('[data-nav="next"]').addEventListener('click', () => { calM++; if (calM > 11) { calM = 0; calY++; } renderCal(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
    gridEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-date]'); if (!btn) return;
      selDate = btn.dataset.date;
      overlay.classList.remove('open');
      if (onPick) onPick(selDate);
    });
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() { const t = new Date(); return ymd(t.getFullYear(), t.getMonth(), t.getDate()); }

  function renderCal() {
    titleEl.textContent = calY + '년 ' + (calM + 1) + '월';
    const first = new Date(calY, calM, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(calY, calM + 1, 0).getDate();
    const daysInPrev = new Date(calY, calM, 0).getDate();
    const today = todayStr();

    let html = WD.map(w => '<div class="dash-cal-wd">' + w + '</div>').join('');
    for (let i = startDow - 1; i >= 0; i--) html += '<div class="dash-cal-day mute">' + (daysInPrev - i) + '</div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = ymd(calY, calM, d);
      const cls = ['dash-cal-day'];
      if (ds === today) cls.push('today');
      if (ds === selDate) cls.push('sel');
      if (markedDates && markedDates.has(ds)) cls.push('marked');
      html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + ds + '">' + d + '</button>';
    }
    const total = startDow + daysInMonth;
    const trailing = (7 - (total % 7)) % 7;
    for (let d = 1; d <= trailing; d++) html += '<div class="dash-cal-day mute">' + d + '</div>';
    gridEl.innerHTML = html;
  }

  /* baseDateStr: 'YYYY-MM-DD' 초기 선택값, callback(dateStr) 호출, marked: Set(선택적, 점 표시용 — 현재 미사용 여지) */
  function openCalendar(baseDateStr, callback, marked) {
    ensureOverlay();
    const base = baseDateStr ? new Date(baseDateStr + 'T00:00:00') : new Date();
    calY = base.getFullYear(); calM = base.getMonth();
    selDate = baseDateStr || '';
    onPick = callback;
    markedDates = marked || null;
    renderCal();
    overlay.classList.add('open');
  }

  /* ===== 시간 선택 팝업 (싱글톤 오버레이) =====
     baseTimeStr: 'HH:MM' 초기값, callback(timeStr) 호출 */
  let timeOverlay = null, hourCol = null, minCol = null, timeOnPick = null;
  let selHour = 0, selMin = 0;

  function ensureTimeOverlay() {
    if (timeOverlay) return;
    timeOverlay = document.createElement('div');
    timeOverlay.className = 'dash-time-overlay';
    timeOverlay.innerHTML =
      '<div class="dash-time-box">' +
        '<div class="dash-time-head"><span class="title">시간 선택</span><button type="button" data-role="close">✕</button></div>' +
        '<div class="dash-time-cols">' +
          '<div class="dash-time-col" data-col="h"></div>' +
          '<div class="dash-time-col" data-col="m"></div>' +
        '</div>' +
        '<div class="dash-time-foot"><button type="button" class="btn-solid" data-role="confirm">확인</button></div>' +
      '</div>';
    document.body.appendChild(timeOverlay);
    hourCol = timeOverlay.querySelector('[data-col="h"]');
    minCol = timeOverlay.querySelector('[data-col="m"]');

    let hh = '';
    for (let h = 0; h < 24; h++) hh += '<div class="dash-time-item" data-h="' + h + '">' + pad(h) + '</div>';
    hourCol.innerHTML = hh;
    let mm = '';
    for (let m = 0; m < 60; m += 5) mm += '<div class="dash-time-item" data-m="' + m + '">' + pad(m) + '</div>';
    minCol.innerHTML = mm;

    hourCol.addEventListener('click', e => {
      const it = e.target.closest('[data-h]'); if (!it) return;
      selHour = parseInt(it.dataset.h, 10);
      hourCol.querySelectorAll('.dash-time-item').forEach(el => el.classList.toggle('sel', el === it));
    });
    minCol.addEventListener('click', e => {
      const it = e.target.closest('[data-m]'); if (!it) return;
      selMin = parseInt(it.dataset.m, 10);
      minCol.querySelectorAll('.dash-time-item').forEach(el => el.classList.toggle('sel', el === it));
    });
    timeOverlay.querySelector('[data-role="close"]').addEventListener('click', () => timeOverlay.classList.remove('open'));
    timeOverlay.querySelector('[data-role="confirm"]').addEventListener('click', () => {
      timeOverlay.classList.remove('open');
      const val = pad(selHour) + ':' + pad(selMin);
      if (timeOnPick) timeOnPick(val);
    });
    timeOverlay.addEventListener('click', e => { if (e.target === timeOverlay) timeOverlay.classList.remove('open'); });
  }

  function openTimePicker(baseTimeStr, callback) {
    ensureTimeOverlay();
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(baseTimeStr || '');
    selHour = m ? Math.min(23, parseInt(m[1], 10)) : new Date().getHours();
    selMin = m ? (Math.round(parseInt(m[2], 10) / 5) * 5) % 60 : 0;
    timeOnPick = callback;
    hourCol.querySelectorAll('.dash-time-item').forEach(el => el.classList.toggle('sel', parseInt(el.dataset.h, 10) === selHour));
    minCol.querySelectorAll('.dash-time-item').forEach(el => el.classList.toggle('sel', parseInt(el.dataset.m, 10) === selMin));
    timeOverlay.classList.add('open');
    const selH = hourCol.querySelector('.sel'); if (selH) selH.scrollIntoView({ block: 'center' });
    const selM = minCol.querySelector('.sel'); if (selM) selM.scrollIntoView({ block: 'center' });
  }

  /* ===== native <select> 자동 래핑 (기존 페이지 JS를 안 건드리고 스타일만 교체) =====
     select 태그는 그대로 두고 화면에서만 숨긴 뒤, 그 위에 커스텀 버튼+팝업을 얹는다.
     선택 시 원본 select의 value를 갱신하고 change 이벤트를 그대로 발생시키므로
     기존 페이지의 저장 로직(예: $('rec-f-type').value)은 수정 없이 그대로 동작한다. */
  function wrapNativeSelect(selectEl) {
    if (!selectEl || selectEl.dataset.dashWrapped) return;
    selectEl.dataset.dashWrapped = '1';
    selectEl.classList.add('visually-hidden');

    const wrap = document.createElement('div');
    wrap.className = 'dash-picker-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-picker-btn';
    btn.innerHTML = '<span data-role="label"></span><span class="car">▾</span>';
    const pop = document.createElement('div');
    pop.className = 'dash-select-pop';
    wrap.appendChild(btn); wrap.appendChild(pop);
    selectEl.insertAdjacentElement('afterend', wrap);

    const options = Array.from(selectEl.options).map(o => o.textContent);
    const valueByLabel = {};
    Array.from(selectEl.options).forEach(o => { valueByLabel[o.textContent] = o.value; });
    const initialLabel = selectEl.selectedOptions[0] ? selectEl.selectedOptions[0].textContent : options[0];

    initSelect(btn, pop, options, initialLabel, label => {
      selectEl.value = valueByLabel[label];
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  function autoWrapSelects() {
    document.querySelectorAll('select[data-dash-select]').forEach(wrapNativeSelect);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoWrapSelects);
  } else {
    autoWrapSelects();
  }

  window.DashUI = { initSelect, openCalendar, todayStr, wrapNativeSelect, openTimePicker };
})();
