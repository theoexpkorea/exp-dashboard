/* ============================================================
   매물현황 페이지 — CSV 반자동 연동 (셀좌표 매핑)
   엑셀 대시보드 시트를 CSV로 export → 업로드 → 파싱 → localStorage 저장 → 렌더
   ============================================================ */

var STORAGE_KEY = 'theo_dashboard_maemul_csv_v1';

/* 잡지/신문 스타일 — 절제된 톤의 멀티 팔레트 (도넛용 순환 팔레트 + 섹션별 고유색) */
var PALETTE = ['#2746E6', '#C2694A', '#4C8577', '#C99A2E', '#5B6B8C', '#8C4358', '#2D8C8C', '#946A48'];
var CHART_COLORS = {
  newListings: '#C2694A',   // terracotta
  adChannels: '#4C8577',    // sage
  newAds: '#C99A2E',        // mustard
  selfContract: '#8C4358',  // wine
  region: '#5B6B8C',        // slate
  monthly: '#2746E6'        // brand navy
};

function get_(rows, r, c) {
  var row = rows[r];
  if (!row) return '';
  var v = row[c];
  return v === undefined || v === null ? '' : String(v).trim();
}
function num_(v) {
  var n = parseInt(String(v || '').replace(/[^0-9\-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}
function pairList_(rows, startRow, endRow, nameCol, valueCol) {
  var out = [];
  for (var r = startRow; r <= endRow; r++) {
    var name = get_(rows, r, nameCol);
    if (!name) continue;
    out.push({ name: name, value: num_(get_(rows, r, valueCol)) });
  }
  return out;
}

function parseMaemulCsv(rows) {
  var data = {};

  data.baseDate = get_(rows, 2, 1).replace(/기준/, '').trim();

  data.kpi = {
    activeListings: num_(get_(rows, 5, 10)),
    vacancies: num_(get_(rows, 5, 13)),
    newListingsMonth: num_(get_(rows, 8, 10)),
    newAdsMonth: num_(get_(rows, 8, 13)),
    totalLeads: num_(get_(rows, 11, 10)),
    newLeadsMonth: num_(get_(rows, 11, 13))
  };

  // 매물 현황 요약 (rows 6-17, cols 1-5) + 합계(row18)
  var statusRows = [];
  for (var r = 6; r <= 17; r++) {
    var name = get_(rows, r, 1);
    if (!name) continue;
    statusRows.push({
      name: name,
      active: num_(get_(rows, r, 2)),
      available: num_(get_(rows, r, 3)),
      negotiating: num_(get_(rows, r, 4)),
      done: num_(get_(rows, r, 5))
    });
  }
  data.statusSummary = {
    rows: statusRows,
    total: {
      active: num_(get_(rows, 18, 2)),
      available: num_(get_(rows, 18, 3)),
      negotiating: num_(get_(rows, 18, 4)),
      done: num_(get_(rows, 18, 5))
    }
  };

  // 공실 현황 (rows 6-17, cols 7-8) + 합계(row18)
  var vacRows = [];
  for (var r2 = 6; r2 <= 17; r2++) {
    var vname = get_(rows, r2, 7);
    if (!vname) continue;
    vacRows.push({ name: vname, value: num_(get_(rows, r2, 8)) });
  }
  data.vacancy = { rows: vacRows, total: num_(get_(rows, 18, 8)) };

  // 거래구분별 건수 (rows 22-25, cols 7-8)
  data.dealType = pairList_(rows, 22, 25, 7, 8);

  // 매물구분 (rows 22-24, cols 4-5)
  data.listingType = pairList_(rows, 22, 24, 4, 5);

  // 광고 현황 채널별 (rows 22-27, cols 1-2)
  data.adChannels = pairList_(rows, 22, 27, 1, 2);

  // 자기계약 누적 (rows 46-57, cols 1-2) + 합계(row58)
  data.selfContract = {
    rows: pairList_(rows, 46, 57, 1, 2),
    total: num_(get_(rows, 58, 2))
  };

  // 신규 등록 매물종류별 (rows 46-57, cols 4-5) + 합계(row58)
  data.newListingsByType = {
    rows: pairList_(rows, 46, 57, 4, 5),
    total: num_(get_(rows, 58, 5))
  };

  // 만기 임박 (rows 31-33, cols 4-5)
  data.expiring = pairList_(rows, 31, 33, 4, 5);

  // 지역별 매물 현황 (rows 62-69, cols 1-2 및 4-5)
  var regions = [];
  for (var r3 = 62; r3 <= 69; r3++) {
    var n1 = get_(rows, r3, 1);
    if (n1) regions.push({ name: n1, value: num_(get_(rows, r3, 2)) });
    var n2 = get_(rows, r3, 4);
    if (n2) regions.push({ name: n2, value: num_(get_(rows, r3, 5)) });
  }
  data.regions = regions;

  // 월별 신규 등록 추이 (row72=월, row73=건수, cols 2-13)
  var months = [], counts = [];
  for (var c = 2; c <= 13; c++) {
    var m = get_(rows, 72, c);
    if (!m) continue;
    months.push(m);
    counts.push(num_(get_(rows, 73, c)));
  }
  data.monthly = { months: months, counts: counts };

  // 이번 달 신규 광고 종류별 (rows 77-88, cols 0-1 — 이 블록만 열 오프셋이 다름)
  data.newAdsByType = pairList_(rows, 77, 88, 0, 1);

  return data;
}

function saveData_(data, uploadedAt) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    data: data,
    uploadedAt: uploadedAt || new Date().toISOString()
  }));
}
function loadData_() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/* ---------------- 기기 간 동기화 (매물뷰/CRM과 동일한 Apps Script 프로젝트 재사용) ----------------
   업로드 시: localStorage(즉시) + 서버(다른 기기용) 둘 다 저장
   접속 시: localStorage로 즉시 표시 → 백그라운드로 서버 최신값 확인 후 있으면 교체 */
