/* ============================================================
   theo 대시보드 — 종합현황(index.html) 요약 카드
   각 카테고리 페이지가 이미 쓰고 있는 localStorage 캐시를 그대로 재사용해서
   즉시 표시하고, 뒤에서 각자의 실제 데이터 소스로 조용히 갱신한다.
   (fetchJsonp / DASHBOARD_LOCK 은 lock.js에서 이미 로드됨)
   ============================================================ */

function sumCard_(key) {
  return document.querySelector('[data-card="' + key + '"]');
}
function sumSet_(key, statText, labelText) {
  const card = sumCard_(key);
  if (!card) return;
  const statEl = card.querySelector('.stat');
  const labelEl = card.querySelector('.stat-label');
  if (statEl) statEl.textContent = statText;
  if (labelEl) labelEl.textContent = labelText;
}
function sumReadCache_(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function sumTodayStr_() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function sumDDay_(nextStr) {
  if (!nextStr) return null;
  const t = new Date(sumTodayStr_() + 'T00:00:00');
  const n = new Date(nextStr + 'T00:00:00');
  return Math.round((n - t) / 86400000);
}

/* ---------------- 매물현황 (CSV 반자동 → localStorage + 서버 getMaemulStatus) ---------------- */
function sumRenderMaemul_(data) {
  if (!data || !data.kpi) {
    sumSet_('maemul', '—', '아직 업로드 전');
    return;
  }
  sumSet_('maemul', (data.kpi.activeListings || 0).toLocaleString() + '건', '거래중 매물');
}
async function sumLoadMaemul_() {
  const cached = sumReadCache_('theo_dashboard_maemul_csv_v1');
  if (cached && cached.data) sumRenderMaemul_(cached.data);
  else sumSet_('maemul', '—', '아직 업로드 전');

  const url = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';
  if (!url || typeof fetchJsonp !== 'function') return;
  try {
    const res = await fetchJsonp(url + '?mode=getMaemulStatus');
    if (res && res.data) sumRenderMaemul_(res.data);
  } catch (e) { /* 캐시로 이미 표시됨 */ }
}

/* ---------------- 추천매물 (recommendList) ---------------- */
function sumRenderRecommend_(clients) {
  const list = Array.isArray(clients) ? clients : [];
  const active = list.filter((c) => !c.ended).length;
  sumSet_('recommend', active.toLocaleString() + '건', '진행중 고객');
}
async function sumLoadRecommend_() {
  const cached = sumReadCache_('theo_dashboard_recommend_cache_v1');
  if (cached && cached.clients) sumRenderRecommend_(cached.clients);

  const url = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';
  if (!url || typeof fetchJsonp !== 'function') return;
  try {
    const res = await fetchJsonp(url + '?mode=recommendList');
    if (res && res.clients) sumRenderRecommend_(res.clients);
  } catch (e) {}
}

/* ---------------- 파밍현황 (exp-farming 자체 Apps Script, mode=data) ---------------- */
const SUM_FARM_DATA_URL = 'https://script.google.com/macros/s/AKfycbzzJs4Y8_iNMYtXQjcBmKCgJkHrAR2YvFFAKJI4Xx0ujgjLkbIZGvXcWeM5B1WPN7kD/exec';
function sumRenderFarm_(properties) {
  const list = Array.isArray(properties) ? properties : [];
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const monthCount = list.filter((p) => p.파밍일자 && String(p.파밍일자).indexOf(ym) === 0 && p.파밍여부 !== '파밍취소').length;
  sumSet_('farming', monthCount.toLocaleString() + '건', '이번 달 파밍');
}
async function sumLoadFarm_() {
  const cached = sumReadCache_('theo_dashboard_farm_cache_v1');
  if (cached && cached.properties) sumRenderFarm_(cached.properties);

  if (typeof fetchJsonp !== 'function') return;
  try {
    const sep = SUM_FARM_DATA_URL.indexOf('?') >= 0 ? '&' : '?';
    const res = await fetchJsonp(SUM_FARM_DATA_URL + sep + 'mode=data');
    if (res && res.properties) sumRenderFarm_(res.properties);
  } catch (e) {}
}

/* ---------------- 고객관리 (crmList) ---------------- */
function sumRenderCustomer_(items) {
  const list = Array.isArray(items) ? items : [];
  const todayCount = list.filter((it) => {
    const d = sumDDay_(it.nextContact);
    return d !== null && d <= 0;
  }).length;
  sumSet_('customer', todayCount.toLocaleString() + '건', '오늘 연락할 고객');
}
async function sumLoadCustomer_() {
  const cached = sumReadCache_('theo_dashboard_crm_cache_v1');
  if (cached && cached.items) sumRenderCustomer_(cached.items);

  const url = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';
  if (!url || typeof fetchJsonp !== 'function') return;
  try {
    const res = await fetchJsonp(url + '?mode=crmList');
    if (res && res.items) sumRenderCustomer_(res.items);
  } catch (e) {}
}

/* ---------------- 일정관리 (scheduleList) ---------------- */
function sumRenderSchedule_(items) {
  const list = Array.isArray(items) ? items : [];
  const today = sumTodayStr_();
  const todayCount = list.filter((it) => it.date === today).length;
  sumSet_('schedule', todayCount.toLocaleString() + '건', '오늘 일정');
}
async function sumLoadSchedule_() {
  const cached = sumReadCache_('theo_dashboard_sched_cache_v1');
  if (cached && cached.items) sumRenderSchedule_(cached.items);

  const url = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';
  if (!url || typeof fetchJsonp !== 'function') return;
  try {
    const res = await fetchJsonp(url + '?mode=scheduleList');
    if (res && Array.isArray(res)) sumRenderSchedule_(res);
  } catch (e) {}
}

/* ---------------- 마케팅툴 (marketingStats — 이번달 생성 건수) ---------------- */
function sumRenderMarketing_(stats) {
  const count = (stats && typeof stats.thisMonth === 'number') ? stats.thisMonth : 0;
  sumSet_('marketing', count.toLocaleString() + '건', '이번달 생성');
}
async function sumLoadMarketing_() {
  const cached = sumReadCache_('theo_dashboard_marketing_stats_cache_v1');
  if (cached && typeof cached.thisMonth === 'number') sumRenderMarketing_(cached);

  const url = (typeof DASHBOARD_LOCK !== 'undefined' && DASHBOARD_LOCK.appsScriptUrl) || '';
  if (!url || typeof fetchJsonp !== 'function') return;
  try {
    const res = await fetchJsonp(url + '?mode=marketingStats');
    if (res && typeof res.thisMonth === 'number') {
      sumRenderMarketing_(res);
      try { localStorage.setItem('theo_dashboard_marketing_stats_cache_v1', JSON.stringify(res)); } catch (e) {}
    }
  } catch (e) {}
}

function sumInit() {
  sumLoadMaemul_();
  sumLoadRecommend_();
  sumLoadFarm_();
  sumLoadCustomer_();
  sumLoadSchedule_();
  sumLoadMarketing_();
}

document.addEventListener('DOMContentLoaded', sumInit);
