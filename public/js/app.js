'use strict';

/* ============================================================
   App entry — router, theme, init
   ============================================================ */

const VIEWS = ['dashboard', 'transactions', 'accounts', 'analytics', 'budgets', 'recurring', 'settings'];

async function init() {
  try {
    const boot = await api.get('/api/bootstrap');
    State.settings = boot.settings;
    State.categories = boot.categories;
    State.accounts = boot.accounts || [];
    State.accountTypes = boot.accountTypes || [];
    State.currencies = boot.currencies;
    State.methods = boot.methods;
    if (boot.ai) State.ai = boot.ai;
    State.month = currentMonthKey();
  } catch (err) {
    $('#view').innerHTML = `
      <div class="card empty">
        <div class="empty-icon">🔌</div>
        <h3>Can't reach the server</h3>
        <p>${esc(err.message)}</p>
        <button class="btn" onclick="location.reload()">Try again</button>
      </div>`;
    return;
  }

  // Theme: local preference wins (instant), then fall back to server setting
  const stored = localStorage.getItem('theme');
  applyTheme(stored || State.settings.theme || 'system', { sync: false });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('theme') || 'system') === 'system') applyTheme('system', { sync: false });
  });

  window.addEventListener('hashchange', route);
  $('#fab').addEventListener('click', () => openTxModal());
  $('#sideThemeBtn').addEventListener('click', toggleTheme);
  $('#topThemeBtn').addEventListener('click', toggleTheme);
  document.addEventListener('keydown', onKeydown);

  route();

  // PWA service worker (only on secure contexts: localhost or https)
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function route() {
  const name = (location.hash || '#/dashboard').replace(/^#\//, '') || 'dashboard';
  const next = VIEWS.includes(name) ? name : 'dashboard';
  const changed = next !== State.view;
  State.view = next;
  document.body.dataset.view = next;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === State.view));
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
      case 'budgets': await renderBudgets(); break;
      case 'recurring': await renderRecurring(); break;
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
