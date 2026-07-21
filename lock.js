/* ============================================================
   theo 대시보드 — 잠금화면 공유 스크립트

   TODO(연동 예정): 지금은 자리만 잡아둔 상태.
   실제로는 Apps Script doGet(mode=pass&app=dashboard) 호출해서
   '비번' 탭의 대시보드 전용 셀 값과 비교해야 함.
   매물뷰/CRM 비번과는 완전히 별도 셀 사용 예정.
   ============================================================ */

const DASHBOARD_LOCK = {
  sessionKey: "theo_dashboard_unlocked",
  // TODO: Apps Script 연동 전까지 쓰는 임시 값. 실연동 시 이 상수 제거.
  placeholderPassword: "theo2026",
  placeholderPattern: [1, 2, 5, 8, 9],
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

function initLockScreen(basePrefix = "") {
  if (isUnlocked()) return; // 이미 이번 세션에 인증됨

  const overlay = document.createElement("div");
  overlay.className = "lock-screen";
  overlay.id = "lock-screen";

  overlay.innerHTML = isMobileViewport() ? patternLockMarkup() : passwordLockMarkup();
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  if (isMobileViewport()) {
    setupPatternLock(overlay);
  } else {
    setupPasswordLock(overlay);
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

function setupPasswordLock(overlay) {
  const form = overlay.querySelector("#lock-pw-form");
  const input = overlay.querySelector("#lock-pw-input");
  const errorEl = overlay.querySelector("#lock-error");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value === DASHBOARD_LOCK.placeholderPassword) {
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

function setupPatternLock(overlay) {
  const grid = overlay.querySelector("#pattern-grid");
  const svg = overlay.querySelector("#pattern-svg");
  const dotEls = Array.from(overlay.querySelectorAll(".pattern-dot"));
  const errorEl = overlay.querySelector("#lock-error");

  // 3x3 좌표 배치
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

  function reset(errorState) {
    sequence = [];
    dotEls.forEach((d) => d.classList.remove("active", "error"));
    svg.innerHTML = "";
    if (errorState) {
      errorEl.textContent = "패턴이 올바르지 않습니다. 다시 시도하세요";
    } else {
      errorEl.textContent = "패턴을 그려주세요";
    }
  }

  function addPoint(n) {
    if (sequence.includes(n)) return;
    sequence.push(n);
    const dot = dotEls.find((d) => Number(d.dataset.n) === n);
    dot.classList.add("active");
    drawLines();
  }

  function drawLines() {
    svg.innerHTML = sequence
      .map((n, i) => {
        if (i === 0) return "";
        const a = positions[sequence[i - 1]];
        const b = positions[n];
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>`;
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
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < 24) return n;
    }
    return null;
  }

  function finish() {
    drawing = false;
    const match =
      sequence.length === DASHBOARD_LOCK.placeholderPattern.length &&
      sequence.every((v, i) => v === DASHBOARD_LOCK.placeholderPattern[i]);

    if (match) {
      unlockAndRemove(overlay);
    } else {
      dotEls.forEach((d) => {
        if (d.classList.contains("active")) d.classList.add("error");
      });
      setTimeout(() => reset(true), 260);
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
    if (!drawing) return;
    if (sequence.length === 0) return;
    finish();
  });
}

function keyIconSvg() {
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8" cy="15" r="4.2"/><path d="M11 12.2 19.5 3.7M16.5 6.7l2.3 2.3M19 4.2l2.3 2.3"/>
  </svg>`;
}
