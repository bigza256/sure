// ============================================
// SURE — shared UI helpers
// Track the Pool. Follow Every Bet.
// ============================================

export const $  = (s, r=document) => r.querySelector(s);
export const $$ = (s, r=document) => [...r.querySelectorAll(s)];

// ---- App-wide constant ----
export const APP_TAGLINE = "SURE — Track the Pool. Follow Every Bet.";

// ---- Formatting ----
export function formatUGX(n){
  const v = Number(n || 0);
  return "UGX " + v.toLocaleString("en-UG", { maximumFractionDigits: 0 });
}

export function formatNumber(n){
  return Number(n || 0).toLocaleString("en-UG", { maximumFractionDigits: 2 });
}

export function formatDate(ts){
  if(!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if(isNaN(d)) return "—";

  return d.toLocaleDateString("en-GB", {
    day:"2-digit",
    month:"short",
    year:"numeric"
  });
}

export function formatDateTime(ts){
  if(!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if(isNaN(d)) return "—";

  return d.toLocaleString("en-GB", {
    day:"2-digit",
    month:"short",
    year:"numeric",
    hour:"2-digit",
    minute:"2-digit"
  });
}

export function timeAgo(ts){
  if(!ts) return "—";

  const s = Math.floor((Date.now() - Number(ts)) / 1000);

  if(s < 60)     return "just now";
  if(s < 3600)   return Math.floor(s/60) + "m ago";
  if(s < 86400)  return Math.floor(s/3600) + "h ago";
  if(s < 604800) return Math.floor(s/86400) + "d ago";

  return formatDate(ts);
}

export function initials(name=""){
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0,2)
    .map(w => w[0] || "")
    .join("")
    .toUpperCase() || "U";
}

export function esc(s=""){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  })[c]);
}

export function statusBadge(status){
  const s = String(status || "").toLowerCase();

  const map = {
    pending:"pending",
    approved:"approved",
    rejected:"rejected",
    win:"win",
    loss:"loss",
    void:"void",
    completed:"completed",
    processing:"processing",
    active:"active",
    suspended:"suspended",
    requested:"pending",
    clarification:"pending",
    cancelled:"void"
  };

  const cls = map[s] || "void";

  return `<span class="badge badge-${cls}">${esc(status || "—")}</span>`;
}

// ============================================
// TOAST
// ============================================

let toastWrap;

export function toast(msg, type="", ms=3200){
  if(!toastWrap){
    toastWrap = document.createElement("div");
    toastWrap.className = "toast-wrap";
    document.body.appendChild(toastWrap);
  }

  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;

  toastWrap.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(12px)";
    el.style.transition = ".2s";
  }, ms - 200);

  setTimeout(() => el.remove(), ms);
}

// ============================================
// MODAL
// ============================================

export function openModal(html){
  closeModal();

  const ov = document.createElement("div");
  ov.className = "modal-overlay";

  ov.innerHTML = `<div class="modal">${html}</div>`;

  ov.addEventListener("click", e => {
    if(e.target === ov) closeModal();
  });

  document.body.appendChild(ov);

  requestAnimationFrame(() => ov.classList.add("open"));

  const close = ov.querySelector("[data-close]");
  close && close.addEventListener("click", closeModal);

  return ov;
}

export function closeModal(){
  const ov = document.querySelector(".modal-overlay");

  if(ov){
    ov.classList.remove("open");
    setTimeout(() => ov.remove(), 250);
  }
}

export function confirmDialog({
  title="Confirm",
  message="",
  confirmText="Confirm",
  danger=false
}){
  return new Promise(resolve => {

    const ov = openModal(`
      <div class="modal-head">
        <h3>${esc(title)}</h3>

        <button
          class="modal-close"
          data-close
          type="button"
        >✕</button>
      </div>

      <p style="color:var(--gray-600);font-size:.92rem">
        ${message}
      </p>

      <div class="modal-actions">

        <button
          class="btn btn-outline"
          data-no
          type="button"
        >
          Cancel
        </button>

        <button
          class="btn ${danger ? "btn-danger" : "btn-royal"}"
          data-yes
          type="button"
        >
          ${esc(confirmText)}
        </button>

      </div>
    `);

    ov.querySelector("[data-no]").onclick = () => {
      closeModal();
      resolve(false);
    };

    ov.querySelector("[data-yes]").onclick = () => {
      closeModal();
      resolve(true);
    };
  });
}

// ============================================
// SKELETON / EMPTY
// ============================================

export function skeletonRows(n=3){
  return Array.from({ length: n }).map(() => `
    <div style="padding:14px 0;border-bottom:1px solid var(--gray-100)">
      <div class="skeleton sk-line w60"></div>
      <div class="skeleton sk-line w40"></div>
    </div>
  `).join("");
}

export function emptyState(
  icon="📭",
  title="Nothing here yet",
  text=""
){
  return `
    <div class="empty">
      <div class="empty-icon">${icon}</div>
      <h4>${esc(title)}</h4>
      <p>${esc(text)}</p>
    </div>
  `;
}

