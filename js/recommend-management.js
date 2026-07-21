/* ============================================================
   추천매물(recommend-management) 페이지
   - 고객 탭 + 추천멘트 탭을 구글시트에서 읽어와 목록/진행현황 표시
   - CRM식 등록/수정 모달로 두 탭을 함께 저장(추천멘트는 접속코드 기준 통째로 재작성)
   - 카톡전송 주소 복사 (exp-client 접속코드 링크)
   ============================================================ */

var CLIENT_BASE_URL = 'https://theoexpkorea.github.io/exp-client/';

var recState = {
  clients: [],
  notes: [],       // [{row, access, id, note}]
  filter: 'all',   // all | active | ended
  q: ''
};

function serverUrl2_() {
  return (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) ? DASHBOARD_LOCK.appsScriptUrl : null;
}

/* ---------------- 데이터 로드 ---------------- */

function loadRecommendList() {
  var url = serverUrl2_();
  if (!url || typeof fetchJsonp !== 'function') return;
  var listEl = document.getElementById('rec-tbody');
  if (listEl) listEl.innerHTML = '<tr><td colspan="5" class="rec-empty">불러오는 중…</td></tr>';

  fetchJsonp(url + '?mode=recommendList').then(function (res) {
    recState.clients = (res && res.clients) || [];
    recState.notes = (res && res.notes) || [];
    renderRecommend();
  }).catch(function () {
    if (listEl) listEl.innerHTML = '<tr><td colspan="5" class="rec-empty">불러오지 못했습니다. 새로고침 해주세요.</td></tr>';
  });
}

function notesForAccess(access) {
  return recState.notes.filter(function (n) { return n.access === access; });
}

/* ---------------- 진행현황 카드 ---------------- */

function renderRecommendKpi() {
  var total = recState.clients.length;
  var active = recState.clients.filter(function (c) { return !c.ended; }).length;
  var totalEl = document.getElementById('rec-kpi-total');
  var activeEl = document.getElementById('rec-kpi-active');
  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
}

/* ---------------- 목록 렌더 ---------------- */

function matchesFilter(c) {
  if (recState.filter === 'active') return !c.ended;
  if (recState.filter === 'ended') return c.ended;
  return true;
}
function matchesSearch(c) {
  if (!recState.q) return true;
  var q = recState.q.toLowerCase();
  return (c.name || '').toLowerCase().indexOf(q) >= 0 ||
    (c.access || '').toLowerCase().indexOf(q) >= 0 ||
    (c.code || '').toLowerCase().indexOf(q) >= 0;
}

function idCount(c) {
  return (c.ids || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).length;
}

function renderRecommend() {
  renderRecommendKpi();

  var rows = recState.clients.filter(matchesFilter).filter(matchesSearch);
  var tbody = document.getElementById('rec-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="rec-empty">조건에 맞는 고객이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function (c) {
    var statusHtml = c.ended
      ? '<span class="rec-status-pill ended">종료</span>'
      : '<span class="rec-status-pill active">진행중</span>';
    return '' +
      '<tr>' +
        '<td>' +
          '<div class="rec-name">' + escapeHtml(c.name || '(이름없음)') + '</div>' +
          '<div class="rec-access">' + escapeHtml(c.access) + (c.type ? ' · ' + escapeHtml(c.type) : '') + '</div>' +
        '</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td><span class="rec-count-badge">' + idCount(c) + '건</span></td>' +
        '<td>' + (c.mapUrl ? '<span class="rec-count-badge">연결됨</span>' : '<span class="rec-count-badge">-</span>') + '</td>' +
        '<td>' +
          '<div class="rec-row-actions">' +
            '<button class="rec-icon-btn" data-copy="' + escapeHtml(c.access) + '" title="카톡전송 주소 복사">' + kakaoIconSvg() + '</button>' +
            '<button class="rec-icon-btn" data-edit="' + c.row + '" title="수정">' + editIconSvg() + '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join('');

  Array.prototype.forEach.call(tbody.querySelectorAll('[data-edit]'), function (btn) {
    btn.addEventListener('click', function () {
      var row = parseInt(btn.getAttribute('data-edit'), 10);
      var client = recState.clients.find(function (c) { return c.row === row; });
      if (client) openRecModal(client);
    });
  });
  Array.prototype.forEach.call(tbody.querySelectorAll('[data-copy]'), function (btn) {
    btn.addEventListener('click', function () {
      copyKakaoLink(btn.getAttribute('data-copy'), btn);
    });
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ---------------- 카톡전송 주소 복사 ---------------- */

function copyKakaoLink(access, btnEl) {
  if (!access) return;
  var url = CLIENT_BASE_URL + '?id=' + encodeURIComponent(access);
  var done = function () {
    showRecToast('링크를 복사했어요');
    if (btnEl) {
      btnEl.classList.add('copy-flash');
      setTimeout(function () { btnEl.classList.remove('copy-flash'); }, 900);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy_(url, done); });
  } else {
    fallbackCopy_(url, done);
  }
}
function fallbackCopy_(text, cb) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); cb(); } catch (e) { /* 무시 */ }
  document.body.removeChild(ta);
}

