/* ============================================================
   theo 대시보드 — 계약관리 (계약서 라이브러리 + 특약 라이브러리)
   ============================================================ */

// TODO: 실제 배포된 Apps Script 웹앱 URL로 교체하세요.
// 매물장필터뷰 프로젝트에 이번에 추가한 doGet/doPost 분기가 있는 그 배포 URL입니다.
const CONTRACT_API_URL = "https://script.google.com/macros/s/여기에_배포ID/exec";

const FALLBACK_TYPES = ["매매", "임대차", "권리금계약", "가계약", "전대차", "합의서", "기타"];
const FALLBACK_TAGS = ["근저당승계", "위반건축물", "다운계약", "임차인승계", "하자담보", "정화조/하수도부담금", "주차시설", "간판", "부가세환급", "명도", "기타"];

let dealRows = [];      // 계약서라이브러리 시트 원본 row 목록
let clauseRows = [];    // 특약라이브러리 시트 원본 row 목록
let contractTypes = FALLBACK_TYPES.slice();
let clauseTags = FALLBACK_TAGS.slice();
let activeDealTypeFilter = "all";
let selectedClauseTags = new Set();
let selectedDealId = null;

/* ---------------- API 헬퍼 ---------------- */

function jsonp(mode, params = {}) {
  return new Promise((resolve, reject) => {
    const cbName = "cb_" + mode + "_" + Date.now() + "_" + Math.floor(Math.random() * 9999);
    const script = document.createElement("script");
    window[cbName] = (data) => {
      resolve(data);
      delete window[cbName];
      script.remove();
    };
    const qs = new URLSearchParams({ mode, callback: cbName, ...params }).toString();
    script.src = `${CONTRACT_API_URL}?${qs}`;
    script.onerror = () => { reject(new Error("네트워크 오류")); delete window[cbName]; script.remove(); };
    document.body.appendChild(script);
  });
}

async function postJSON(mode, payload) {
  const res = await fetch(CONTRACT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script doPost는 이 방식이 CORS preflight를 안 타서 안전
    body: JSON.stringify({ mode, ...payload }),
  });
  return await res.json();
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------------- 초기 로딩 ---------------- */

async function loadAll() {
  loadDeals();
  loadClauses();
  loadSettings();
}

async function loadSettings() {
  try {
    const data = await jsonp("contractSettings");
    if (data && data.ok) {
      if (data.types && data.types.length) contractTypes = data.types;
      if (data.tags && data.tags.length) clauseTags = data.tags;
    }
  } catch (e) { /* 실패시 기본값 유지 */ }
  renderTypeFilters();
  renderTypeSelect();
  renderTagPicker();
  renderClauseTagFilters();
}

async function loadDeals() {
  const listEl = document.getElementById("dealList");
  try {
    const data = await jsonp("contractList");
    dealRows = (data && data.rows) || [];
  } catch (e) {
    dealRows = [];
  }
  renderDealList();
  updateKpis();
}

async function loadClauses() {
  try {
    const data = await jsonp("clauseList");
    clauseRows = (data && data.rows) || [];
  } catch (e) {
    clauseRows = [];
  }
  renderClauseList();
  updateKpis();
}

function updateKpis() {
  const dealIds = new Set(dealRows.map(r => r.dealId));
  document.getElementById("statDeals").textContent = dealIds.size;
  document.getElementById("statDocs").textContent = dealRows.length;
  document.getElementById("statClauses").textContent = clauseRows.length;
}

/* ---------------- 계약서 라이브러리: 거래그룹 리스트 ---------------- */

function groupDeals(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.dealId)) map.set(r.dealId, []);
    map.get(r.dealId).push(r);
  }
  const groups = [];
  for (const [dealId, docs] of map.entries()) {
    docs.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const latest = docs[docs.length - 1];
    groups.push({ dealId, maemulNo: latest.maemulNo, docs, latestDate: latest.date, latestSummary: latest.summary });
  }
  groups.sort((a, b) => (b.latestDate || "").localeCompare(a.latestDate || ""));
  return groups;
}

function renderTypeFilters() {
  const wrap = document.getElementById("dealTypeFilters");
  wrap.innerHTML = `<button class="rec-filter-chip active" data-type="all">전체</button>` +
    contractTypes.map(t => `<button class="rec-filter-chip" data-type="${t}">${t}</button>`).join("");
  wrap.querySelectorAll(".rec-filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".rec-filter-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeDealTypeFilter = btn.dataset.type;
      renderDealList();
    });
  });
}