export function setLoading(el, show=true){
  if(show){
    el.innerHTML = `
      <div class="loading-block">
        <div class="spinner dark"></div>
      </div>
    `;
  }
}

// ============================================
// NAVIGATION
// ============================================

export const NAV = [
  {
    href:"index.html",
    label:"Home",
    icon:"🏠"
  },
  {
    href:"how-it-works.html",
    label:"How It Works",
    icon:"⚙️"
  },
  {
    href:"pool.html",
    label:"Pool",
    icon:"💧"
  },
  {
    href:"bets.html",
    label:"Bets",
    icon:"🎯"
  },
  {
    href:"comments.html",
    label:"Community",
    icon:"💬"
  },
  {
    href:"faq.html",
    label:"FAQ",
    icon:"❓"
  }
];

export const USER_NAV = [
  {
    href:"dashboard.html",
    label:"Dashboard",
    icon:"📊"
  },
  {
    href:"pool.html",
    label:"Pool",
    icon:"💧"
  },
  {
    href:"bets.html",
    label:"Bets",
    icon:"🎯"
  },
  {
    href:"transactions.html",
    label:"Transactions",
    icon:"🧾"
  },
  {
    href:"profile.html",
    label:"Profile",
    icon:"👤"
  }
];

// ============================================
// ADMIN NAVIGATION
// ============================================

export const ADMIN_NAV = [
  {
    href:"index.html",
    label:"Dashboard",
    icon:"📊"
  },
  {
    href:"users.html",
    label:"Users",
    icon:"👥"
  },
  {
    href:"deposits.html",
    label:"Deposits",
    icon:"💵"
  },
  {
    href:"withdrawals.html",
    label:"Withdrawals",
    icon:"🏦"
  },
  {
    href:"betting.html",
    label:"Bet Manager",
    icon:"🎯"
  },
  {
    href:"cycles.html",
    label:"Cycles",
    icon:"📅"
  },
  {
    href:"messages.html",
    label:"Messages",
    icon:"📬"
  },
  {
    href:"comments.html",
    label:"Comments",
    icon:"💬"
  },
  {
    href:"settings.html",
    label:"Settings",
    icon:"⚙️"
  },
  {
    href:"activity.html",
    label:"Activity",
    icon:"📜"
  }
];

// ============================================
// PAGE / PATH HELPERS
// ============================================

function currentPage(){
  return location.pathname.split("/").pop() || "index.html";
}

function inAdmin(){
  return location.pathname
    .replace(/\\/g, "/")
    .includes("/admin/");
}

function basePrefix(){
  return inAdmin() ? "../" : "";
}

function isActive(href){
  return href.split("/").pop() === currentPage();
}

// ============================================
// HEADER
// ============================================

export function renderHeader({
  user=null,
  isAdmin=false
} = {}){

  const mount = document.getElementById("header");

  if(!mount) return;

  const adminView = !!(isAdmin && inAdmin());

  const items = adminView
    ? ADMIN_NAV
    : (user ? USER_NAV : NAV);

  const base = basePrefix();

  // --------------------------------------------
  // Desktop navigation
  // --------------------------------------------

  const desktopLinks = items.map(it => `
    <a
      class="nav-link ${isActive(it.href) ? "active" : ""}"
      href="${it.href}"
    >
      ${it.label}
    </a>
  `).join("");

  // --------------------------------------------
  // Mobile drawer navigation
  // --------------------------------------------

  const drawerLinks = items.map(it => `
    <a
      class="drawer-link ${isActive(it.href) ? "active" : ""}"
      href="${it.href}"
    >
      <span>${it.icon}</span>
      ${it.label}
    </a>
  `).join("");

  // --------------------------------------------
  // Header markup
  // --------------------------------------------

  mount.innerHTML = `

    <header class="header">

      <div class="container header-inner">

        <a href="${base}index.html" class="logo">
          <span class="logo-mark">S</span>SU<span>RE</span>
        </a>

        <nav class="desktop-nav">
          ${desktopLinks}
        </nav>

        <div class="header-actions desktop">

          ${
            user

            ? `
              <span
                class="badge badge-active"
                style="
                  color:#fff;
                  background:rgba(255,255,255,.1)
                "
              >
                ${esc(user.name || user.email || "User")}
              </span>

              <a
                class="btn btn-sm btn-outline-light"
                href="${base}dashboard.html"
              >
                Dashboard
              </a>

              <button
                class="btn btn-sm btn-primary"
                id="logoutBtn"
                type="button"
              >
                Logout
              </button>
            `

            : `
              <a
                class="nav-link"
                href="${base}login.html"
              >
                Login
              </a>

              <a
                class="btn btn-sm btn-primary"
                href="${base}register.html"
              >
                Create Account
              </a>
            `
          }

        </div>

        <button
          class="hamburger"
          id="hamburger"
          aria-label="Menu"
          type="button"
        >
          <span></span>
        </button>

      </div>

    </header>

    <!-- ========================================
         MOBILE DRAWER
         ======================================== -->

    <div
      class="mobile-drawer"
      id="drawer"
    >

      <div class="drawer-panel">

        <button
          class="drawer-close"
          id="drawerClose"
          aria-label="Close"
          type="button"
        >
          ✕
        </button>

        <a
          href="${base}index.html"
          class="logo"
        >
          <span class="logo-mark">S</span>SU<span>RE</span>
        </a>

        ${drawerLinks}

        <div class="drawer-divider"></div>

        ${
          user

          ? `
            <a
              class="drawer-link"
              href="${base}settings.html"
            >
              <span>⚙️</span>
              Settings
            </a>

            <button
              class="drawer-link"
              id="drawerLogout"
              type="button"
              style="text-align:left;width:100%"
            >
              <span>🚪</span>
              Logout
            </button>
          `

          : `
            <a
              class="drawer-link"
              href="${base}login.html"
            >
              <span>🔐</span>
              Login
            </a>

            <a
              class="drawer-link"
              href="${base}register.html"
            >
              <span>✨</span>
              Create Account
            </a>
          `
        }

      </div>

    </div>
  `;

  // ==========================================
  // DRAWER CONTROLS
  // ==========================================

  const drawer = document.getElementById("drawer");
  const hamburger = document.getElementById("hamburger");
  const drawerClose = document.getElementById("drawerClose");

  hamburger && (
    hamburger.onclick = () => {
      drawer.classList.add("open");
    }
  );

  drawerClose && (
    drawerClose.onclick = () => {
      drawer.classList.remove("open");
    }
  );

  drawer && drawer.addEventListener("click", e => {
    if(e.target === drawer){
      drawer.classList.remove("open");
    }
  });

  // ==========================================
  // LOGOUT
  // ==========================================

  const logout = async () => {
    const m = await import("./auth.js");
    await m.logoutUser();
  };

  const lb = document.getElementById("logoutBtn");
  const dl = document.getElementById("drawerLogout");

  lb && (lb.onclick = logout);
  dl && (dl.onclick = logout);
}

