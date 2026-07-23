/* ============================================================
   theo 대시보드 — 즐겨찾기 (js/favorites.js)
   우측 패널(넓은 화면, data-fav-mount="desktop")과
   모바일 사이드바 섹션(data-fav-mount="mobile")에서 공유 사용.

   백엔드: 매물장필터뷰 Apps Script에 mode=favoritesList / favoritesSave 추가 필요
   시트: '즐겨찾기' 탭 (A=순서, B=이름, C=URL)
   ============================================================ */

const FAV_DATA_URL = (typeof DASHBOARD_LOCK !== "undefined" && DASHBOARD_LOCK.appsScriptUrl) || "";
const FAV_CACHE_KEY = "theo_dashboard_fav_cache_v1";

// 시트가 아직 없거나(첫 실행) 캐시가 전혀 없을 때만 쓰이는 기본값 — 필요하면 편집모드에서 바로 수정 가능
const FAV_DEFAULTS = [
  { name: "네이버지도", url: "https://map.naver.com/" },
  { name: "네이버부동산", url: "https://land.naver.com/" },
  { name: "구글지도", url: "https://maps.google.com/" },
  { name: "토지이음", url: "https://www.eum.go.kr/" },
  { name: "상권분석", url: "https://golmok.seoul.go.kr/" },
  { name: "소상공인365", url: "https://www.sbiz365.kr/" },
];

let favItems = [];
let favEditing = false;
let favDragIdx = null;
let favSaveTimer = null;
let favLoaded = false; // 서버 응답을 한 번이라도 받았는지 (받기 전엔 저장 안 함 — 빈 캐시로 서버 덮어쓰기 방지)

function favEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 모든 자동/수동 파비콘이 실패했을 때 최종적으로 쓰이는 회색 지구본 (항상 로드 성공하는 data URI)
const FAV_ICON_FALLBACK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20'/%3E%3C/svg%3E";

// f = { name, url, icon? } — icon이 있으면 수동 지정 아이콘을 최우선으로 사용
// icon이 없으면 구글 파비콘 → DuckDuckGo 파비콘 → 기본 지구본 순으로 시도
function favIconChain(f) {
  if (f.icon) {
    return { src: f.icon, fallbacks: [FAV_ICON_FALLBACK] };
  }
  let host;
  try {
    host = new URL(f.url).hostname;
  } catch (e) {
    return { src: FAV_ICON_FALLBACK, fallbacks: [] };
  }
  const google = "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=64";
  const ddg = "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(host) + ".ico";
  return { src: google, fallbacks: [ddg, FAV_ICON_FALLBACK] };
}

// <img onerror="favIconFallback(this)"> 에서 호출 — data-fav-chain에 남은 후보를 순서대로 시도
function favIconFallback(img) {
  let chain = [];
  try {
    chain = JSON.parse(img.dataset.favChain || "[]");
  } catch (e) {}
  if (chain.length) {
    const next = chain.shift();
    img.dataset.favChain = JSON.stringify(chain);
    img.src = next;
  } else {
    img.onerror = null;
    img.src = FAV_ICON_FALLBACK;
  }
}
window.favIconFallback = favIconFallback;

/* ===== JSONP (일정관리/파밍현황과 동일 패턴) ===== */
function favJsonp(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cb = "__favdash_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    const s = document.createElement("script");
    let done = false;
    window[cb] = (data) => {
      done = true;
      cleanup();
      resolve(data);
    };
    function cleanup() {
      try {
        delete window[cb];
      } catch (e) {}
      if (s.parentNode) s.parentNode.removeChild(s);
    }
    s.onerror = () => {
      if (!done) {
        cleanup();
        reject(new Error("load fail"));
      }
    };
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    s.src = url + sep + "callback=" + cb;
    document.head.appendChild(s);
    setTimeout(() => {
      if (!done) {
        cleanup();
        reject(new Error("timeout"));
      }
    }, timeoutMs || 15000);
  });
}
async function favJsonpRetry(url, timeoutMs) {
  try {
    return await favJsonp(url, timeoutMs);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 800));
    return await favJsonp(url, timeoutMs);
  }
}
function favBuildUrl(mode, params) {
  const p = Object.assign({ mode: mode }, params || {});
  const qs = Object.keys(p)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(p[k] == null ? "" : p[k]))
    .join("&");
  return FAV_DATA_URL + "?" + qs;
}