function renderDealList() {
  const listEl = document.getElementById("dealList");
  const keyword = (document.getElementById("dealSearch").value || "").trim().toLowerCase();

  let filtered = dealRows;
  if (activeDealTypeFilter !== "all") filtered = filtered.filter(r => r.type === activeDealTypeFilter);
  if (keyword) {
    filtered = filtered.filter(r =>
      (r.maemulNo || "").toLowerCase().includes(keyword) ||
      (r.summary || "").toLowerCase().includes(keyword)
    );
  }

  const groups = groupDeals(filtered);
  if (!groups.length) {
    listEl.innerHTML = `<div class="rec-empty">등록된 거래건이 없습니다. 오른쪽 아래 "새 계약서 등록"으로 시작하세요.</div>`;
    return;
  }

  listEl.innerHTML = groups.map(g => `
    <div class="deal-card" data-deal="${g.dealId}">
      <div class="deal-card-top">
        <span class="deal-maemul">${g.maemulNo || "(매물번호 미지정)"}</span>
        <span class="deal-date">${g.latestDate || ""}</span>
      </div>
      <div class="deal-doc-badges">
        ${g.docs.map(d => `<span class="doc-tag t-${d.type}">${d.type}</span>`).join("")}
      </div>
      <div class="deal-summary">${g.latestSummary || "특이사항 없음"}</div>
    </div>
  `).join("");

  listEl.querySelectorAll(".deal-card").forEach(card => {
    card.addEventListener("click", () => openDealPanel(card.dataset.deal));
  });
}

function openDealPanel(dealId) {
  selectedDealId = dealId;
  const docs = dealRows.filter(r => r.dealId === dealId).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (!docs.length) return;

  document.getElementById("dealPanelTitle").textContent = docs[0].maemulNo || dealId;
  document.getElementById("dealPanelSub").textContent = `${dealId} · 문서 ${docs.length}건`;

  document.getElementById("dealPanelBody").innerHTML = docs.map(d => `
    <div class="timeline-item">
      <div class="timeline-item-top">
        <span class="doc-tag t-${d.type}">${d.type}</span>
        <span class="timeline-date">${d.date || ""}</span>
      </div>
      <div class="timeline-summary">${d.summary || ""}</div>
      <div class="timeline-files">
        <a class="timeline-file-btn ${d.fileContract ? "" : "disabled"}" href="${d.fileContract || "#"}" target="_blank" rel="noopener">계약서 열기</a>
        <a class="timeline-file-btn ${d.fileConfirm ? "" : "disabled"}" href="${d.fileConfirm || "#"}" target="_blank" rel="noopener">확인설명서 열기</a>
      </div>
    </div>
  `).join("");

  document.getElementById("dealOverlay").classList.add("open");
  document.getElementById("dealPanel").classList.add("open");
}

function closeDealPanel() {
  document.getElementById("dealOverlay").classList.remove("open");
  document.getElementById("dealPanel").classList.remove("open");
}

/* ---------------- 특약 라이브러리 ---------------- */

function renderClauseTagFilters() {
  const wrap = document.getElementById("clauseTagFilters");
  wrap.innerHTML = clauseTags.map(t => `<button class="rec-filter-chip" data-tag="${t}">${t}</button>`).join("");
  wrap.querySelectorAll(".rec-filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag;
      if (selectedClauseTags.has(tag)) { selectedClauseTags.delete(tag); btn.classList.remove("active"); }
      else { selectedClauseTags.add(tag); btn.classList.add("active"); }
      renderClauseList();
    });
  });
}