function serverUrl_() {
  return (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) ? DASHBOARD_LOCK.appsScriptUrl : null;
}

function setSyncStatus_(text, isError) {
  var el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--text-secondary)';
}

function pushToServer_(data, uploadedAt) {
  var url = serverUrl_();
  if (!url) return;
  setSyncStatus_('다른 기기로 동기화 중…');
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ mode: 'saveMaemulStatus', data: data, uploadedAt: uploadedAt })
  }).then(function (res) { return res.json(); }).then(function (res) {
    if (res && res.ok) { setSyncStatus_('다른 기기에도 동기화됨'); }
    else { setSyncStatus_('동기화 실패 — 이 기기에만 저장됨', true); }
  }).catch(function () {
    setSyncStatus_('동기화 실패 — 이 기기에만 저장됨 (인터넷 연결 확인)', true);
  });
}

function pullFromServer_() {
  var url = serverUrl_();
  if (!url || typeof fetchJsonp !== 'function') return;
  fetchJsonp(url + '?mode=getMaemulStatus').then(function (res) {
    if (!res || !res.data) return;
    var local = loadData_();
    var serverIsNewer = !local || !local.uploadedAt || new Date(res.uploadedAt) > new Date(local.uploadedAt);
    if (serverIsNewer) {
      saveData_(res.data, res.uploadedAt);
      showContent_(loadData_());
    }
  }).catch(function () { /* 서버 응답 없으면 로컬 캐시로 계속 사용 */ });
}

/* ---------------- Rendering ---------------- */

function fmtUploadedAt_(iso) {
  var d = new Date(iso);
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' 업로드';
}

var KPI_ICONS = {
  activeListings: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>',
  vacancies: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2.4"/><path d="M9 9h6v6H9z"/></svg>',
  newListingsMonth: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  newAdsMonth: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 8.5a4.2 4.2 0 0 1 0 7"/></svg>',
  totalLeads: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.2 14.3c2.7.4 4.8 2.6 4.8 5.7"/></svg>',
  newLeadsMonth: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>'
};
var KPI_LABELS = [
  ['activeListings', '거래중 매물', '전체 거래중 기준'],
  ['vacancies', '공실', '전체 공실 기준'],
  ['newListingsMonth', '이번달 신규등록', '이번 달 신규 매물'],
  ['newAdsMonth', '이번달 신규광고', '이번 달 신규 광고'],
  ['totalLeads', '총 가망고객', '전체 가망고객 수'],
  ['newLeadsMonth', '이번달 신규 고객', '이번 달 신규 접수']
];

var MAP_URL = 'https://www.google.com/maps/d/u/1/?hl=ko';

