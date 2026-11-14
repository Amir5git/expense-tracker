'use strict';

/* ============================================================
   App entry — router, theme, init
   ============================================================ */

const VIEWS = ['dashboard', 'transactions', 'accounts', 'analytics', 'settings'];

async function init() {
  api.onAuthRequired = () => showLock();

  // Static listeners are wired once; boot() runs again after unlocking.
  window.addEventListener('hashchange', route);
  $('#fab').addEventListener('click', () => openTxModal());
  $('#sideThemeBtn').addEventListener('click', toggleTheme);
  $('#topThemeBtn').addEventListener('click', toggleTheme);
  $('#lockThemeBtn').addEventListener('click', toggleTheme);
  $('#lockForm').addEventListener('submit', onUnlockSubmit);
  setupBottomNav();
  setupGestures();
  setupTxBulkBar();
  document.addEventListener('keydown', onKeydown);

  try {
    const status = await api.get('/api/auth/status');
    if (status.enabled && !status.authed) {
      showLock();
      return;
    }
  } catch { /* offline / older server: boot() shows the error */ }

  await boot();
}

let bootWired = false;

async function boot() {
  let data;
  try {
    data = await api.get('/api/bootstrap');
  } catch (err) {
    if (document.body.classList.contains('locked')) return;
    $('#view').innerHTML = `
      <div class="card empty">
        <div class="empty-icon">🔌</div>
        <h3>Can't reach the server</h3>
        <p>${esc(err.message)}</p>
        <button class="btn" onclick="location.reload()">Try again</button>
      </div>`;
    return;
  }

  State.settings = data.settings;
  State.categories = data.categories;
  State.accounts = data.accounts || [];
  State.accountTypes = data.accountTypes || [];
  State.currencies = data.currencies;
  State.methods = data.methods;
  if (data.ai) State.ai = data.ai;
  State.month = currentMonthKey();

  // Theme: local preference wins (instant), then fall back to server setting
  const stored = localStorage.getItem('theme');
  applyTheme(stored || State.settings.theme || 'system', { sync: false });

  if (!bootWired) {
    bootWired = true;
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('theme') || 'system') === 'system') applyTheme('system', { sync: false });
    });

    // PWA service worker (only on secure contexts: localhost or https)
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  route();
}

/* ---------- app lock ---------- */

function showLock() {
  document.body.classList.add('locked');
  const screen = $('#lockScreen');
  if (screen) screen.hidden = false;
  const error = $('#lockError');
  if (error) error.textContent = '';
  const pass = $('#lockPass');
  if (pass) {
    pass.value = '';
    setTimeout(() => pass.focus(), 80);
  }
  const btn = $('#lockBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Unlock'; }
}

function hideLock() {
  document.body.classList.remove('locked');
  const screen = $('#lockScreen');
  if (screen) screen.hidden = true;
}