function renderClauseList() {
  const listEl = document.getElementById("clauseList");
  const keyword = (document.getElementById("clauseSearch").value || "").trim().toLowerCase();

  let filtered = clauseRows;
  if (selectedClauseTags.size) {
    filtered = filtered.filter(r => (r.tags || []).some(t => selectedClauseTags.has(t)));
  }
  if (keyword) {
    filtered = filtered.filter(r =>
      (r.text || "").toLowerCase().includes(keyword) ||
      (r.tags || []).join(",").toLowerCase().includes(keyword)
    );
  }
  filtered = filtered.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (!filtered.length) {
    listEl.innerHTML = `<div class="rec-empty">등록된 특약이 없습니다.</div>`;
    return;
  }

  listEl.innerHTML = filtered.map((c, idx) => `
    <div class="clause-card">
      <div class="clause-tags">${(c.tags || []).map(t => `<span class="clause-tag">${t}</span>`).join("")}</div>
      <div class="clause-text">${escapeHtml(c.text || "")}</div>
      <div class="clause-meta-row">
        <span class="clause-meta">${c.maemulNo ? c.maemulNo + " · " : ""}${c.usedDate || ""}</span>
        <button class="clause-copy-btn" data-idx="${idx}">복사</button>
      </div>
    </div>
  `).join("");

  listEl.querySelectorAll(".clause-copy-btn").forEach((btn, i) => {
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(filtered[i].text || "");
      btn.textContent = "복사됨";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = "복사"; btn.classList.remove("copied"); }, 1500);
    });
  });
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderTagPicker() {
  const wrap = document.getElementById("clauseTagPicker");
  wrap.innerHTML = clauseTags.map(t => `<button type="button" class="tp-chip" data-tag="${t}">${t}</button>`).join("");
  wrap.querySelectorAll(".tp-chip").forEach(btn => {
    btn.addEventListener("click", () => btn.classList.toggle("sel"));
  });
}

function renderTypeSelect() {
  if (!fTypePicker) return;
  fTypePicker.setOptions(contractTypes.map(t => ({ value: t, text: t })));
}

/* ---------------- 특약 등록 모달 ---------------- */

function openClauseForm() {
  document.getElementById("cText").value = "";
  document.getElementById("cMaemul").value = "";
  clauseDatePicker.setValue("");
  document.getElementById("clauseFormError").textContent = "";
  document.querySelectorAll("#clauseTagPicker .tp-chip").forEach(c => c.classList.remove("sel"));

  const refOptions = [{ value: "", text: "연결 안 함" }].concat(
    dealRows.map(r => ({ value: r.regId, text: `${r.maemulNo || r.dealId} · ${r.type} · ${r.date || ""}` }))
  );
  clauseRefPicker.setOptions(refOptions, "");

  document.getElementById("clauseFormOverlay").classList.add("show");
}
function closeClauseForm() { document.getElementById("clauseFormOverlay").classList.remove("show"); }

async function saveClause() {
  const tags = [...document.querySelectorAll("#clauseTagPicker .tp-chip.sel")].map(b => b.dataset.tag);
  const text = document.getElementById("cText").value.trim();
  const maemulNo = document.getElementById("cMaemul").value.trim();
  const usedDate = clauseDatePicker.getValue();
  const contractRegId = clauseRefPicker.getValue();
  const errEl = document.getElementById("clauseFormError");

  if (!text) { errEl.textContent = "특약문구를 입력하세요."; return; }
  if (!tags.length) { errEl.textContent = "태그를 하나 이상 선택하세요."; return; }

  const saveBtn = document.getElementById("clauseFormSave");
  saveBtn.disabled = true; saveBtn.textContent = "저장 중...";
  try {
    const data = await postJSON("clauseSave", { tags, text, maemulNo, usedDate, contractRegId });
    if (data && data.ok) {
      toast("특약이 저장되었습니다.");
      closeClauseForm();
      loadClauses();
    } else {
      errEl.textContent = (data && data.error) || "저장에 실패했습니다.";
    }
  } catch (e) {
    errEl.textContent = "네트워크 오류로 저장하지 못했습니다.";
  }
  saveBtn.disabled = false; saveBtn.textContent = "저장";
}

/* ============================================================
   등록 마법사 (업로드 + 마스킹 → 메타데이터 → 저장)
   masking-prototype.html 로직을 문서 슬롯 2개(계약서/확인설명서)로 재사용
   ============================================================ */

const PII_PATTERNS = [
  { label: "주민/법인등록번호", re: /^\d{6}-\d{7}$/ },
  { label: "전화번호", re: /^01[016789]-?\d{3,4}-?\d{4}$/ },
  { label: "계좌번호(추정)", re: /^\d{2,6}-\d{2,8}-\d{2,8}$/ },
  { label: "생년월일(추정,6자리)", re: /^\d{6}$/ },
];
function matchPiiPattern(text) {
  const t = text.trim();
  for (const p of PII_PATTERNS) if (p.re.test(t)) return p.label;
  return null;
}

