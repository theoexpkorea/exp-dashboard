/* ============================================================
   theo 대시보드 — 잠금화면 공유 스크립트

   실제 Apps Script getPass(app=dashboard)를 호출해서 인증합니다.
   '비번' 탭 B1(텍스트 비번) / B2(패턴락 정답, "1,2,5,8,9" 형식)을
   서버에서 읽어와 비교하는 구조 — 정답 자체는 소스에 없습니다.
   ============================================================ */

const DASHBOARD_LOCK = {
  sessionKey: "theo_dashboard_unlocked",
  idleTimeoutMs: 30 * 60 * 1000, // 30분간 활동 없으면 자동 로그아웃
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbzDk9DYfD7okIfp4_MH5asXVxgroC9qlYGL08yHL_0dXPDfWElTdKglhQ-BQxWVoiil/exec",
};

function isMobileViewport() {
  return window.innerWidth <= 600;
}

function isUnlocked() {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_LOCK.sessionKey);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !data.ts) return false;
    if (Date.now() - data.ts > DASHBOARD_LOCK.idleTimeoutMs) {
      sessionStorage.removeItem(DASHBOARD_LOCK.sessionKey);
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function markUnlocked() {
  sessionStorage.setItem(DASHBOARD_LOCK.sessionKey, JSON.stringify({ ts: Date.now() }));
}

// 활동(클릭/터치/키입력/스크롤)이 있을 때마다 마지막 활동 시각을 갱신 — 실제 사용 중엔 로그아웃되지 않도록
let __lastActivityWrite = 0;
function touchActivity() {
  if (!sessionStorage.getItem(DASHBOARD_LOCK.sessionKey)) return;
  const now = Date.now();
  if (now - __lastActivityWrite < 5000) return; // 5초에 한 번만 기록 (과도한 쓰기 방지)
  __lastActivityWrite = now;
  sessionStorage.setItem(DASHBOARD_LOCK.sessionKey, JSON.stringify({ ts: now }));
}
["click", "keydown", "mousemove", "touchstart", "scroll"].forEach((evt) => {
  window.addEventListener(evt, touchActivity, { passive: true });
});

// 페이지가 열려있는 동안 주기적으로 로그아웃 여부 확인 — 시간 지나면 자동으로 잠금화면 다시 노출
function startIdleWatchdog() {
  if (window.__theoIdleWatchdogStarted) return;
  window.__theoIdleWatchdogStarted = true;
  setInterval(() => {
    if (!isUnlocked()) location.reload();
  }, 15000);
}

// JSONP로 Apps Script 호출 (CORS 회피 — 매물뷰/CRM과 동일 패턴)
function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    const script = document.createElement("script");

    window[cbName] = (data) => {
      resolve(data);
      cleanup();
    };
    function cleanup() {
      delete window[cbName];
      script.remove();
    }

    script.onerror = () => {
      cleanup();
      reject(new Error("jsonp_failed"));
    };
    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + cbName;
    document.body.appendChild(script);
  });
}

// 매물뷰/CRM과 동일한 캐싱 패턴: 마지막으로 받은 비번을 localStorage에 영구 저장해뒀다가
// 다음 접속 때는 네트워크를 기다리지 않고 캐시로 즉시 화면을 사용 가능하게 함.
// 네트워크 요청은 뒤에서 조용히 진행해서 캐시를 최신값으로 갱신만 함.
const PASS_CACHE_KEY = "theo_dashboard_pass_cache";
const PATTERN_CACHE_KEY = "theo_dashboard_pattern_cache";

function readCredsCache() {
  try {
    const pass = localStorage.getItem(PASS_CACHE_KEY);
    if (pass === null) return null;
    const patternRaw = localStorage.getItem(PATTERN_CACHE_KEY);
    return { pass, pattern: patternRaw ? JSON.parse(patternRaw) : [] };
  } catch (e) {
    return null;
  }
}

function writeCredsCache(creds) {
  try {
    localStorage.setItem(PASS_CACHE_KEY, creds.pass || "");
    localStorage.setItem(PATTERN_CACHE_KEY, JSON.stringify(creds.pattern || []));
  } catch (e) {
    /* 저장 실패해도 이번 세션 인증 자체엔 지장 없음 */
  }
}

async function fetchDashboardCredsFromServer() {
  const url = `${DASHBOARD_LOCK.appsScriptUrl}?mode=pass&app=dashboard`;
  const data = await fetchJsonp(url);
  return {
    pass: data && data.pass ? String(data.pass) : "",
    pattern: (data && Array.isArray(data.pattern)) ? data.pattern : [],
  };
}

