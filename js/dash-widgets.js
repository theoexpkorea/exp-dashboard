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
    let current = initial;
    const labelEl = btnEl.querySelector('[data-role="label"]') || btnEl;

    function renderPop() {
      popEl.innerHTML = options.map(opt =>
        '<div class="opt ' + (opt === current ? 'sel' : '') + '" data-val="' + opt + '">' +
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
      current = opt.dataset.val;
      labelEl.textContent = current;
      close();
      if (onChange) onChange(current);
    });
    document.addEventListener('click', e => {
      if (!btnEl.contains(e.target) && !popEl.contains(e.target)) close();
    });

    labelEl.textContent = current || '';

    return {
      get: () => current,
      set: v => { current = v; labelEl.textContent = v || ''; }
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

  window.DashUI = { initSelect, openCalendar, todayStr };
})();