let sharedOcrWorker = null;
async function getOcrWorker() {
  if (!sharedOcrWorker) {
    sharedOcrWorker = await Tesseract.createWorker("kor+eng", 1, {
      logger: (m) => { /* 필요시 진행률 표시에 사용 가능 */ }
    });
  }
  return sharedOcrWorker;
}

const wizardDocs = {
  contract: { file: null, pageStates: [], pdfBlob: null, ocrDone: false },
  confirm: { file: null, pageStates: [], pdfBlob: null, ocrDone: false },
};
let wizardStep = 1;
let wizardDealMode = "new"; // 'new' | 'existing'

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

async function handleFileSelected(docKey, file, pagesContainerId, statusElId) {
  const slot = wizardDocs[docKey];
  slot.file = file;
  slot.pageStates = [];
  slot.ocrDone = false;
  const container = document.getElementById(pagesContainerId);
  const statusEl = document.getElementById(statusElId);
  container.innerHTML = "";
  if (!file) { statusEl.textContent = ""; return; }

  statusEl.textContent = "페이지 렌더링 중...";
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const worker = await getOcrWorker();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const block = document.createElement("div");
    block.className = "mask-page-block";
    block.innerHTML = `
      <div class="mask-page-head">
        <span>${pageNum} / ${pdf.numPages} 페이지</span>
        <div class="mask-btn-row">
          <button class="mask-mini-btn maskApply">마스킹 적용</button>
          <button class="mask-mini-btn maskReset">수동영역 초기화</button>
        </div>
      </div>
      <div class="mask-stage"></div>
      <div class="mask-legend">
        <span><i class="dot" style="background:#E63946"></i>자동감지</span>
        <span><i class="dot" style="background:#2746E6"></i>수동추가(드래그)</span>
      </div>
    `;
    container.appendChild(block);
    const stage = block.querySelector(".mask-stage");
    stage.style.width = "100%";
    stage.style.position = "relative";
    canvas.style.maxWidth = "100%"; canvas.style.height = "auto";
    stage.appendChild(canvas);

    const overlay = document.createElement("canvas");
    overlay.width = viewport.width; overlay.height = viewport.height;
    overlay.className = "mask-overlay-canvas";
    overlay.style.maxWidth = "100%"; overlay.style.height = "auto";
    stage.appendChild(overlay);
    const octx = overlay.getContext("2d");

    const state = { canvas, ctx, overlay, octx, regions: [] };
    slot.pageStates.push(state);

    statusEl.textContent = `${pageNum}/${pdf.numPages} 페이지 OCR 분석 중...`;
    const { data } = await worker.recognize(canvas);
    for (const w of (data.words || [])) {
      const label = matchPiiPattern(w.text);
      if (label && w.bbox) {
        state.regions.push({
          x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0,
          type: "auto", enabled: true, label,
        });
      }
    }
    redrawMaskOverlay(state);
    attachMaskDrawHandlers(state, overlay);

    block.querySelector(".maskApply").addEventListener("click", () => {
      for (const r of state.regions) {
        if (!r.enabled) continue;
        state.ctx.fillStyle = "#000";
        state.ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      state.regions = [];
      redrawMaskOverlay(state);
    });
    block.querySelector(".maskReset").addEventListener("click", () => {
      state.regions = state.regions.filter(r => r.type === "auto");
      state.regions.forEach(r => r.enabled = true);
      redrawMaskOverlay(state);
    });
  }

  slot.ocrDone = true;
  statusEl.textContent = `완료 (${pdf.numPages}페이지)`;
}

function redrawMaskOverlay(state) {
  const { octx, overlay, regions } = state;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  for (const r of regions) {
    if (!r.enabled) continue;
    octx.fillStyle = r.type === "auto" ? "rgba(230,57,70,0.35)" : "rgba(39,70,230,0.35)";
    octx.strokeStyle = r.type === "auto" ? "#E63946" : "#2746E6";
    octx.lineWidth = 2;
    octx.fillRect(r.x, r.y, r.w, r.h);
    octx.strokeRect(r.x, r.y, r.w, r.h);
  }
}