var toastTimer = null;
function showRecToast(msg) {
  var el = document.getElementById('rec-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
}

/* ---------------- 등록/수정 모달 ---------------- */

var recNoteRowSeq = 0;

function openRecModal(client) {
  var overlay = document.getElementById('rec-modal-overlay');
  var titleEl = document.getElementById('rec-modal-title');
  var errEl = document.getElementById('rec-modal-error');
  errEl.textContent = '';

  document.getElementById('rec-f-row').value = client ? client.row : '';
  document.getElementById('rec-f-code').value = client ? client.code : '';
  document.getElementById('rec-f-name').value = client ? client.name : '';
  document.getElementById('rec-f-access').value = client ? client.access : '';
  document.getElementById('rec-f-type').value = client ? (client.type || '중개사') : '중개사';
  document.getElementById('rec-f-map').value = client ? client.mapUrl : '';
  document.getElementById('rec-f-ended').checked = client ? !!client.ended : false;
  document.getElementById('rec-f-hideTrade').checked = client ? !!client.hideTrade : false;
  document.getElementById('rec-f-hideProposal').checked = client ? !!client.hideProposal : false;
  document.getElementById('rec-f-hideEum').checked = client ? !!client.hideEum : false;
  document.getElementById('rec-f-hideSemas').checked = client ? !!client.hideSemas : false;
  document.getElementById('rec-f-hideTradeReport').checked = client ? !!client.hideTradeReport : false;

  titleEl.textContent = client ? '고객 정보 수정' : '추천매물 등록';
  document.getElementById('rec-delete-btn').classList.toggle('hidden', !client);

  var notesWrap = document.getElementById('rec-notes-list');
  notesWrap.innerHTML = '';
  var existingNotes = client ? notesForAccess(client.access) : [];
  if (existingNotes.length) {
    existingNotes.forEach(function (n) { addNoteRow(n.id, n.note); });
  } else {
    addNoteRow('', '');
  }

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeRecModal() {
  document.getElementById('rec-modal-overlay').classList.remove('show');
  document.body.style.overflow = '';
}

function addNoteRow(id, note) {
  recNoteRowSeq++;
  var wrap = document.getElementById('rec-notes-list');
  var row = document.createElement('div');
  row.className = 'rec-note-row';
  row.dataset.seq = recNoteRowSeq;
  row.innerHTML =
    '<input type="text" class="note-id" placeholder="매물번호" value="' + escapeHtml(id || '') + '" autocomplete="off" data-lpignore="true" />' +
    '<textarea class="note-text" placeholder="추천 멘트">' + escapeHtml(note || '') + '</textarea>' +
    '<button type="button" class="rec-note-del" title="삭제">' + trashIconSvg() + '</button>';
  row.querySelector('.rec-note-del').addEventListener('click', function () { row.remove(); });
  wrap.appendChild(row);
}

function collectNotes() {
  var rows = document.querySelectorAll('#rec-notes-list .rec-note-row');
  var out = [];
  rows.forEach(function (row) {
    var id = row.querySelector('.note-id').value.trim();
    var note = row.querySelector('.note-text').value.trim();
    if (id) out.push({ id: id, note: note });
  });
  return out;
}

function saveRecClient() {
  var errEl = document.getElementById('rec-modal-error');
  var access = document.getElementById('rec-f-access').value.trim();
  var name = document.getElementById('rec-f-name').value.trim();
  if (!access) { errEl.textContent = '접속코드는 필수입니다.'; return; }
  if (!name) { errEl.textContent = '고객명(표시 이름)은 필수입니다.'; return; }

  var notes = collectNotes();
  var ids = notes.map(function (n) { return n.id; }).join(',');

  var payload = {
    mode: 'recommendClientSave',
    row: document.getElementById('rec-f-row').value || '',
    code: document.getElementById('rec-f-code').value.trim(),
    name: name,
    ids: ids,
    mapUrl: document.getElementById('rec-f-map').value.trim(),
    type: document.getElementById('rec-f-type').value,
    access: access,
    ended: document.getElementById('rec-f-ended').checked,
    hideTrade: document.getElementById('rec-f-hideTrade').checked,
    hideProposal: document.getElementById('rec-f-hideProposal').checked,
    hideEum: document.getElementById('rec-f-hideEum').checked,
    hideSemas: document.getElementById('rec-f-hideSemas').checked,
    hideTradeReport: document.getElementById('rec-f-hideTradeReport').checked,
    notes: notes
  };

  var url = serverUrl2_();
  if (!url) { errEl.textContent = '서버 주소를 찾을 수 없습니다.'; return; }

  var saveBtn = document.getElementById('rec-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중…';

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function (res) { return res.json(); }).then(function (res) {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
    if (res && res.ok) {
      closeRecModal();
      showRecToast('저장했어요');
      loadRecommendList();
    } else if (res && res.error === 'dup_access') {
      errEl.textContent = '이미 사용 중인 접속코드입니다.';
    } else {
      errEl.textContent = '저장에 실패했습니다. 다시 시도해주세요.';
    }
  }).catch(function () {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
    errEl.textContent = '서버에 연결할 수 없습니다.';
  });
}

function deleteRecClient() {
  var row = document.getElementById('rec-f-row').value;
  var access = document.getElementById('rec-f-access').value.trim();
  if (!row) return;
  if (!confirm('이 고객 링크를 삭제할까요? 되돌릴 수 없습니다.')) return;

  var url = serverUrl2_();
  if (!url) return;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ mode: 'recommendClientDelete', row: row, access: access })
  }).then(function (res) { return res.json(); }).then(function (res) {
    if (res && res.ok) {
      closeRecModal();
      showRecToast('삭제했어요');
      loadRecommendList();
    } else {
      alert('삭제에 실패했습니다.');
    }
  }).catch(function () { alert('서버에 연결할 수 없습니다.'); });
}