async function initLockScreen(basePrefix = "") {
  if (isUnlocked()) {
    startIdleWatchdog(); // 이미 이번 세션에 인증됨 — 대신 무활동 감시는 계속
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "lock-screen";
  overlay.id = "lock-screen";

  const mobile = false; // 패턴락 비활성화 — 폰에서도 PC와 동일하게 텍스트 비번 사용
  // 다시 패턴락을 쓰고 싶으면 위 줄을 `const mobile = isMobileViewport();` 로 되돌리면 됩니다.
  overlay.innerHTML = mobile ? patternLockMarkup() : passwordLockMarkup();
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  const errorEl = overlay.querySelector("#lock-error");
  const submitBtn = overlay.querySelector('.lock-pw-form button[type="submit"]');
  const patternGrid = overlay.querySelector("#pattern-grid");

  // credsRef.current를 화면(제출 핸들러)이 참조 — 캐시가 있으면 즉시 사용 가능,
  // 없을 때만 로딩 표시를 하고 네트워크 응답을 기다림
  const credsRef = { current: readCredsCache() };
  const hadCache = !!credsRef.current;

  if (!hadCache) {
    if (errorEl) errorEl.textContent = "불러오는 중…";
    if (submitBtn) submitBtn.disabled = true;
    if (patternGrid) patternGrid.classList.add("loading");
  }

  if (mobile) {
    setupPatternLock(overlay, credsRef);
  } else {
    setupPasswordLock(overlay, credsRef);
  }

  // 네트워크에서 최신 비번을 가져와 캐시 갱신 (화면은 이미 캐시로 사용 가능한 상태이므로 기다리지 않음)
  try {
    const fresh = await fetchDashboardCredsFromServer();
    credsRef.current = fresh;
    writeCredsCache(fresh);
    if (!hadCache) {
      if (submitBtn) submitBtn.disabled = false;
      if (patternGrid) patternGrid.classList.remove("loading");
      if (errorEl) errorEl.textContent = mobile ? "패턴을 그려주세요" : "";
    }
  } catch (e) {
    if (!hadCache) {
      if (errorEl) errorEl.textContent = "서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요";
    }
    // 캐시가 있었다면 조용히 무시 — 화면은 이미 캐시 값으로 사용 가능한 상태
  }
}

function unlockAndRemove(overlay) {
  markUnlocked();
  startIdleWatchdog();
  document.body.style.overflow = "";
  overlay.remove();
}

function passwordLockMarkup() {
  return `
    <div class="lock-box">
      <div class="lock-brand">
        <span class="lock-key-icon">${keyIconSvg()}</span>
        <span class="mark">the<span class="o">o</span></span>
        <span class="sub">업무현황 · eXp Korea</span>
      </div>
      <form class="lock-pw-form" id="lock-pw-form">
        <input type="password" id="lock-pw-input" placeholder="비밀번호" autocomplete="off" name="dash-pw-${Date.now()}" data-lpignore="true" autocorrect="off" />
        <button type="submit">입장</button>
      </form>
      <div class="lock-error" id="lock-error"></div>
    </div>
  `;
}

function setupPasswordLock(overlay, credsRef) {
  const form = overlay.querySelector("#lock-pw-form");
  const input = overlay.querySelector("#lock-pw-input");
  const errorEl = overlay.querySelector("#lock-error");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const creds = credsRef.current;
    if (!creds) {
      errorEl.textContent = "서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요";
      return;
    }
    if (creds.pass && input.value === creds.pass) {
      unlockAndRemove(overlay);
    } else {
      errorEl.textContent = "비밀번호가 올바르지 않습니다";
      input.value = "";
      input.focus();
    }
  });

  setTimeout(() => input.focus(), 50);
}

function patternLockMarkup() {
  const dots = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((n) => `<div class="pattern-dot" data-n="${n}"></div>`)
    .join("");
  return `
    <div class="lock-box">
      <div class="lock-brand">
        <span class="lock-key-icon">${keyIconSvg()}</span>
        <span class="mark">the<span class="o">o</span></span>
        <span class="sub">업무현황 · eXp Korea</span>
      </div>
      <div class="pattern-grid" id="pattern-grid">
        <svg class="pattern-svg" id="pattern-svg"></svg>
        ${dots}
      </div>
      <div class="lock-error" id="lock-error">패턴을 그려주세요</div>
    </div>
  `;
}