function attachMaskDrawHandlers(state, overlay) {
  let dragging = false, startX, startY;
  function toCanvasXY(e) {
    const rect = overlay.getBoundingClientRect();
    const scaleX = overlay.width / rect.width, scaleY = overlay.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }
  overlay.addEventListener("mousedown", (e) => {
    const [x, y] = toCanvasXY(e);
    const regions = state.regions;
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      if (r.enabled && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        if (r.type === "auto") r.enabled = false; else regions.splice(i, 1);
        redrawMaskOverlay(state);
        return;
      }
    }
    dragging = true; startX = x; startY = y;
  });
  overlay.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const [x, y] = toCanvasXY(e);
    redrawMaskOverlay(state);
    state.octx.fillStyle = "rgba(39,70,230,0.25)";
    state.octx.strokeStyle = "#2746E6";
    state.octx.lineWidth = 2;
    const rx = Math.min(startX, x), ry = Math.min(startY, y), rw = Math.abs(x - startX), rh = Math.abs(y - startY);
    state.octx.fillRect(rx, ry, rw, rh);
    state.octx.strokeRect(rx, ry, rw, rh);
  });
  window.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    const [x, y] = toCanvasXY(e);
    const rx = Math.min(startX, x), ry = Math.min(startY, y), rw = Math.abs(x - startX), rh = Math.abs(y - startY);
    if (rw > 5 && rh > 5) state.regions.push({ x: rx, y: ry, w: rw, h: rh, type: "manual", enabled: true });
    redrawMaskOverlay(state);
  });
}