async function onUnlockSubmit(e) {
  e.preventDefault();
  const btn = $('#lockBtn');
  const error = $('#lockError');
  const passphrase = $('#lockPass').value;
  if (!passphrase) return;

  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  error.textContent = '';
  try {
    await api.post('/api/auth/login', { passphrase });
    hideLock();
    await boot();
  } catch (err) {
    error.textContent = err.message;
    $('#lockPass').select();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
}

function route() {
  const raw = (location.hash || '#/dashboard').replace(/^#\//, '') || 'dashboard';
  const next = VIEWS.includes(raw) ? raw : 'dashboard';
  if (next !== raw) history.replaceState(null, '', '#/' + next);
  const changed = next !== State.view;
  if (next !== 'transactions' && State.tx.selectMode) setTxSelectMode(false);
  State.view = next;
  document.body.dataset.view = next;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === State.view));
  positionNavLiquid();
  renderCurrent();
  if (changed) window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function renderCurrent() {
  const view = $('#view');
  view.innerHTML = '<div class="loading-block">Loading…</div>';
  try {
    switch (State.view) {
      case 'transactions': await renderTransactions(); break;
      case 'accounts': await renderAccounts(); break;
      case 'analytics': await renderAnalytics(); break;
      case 'settings': await renderSettings(); break;
      default: await renderDashboard();
    }
  } catch (err) {
    view.innerHTML = `
      <div class="card empty">
        <div class="empty-icon">⚠️</div>
        <h3>Something went wrong</h3>
        <p>${esc(err.message)}</p>
        <button class="btn" onclick="location.reload()">Reload</button>
      </div>`;
  }
  animateView(view);
}

/* Re-trigger the enter animation after the view content is replaced. */
function animateView(view) {
  view.classList.remove('view-enter');
  void view.offsetWidth;
  view.classList.add('view-enter');
}

/* ---------- liquid bottom navigation ---------- */

let navResizeRaf = 0;
let navStretchTimer = 0;

function setupBottomNav() {
  const nav = $('#bottomnav');
  if (!nav) return;
  nav.addEventListener('pointerdown', onNavPointerDown);
  window.addEventListener('resize', () => {
    cancelAnimationFrame(navResizeRaf);
    navResizeRaf = requestAnimationFrame(() => positionNavLiquid({ instant: true }));
  });
  // Content (charts, long labels) can change the layout width without a window
  // resize event. Keep the liquid pill aligned with the active tab.
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => positionNavLiquid({ instant: true }));
    observer.observe(nav);
  }
}

/* Slide the liquid pill so it sits under the active tab. */
function positionNavLiquid({ instant = false } = {}) {
  const nav = $('#bottomnav');
  const liquid = nav && nav.querySelector('.nav-liquid');
  if (!liquid) return;

  if (getComputedStyle(nav).display === 'none') return;

  const active = nav.querySelector('a.active');
  const rect = active && active.getBoundingClientRect();
  if (!active || !rect || !rect.width) {
    nav.classList.remove('liquid-ready');
    return;
  }

  const navRect = nav.getBoundingClientRect();
  const center = rect.left - navRect.left + rect.width / 2;
  const width = Math.max(52, rect.width - 10);
  const fromX = parseFloat(liquid.style.getPropertyValue('--nav-x'));
  const distance = Number.isFinite(fromX) ? Math.abs(center - fromX) : 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (instant) liquid.classList.add('no-anim');
  liquid.style.setProperty('--nav-x', `${center}px`);
  liquid.style.setProperty('--nav-w', `${width}px`);

  // Stretch in the direction of travel, then settle back like a liquid.
  if (!instant && !reduced && distance > 2) {
    liquid.style.setProperty('--nav-stretch', Math.min(1.16, 1 + distance / 1100).toFixed(3));
    liquid.style.setProperty('--nav-trail-stretch', Math.min(1.42, 1 + distance / 420).toFixed(3));
    clearTimeout(navStretchTimer);
    navStretchTimer = setTimeout(() => {
      liquid.style.setProperty('--nav-stretch', '1');
      liquid.style.setProperty('--nav-trail-stretch', '1');
    }, 300);
  } else if (instant) {
    liquid.style.setProperty('--nav-stretch', '1');
    liquid.style.setProperty('--nav-trail-stretch', '1');
  }

  if (instant) {
    void liquid.offsetWidth;
    requestAnimationFrame(() => liquid.classList.remove('no-anim'));
  }

  // Fade in only after the first position is applied, so it doesn't slide in on load.
  requestAnimationFrame(() => nav.classList.add('liquid-ready'));
}

/* A soft ripple that spreads from the finger within the tapped tab. */
function onNavPointerDown(e) {
  const link = e.target.closest('#bottomnav a');
  if (!link) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const rect = link.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'nav-ripple';
  ripple.style.left = `${e.clientX - rect.left}px`;
  ripple.style.top = `${e.clientY - rect.top}px`;
  ripple.addEventListener('animationend', () => ripple.remove());
  link.appendChild(ripple);
}