/* ===== 로컬 캐시 (즉시 표시 → 백그라운드 갱신) ===== */
function favReadCache() {
  try {
    const raw = localStorage.getItem(FAV_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function favWriteCache(items) {
  try {
    localStorage.setItem(FAV_CACHE_KEY, JSON.stringify({ items: items || [], savedAt: Date.now() }));
  } catch (e) {}
}

function favMountEls() {
  return Array.from(document.querySelectorAll("[data-fav-mount]"));
}

async function favInit() {
  const cached = favReadCache();
  favItems = cached && Array.isArray(cached.items) && cached.items.length ? cached.items : FAV_DEFAULTS.slice();
  favRenderAll();

  if (!FAV_DATA_URL) return;
  try {
    const res = await favJsonpRetry(favBuildUrl("favoritesList"), 15000);
    if (Array.isArray(res)) {
      favLoaded = true;
      // 서버에 아직 시트/데이터가 없으면(빈 배열) 기본값을 그대로 보여주고, 있으면 서버 값을 신뢰
      favItems = res.length
        ? res.map((r) => (r.icon ? { name: r.name, url: r.url, icon: r.icon } : { name: r.name, url: r.url }))
        : favItems;
      favWriteCache(favItems);
      favRenderAll();
    }
  } catch (e) {
    /* 캐시로 이미 표시된 상태 — 실패해도 조용히 무시 */
  }
}

function favSaveRemote() {
  if (!FAV_DATA_URL || !favLoaded) return; // 서버 응답을 받기 전에는 절대 저장하지 않음(빈 값으로 덮어쓰기 방지)
  clearTimeout(favSaveTimer);
  favSaveTimer = setTimeout(async () => {
    try {
      await favJsonpRetry(favBuildUrl("favoritesSave", { list: JSON.stringify(favItems) }), 15000);
    } catch (e) {
      /* 실패해도 로컬엔 반영되어 있고, 다음 로드 때 재동기화 시도됨 */
    }
  }, 500);
}

function favPersist() {
  favWriteCache(favItems);
  favSaveRemote();
}

function favRenderAll() {
  favMountEls().forEach(favRenderInto);
}

function favRenderInto(mount) {
  const mid = mount.dataset.favMount;

  const editBtnHtml = favEditing
    ? `<button type="button" class="fav-edit-toggle on" data-fav-action="done">완료</button>`
    : `<button type="button" class="fav-edit-toggle" data-fav-action="edit" title="편집">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </button>`;

  const listHtml = favItems
    .map(
      (f, i) => `
    <div class="fav-item${favEditing ? " editing" : ""}" data-fav-idx="${i}" ${favEditing ? 'draggable="true"' : ""}>
      ${
        favEditing
          ? `<span class="fav-drag-handle">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>
      </span>`
          : ""
      }
      ${(() => {
        const ic = favIconChain(f);
        return `<img class="fav-icon${f.icon ? " fav-icon-custom" : ""}" src="${favEsc(ic.src)}" data-fav-chain="${favEsc(
          JSON.stringify(ic.fallbacks)
        )}" onerror="favIconFallback(this)" alt="" width="18" height="18" loading="lazy" />`;
      })()}
      ${
        favEditing
          ? `<input class="fav-name-input" type="text" value="${favEsc(f.name)}" data-fav-field="name" />`
          : `<a class="fav-link" href="${favEsc(f.url)}" target="_blank" rel="noopener">${favEsc(f.name)}</a>`
      }
      ${
        favEditing
          ? `
        <button type="button" class="fav-mini-btn" data-fav-action="icon" title="아이콘 직접 지정">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </button>
        <button type="button" class="fav-mini-btn" data-fav-action="up" title="위로">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
        </button>
        <button type="button" class="fav-mini-btn" data-fav-action="down" title="아래로">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <button type="button" class="fav-mini-btn danger" data-fav-action="delete" title="삭제">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14"/></svg>
        </button>
      `
          : ""
      }
    </div>
  `
    )
    .join("");

  const addFormHtml = favEditing
    ? `
    <div class="fav-add-row">
      <input type="text" class="fav-add-input" id="fav-add-name-${mid}" placeholder="이름" />
      <input type="text" class="fav-add-input" id="fav-add-url-${mid}" placeholder="URL" />
      <button type="button" class="fav-add-btn" data-fav-action="add" data-mount="${mid}">+ 추가</button>
    </div>
    <button type="button" class="fav-sort-btn" data-fav-action="sort">이름순 정렬</button>
  `
    : "";

  mount.innerHTML = `
    <div class="fav-head">
      <span class="fav-title">즐겨찾기</span>
      ${editBtnHtml}
    </div>
    <div class="fav-list">${listHtml || '<div class="fav-empty">즐겨찾기가 없습니다</div>'}</div>
    ${addFormHtml}
  `;

  favBindEvents(mount);
}

function favBindEvents(mount) {
  mount.querySelectorAll("[data-fav-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.favAction;

      if (action === "edit") {
        favEditing = true;
        favRenderAll();
        return;
      }
      if (action === "done") {
        favEditing = false;
        favRenderAll();
        return;
      }
      if (action === "sort") {
        favItems.sort((a, b) => a.name.localeCompare(b.name, "ko"));
        favPersist();
        favRenderAll();
        return;
      }
      if (action === "add") {
        const mid = btn.dataset.mount;
        const nameEl = document.getElementById("fav-add-name-" + mid);
        const urlEl = document.getElementById("fav-add-url-" + mid);
        const name = (nameEl.value || "").trim();
        let url = (urlEl.value || "").trim();
        if (!name || !url) return;
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        favItems.push({ name, url });
        favPersist();
        favRenderAll();
        return;
      }

      const item = btn.closest(".fav-item");
      if (!item) return;
      const idx = Number(item.dataset.favIdx);

      if (action === "icon") {
        const current = favItems[idx].icon || "";
        const val = window.prompt(
          "아이콘 이미지 URL을 직접 입력하세요.\n비워두고 확인을 누르면 자동 파비콘으로 되돌아갑니다.",
          current
        );
        if (val === null) return; // 취소
        const trimmed = val.trim();
        if (trimmed) favItems[idx].icon = trimmed;
        else delete favItems[idx].icon;
        favPersist();
        favRenderAll();
        return;
      }

      if (action === "delete") {
        favItems.splice(idx, 1);
        favPersist();
        favRenderAll();
      } else if (action === "up" && idx > 0) {
        [favItems[idx - 1], favItems[idx]] = [favItems[idx], favItems[idx - 1]];
        favPersist();
        favRenderAll();
      } else if (action === "down" && idx < favItems.length - 1) {
        [favItems[idx + 1], favItems[idx]] = [favItems[idx], favItems[idx + 1]];
        favPersist();
        favRenderAll();
      }
    });
  });

  mount.querySelectorAll(".fav-name-input").forEach((input) => {
    input.addEventListener("change", () => {
      const idx = Number(input.closest(".fav-item").dataset.favIdx);
      const v = input.value.trim();
      if (v) {
        favItems[idx].name = v;
        favPersist();
      }
    });
    input.addEventListener("click", (e) => e.stopPropagation());
  });

  mount.querySelectorAll('.fav-item[draggable="true"]').forEach((item) => {
    item.addEventListener("dragstart", () => {
      favDragIdx = Number(item.dataset.favIdx);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const dropIdx = Number(item.dataset.favIdx);
      if (favDragIdx === null || favDragIdx === dropIdx) return;
      const moved = favItems.splice(favDragIdx, 1)[0];
      favItems.splice(dropIdx, 0, moved);
      favDragIdx = null;
      favPersist();
      favRenderAll();
    });
  });
}

document.addEventListener("DOMContentLoaded", favInit);