async function finalizeDocSlot(key) {
  const slot = wizardDocs[key];
  if (!slot.file) { slot.pdfBlob = null; return; }
  if (slot.pageStates.length) {
    const { jsPDF } = window.jspdf;
    const first = slot.pageStates[0].canvas;
    const pdfDoc = new jsPDF({ unit: "px", format: [first.width, first.height] });
    slot.pageStates.forEach((st, i) => {
      if (i > 0) pdfDoc.addPage([st.canvas.width, st.canvas.height]);
      pdfDoc.addImage(st.canvas.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, st.canvas.width, st.canvas.height);
    });
    slot.pdfBlob = pdfDoc.output("blob");
  } else {
    slot.pdfBlob = slot.file; // OCR을 안 돌린 원본 그대로 (사용자 확인 후에만 이 경로로 옴)
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) { resolve(null); return; }
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* ---------------- 마법사 UI 흐름 ---------------- */

function resetWizard() {
  wizardStep = 1;
  wizardDealMode = "new";
  wizardDocs.contract = { file: null, pageStates: [], pdfBlob: null, ocrDone: false };
  wizardDocs.confirm = { file: null, pageStates: [], pdfBlob: null, ocrDone: false };
  document.getElementById("fileContract").value = "";
  document.getElementById("fileConfirm").value = "";
  document.getElementById("pagesContract").innerHTML = "";
  document.getElementById("pagesConfirm").innerHTML = "";
  document.getElementById("statusContract").textContent = "";
  document.getElementById("statusConfirm").textContent = "";
  document.getElementById("fMaemul").value = "";
  if (contractDatePicker) contractDatePicker.setValue("");
  document.getElementById("fSummary").value = "";
  document.getElementById("fMemo").value = "";
  document.getElementById("dealModeNew").classList.add("sel");
  document.getElementById("dealModeExisting").classList.remove("sel");
  document.getElementById("existingDealField").style.display = "none";
  showWizardStep(1);
}

function openWizard() {
  resetWizard();
  document.getElementById("wizOverlay").classList.add("show");
}
function closeWizard() {
  document.getElementById("wizOverlay").classList.remove("show");
}

function showWizardStep(n) {
  wizardStep = n;
  ["wizStep1", "wizStep2", "wizStep3"].forEach((id, i) => {
    document.getElementById(id).classList.toggle("active", i + 1 === n);
  });
  ["wstep1", "wstep2", "wstep3"].forEach((id, i) => {
    const el = document.getElementById(id);
    el.classList.toggle("on", i + 1 === n);
    el.classList.toggle("done", i + 1 < n);
  });
  document.getElementById("wizPrev").style.visibility = n === 1 ? "hidden" : "visible";
  document.getElementById("wizNext").textContent = n === 3 ? "등록 완료" : "다음 단계";
}

async function wizardGoNext() {
  if (wizardStep === 1) {
    if (!wizardDocs.contract.file && !wizardDocs.confirm.file) {
      toast("계약서 또는 확인설명서를 최소 1개 업로드하세요.");
      return;
    }
    const skippedOcr = ["contract", "confirm"].filter(k => wizardDocs[k].file && !wizardDocs[k].ocrDone);
    if (skippedOcr.length) {
      const ok = confirm("아직 OCR/마스킹을 실행하지 않은 문서가 있습니다. 마스킹 없이 원본 그대로 저장하시겠습니까?\n(개인정보가 그대로 남아있을 수 있습니다)");
      if (!ok) return;
    }
    // 거래건 선택 단계 진입 전, 기존 거래건 목록 채워두기
    const groups = groupDeals(dealRows);
    existingDealPicker.setOptions(groups.map(g => ({ value: g.dealId, text: `${g.maemulNo || g.dealId} · 최근 ${g.latestDate || ""}` })));
    showWizardStep(2);
    return;
  }
  if (wizardStep === 2) {
    const maemulNo = document.getElementById("fMaemul").value.trim();
    const date = contractDatePicker.getValue();
    if (!maemulNo) { toast("매물번호를 입력하세요."); return; }
    if (!date) { toast("계약일자를 입력하세요."); return; }
    showWizardStep(3);
    await submitWizard();
    return;
  }
  if (wizardStep === 3) {
    closeWizard();
    return;
  }
}

function wizardGoPrev() {
  if (wizardStep > 1) showWizardStep(wizardStep - 1);
}

async function submitWizard() {
  const progEl = document.getElementById("wizProgress");
  progEl.innerHTML = `<div class="spin"></div>마스킹된 문서를 정리하는 중...`;

  await finalizeDocSlot("contract");
  await finalizeDocSlot("confirm");

  progEl.innerHTML = `<div class="spin"></div>Drive에 업로드하고 저장하는 중... (문서 용량에 따라 최대 1분 정도 걸릴 수 있어요)`;

  const fileContractBase64 = await blobToBase64(wizardDocs.contract.pdfBlob);
  const fileConfirmBase64 = await blobToBase64(wizardDocs.confirm.pdfBlob);

  const payload = {
    dealId: wizardDealMode === "existing" ? existingDealPicker.getValue() : "",
    maemulNo: document.getElementById("fMaemul").value.trim(),
    type: fTypePicker.getValue(),
    date: contractDatePicker.getValue(),
    summary: document.getElementById("fSummary").value.trim(),
    memo: document.getElementById("fMemo").value.trim(),
    fileContractBase64, fileConfirmBase64,
  };

  try {
    const data = await postJSON("contractSave", payload);
    if (data && data.ok) {
      progEl.innerHTML = `✅ 저장 완료 (거래그룹 ${data.dealId})`;
      toast("계약서가 저장되었습니다.");
      loadDeals();
    } else {
      progEl.innerHTML = `❌ 저장 실패: ${(data && data.error) || "알 수 없는 오류"}`;
    }
  } catch (e) {
    progEl.innerHTML = `❌ 네트워크 오류로 저장하지 못했습니다.`;
  }
}

/* ============================================================
   커스텀 달력 팝오버 (네이티브 date input 대체)
   ============================================================ */

function pad2_(n) { return String(n).padStart(2, "0"); }
function fmtDateStr_(y, m, d) { return `${y}-${pad2_(m + 1)}-${pad2_(d)}`; }
function todayStr_() {
  const t = new Date();
  return fmtDateStr_(t.getFullYear(), t.getMonth(), t.getDate());
}

function makeDatePicker(btnId, popId, labelId) {
  const btn = document.getElementById(btnId);
  const pop = document.getElementById(popId);
  const label = document.getElementById(labelId);
  const today = new Date();
  const state = { year: today.getFullYear(), month: today.getMonth(), value: "" };

  function render() {
    const first = new Date(state.year, state.month, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const daysInPrevMonth = new Date(state.year, state.month, 0).getDate();
    const cells = [];
    for (let i = startDow - 1; i >= 0; i--) {
      cells.push({ day: daysInPrevMonth - i, muted: true, dateStr: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, muted: false, dateStr: fmtDateStr_(state.year, state.month, d) });
    }
    while (cells.length % 7 !== 0) {
      const idx = cells.length - (startDow + daysInMonth);
      cells.push({ day: idx + 1, muted: true, dateStr: null });
    }

    const tStr = todayStr_();
    pop.innerHTML = `
      <div class="cal-pop-head">
        <button type="button" class="calPrev">‹</button>
        <span class="cal-title">${state.year}년 ${state.month + 1}월</span>
        <button type="button" class="calNext">›</button>
      </div>
      <div class="cal-weekdays"><span class="sun">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
      <div class="cal-grid">
        ${cells.map(c => {
          if (c.muted) return `<button type="button" class="cal-day muted" disabled>${c.day}</button>`;
          const isToday = c.dateStr === tStr;
          const isSel = c.dateStr === state.value;
          return `<button type="button" class="cal-day${isToday ? " today" : ""}${isSel ? " sel" : ""}" data-date="${c.dateStr}">${c.day}</button>`;
        }).join("")}
      </div>
      <div class="cal-pop-foot">
        <button type="button" class="calClear">삭제</button>
        <button type="button" class="calToday">오늘</button>
      </div>
    `;

    pop.querySelector(".calPrev").addEventListener("click", () => {
      state.month--; if (state.month < 0) { state.month = 11; state.year--; }
      render();
    });
    pop.querySelector(".calNext").addEventListener("click", () => {
      state.month++; if (state.month > 11) { state.month = 0; state.year++; }
      render();
    });
    pop.querySelectorAll(".cal-day[data-date]").forEach(el => {
      el.addEventListener("click", () => {
        state.value = el.dataset.date;
        label.textContent = state.value;
        closePop();
      });
    });
    pop.querySelector(".calToday").addEventListener("click", () => {
      const t = new Date();
      state.year = t.getFullYear(); state.month = t.getMonth();
      state.value = todayStr_();
      label.textContent = state.value;
      render();
      closePop();
    });
    pop.querySelector(".calClear").addEventListener("click", () => {
      state.value = "";
      label.textContent = "날짜 선택";
      closePop();
    });
  }

  function openPop() {
    render();
    pop.classList.add("open");
    btn.classList.add("open");
    document.addEventListener("click", onOutsideClick, true);
  }
  function closePop() {
    pop.classList.remove("open");
    btn.classList.remove("open");
    document.removeEventListener("click", onOutsideClick, true);
  }
  function onOutsideClick(e) {
    if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePop();
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.classList.contains("open")) closePop(); else openPop();
  });

  return {
    getValue: () => state.value,
    setValue: (v) => {
      state.value = v || "";
      label.textContent = state.value || "날짜 선택";
      if (v) {
        const d = new Date(v + "T00:00:00");
        if (!isNaN(d)) { state.year = d.getFullYear(); state.month = d.getMonth(); }
      }
    },
  };
}