// ============================================
// FOOTER
// No demo badge
// ============================================

export function renderFooter(){

  const mount = document.getElementById("footer");

  if(!mount) return;

  const base = basePrefix();

  mount.innerHTML = `

    <footer class="footer">

      <div class="container">

        <div class="footer-grid">

          <div>

            <a
              href="${base}index.html"
              class="logo"
            >
              <span class="logo-mark">S</span>SU<span>RE</span>
            </a>

            <p style="font-size:.85rem;max-width:280px">
              ${APP_TAGLINE}
            </p>

          </div>

          <div>

            <h4>Platform</h4>

            <a href="${base}how-it-works.html">
              How It Works
            </a>

            <a href="${base}pool.html">
              Pool Transparency
            </a>

            <a href="${base}bets.html">
              Betting Activity
            </a>

            <a href="${base}plans.html">
              Plans
            </a>

          </div>

          <div>

            <h4>Support</h4>

            <a href="${base}faq.html">
              FAQ
            </a>

            <a href="${base}contact.html">
              Contact
            </a>

            <a href="${base}about.html">
              About
            </a>

            <a href="${base}comments.html">
              Community
            </a>

          </div>

          <div>

            <h4>Legal</h4>

            <a href="${base}terms.html">
              Terms
            </a>

            <a href="${base}risk-disclosure.html">
              Risk Disclosure
            </a>

          </div>

        </div>

        <div class="footer-bottom">

          © ${new Date().getFullYear()} SURE.
          Track the Pool. Follow Every Bet.

          <br>

          Sports betting involves significant risk.
          Past results do not guarantee future results.

        </div>

      </div>

    </footer>
  `;
}

// ============================================
// BOTTOM NAV — MOBILE
// ============================================

export function renderBottomNav({
  user=null,
  isAdmin=false
} = {}){

  const mount = document.getElementById("bottomNav");

  if(!mount) return;

  const adminView = !!(isAdmin && inAdmin());

  const items = adminView

    ? ADMIN_NAV.slice(0, 5)

    : (
        user

        ? USER_NAV

        : [
            {
              href:"index.html",
              label:"Home",
              icon:"🏠"
            },
            {
              href:"how-it-works.html",
              label:"How",
              icon:"⚙️"
            },
            {
              href:"pool.html",
              label:"Pool",
              icon:"💧"
            },
            {
              href:"bets.html",
              label:"Bets",
              icon:"🎯"
            },
            {
              href:"login.html",
              label:"Login",
              icon:"🔐"
            }
          ]
      );

  mount.innerHTML = `

    <nav class="bottom-nav">

      ${items.map(it => `

        <a
          href="${it.href}"
          class="${isActive(it.href) ? "active" : ""}"
        >

          <span class="ic">
            ${it.icon}
          </span>

          ${it.label}

        </a>

      `).join("")}

    </nav>
  `;
}