/* ---------------- 드래그 가능한 등록 FAB ---------------- */

function setupRecFab() {
  var fab = document.getElementById('rec-fab');
  if (!fab) return;

  var margin = 16;
  fab.style.right = margin + 'px';
  fab.style.bottom = (margin + 12) + 'px';

  var dragging = false;
  var moved = false;
  var startX, startY, startRight, startBottom;

  fab.addEventListener('pointerdown', function (e) {
    dragging = true;
    moved = false;
    fab.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    var rect = fab.getBoundingClientRect();
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;
  });
  fab.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    var newRight = clamp_(startRight - dx, margin, window.innerWidth - fab.offsetWidth - margin);
    var newBottom = clamp_(startBottom - dy, margin, window.innerHeight - fab.offsetHeight - margin);
    fab.style.right = newRight + 'px';
    fab.style.bottom = newBottom + 'px';
  });
  fab.addEventListener('pointerup', function () {
    dragging = false;
    if (!moved) openRecModal(null);
  });
}
function clamp_(v, min, max) { return Math.max(min, Math.min(max, v)); }

/* ---------------- SVG icons ---------------- */

function kakaoIconSvg() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/><path d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7-.2.9-.9 3.1-1 3.5-.1.5.2.5.4.4.2-.1 2.9-2 4.1-2.8.6.1 1.2.1 1.8.1 5.5 0 10-3.6 10-8s-4.5-8-10-8Z"/></svg>';
}
function editIconSvg() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
}
function trashIconSvg() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
}
function plusIconSvg() {
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
}

/* ---------------- 부팅 ---------------- */

document.addEventListener('DOMContentLoaded', function () {
  loadRecommendList();
  setupRecFab();

  document.getElementById('rec-search').addEventListener('input', function (e) {
    recState.q = e.target.value.trim();
    renderRecommend();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.rec-filter-chip'), function (chip) {
    chip.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.rec-filter-chip'), function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      recState.filter = chip.getAttribute('data-filter');
      renderRecommend();
    });
  });

  document.getElementById('rec-modal-close').addEventListener('click', closeRecModal);
  document.getElementById('rec-modal-overlay').addEventListener('click', function (e) {
    if (e.target.id === 'rec-modal-overlay') closeRecModal();
  });
  document.getElementById('rec-cancel-btn').addEventListener('click', closeRecModal);
  document.getElementById('rec-save-btn').addEventListener('click', saveRecClient);
  document.getElementById('rec-delete-btn').addEventListener('click', deleteRecClient);
  document.getElementById('rec-add-note-btn').addEventListener('click', function () { addNoteRow('', ''); });
});