let contractDatePicker, clauseDatePicker;

/* ---------------- 커스텀 드롭다운 (네이티브 select 대체, dash-select-pop 재사용) ---------------- */

function makeCustomSelect(btnId, popId, labelId) {
  const btn = document.getElementById(btnId);
  const pop = document.getElementById(popId);
  const label = document.getElementById(labelId);
  let value = "";
  let options = [];

  function render() {
    pop.innerHTML = options.map(o =>
      `<div class="opt${o.value === value ? " sel" : ""}" data-value="${o.value}">${o.text}<span class="ck">✓</span></div>`
    ).join("");
    pop.querySelectorAll(".opt").forEach(el => {
      el.addEventListener("click", () => {
        value = el.dataset.value;
        const opt = options.find(o => o.value === value);
        label.textContent = opt ? opt.text : "선택";
        render();
        closePop();
      });
    });
  }

  function openPop() {
    render();
    pop.classList.add("open");
    btn.classList.add("open");
    document.addEventListener("click", onOutsideClick, true);
  }
  function closePop() {
    pop.classList.remove("open");
    btn.classList.remove("open");
    document.removeEventListener("click", onOutsideClick, true);
  }
  function onOutsideClick(e) {
    if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closePop();
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.classList.contains("open")) closePop(); else openPop();
  });

  return {
    setOptions(opts, selectedValue) {
      options = opts;
      value = selectedValue !== undefined && opts.some(o => o.value === selectedValue)
        ? selectedValue
        : (opts[0] ? opts[0].value : "");
      const opt = options.find(o => o.value === value);
      label.textContent = opt ? opt.text : "선택";
    },
    getValue: () => value,
    setValue(v) {
      value = v || "";
      const opt = options.find(o => o.value === value);
      label.textContent = opt ? opt.text : (options[0] ? "선택" : "선택");
    },
  };
}