function setupPatternLock(overlay, credsRef) {
  const grid = overlay.querySelector("#pattern-grid");
  const svg = overlay.querySelector("#pattern-svg");
  const dotEls = Array.from(overlay.querySelectorAll(".pattern-dot"));
  const errorEl = overlay.querySelector("#lock-error");
  const creds = credsRef.current;

  if (!creds) {
    errorEl.textContent = "서버에 연결할 수 없습니다";
    return; // 서버 응답 없으면 그리기 자체를 막음
  }
  if (!creds.pattern || creds.pattern.length < 3) {
    errorEl.textContent = "패턴이 설정되지 않았습니다 (비번 탭 B2 확인)";
    return;
  }

  const positions = {};
  [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((n, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    positions[n] = { x: 30 + col * 100, y: 30 + row * 100 };
  });
  dotEls.forEach((dot) => {
    const n = Number(dot.dataset.n);
    dot.style.left = positions[n].x + "px";
    dot.style.top = positions[n].y + "px";
  });

  let drawing = false;
  let sequence = [];
  let errorState = false;
  let lastX = null;
  let lastY = null;

  function reset(isError) {
    sequence = [];
    errorState = false;
    lastX = null;
    lastY = null;
    dotEls.forEach((d) => d.classList.remove("active", "error"));
    svg.innerHTML = "";
    errorEl.textContent = isError ? "패턴이 올바르지 않습니다. 다시 시도하세요" : "패턴을 그려주세요";
  }

  function addPoint(n) {
    if (sequence.includes(n)) return;
    sequence.push(n);
    dotEls.find((d) => Number(d.dataset.n) === n).classList.add("active");
    drawLines();
  }

  function drawLines() {
    const lineColor = errorState ? "var(--danger)" : "var(--accent)";
    svg.innerHTML = sequence
      .map((n, i) => {
        if (i === 0) return "";
        const a = positions[sequence[i - 1]];
        const b = positions[n];
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${lineColor}" stroke-width="6" stroke-linecap="round"/>`;
      })
      .join("");
  }

  function toLocal(clientX, clientY) {
    const rect = grid.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // 점(px,py)이 선분(x1,y1)-(x2,y2)에서 얼마나 가까운지, 그리고 선분 위 어느 지점(t)인지 계산
  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), t };
  }

  const HIT_RADIUS = 30;

  // 현재 위치에서 바로 위 점 판정 (터치 시작 시 등 단일 지점 판정용)
  function dotAtPoint(x, y) {
    for (const dot of dotEls) {
      const n = Number(dot.dataset.n);
      const p = positions[n];
      if (Math.hypot(p.x - x, p.y - y) < HIT_RADIUS) return n;
    }
    return null;
  }

  // 이전 위치→현재 위치 사이 궤적을 따라 지나친 점들을 순서대로 모두 잡아냄 (빠른 스와이프 대비)
  function addPointsAlongPath(x1, y1, x2, y2) {
    const candidates = [];
    for (const dot of dotEls) {
      const n = Number(dot.dataset.n);
      if (sequence.includes(n)) continue;
      const p = positions[n];
      const { dist, t } = distToSegment(p.x, p.y, x1, y1, x2, y2);
      if (dist < HIT_RADIUS) candidates.push({ n, t });
    }
    candidates.sort((a, b) => a.t - b.t);
    candidates.forEach((c) => addPoint(c.n));
  }

  function vibrateError() {
    if (navigator.vibrate) {
      navigator.vibrate([80, 40, 80, 40, 120]);
    }
  }

  function finish() {
    drawing = false;
    const match =
      sequence.length === creds.pattern.length &&
      sequence.every((v, i) => v === creds.pattern[i]);

    if (match) {
      unlockAndRemove(overlay);
    } else {
      errorState = true;
      dotEls.forEach((d) => { if (d.classList.contains("active")) d.classList.add("error"); });
      drawLines();
      vibrateError();
      setTimeout(() => reset(true), 320);
    }
  }

  grid.addEventListener("pointerdown", (e) => {
    drawing = true;
    reset(false);
    const { x, y } = toLocal(e.clientX, e.clientY);
    const n = dotAtPoint(x, y);
    if (n) addPoint(n);
    lastX = x;
    lastY = y;
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const { x, y } = toLocal(e.clientX, e.clientY);
    if (lastX !== null) {
      addPointsAlongPath(lastX, lastY, x, y);
    } else {
      const n = dotAtPoint(x, y);
      if (n) addPoint(n);
    }
    lastX = x;
    lastY = y;
  });
  window.addEventListener("pointerup", () => {
    if (!drawing || sequence.length === 0) return;
    finish();
  });
}

function keyIconSvg() {
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8" cy="15" r="4.2"/><path d="M11 12.2 19.5 3.7M16.5 6.7l2.3 2.3M19 4.2l2.3 2.3"/>
  </svg>`;
}