/* ---------- mobile gestures: swipe tabs, pull to refresh ---------- */

const TAB_ORDER = ['dashboard', 'transactions', 'accounts', 'analytics', 'settings'];
const SWIPE_THRESHOLD = 64;
const PULL_THRESHOLD = 90;

function isHorizScrollable(el, root) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 8) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

function setupGestures() {
  const view = $('#view');
  if (!view) return;

  let sx = 0, sy = 0, tracking = false, pulling = false, pulled = 0;
  const hint = $('#pullHint');

  const setHint = (text, visible, progress = 1) => {
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('show', visible);
    hint.style.opacity = visible ? String(progress) : '';
  };

  view.addEventListener('touchstart', e => {
    tracking = false;
    pulling = false;
    if (e.touches.length !== 1 || modalStack.length) return;
    if (!TAB_ORDER.includes(State.view)) return;
    const target = e.target;
    if (target.closest('input, select, textarea, .segmented, [data-no-swipe]')) return;
    if (isHorizScrollable(target, view)) return;
    const t = e.touches[0];
    sx = t.clientX;
    sy = t.clientY;
    tracking = true;
  }, { passive: true });

  view.addEventListener('touchmove', e => {
    if (!tracking || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;

    // A downward pull at the very top refreshes the current view.
    if (!pulling && window.scrollY <= 0 && dy > 14 && Math.abs(dy) > Math.abs(dx)) {
      pulling = true;
    }
    if (pulling) {
      pulled = Math.max(0, dy);
      const ready = pulled >= PULL_THRESHOLD;
      setHint(ready ? 'Release to refresh' : 'Pull to refresh', true, Math.min(1, pulled / PULL_THRESHOLD));
      if (dy < 0) {
        pulling = false;
        pulled = 0;
        setHint('', false);
      }
      return;
    }

    // A horizontal swipe moves to the neighbouring bottom-nav tab.
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.6) {
      tracking = false;
      const i = TAB_ORDER.indexOf(State.view);
      const next = dx < 0 ? TAB_ORDER[i + 1] : TAB_ORDER[i - 1];
      if (next) {
        if (navigator.vibrate) navigator.vibrate(6);
        location.hash = '#/' + next;
      }
    }
  }, { passive: true });

  view.addEventListener('touchend', async () => {
    if (!tracking) return;
    tracking = false;
    if (!pulling) return;
    const refresh = pulled >= PULL_THRESHOLD;
    pulling = false;
    pulled = 0;
    if (!refresh) return setHint('', false);
    setHint('Refreshing…', true, 1);
    try { await renderCurrent(); } catch { /* the view shows its own error */ }
    setTimeout(() => setHint('', false), 350);
  }, { passive: true });

  view.addEventListener('touchcancel', () => {
    tracking = false;
    pulling = false;
    pulled = 0;
    setHint('', false);
  }, { passive: true });
}

function refreshView() { renderCurrent(); }

/* ---------- theme ---------- */

function applyTheme(mode, { sync = true } = {}) {
  const effective = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.dataset.theme = effective;
  localStorage.setItem('theme', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effective === 'dark' ? '#121318' : '#f2f3f9');
  if (sync) api.put('/api/settings', { theme: mode }).catch(() => {});
}

function toggleTheme() {
  const stored = localStorage.getItem('theme') || 'system';
  const effective = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = stored === 'system' ? (effective === 'dark' ? 'light' : 'dark') : (stored === 'dark' ? 'light' : 'dark');
  applyTheme(next);
}

/* ---------- keyboard shortcuts ---------- */

function onKeydown(e) {
  if (modalStack.length) return;
  const t = document.activeElement && document.activeElement.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    openTxModal();
  } else if (e.key === '/') {
    e.preventDefault();
    State.focusSearch = true;
    if (State.view !== 'transactions') location.hash = '#/transactions';
    else {
      State.focusSearch = false;
      const s = $('#txSearch');
      if (s) s.focus();
    }
  }
}

init();