let fTypePicker, existingDealPicker, clauseRefPicker;

/* ---------------- 이벤트 바인딩 ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  contractDatePicker = makeDatePicker("fDateBtn", "fDatePop", "fDateLabel");
  clauseDatePicker = makeDatePicker("cDateBtn", "cDatePop", "cDateLabel");
  fTypePicker = makeCustomSelect("fTypeBtn", "fTypePop", "fTypeLabel");
  existingDealPicker = makeCustomSelect("existingDealBtn", "existingDealPop", "existingDealLabel");
  clauseRefPicker = makeCustomSelect("cContractRefBtn", "cContractRefPop", "cContractRefLabel");

  loadAll();

  // 세그먼트 탭
  document.querySelectorAll(".seg-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("panel-contract").classList.toggle("active", tab === "contract");
      document.getElementById("panel-clause").classList.toggle("active", tab === "clause");
      document.getElementById("mainFabLabel").textContent = tab === "contract" ? "새 계약서 등록" : "새 특약 등록";
    });
  });

  document.getElementById("dealSearch").addEventListener("input", renderDealList);
  document.getElementById("clauseSearch").addEventListener("input", renderClauseList);
  document.getElementById("dealRefreshBtn").addEventListener("click", loadDeals);
  document.getElementById("clauseRefreshBtn").addEventListener("click", loadClauses);

  document.getElementById("dealPanelClose").addEventListener("click", closeDealPanel);
  document.getElementById("dealOverlay").addEventListener("click", closeDealPanel);
  document.getElementById("dealPanelAddDoc").addEventListener("click", () => {
    closeDealPanel();
    openWizard();
    wizardDealMode = "existing";
    document.getElementById("dealModeExisting").click();
    const groups = groupDeals(dealRows);
    existingDealPicker.setOptions(groups.map(g => ({ value: g.dealId, text: `${g.maemulNo || g.dealId} · 최근 ${g.latestDate || ""}` })));
    existingDealPicker.setValue(selectedDealId);
    const g = groups.find(g => g.dealId === selectedDealId);
    if (g) document.getElementById("fMaemul").value = g.maemulNo || "";
  });

  // 메인 FAB — 탭에 따라 다른 동작
  document.getElementById("mainFab").addEventListener("click", () => {
    const isContractTab = document.getElementById("panel-contract").classList.contains("active");
    if (isContractTab) openWizard(); else openClauseForm();
  });

  // 마법사
  document.getElementById("wizClose").addEventListener("click", closeWizard);
  document.getElementById("wizNext").addEventListener("click", wizardGoNext);
  document.getElementById("wizPrev").addEventListener("click", wizardGoPrev);
  document.getElementById("dealModeNew").addEventListener("click", () => {
    wizardDealMode = "new";
    document.getElementById("dealModeNew").classList.add("sel");
    document.getElementById("dealModeExisting").classList.remove("sel");
    document.getElementById("existingDealField").style.display = "none";
  });
  document.getElementById("dealModeExisting").addEventListener("click", () => {
    wizardDealMode = "existing";
    document.getElementById("dealModeExisting").classList.add("sel");
    document.getElementById("dealModeNew").classList.remove("sel");
    document.getElementById("existingDealField").style.display = "block";
  });
  document.getElementById("fileContract").addEventListener("change", (e) => {
    handleFileSelected("contract", e.target.files[0] || null, "pagesContract", "statusContract");
  });
  document.getElementById("fileConfirm").addEventListener("change", (e) => {
    handleFileSelected("confirm", e.target.files[0] || null, "pagesConfirm", "statusConfirm");
  });

  // 특약 등록 모달
  document.getElementById("clauseFormClose").addEventListener("click", closeClauseForm);
  document.getElementById("clauseFormCancel").addEventListener("click", closeClauseForm);
  document.getElementById("clauseFormSave").addEventListener("click", saveClause);
});
