/* ============================================================
   매물현황 페이지 — CSV 반자동 연동 (셀좌표 매핑)
   엑셀 대시보드 시트를 CSV로 export → 업로드 → 파싱 → localStorage 저장 → 렌더
   ============================================================ */

var STORAGE_KEY = 'theo_dashboard_maemul_csv_v1';

var PALETTE = ['#2746E6', '#5A72EA', '#93A1F2', '#1B2E99', '#B7C1F6', '#0F2899', '#6F82EE', '#151C3D'];

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

function saveData_(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    data: data,
    uploadedAt: new Date().toISOString()
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

function renderKpi_(kpi) {
  var wrap = document.getElementById('kpi-grid');
  wrap.innerHTML = KPI_LABELS.map(function (item) {
    var key = item[0], label = item[1], sub = item[2];
    return '<div class="summary-card static">' +
      '<div class="icon-badge">' + KPI_ICONS[key] + '</div>' +
      '<div class="title-row"><h3>' + label + '</h3></div>' +
      '<div class="stat">' + kpi[key].toLocaleString() + '</div>' +
      '<div class="stat-label">' + sub + '</div>' +
      '</div>';
  }).join('');
}

function renderStatusTable_(statusSummary) {
  var el = document.getElementById('table-status');
  var head = '<tr><th>시트명</th><th>거래중 매물</th><th>거래가능</th><th>협의중</th><th>거래완료</th></tr>';
  var body = statusSummary.rows.map(function (row) {
    return '<tr><td>' + row.name + '</td><td>' + row.active + '</td><td>' + row.available + '</td><td>' + row.negotiating + '</td><td>' + row.done + '</td></tr>';
  }).join('');
  var t = statusSummary.total;
  var totalRow = '<tr class="total-row"><td>합계</td><td>' + t.active + '</td><td>' + t.available + '</td><td>' + t.negotiating + '</td><td>' + t.done + '</td></tr>';
  el.innerHTML = head + body + totalRow;
}

function renderVacancyTable_(vacancy) {
  var el = document.getElementById('table-vacancy');
  var head = '<tr><th>시트명</th><th>공실 수</th></tr>';
  var body = vacancy.rows.map(function (row) {
    return '<tr><td>' + row.name + '</td><td>' + row.value + '</td></tr>';
  }).join('');
  var totalRow = '<tr class="total-row"><td>합계</td><td>' + vacancy.total + '</td></tr>';
  el.innerHTML = head + body + totalRow;
}

function renderSelfContractTable_(selfContract) {
  var el = document.getElementById('table-selfcontract');
  var head = '<tr><th>시트명</th><th>자기계약 누적</th></tr>';
  var body = selfContract.rows.map(function (row) {
    return '<tr><td>' + row.name + '</td><td>' + row.value + '</td></tr>';
  }).join('');
  var totalRow = '<tr class="total-row"><td>합계</td><td>' + selfContract.total + '</td></tr>';
  el.innerHTML = head + body + totalRow;
}

function renderExpiringBadges_(expiring) {
  var el = document.getElementById('badge-expiring');
  el.innerHTML = expiring.map(function (row) {
    var hasCount = row.value > 0;
    return '<div class="badge-row' + (hasCount ? ' has-count' : '') + '">' +
      '<span>' + row.name + '</span>' +
      '<span class="badge-count">' + row.value + '건</span>' +
      '</div>';
  }).join('');
}

var chartInstances = {};
function destroyChart_(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function renderDonut_(canvasId, items) {
  destroyChart_(canvasId);
  var ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: items.map(function (i) { return i.name; }),
      datasets: [{
        data: items.map(function (i) { return i.value; }),
        backgroundColor: items.map(function (_, idx) { return PALETTE[idx % PALETTE.length]; }),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 12, family: "Pretendard" }, padding: 12 } }
      }
    }
  });
}

function renderBar_(canvasId, items, horizontal) {
  destroyChart_(canvasId);
  var ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map(function (i) { return i.name; }),
      datasets: [{
        data: items.map(function (i) { return i.value; }),
        backgroundColor: '#2746E6',
        borderRadius: 6,
        maxBarThickness: 34
      }]
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: !horizontal }, ticks: { font: { size: 11.5, family: "Pretendard" } } },
        y: { grid: { display: horizontal }, ticks: { font: { size: 11.5, family: "Pretendard" } }, beginAtZero: true }
      }
    }
  });
}

function renderLine_(canvasId, months, counts) {
  destroyChart_(canvasId);
  var ctx = document.getElementById(canvasId).getContext('2d');
  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        data: counts,
        borderColor: '#2746E6',
        backgroundColor: 'rgba(39, 70, 230, 0.10)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointBackgroundColor: '#2746E6'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 11, family: "Pretendard" } } },
        y: { beginAtZero: true, ticks: { font: { size: 11, family: "Pretendard" } } }
      }
    }
  });
}

function renderAll_(data) {
  renderKpi_(data.kpi);
  renderStatusTable_(data.statusSummary);
  renderVacancyTable_(data.vacancy);
  renderSelfContractTable_(data.selfContract);
  renderExpiringBadges_(data.expiring);

  renderDonut_('chart-dealtype', data.dealType);
  renderDonut_('chart-listingtype', data.listingType);
  renderBar_('chart-newlistings', data.newListingsByType.rows, false);
  renderBar_('chart-adchannels', data.adChannels, false);
  renderBar_('chart-newads', data.newAdsByType, false);
  renderBar_('chart-region', data.regions, true);
  renderLine_('chart-monthly', data.monthly.months, data.monthly.counts);
}

function showContent_(stored) {
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('dash-content').classList.remove('hidden');
  document.getElementById('upload-basedate').textContent = stored.data.baseDate + ' 기준';
  document.getElementById('upload-updated').textContent = fmtUploadedAt_(stored.uploadedAt);
  renderAll_(stored.data);
}

function handleFile_(file) {
  if (!file) return;
  Papa.parse(file, {
    encoding: 'UTF-8',
    complete: function (results) {
      var rows = results.data;
      var parsed = parseMaemulCsv(rows);
      saveData_(parsed);
      showContent_(loadData_());
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
});