function renderKpi_(kpi, expiring) {
  var wrap = document.getElementById('kpi-grid');
  var pairTint = [1, 1, 3, 3, 5, 5]; // 거래중/공실 · 신규등록/신규광고 · 가망고객/신규고객 — 테마별로 묶어서 톤 통일
  var cards = KPI_LABELS.map(function (item, idx) {
    var key = item[0], label = item[1], sub = item[2];
    return '<div class="summary-card static tint-' + pairTint[idx] + '">' +
      '<div class="icon-badge">' + KPI_ICONS[key] + '</div>' +
      '<div class="title-row"><h3>' + label + '</h3></div>' +
      '<div class="stat">' + kpi[key].toLocaleString() + '</div>' +
      '<div class="stat-label">' + sub + '</div>' +
      '</div>';
  });

  cards.push(
    '<a class="summary-card tint-2" href="' + MAP_URL + '" target="_blank" rel="noopener">' +
    '<div class="icon-badge" style="background:#fff;box-shadow:inset 0 0 0 1px var(--border);">' +
    '<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>' +
    '</div>' +
    '<div class="title-row"><h3>내 매물 지도</h3></div>' +
    '<div class="stat-label" style="margin-top:auto;">구글 My Maps 열기 →</div>' +
    '</a>'
  );

  cards.push(
    '<div class="summary-card static tint-6">' +
    '<div class="icon-badge"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></div>' +
    '<div class="title-row"><h3>만기 임박</h3></div>' +
    '<div class="badge-list mini horizontal">' + expiring.map(function (row) {
      var hasCount = row.value > 0;
      return '<div class="badge-row' + (hasCount ? ' has-count' : '') + '">' +
        '<span>' + row.name + '</span>' +
        '<span class="badge-count">' + row.value + '건</span>' +
        '</div>';
    }).join('') + '</div>' +
    '</div>'
  );

  wrap.innerHTML = cards.join('');
}

function renderStatusTable_(statusSummary) {
  var el = document.getElementById('table-status');
  var head = '<tr><th>구분</th><th>거래중 매물</th><th>거래가능</th><th>협의중</th><th>거래완료</th></tr>';
  var body = statusSummary.rows.map(function (row) {
    return '<tr><td>' + row.name + '</td><td>' + row.active + '</td><td>' + row.available + '</td><td>' + row.negotiating + '</td><td>' + row.done + '</td></tr>';
  }).join('');
  var t = statusSummary.total;
  var totalRow = '<tr class="total-row"><td>합계</td><td>' + t.active + '</td><td>' + t.available + '</td><td>' + t.negotiating + '</td><td>' + t.done + '</td></tr>';
  el.innerHTML = head + body + totalRow;
}

function renderVacancyTable_(vacancy) {
  var el = document.getElementById('table-vacancy');
  var head = '<tr><th>구분</th><th>공실 수</th></tr>';
  var body = vacancy.rows.map(function (row) {
    return '<tr><td>' + row.name + '</td><td>' + row.value + '</td></tr>';
  }).join('');
  var totalRow = '<tr class="total-row"><td>합계</td><td>' + vacancy.total + '</td></tr>';
  el.innerHTML = head + body + totalRow;
}

function renderSelfContractTable_(selfContract) {
  var el = document.getElementById('table-selfcontract');
  var head = '<tr><th>구분</th><th>자기계약 누적</th></tr>';
  var body = selfContract.rows.map(function (row) {
    return '<tr><td>' + row.name + '</td><td>' + row.value + '</td></tr>';
  }).join('');
  var totalRow = '<tr class="total-row"><td>합계</td><td>' + selfContract.total + '</td></tr>';
  el.innerHTML = head + body + totalRow;
}

var chartInstances = {};
function destroyChart_(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}
function chartFallback_(canvasId, msg) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var wrap = canvas.closest('.chart-wrap');
  if (wrap) wrap.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:13px;">' + msg + '</div>';
}

var TOOLTIP_STYLE = {
  enabled: true,
  backgroundColor: '#ffffff',
  titleColor: '#727A86',
  bodyColor: '#15181E',
  titleFont: { family: "Pretendard", size: 10.5, weight: '700' },
  bodyFont: { family: "Pretendard", size: 12.5, weight: '700' },
  borderColor: '#E6E8EC',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 9,
  boxPadding: 4,
  displayColors: true,
  usePointStyle: true,
  caretSize: 5
};

function renderDonut_(canvasId, items) {
  if (typeof Chart === 'undefined') { chartFallback_(canvasId, '차트 라이브러리를 불러오지 못했습니다'); return; }
  try {
  destroyChart_(canvasId);
  var ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: items.map(function (i) { return i.name; }),
      datasets: [{
        data: items.map(function (i) { return i.value; }),
        backgroundColor: items.map(function (_, idx) { return PALETTE[idx % PALETTE.length]; }),
        borderColor: '#fff',
        borderWidth: 2,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11.5, family: "Pretendard" }, padding: 12, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle' }
        },
        tooltip: TOOLTIP_STYLE
      }
    }
  });
  } catch (e) { chartFallback_(canvasId, '차트를 그리는 중 오류가 발생했습니다'); }
}

