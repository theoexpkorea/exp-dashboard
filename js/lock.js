/* ============================================================
   theo 대시보드 — 잠금화면 공유 스크립트

   실제 Apps Script getPass(app=dashboard)를 호출해서 인증합니다.
   '비번' 탭 B1(텍스트 비번) / B2(패턴락 정답, "1,2,5,8,9" 형식)을
   서버에서 읽어와 비교하는 구조 — 정답 자체는 소스에 없습니다.
   ============================================================ */

const DASHBOARD_LOCK = {
  sessionKey: "theo_dashboard_unlocked",
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbzDk9DYfD7okIfp4_MH5asXVxgroC9qlYGL08yHL_0dXPDfWElTdKglhQ-BQxWVoiil/exec",
};

function isMobileViewport() {
  return window.innerWidth <= 600;
}

function isUnlocked() {
  return sessionStorage.getItem(DASHBOARD_LOCK.sessionKey) === "1";
}

function markUnlocked() {
  sessionStorage.setItem(DASHBOARD_LOCK.sessionKey, "1");
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

async function fetchDashboardCreds() {
  const url = `${DASHBOARD_LOCK.appsScriptUrl}?mode=pass&app=dashboard`;
  const data = await fetchJsonp(url);
  return {
    pass: data && data.pass ? String(data.pass) : "",
    pattern: (data && Array.isArray(data.pattern)) ? data.pattern : [],
  };
}

async function initLockScreen(basePrefix = "") {
  if (isUnlocked()) return; // 이미 이번 세션에 인증됨

  const overlay = document.createElement("div");
  overlay.className = "lock-screen";
  overlay.id = "lock-screen";

  const mobile = isMobileViewport();
  overlay.innerHTML = mobile ? patternLockMarkup() : passwordLockMarkup();
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  let creds = null;
  let loadError = false;
  try {
    creds = await fetchDashboardCreds();
  } catch (e) {
    loadError = true;
  }

  if (mobile) {
    setupPatternLock(overlay, creds, loadError);
  } else {
    setupPasswordLock(overlay, creds, loadError);
  }
}

function unlockAndRemove(overlay) {
  markUnlocked();
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

function setupPasswordLock(overlay, creds, loadError) {
  const form = overlay.querySelector("#lock-pw-form");
  const input = overlay.querySelector("#lock-pw-input");
  const errorEl = overlay.querySelector("#lock-error");

  if (loadError || !creds) {
    errorEl.textContent = "서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
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

function setupPatternLock(overlay, creds, loadError) {
  const grid = overlay.querySelector("#pattern-grid");
  const svg = overlay.querySelector("#pattern-svg");
  const dotEls = Array.from(overlay.querySelectorAll(".pattern-dot"));
  const errorEl = overlay.querySelector("#lock-error");

  if (loadError || !creds) {
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

  function reset(isError) {
    sequence = [];
    errorState = false;
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

  function dotAt(clientX, clientY) {
    const rect = grid.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const dot of dotEls) {
      const n = Number(dot.dataset.n);
      const p = positions[n];
      if (Math.hypot(p.x - x, p.y - y) < 30) return n;
    }
    return null;
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
    const n = dotAt(e.clientX, e.clientY);
    if (n) addPoint(n);
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const n = dotAt(e.clientX, e.clientY);
    if (n) addPoint(n);
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
