/* ============================================================
   theo 대시보드 — 사이드바 공유 스크립트
   각 페이지에서 renderSidebar('매물현황' 같은 key)로 호출
   ============================================================ */

const NAV_WORKAREAS = [
  { key: "maemul", label: "매물현황", href: "pages/maemul-status.html", icon: "home" },
  { key: "recommend", label: "추천매물", href: "pages/recommend-management.html", icon: "star" },
  { key: "farming", label: "파밍현황", href: "pages/farming-status.html", icon: "map" },
  { key: "customer", label: "고객관리", href: "pages/customer-management.html", icon: "users" },
  { key: "schedule", label: "일정관리", href: "pages/schedule-management.html", icon: "calendar" },
  { key: "marketing", label: "마케팅툴", href: null, icon: "megaphone", disabled: true, tag: "추가예정" },
];

const NAV_APPLINKS = [
  { key: "app-maemul", label: "매물 필터뷰", href: "https://theoexpkorea.github.io/exp-maemul/", icon: "grid" },
  { key: "app-client", label: "추천매물", href: "https://theoexpkorea.github.io/exp-client/", icon: "star" },
  { key: "app-card", label: "명함스캔", href: "https://theoexpkorea.github.io/card-scanner/", icon: "idcard" },
  { key: "app-contact", label: "상담신청", href: "https://theoexpkorea.github.io/exp-client/contact.html", icon: "message" },
  { key: "app-crm", label: "CRM 관리", href: "https://theoexpkorea.github.io/exp-crm/", icon: "users" },
  { key: "app-farming", label: "파밍서치", href: "https://theoexpkorea.github.io/exp-farming/", icon: "search" },
];

const NAV_ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  map: '<path d="M9 20 3 17V5l6 3m0 12 6-3m-6 3V8m6 9 6 3V8l-6-3m0 12V5m0 0L9 8"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.2 14.3c2.7.4 4.8 2.6 4.8 5.7"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h2l4 3.5V5.5L6 9H4a1 1 0 0 0-1 1Z"/><path d="M14 8.2a4.5 4.5 0 0 1 0 7.6M17.2 5.8a8.8 8.8 0 0 1 0 12.4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.3"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.3"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.3"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.3"/>',
  star: '<path d="M12 3.2 14.7 9l6.3.6-4.7 4.2 1.4 6.2-5.7-3.4-5.7 3.4 1.4-6.2-4.7-4.2 6.3-.6Z"/>',
  idcard: '<rect x="2.5" y="5" width="19" height="14" rx="2.2"/><circle cx="8.6" cy="11" r="2"/><path d="M6 15.7c.5-1.4 1.7-2.1 2.6-2.1s2.1.7 2.6 2.1"/><path d="M14 9h5M14 13h5"/>',
  message: '<path d="M4 5.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9.5l-4 3.5v-3.5H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.7"/><path d="m20 20-4.2-4.2"/>',
  logout: '<path d="M8.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5"/><path d="m15.5 16.5 4.5-4.5-4.5-4.5"/><path d="M20 12H9"/>',
};

function svgIcon(name, size = 18) {
  const body = NAV_ICONS[name] || "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function navItemHtml(item, activeKey, basePrefix) {
  const isActive = item.key === activeKey;
  const classes = ["nav-item"];
  if (isActive) classes.push("active");
  if (item.disabled) classes.push("disabled");

  const iconHtml = item.icon ? svgIcon(item.icon, 17) : "";
  const tagHtml = item.tag ? `<span class="soon-tag">${item.tag}</span>` : "";
  const href = item.disabled ? "#" : (item.href.startsWith("http") ? item.href : basePrefix + item.href);

  return `<a class="${classes.join(" ")}" href="${href}" ${item.disabled ? 'aria-disabled="true" tabindex="-1"' : ""}>
    ${iconHtml}<span>${item.label}</span>${tagHtml}
  </a>`;
}

function renderSidebar(activeKey, opts = {}) {
  const basePrefix = opts.basePrefix || ""; // 하위 페이지에서 루트로 갈 때 접두사 (예: "../")
  const mount = document.getElementById("sidebar-mount");
  if (!mount) return;

  const rootHref = basePrefix ? basePrefix + "index.html" : "index.html";

  mount.innerHTML = `
    <div class="sidebar-scrim" id="sidebar-scrim"></div>
    <aside class="sidebar" id="sidebar">
      <a class="sidebar-brand" href="${rootHref}">
        <span class="mark">the<span class="o">o</span></span>
        <span class="sub">업무현황 · eXp Korea</span>
      </a>
      <nav class="sidebar-scroll">
        <div class="nav-group" data-group="work">
          <button class="nav-group-label" type="button">
            업무 영역
            ${svgIcon("chevron", 14).replace("<svg", '<svg class="chevron"')}
          </button>
          <div class="nav-group-items">
            ${NAV_WORKAREAS.map((i) => navItemHtml(i, activeKey, basePrefix)).join("")}
          </div>
        </div>

        <div class="nav-divider"></div>

        <div class="nav-group" data-group="apps">
          <button class="nav-group-label" type="button">
            앱 바로가기
            ${svgIcon("chevron", 14).replace("<svg", '<svg class="chevron"')}
          </button>
          <div class="nav-group-items">
            ${NAV_APPLINKS.map((i) => `<a class="nav-item" href="${i.href}" target="_blank" rel="noopener">
              ${svgIcon(i.icon, 17)}<span>${i.label}</span>
            </a>`).join("")}
          </div>
        </div>
      </nav>

      <div class="sidebar-admin-wrap">
        <button type="button" class="sidebar-admin" id="admin-trigger">
          <div class="admin-avatar">T</div>
          <div class="admin-meta">
            <div class="admin-name">theo</div>
            <div class="admin-org">관리자 · eXp Korea</div>
          </div>
          ${svgIcon("chevron", 13).replace("<svg", '<svg class="admin-chevron"')}
        </button>
        <div class="admin-menu" id="admin-menu">
          <button type="button" class="admin-menu-item" id="admin-logout">
            ${svgIcon("logout", 16)}<span>로그아웃</span>
          </button>
        </div>
      </div>
    </aside>
  `;

  // 아코디언 토글
  mount.querySelectorAll(".nav-group-label").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".nav-group").classList.toggle("collapsed");
    });
  });

  // 모바일 슬라이드
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("sidebar-scrim");
  const hamburger = document.getElementById("hamburger-btn");

  function openSidebar() {
    sidebar.classList.add("open");
    scrim.classList.add("open");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    scrim.classList.remove("open");
  }
  if (hamburger) hamburger.addEventListener("click", openSidebar);
  scrim.addEventListener("click", closeSidebar);

  // 관리자 프로필 클릭 → 로그아웃 드롭다운 토글
  const adminTrigger = mount.querySelector("#admin-trigger");
  const adminMenu = mount.querySelector("#admin-menu");
  const logoutBtn = mount.querySelector("#admin-logout");

  if (adminTrigger && adminMenu) {
    adminTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      adminMenu.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      if (!adminMenu.contains(e.target) && !adminTrigger.contains(e.target)) {
        adminMenu.classList.remove("open");
      }
    });
  }
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (typeof theoLogout === "function") theoLogout();
    });
  }
}