function renderBar_(canvasId, items, opts) {
  opts = opts || {};
  if (typeof Chart === 'undefined') { chartFallback_(canvasId, '차트 라이브러리를 불러오지 못했습니다'); return; }
  try {
  destroyChart_(canvasId);
  var horizontal = !!opts.horizontal;
  var color = opts.color || '#2746E6';
  var ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map(function (i) { return i.name; }),
      datasets: [{
        data: items.map(function (i) { return i.value; }),
        backgroundColor: color,
        borderRadius: 4,
        maxBarThickness: 28
      }]
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: TOOLTIP_STYLE },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          border: { display: false },
          ticks: { font: { size: 11, family: "Pretendard" }, color: '#727A86', precision: 0 },
          beginAtZero: horizontal
        },
        y: {
          grid: { display: false, drawBorder: false },
          border: { display: false },
          ticks: { font: { size: 11, family: "Pretendard" }, color: '#727A86', precision: 0 },
          beginAtZero: !horizontal
        }
      }
    }
  });
  } catch (e) { chartFallback_(canvasId, '차트를 그리는 중 오류가 발생했습니다'); }
}

function renderLine_(canvasId, months, counts) {
  if (typeof Chart === 'undefined') { chartFallback_(canvasId, '차트 라이브러리를 불러오지 못했습니다'); return; }
  try {
  destroyChart_(canvasId);
  var ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        data: counts,
        borderColor: CHART_COLORS.monthly,
        backgroundColor: 'rgba(39, 70, 230, 0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 2.5,
        pointBackgroundColor: CHART_COLORS.monthly,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: TOOLTIP_STYLE },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          border: { display: false },
          ticks: { font: { size: 10.5, family: "Pretendard" }, color: '#727A86', maxRotation: 0 }
        },
        y: {
          grid: { color: 'rgba(21, 24, 30, 0.06)', drawBorder: false },
          border: { display: false },
          beginAtZero: true,
          ticks: { font: { size: 10.5, family: "Pretendard" }, color: '#727A86', precision: 0 }
        }
      }
    }
  });
  } catch (e) { chartFallback_(canvasId, '차트를 그리는 중 오류가 발생했습니다'); }
}

function renderAll_(data) {
  renderKpi_(data.kpi, data.expiring);
  renderStatusTable_(data.statusSummary);
  renderVacancyTable_(data.vacancy);
  renderSelfContractTable_(data.selfContract);

  renderDonut_('chart-dealtype', data.dealType);
  renderDonut_('chart-listingtype', data.listingType);
  renderBar_('chart-newlistings', data.newListingsByType.rows, { color: CHART_COLORS.newListings });
  renderBar_('chart-adchannels', data.adChannels, { color: CHART_COLORS.adChannels });
  renderBar_('chart-newads', data.newAdsByType, { color: CHART_COLORS.newAds });

  // 지역별: 값이 0인 지역은 라벨이 빽빽해지고 안 잘리게 걸러낸다 (0건 지역은 표에 이미 다 있으니 제외해도 정보 손실 없음)
  var activeRegions = data.regions.filter(function (r) { return r.value > 0; })
    .sort(function (a, b) { return b.value - a.value; });
  if (activeRegions.length) {
    renderBar_('chart-region', activeRegions, { horizontal: true, color: CHART_COLORS.region });
  } else {
    chartFallback_('chart-region', '등록된 지역 데이터가 없습니다');
  }

  renderLine_('chart-monthly', data.monthly.months, data.monthly.counts);
}

function showContent_(stored) {
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('dash-content').classList.remove('hidden');
  document.getElementById('upload-basedate').textContent = stored.data.baseDate + ' 기준';
  renderAll_(stored.data);
}

function handleFile_(file) {
  if (!file) return;
  Papa.parse(file, {
    encoding: 'UTF-8',
    complete: function (results) {
      var rows = results.data;
      var parsed = parseMaemulCsv(rows);
      var ts = new Date().toISOString();
      saveData_(parsed, ts);
      showContent_(loadData_());
      pushToServer_(parsed, ts);
    },
    error: function () {
      alert('CSV 파일을 읽는 중 문제가 발생했습니다. 파일을 다시 확인해주세요.');
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  var input = document.getElementById('csv-input');
  document.getElementById('upload-btn').addEventListener('click', function () { input.click(); });
  document.getElementById('upload-btn-2').addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function (e) {
    handleFile_(e.target.files[0]);
    input.value = '';
  });

  var stored = loadData_();
  if (stored && stored.data) {
    showContent_(stored);
  }
  // 로컬 캐시가 없는 기기(예: 처음 여는 폰)에서도 서버에 저장된 최신 데이터를 받아와 표시
  pullFromServer_();
});
