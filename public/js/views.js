'use strict';

/* ============================================================
   Views
   ============================================================ */

function setViewTitle(t) { $('#viewTitle').textContent = t; }
function setViewActions(html) { $('#viewActions').innerHTML = html || ''; }

/* ---------- shared pieces ---------- */

function txRowHTML(tx, { showDate = false, showMethod = true } = {}) {
  const isIncome = tx.type === 'income';
  const sub = [];
  if (tx.note) sub.push(esc(tx.category_name));
  if (showMethod) sub.push(esc(METHOD_LABEL[tx.method] || tx.method));
  if (tx.recurring_id) sub.push('🔁 auto');
  if (showDate) sub.push(esc(shortDate(tx.date)));
  return `
    <div class="tx-row" data-tx-id="${tx.id}" role="button" tabindex="0" title="Edit">
      <div class="tx-icon" style="background:${esc(tx.category_color)}22">${esc(tx.category_icon || '📦')}</div>
      <div class="tx-main">
        <div class="tx-name">${esc(tx.note || tx.category_name)}</div>
        ${sub.length ? `<div class="tx-note">${sub.join(' · ')}</div>` : ''}
        ${tagChipsHTML(tx.tags)}
      </div>
      <div class="tx-amount ${isIncome ? 'income' : 'expense'}">${esc(fmtMoney(tx.amount))}</div>
    </div>`;
}

function wireTxRows(root, rows) {
  $$('.tx-row', root).forEach(el => {
    const open = () => {
      const tx = rows.find(r => String(r.id) === el.dataset.txId);
      if (tx) openTxModal(tx);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
  });
}

function monthNavHTML() {
  const isCurrent = State.month === currentMonthKey();
  return `
    <button class="icon-btn" data-month="-1" aria-label="Previous month">‹</button>
    <div class="month-label">${esc(monthLabel(State.month))}</div>
    ${isCurrent ? '' : '<button class="btn small secondary today-chip" data-month-today>Today</button>'}
    <button class="icon-btn" data-month="1" aria-label="Next month">›</button>`;
}

function wireMonthNav() {
  $$('#view [data-month]').forEach(b => b.addEventListener('click', () => {
    State.month = addMonthsKey(State.month, Number(b.dataset.month));
    refreshView();
  }));
  const todayBtn = $('#view [data-month-today]');
  if (todayBtn) todayBtn.addEventListener('click', () => { State.month = currentMonthKey(); refreshView(); });
}

function deltaHTML(curr, prev, invert = false) {
  if (!prev) return '— vs last month';
  const d = (curr - prev) / prev * 100;
  if (!isFinite(d)) return '—';
  const up = d >= 0;
  const good = invert ? !up : up;
  return `<span class="${good ? 'delta-up' : 'delta-down'}">${up ? '▲' : '▼'} ${Math.abs(Math.round(d))}%</span> vs last month`;
}

function progressBarHTML(spent, budget) {
  const p = budget > 0 ? (spent / budget) * 100 : 0;
  const cls = p >= 100 ? 'over' : p >= 75 ? 'warn' : 'ok';
  return `<div class="progress"><div class="${cls}" style="width:${Math.min(p, 100)}%"></div></div>`;
}

/* ============================================================
   Dashboard
   ============================================================ */

async function renderDashboard() {
  setViewTitle('Dashboard');
  setViewActions('<button class="btn" data-add>+ Add</button>');

  const view = $('#view');
  const [data, insights] = await Promise.all([
    api.get('/api/summary' + api.qs({ month: State.month })),
    api.get('/api/smart/insights' + api.qs({ month: State.month })).then(r => r.insights).catch(() => []),
  ]);
  State.dashboard = data;

  if (!data.allTime.count) {
    view.innerHTML = `
      <div class="card empty">
        <div class="empty-icon">💸</div>
        <h3>Welcome! Let's track your money</h3>
        <p>Add your first income or expense, or load sample data to explore the app.</p>
        <div class="flex" style="justify-content:center;flex-wrap:wrap">
          <button class="btn" data-add>Add transaction</button>
          <button class="btn secondary" data-sample>Load sample data</button>
        </div>
      </div>`;
    wireDashboardCommon();
    return;
  }

  const m = data.monthTotals;
  const balance = data.allTime.income - data.allTime.expense;
  const saved = m.income - m.expense;

  // budget strip
  let budgetHTML = '';
  if (data.budgets.length) {
    const totalBudget = data.budgets.reduce((a, b) => a + b.amount, 0);
    const totalSpent = data.budgets.reduce((a, b) => a + b.spent, 0);
    const p = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
    const over = totalSpent - totalBudget;
    budgetHTML = `
      <div class="card">
        <div class="card-title">Budgets <span class="link" data-goto="budgets">Manage →</span></div>
        <div class="budget-line"><span>Spent on budgeted categories</span><b>${esc(fmtMoney(totalSpent))} / ${esc(fmtMoney(totalBudget))}</b></div>
        ${progressBarHTML(totalSpent, totalBudget)}
        <div class="budget-line">
          <span>${over > 0
            ? `<span class="over-text">Over budget by ${esc(fmtMoney(over))}</span>`
            : `${esc(fmtMoney(totalBudget - totalSpent))} left`}</span>
          <span>${Math.round(p)}% used</span>
        </div>
        ${data.projected !== null ? `<div class="help-text">Projected month-end spend: <b>${esc(fmtMoney(data.projected))}</b></div>` : ''}
      </div>`;
  }

  const donutSegments = data.byCategory.map(c => ({ label: c.name, value: c.amount, color: c.color }));

  const trendMap = Object.fromEntries(data.trend.map(t => [t.ym, t]));
  const groups = [];
  for (let i = -5; i <= 0; i++) {
    const ym = addMonthsKey(State.month, i);
    groups.push(trendMap[ym] || { ym, income: 0, expense: 0 });
  }

  const unbudgeted = m.expense - data.budgets.reduce((a, b) => a + b.spent, 0);

  const insightsHTML = insights.length ? `
    <div class="card insight-card">
      <div class="card-title">✨ Smart insights <span class="chip">${insights.length}</span></div>
      ${insights.map(i => `
        <div class="insight insight-${i.severity}">
          <span class="insight-icon">${esc(i.icon)}</span>
          <div class="insight-body">
            <b>${esc(i.title)}</b>
            <span>${esc(i.body)}</span>
          </div>
          ${i.cta ? `<button class="btn small secondary insight-cta" data-cta='${esc(JSON.stringify(i.cta))}'>${esc(i.cta.label)}</button>` : ''}
        </div>`).join('')}
    </div>` : '';

  const aiCard = `
    <div class="card ai-card">
      <div class="card-title">🤖 AI assistant ${State.ai.configured
        ? `<span class="chip">${esc(State.ai.providerLabel || State.ai.provider)}</span>`
        : '<button class="link-btn" data-goto="settings">Connect (free) →</button>'}</div>
      ${State.ai.configured ? `
        <div class="ai-chat" id="aiChat"></div>
        <div class="ai-input-row">
          <input class="input" id="aiInput" placeholder="Ask anything… e.g. &quot;where is my money going?&quot;" autocomplete="off">
          <button class="btn" id="aiSend">Ask</button>
        </div>
        <div class="flex" style="gap:10px;margin-top:8px;justify-content:space-between">
          <div class="segmented" id="aiMode" style="flex:1">
            <button type="button" data-mode="ask" class="active">💬 Ask</button>
            <button type="button" data-mode="parse">✨ Quick add</button>
          </div>
          <button class="btn ghost small" id="aiClear">Clear</button>
        </div>
        <div class="help-text">Quick add: type “spent 250 on lunch yesterday” and it fills the form.</div>
      ` : `
        <p style="color:var(--text-2);font-size:13.5px;margin:0 0 6px">
          Chat with your data and add transactions by typing plain English — powered by a free-tier LLM
          (Groq / Gemini / OpenRouter). Your key stays on your server.</p>`}
    </div>`;

  view.innerHTML = `
    <div class="card month-nav">${monthNavHTML()}</div>
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-label">💰 Balance</div>
        <div class="stat-value">${esc(fmtMoney(balance))}</div>
        <div class="stat-sub">${data.allTime.count} transactions · all time</div>
      </div>
      <div class="stat">
        <div class="stat-label">📥 Income</div>
        <div class="stat-value income">${esc(fmtMoney(m.income))}</div>
        <div class="stat-sub">${deltaHTML(m.income, data.prevTotals.income)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">📤 Expenses</div>
        <div class="stat-value expense">${esc(fmtMoney(m.expense))}</div>
        <div class="stat-sub">${deltaHTML(m.expense, data.prevTotals.expense, true)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">🐖 Savings rate</div>
        <div class="stat-value">${data.savingsRate === null ? '—' : Math.round(data.savingsRate * 100) + '%'}</div>
        <div class="stat-sub">${m.income > 0 ? (saved >= 0 ? 'Saved ' : 'Overspent ') + esc(fmtMoney(Math.abs(saved), { compact: true })) : 'No income this month'}</div>
      </div>
    </div>
    ${insightsHTML}
    ${budgetHTML}
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Expenses by category</div>
        <div id="dashDonut"></div>
        ${unbudgeted > 0 && data.budgets.length ? `<div class="help-text">+ ${esc(fmtMoney(unbudgeted))} spent in unbudgeted categories</div>` : ''}
      </div>
      <div class="card">
        <div class="card-title">Last 6 months</div>
        <div id="dashBars"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Recent transactions <span class="link" data-goto="transactions">View all →</span></div>
      ${data.recent.map(r => txRowHTML(r, { showDate: true, showMethod: false })).join('')}
    </div>
    ${aiCard}`;

  renderDonut($('#dashDonut'), donutSegments);
  renderBars($('#dashBars'), groups);
  wireTxRows(view, data.recent);
  wireMonthNav();
  wireDashboardCommon();
  wireInsightCTAs();
  wireAICard();
}

function wireInsightCTAs() {
  $$('[data-cta]').forEach(btn => {
    btn.addEventListener('click', async () => {
      let cta;
      try { cta = JSON.parse(btn.dataset.cta); } catch { return; }
      if (cta.kind === 'budget') {
        openBudgetModal(cta.payload.category_id ? { category_id: cta.payload.category_id, amount: cta.payload.amount } : null);
      } else if (cta.kind === 'recurring') {
        openRecurringModal(null, cta.payload);
      }
    });
  });
}

/* ---------- AI assistant card ---------- */

function loadAIHistory() {
  try { return JSON.parse(localStorage.getItem('aiChatHistory') || '[]'); } catch { return []; }
}
function saveAIHistory(h) {
  try { localStorage.setItem('aiChatHistory', JSON.stringify(h.slice(-30))); } catch { /* full */ }
}

function wireAICard() {
  const chatEl = $('#aiChat');
  const input = $('#aiInput');
  if (!chatEl || !input) return;
  let mode = 'ask';

  const renderChat = () => {
    const history = loadAIHistory();
    chatEl.innerHTML = history.map(m => `
      <div class="ai-msg ${m.role === 'user' ? 'user' : 'bot'}">${esc(m.text)}</div>`).join('')
      + (State.aiBusy ? '<div class="ai-msg bot typing">…thinking</div>' : '');
    chatEl.scrollTop = chatEl.scrollHeight;
  };

  const send = async () => {
    const text = input.value.trim();
    if (!text || State.aiBusy) return;
    input.value = '';
    if (mode === 'ask') {
      const history = loadAIHistory();
      history.push({ role: 'user', text });
      saveAIHistory(history);
      State.aiBusy = true;
      renderChat();
      try {
        const r = await api.post('/api/ai/ask', { question: text, month: State.month });
        const h2 = loadAIHistory();
        h2.push({ role: 'bot', text: r.answer });
        saveAIHistory(h2);
      } catch (err) {
        const h3 = loadAIHistory();
        h3.push({ role: 'bot', text: '⚠️ ' + err.message });
        saveAIHistory(h3);
      }
      State.aiBusy = false;
      renderChat();
    } else {
      const history = loadAIHistory();
      history.push({ role: 'user', text });
      State.aiBusy = true;
      renderChat();
      try {
        const r = await api.post('/api/ai/parse', { text });
        const h2 = loadAIHistory();
        if (r.error) {
          h2.push({ role: 'bot', text: '⚠️ ' + r.error });
        } else {
          h2.push({ role: 'bot', text: `Prefilled a ${r.type === 'income' ? '💰 income' : '💸 expense'} of ${fmtMoney(r.amount)}${r.category_name ? ` (${r.category_name})` : ''} — review & save.` });
          saveAIHistory(h2);
          State.aiBusy = false;
          renderChat();
          openTxModal(null, r);
          return;
        }
        saveAIHistory(h2);
      } catch (err) {
        const h4 = loadAIHistory();
        h4.push({ role: 'bot', text: '⚠️ ' + err.message });
        saveAIHistory(h4);
      }
      State.aiBusy = false;
      renderChat();
    }
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $('#aiSend').addEventListener('click', send);
  $('#aiClear').addEventListener('click', () => { saveAIHistory([]); renderChat(); });
  $$('#aiMode button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $$('#aiMode button').forEach(x => x.classList.toggle('active', x === b));
    input.placeholder = mode === 'ask'
      ? 'Ask anything… e.g. "where is my money going?"'
      : 'e.g. "spent 250 on lunch yesterday"';
    input.focus();
  }));
  renderChat();
}

function wireDashboardCommon() {
  $$('[data-add]').forEach(b => b.addEventListener('click', () => openTxModal()));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.goto; }));
  const sample = $('[data-sample]');
  if (sample) sample.addEventListener('click', () => loadSampleData());
}

/* ============================================================
   Transactions
   ============================================================ */

const RANGE_OPTIONS = [
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: '3months', label: 'Last 3 months' },
  { id: 'year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom…' },
];

async function renderTransactions() {
  setViewTitle('Transactions');
  setViewActions('<button class="btn" data-add>+ Add</button>');
  const f = State.tx.filters;

  // tag options (cached; refreshed when the view loads)
  try {
    State.tx.tags = await api.get('/api/tags');
  } catch { State.tx.tags = State.tx.tags || []; }

  $('#view').innerHTML = `
    <div class="card">
      <div class="filters">
        <div class="search-cell"><input class="input" id="txSearch" placeholder="Search notes & categories…" value="${esc(f.q)}" autocomplete="off"></div>
        <select class="input" id="fType">
          <option value="">All types</option>
          <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Expenses</option>
          <option value="income" ${f.type === 'income' ? 'selected' : ''}>Income</option>
        </select>
        <select class="input" id="fCat">
          <option value="">All categories</option>
          ${State.categories.map(c => `<option value="${c.id}" ${String(f.category) === String(c.id) ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
        </select>
        <select class="input" id="fTag">
          <option value="">All tags</option>
          ${(State.tx.tags || []).map(t => `<option value="${esc(t)}" ${f.tag === t ? 'selected' : ''}>#${esc(t)}</option>`).join('')}
        </select>
        <select class="input" id="fRange">
          ${RANGE_OPTIONS.map(r => `<option value="${r.id}" ${f.range === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
        <select class="input" id="fSort">
          <option value="date_desc" ${f.sort === 'date_desc' ? 'selected' : ''}>Newest first</option>
          <option value="date_asc" ${f.sort === 'date_asc' ? 'selected' : ''}>Oldest first</option>
          <option value="amount_desc" ${f.sort === 'amount_desc' ? 'selected' : ''}>Largest amount</option>
          <option value="amount_asc" ${f.sort === 'amount_asc' ? 'selected' : ''}>Smallest amount</option>
        </select>
      </div>
      <div class="field-row" id="customRange" style="${f.range === 'custom' ? '' : 'display:none'};margin-top:10px;margin-bottom:0">
        <div class="field mb-0"><label>From</label><input class="input" id="fFrom" type="date" value="${esc(f.from)}"></div>
        <div class="field mb-0"><label>To</label><input class="input" id="fTo" type="date" value="${esc(f.to)}"></div>
      </div>
    </div>
    <div class="tx-summary" id="txSummary"></div>
    <div id="txList"><div class="loading-block">Loading…</div></div>
    <div class="center" id="txMoreWrap" style="display:none"><button class="btn secondary" id="txMore"></button></div>`;

  $('#txSearch').addEventListener('input', debounce(e => {
    State.tx.filters.q = e.target.value;
    loadTx(true);
  }, 350));
  $('#fType').addEventListener('change', e => { f.type = e.target.value; loadTx(true); });
  $('#fCat').addEventListener('change', e => { f.category = e.target.value; loadTx(true); });
  $('#fTag').addEventListener('change', e => { f.tag = e.target.value; loadTx(true); });
  $('#fRange').addEventListener('change', e => {
    f.range = e.target.value;
    $('#customRange').style.display = f.range === 'custom' ? '' : 'none';
    loadTx(true);
  });
  $('#fFrom').addEventListener('change', e => { f.from = e.target.value; loadTx(true); });
  $('#fTo').addEventListener('change', e => { f.to = e.target.value; loadTx(true); });
  $('#fSort').addEventListener('change', e => { f.sort = e.target.value; loadTx(true); });
  $$('[data-add]').forEach(b => b.addEventListener('click', () => openTxModal()));

  if (State.focusSearch) {
    State.focusSearch = false;
    $('#txSearch').focus();
  }
  await loadTx(true);
}

async function loadTx(reset) {
  const f = State.tx.filters;
  const listEl = $('#txList');
  if (!listEl) return;
  if (reset) { State.tx.rows = []; State.tx.loadedAll = false; listEl.innerHTML = '<div class="loading-block">Loading…</div>'; $('#txSummary').innerHTML = ''; }
  if (State.tx.loadedAll) return;

  const { from, to } = f.range === 'custom' ? { from: f.from, to: f.to } : rangeToDates(f.range);
  const offset = reset ? 0 : State.tx.rows.length;

  try {
    const data = await api.get('/api/transactions' + api.qs({
      type: f.type, category: f.category, from, to, q: f.q, tag: f.tag, sort: f.sort, limit: 50, offset,
    }));
    State.tx.rows = reset ? data.rows : State.tx.rows.concat(data.rows);
    State.tx.total = data.total;
    State.tx.income = data.income;
    State.tx.expense = data.expense;
    State.tx.loadedAll = State.tx.rows.length >= data.total;
  } catch (err) {
    listEl.innerHTML = `<div class="card empty"><div class="empty-icon">⚠️</div><h3>Couldn't load</h3><p>${esc(err.message)}</p></div>`;
    return;
  }

  $('#txSummary').innerHTML = `
    <span class="chip"><b>${State.tx.total}</b>&nbsp;transaction${State.tx.total === 1 ? '' : 's'}</span>
    <span class="chip in">In ${esc(fmtMoney(State.tx.income, { compact: true }))}</span>
    <span class="chip out">Out ${esc(fmtMoney(State.tx.expense, { compact: true }))}</span>`;

  const grouped = f.sort.startsWith('date');
  listEl.innerHTML = txListHTML(State.tx.rows, { grouped, emptyLabel: filtersEmpty() });

  const moreWrap = $('#txMoreWrap');
  const remaining = State.tx.total - State.tx.rows.length;
  if (remaining > 0) {
    moreWrap.style.display = '';
    $('#txMore').textContent = `Load more (${remaining} left)`;
    $('#txMore').onclick = () => loadTx(false);
  } else {
    moreWrap.style.display = 'none';
  }

  wireTxRows(listEl, State.tx.rows);
}

function filtersEmpty() {
  const f = State.tx.filters;
  return f.q || f.type || f.category || f.tag ? 'No results for these filters. Try changing them.' : 'No transactions in this period yet.';
}

function txListHTML(rows, { grouped = true, emptyLabel = 'No transactions yet.' } = {}) {
  if (!rows.length) {
    return `<div class="card empty"><div class="empty-icon">🧾</div><h3>Nothing found</h3><p>${esc(emptyLabel)}</p></div>`;
  }
  if (!grouped) {
    return `<div class="card">${rows.map(r => txRowHTML(r, { showDate: true })).join('')}</div>`;
  }
  let html = '';
  let currentDate = null;
  let open = false;
  let dayIn = 0, dayOut = 0;
  const closeGroup = () => {
    if (!open) return;
    const totals = [];
    if (dayIn) totals.push(`<span style="color:var(--income)">+${esc(fmtMoney(dayIn, { compact: true }))}</span>`);
    if (dayOut) totals.push(`<span style="color:var(--expense)">−${esc(fmtMoney(dayOut, { compact: true }))}</span>`);
    html += `</div>`;
    // day header is rendered before rows; append totals by replacing placeholder
    html = html.replace(`__DAYTOTAL__${currentDate}__`, totals.length ? totals.join(' ') : '');
    open = false;
  };
  for (const r of rows) {
    if (r.date !== currentDate) {
      closeGroup();
      currentDate = r.date;
      dayIn = 0; dayOut = 0;
      html += `<div class="card">
        <div class="tx-group-date"><span>${esc(dayLabel(r.date))}</span><span class="day-total">__DAYTOTAL__${r.date}__</span></div>`;
      open = true;
    }
    if (r.type === 'income') dayIn += r.amount; else dayOut += r.amount;
    html += txRowHTML(r);
  }
  closeGroup();
  return html;
}

/* ============================================================
   Analytics
   ============================================================ */

async function renderAnalytics() {
  setViewTitle('Analytics');
  setViewActions('');

  const view = $('#view');
  view.innerHTML = '<div class="loading-block">Loading…</div>';

  let a;
  try {
    a = await api.get('/api/analytics' + api.qs({ month: State.month }));
  } catch (err) {
    view.innerHTML = `<div class="card empty"><div class="empty-icon">⚠️</div><h3>Couldn't load analytics</h3><p>${esc(err.message)}</p></div>`;
    return;
  }

  if (!a.activeDays) {
    view.innerHTML = `
      <div class="card month-nav">${monthNavHTML()}</div>
      <div class="card empty">
        <div class="empty-icon">📊</div>
        <h3>No data for ${esc(monthLabel(State.month))}</h3>
        <p>Once you record a few transactions, patterns appear here — heatmap, weekday habits, top merchants and streaks.</p>
      </div>`;
    wireMonthNav();
    return;
  }

  const st = a.streaks;
  const monthTotalExpense = a.expense;

  // merchants leaderboard
  const maxMerch = Math.max(...a.merchants.map(m => m.total), 1);
  const merchantsHTML = a.merchants.length ? `
    <div class="merch-list">
      ${a.merchants.map((m, i) => `
        <div class="merch-row">
          <span class="merch-rank">${i + 1}</span>
          <span class="tx-icon small" style="background:var(--surface-2)">${esc(m.icon || '🏪')}</span>
          <div class="merch-main">
            <div class="merch-name">${esc(m.sample)}</div>
            <div class="merch-bar"><div style="width:${Math.max((m.total / maxMerch) * 100, 4)}%"></div></div>
          </div>
          <div class="merch-nums">
            <b>${esc(fmtMoney(m.total, { compact: true }))}</b>
            <span>${m.count}×</span>
          </div>
        </div>`).join('')}
    </div>` : '<div class="help-text" style="margin:0">No merchant notes this month.</div>';

  // methods breakdown
  const totalMethod = a.methods.reduce((s, m) => s + m.total, 0) || 1;
  const methodsHTML = a.methods.length ? `
    <div class="method-list">
      ${a.methods.map(m => `
        <div class="method-row">
          <span class="method-name">${esc(METHOD_LABEL[m.method] || m.method)}</span>
          <div class="method-bar"><div style="width:${(m.total / totalMethod) * 100}%"></div></div>
          <span class="method-nums"><b>${esc(fmtMoney(m.total, { compact: true }))}</b> · ${m.count}×</span>
        </div>`).join('')}
    </div>` : '<div class="help-text" style="margin:0">No expenses this month.</div>';

  // category trend (6 months, mini heat cells per category)
  const trendMonths = a.trend.months;
  const maxTrend = Math.max(...a.trend.rows.flatMap(r => r.values), 1);
  const trendHTML = a.trend.rows.length ? `
    <div class="trend-head">${trendMonths.map(m => `<span>${esc(monthShort(m))}</span>`).join('')}</div>
    ${a.trend.rows.map(r => `
      <div class="trend-row">
        <span class="trend-cat"><span>${esc(r.category.icon || '📦')}</span>${esc(r.category.name)}</span>
        <div class="trend-cells">
          ${r.values.map((v, i) => {
            const op = v > 0 ? 0.15 + (v / maxTrend) * 0.85 : 0.06;
            return `<span class="trend-cell" style="background:${esc(r.category.color)}${Math.round(op * 255).toString(16).padStart(2, '0')}" title="${esc(r.category.name)} · ${esc(monthShort(trendMonths[i]))}: ${esc(fmtMoney(v))}"></span>`;
          }).join('')}
        </div>
        <b class="trend-total">${esc(fmtMoney(r.total, { compact: true }))}</b>
      </div>`).join('')}` : '<div class="help-text" style="margin:0">Not enough history for trends yet.</div>';

  view.innerHTML = `
    <div class="card month-nav">${monthNavHTML()}</div>

    <div class="stats-grid">
      <div class="stat">
        <div class="stat-label">🔥 No-spend streak</div>
        <div class="stat-value">${st.current}d</div>
        <div class="stat-sub">Best: ${st.best} day${st.best === 1 ? '' : 's'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">📅 Active days</div>
        <div class="stat-value">${a.activeDays}</div>
        <div class="stat-sub">${a.noSpendDays} no-spend day${a.noSpendDays === 1 ? '' : 's'} this month</div>
      </div>
      <div class="stat">
        <div class="stat-label">📤 Month total</div>
        <div class="stat-value expense">${esc(fmtMoney(monthTotalExpense))}</div>
        <div class="stat-sub">${a.activeDays ? esc(fmtMoney(monthTotalExpense / a.activeDays, { compact: true })) + ' / active day' : '—'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">📥 Month income</div>
        <div class="stat-value income">${esc(fmtMoney(a.income))}</div>
        <div class="stat-sub">vs ${esc(fmtMoney(a.expense))} expenses</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Daily spend heatmap <span class="chip">${esc(monthLabel(State.month))}</span></div>
      <div id="anHeatmap"></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">Weekday habits <span class="chip">avg / day, last 3 months</span></div>
        <div id="anWeekday"></div>
        <div class="help-text">Weekends are highlighted — see if they cost you more.</div>
      </div>
      <div class="card">
        <div class="card-title">Payment methods</div>
        ${methodsHTML}
      </div>
    </div>

    <div class="card">
      <div class="card-title">🏪 Top merchants <span class="chip">this month</span></div>
      ${merchantsHTML}
    </div>

    <div class="card">
      <div class="card-title">📈 Category trend <span class="chip">last 6 months</span></div>
      ${trendHTML}
    </div>`;

  renderHeatmap($('#anHeatmap'), a.calendar, fmtMoney);
  renderWeekday($('#anWeekday'), a.weekdayAverages, fmtMoney);
  wireMonthNav();
}

/* ============================================================
   Budgets
   ============================================================ */

async function renderBudgets() {
  setViewTitle('Budgets');
  setViewActions('<button class="btn" data-add-budget>+ Set budget</button>');

  const data = await api.get('/api/budgets' + api.qs({ month: State.month }));
  const budgets = data.budgets;

  let html = `
    <div class="card month-nav">${monthNavHTML()}</div>`;

  if (!budgets.length) {
    html += `
      <div class="card empty">
        <div class="empty-icon">🎯</div>
        <h3>No budgets yet</h3>
        <p>Set a monthly limit per category and track how much of it you've used.</p>
        <button class="btn" data-add-budget>Set your first budget</button>
      </div>`;
  } else {
    const totalBudget = budgets.reduce((a, b) => a + b.amount, 0);
    const totalSpent = budgets.reduce((a, b) => a + b.spent, 0);
    const over = totalSpent - totalBudget;
    const p = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

    html += `
      <div class="card">
        <div class="card-title">Total budget <span class="chip">${esc(monthLabel(State.month))}</span></div>
        <div class="budget-line"><span>Spent</span><b>${esc(fmtMoney(totalSpent))} / ${esc(fmtMoney(totalBudget))}</b></div>
        ${progressBarHTML(totalSpent, totalBudget)}
        <div class="budget-line">
          <span>${over > 0
            ? `<span class="over-text">Over budget by ${esc(fmtMoney(over))}</span>`
            : `${esc(fmtMoney(totalBudget - totalSpent))} left`}</span>
          <span>${p}% used</span>
        </div>
        ${State.dashboard && State.dashboard.projected !== null && State.month === currentMonthKey()
          ? `<div class="help-text">Projected month-end spend: <b>${esc(fmtMoney(State.dashboard.projected))}</b> across all categories</div>` : ''}
      </div>
      <div class="card">
        <div class="card-title">By category</div>`;

    for (const b of budgets) {
      const pctUsed = b.amount > 0 ? b.spent / b.amount : 0;
      const remaining = b.amount - b.spent;
      html += `
        <div class="budget-row">
          <div class="tx-icon" style="background:${esc(b.color)}22">${esc(b.icon)}</div>
          <div class="tx-main">
            <div class="budget-line"><b>${esc(b.name)}</b><span>${esc(fmtMoney(b.spent))} of ${esc(fmtMoney(b.amount))}</span></div>
            ${progressBarHTML(b.spent, b.amount)}
            <div class="budget-line">
              <span>${remaining >= 0 ? `${esc(fmtMoney(remaining))} left` : `<span class="over-text">Over by ${esc(fmtMoney(-remaining))}</span>`}</span>
              <span>${Math.round(pctUsed * 100)}%</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="icon-btn" data-edit-budget="${b.id}" title="Edit budget">✏️</button>
            <button class="icon-btn danger" data-del-budget="${b.id}" title="Remove budget">🗑️</button>
          </div>
        </div>`;
    }
    html += `</div>`;
  }

  $('#view').innerHTML = html;
  wireMonthNav();
  $$('[data-add-budget]').forEach(b => b.addEventListener('click', () => openBudgetModal()));
  budgets.forEach(b => {
    $(`[data-edit-budget="${b.id}"]`).addEventListener('click', () => openBudgetModal(b));
    $(`[data-del-budget="${b.id}"]`).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: `Remove budget for ${b.name}?` });
      if (!ok) return;
      try { await api.del(`/api/budgets/${b.id}`); showToast('Budget removed'); refreshView(); }
      catch (err) { showToast(err.message, 'error'); }
    });
  });
}

/* ============================================================
   Recurring
   ============================================================ */

async function renderRecurring() {
  setViewTitle('Recurring');
  setViewActions('<button class="btn" data-add-rec>+ New rule</button>');

  const rules = await api.get('/api/recurring');

  let html = `
    <div class="note-banner">
      <span class="nb-icon">🔁</span>
      <span>Recurring rules post transactions automatically — rent, salary, subscriptions and anything that repeats.
      Due entries are posted whenever the app or server is opened (catch-up is automatic, nothing is ever missed).</span>
    </div>`;

  if (!rules.length) {
    html += `
      <div class="card empty">
        <div class="empty-icon">🔁</div>
        <h3>No recurring rules</h3>
        <p>Add salary, rent or subscriptions once and they'll be tracked automatically every cycle.</p>
        <button class="btn" data-add-rec>Create a rule</button>
      </div>`;
  } else {
    html += `<div class="card">`;
    for (const r of rules) {
      const overdue = r.active && r.next_date <= todayStr();
      html += `
        <div class="budget-row" style="${r.active ? '' : 'opacity:.55'}">
          <div class="tx-icon" style="background:${esc(r.category_color)}22">${esc(r.category_icon)}</div>
          <div class="tx-main">
            <div class="tx-name">${esc(r.note || r.category_name)}</div>
            <div class="tx-note">
              ${esc(r.category_name)} · ${esc(FREQ_LABEL[r.frequency] || r.frequency)} ·
              next ${esc(shortDate(r.next_date))}${overdue ? ' · <b style="color:var(--warning)">posting soon</b>' : ''}
              ${r.active ? '' : ' · paused'}
            </div>
          </div>
          <div class="tx-amount ${r.type === 'income' ? 'income' : 'expense'}">${esc(fmtMoney(r.amount))}</div>
          <div class="row-actions">
            <button class="icon-btn" data-toggle-rec="${r.id}" title="${r.active ? 'Pause' : 'Resume'}">${r.active ? '⏸️' : '▶️'}</button>
            <button class="icon-btn" data-edit-rec="${r.id}" title="Edit">✏️</button>
            <button class="icon-btn danger" data-del-rec="${r.id}" title="Delete">🗑️</button>
          </div>
        </div>`;
    }
    html += `</div>`;
  }

  $('#view').innerHTML = html;
  $$('[data-add-rec]').forEach(b => b.addEventListener('click', () => openRecurringModal()));
  rules.forEach(r => {
    $(`[data-toggle-rec="${r.id}"]`).addEventListener('click', async () => {
      try {
        await api.put(`/api/recurring/${r.id}`, { active: r.active ? 0 : 1 });
        showToast(r.active ? 'Rule paused' : 'Rule resumed');
        refreshView();
      } catch (err) { showToast(err.message, 'error'); }
    });
    $(`[data-edit-rec="${r.id}"]`).addEventListener('click', () => openRecurringModal(r));
    $(`[data-del-rec="${r.id}"]`).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Delete recurring rule?', message: 'Already-posted transactions are kept.' });
      if (!ok) return;
      try { await api.del(`/api/recurring/${r.id}`); showToast('Rule deleted'); refreshView(); }
      catch (err) { showToast(err.message, 'error'); }
    });
  });
}

/* ============================================================
   Settings
   ============================================================ */

async function renderSettings() {
  setViewTitle('Settings');
  setViewActions('');

  const phoneURL = location.origin;
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

  const [aiStatus, aiSettings] = await Promise.all([
    api.get('/api/ai/status').catch(() => ({ configured: false, provider: 'none', providers: [] })),
    api.get('/api/settings').catch(() => ({})),
  ]);
  const aiDefaultModel = (aiStatus.providers.find(p => p.id === aiStatus.provider) || {}).defaultModel || '';

  $('#view').innerHTML = `
    <div class="card">
      <div class="card-title">Preferences</div>
      <div class="field">
        <label>Currency</label>
        <select class="input" id="setCurrency">
          ${State.currencies.map(c => `<option value="${c.code}" ${State.settings.currency === c.code ? 'selected' : ''}>${c.code} — ${esc(c.name)} (${esc(c.symbol)})</option>`).join('')}
        </select>
        <div class="help-text">Changes how amounts are displayed everywhere. Existing entries are not converted.</div>
      </div>
      <div class="field">
        <label>Theme</label>
        <div class="segmented" id="setTheme">
          <button type="button" data-theme-opt="system">System</button>
          <button type="button" data-theme-opt="light">Light</button>
          <button type="button" data-theme-opt="dark">Dark</button>
        </div>
      </div>
      <div class="field">
        <label>Payment methods</label>
        <div class="flex wrap">${METHODS.map(m => `<span class="chip">${esc(m.label)}</span>`).join('')}</div>
      </div>
    </div>

    <div class="card ai-setup-card">
      <div class="card-title">🤖 AI assistant ${aiStatus.configured ? '<span class="chip">connected</span>' : ''}</div>
      <div class="field">
        <label>Provider</label>
        <select class="input" id="aiProvider">
          <option value="none">Not connected (offline Smart Engine only)</option>
          ${aiStatus.providers.map(p => `<option value="${p.id}" ${aiStatus.provider === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
        <div class="help-text" id="aiProviderNote"></div>
      </div>
      <div class="field" id="aiKeyField">
        <label>API key</label>
        <input class="input" id="aiKey" type="password" autocomplete="off"
          placeholder="${aiSettings.ai_has_key ? 'Saved — type to replace' : 'Paste your API key'}">
        <div class="help-text">Stored on your server only; the browser never receives it. Get a free key from the provider link above.</div>
      </div>
      <div class="field" id="aiModelField">
        <label>Model</label>
        <input class="input" id="aiModel" placeholder="${esc(aiDefaultModel || 'provider default')}" value="${esc(aiSettings.ai_model || '')}" autocomplete="off">
        <div class="help-text" id="aiModelHint">Leave empty to use the provider's default.</div>
      </div>
      <div class="field" id="aiBaseUrlField" style="display:none">
        <label>Base URL (OpenAI-compatible)</label>
        <input class="input" id="aiBaseUrl" placeholder="e.g. http://localhost:11434/v1" value="${esc(aiSettings.ai_base_url || '')}" autocomplete="off">
      </div>
      <div class="flex" style="gap:10px;flex-wrap:wrap">
        <button class="btn" id="aiSave">Save</button>
        <button class="btn secondary" id="aiTestBtn" ${aiStatus.configured ? '' : 'disabled'}>Test connection</button>
      </div>
      <div class="help-text" id="aiTestResult" style="display:none"></div>
      <div class="help-text">Free tiers: Groq, Google Gemini (AI Studio) and OpenRouter's <code>:free</code> models all work. Without AI, the offline Smart Engine (auto-categories, insights, forecasts) keeps working.</div>
    </div>

    <div class="card">
      <div class="card-title">Categories</div>
      <div id="catList">${State.categories.map(c => `
        <div class="budget-row">
          <div class="tx-icon" style="background:${esc(c.color)}22">${esc(c.icon)}</div>
          <div class="tx-main">
            <div class="tx-name">${esc(c.name)}</div>
            <div class="tx-note">${c.type === 'income' ? 'Income' : 'Expense'}${c.usage_count ? ` · ${c.usage_count} transaction${c.usage_count === 1 ? '' : 's'}` : ''}</div>
          </div>
          <div class="row-actions">
            <button class="icon-btn" data-edit-cat="${c.id}" title="Edit">✏️</button>
          </div>
        </div>`).join('')}</div>
      <button class="btn secondary" data-add-cat style="margin-top:10px">+ New category</button>
    </div>

    <div class="card">
      <div class="card-title">Data</div>
      <div class="kv-list">
        <div class="kv">
          <span class="k">📥 Export transactions</span>
          <span class="v"><button class="btn small secondary" id="btnExportCsv">CSV</button></span>
        </div>
        <div class="kv">
          <span class="k">💾 Full backup</span>
          <span class="v"><button class="btn small secondary" id="btnBackup">Download JSON</button></span>
        </div>
        <div class="kv">
          <span class="k">♻️ Restore backup</span>
          <span class="v"><label class="btn small secondary" style="margin:0">Import JSON<input type="file" id="fileImport" accept=".json,application/json" hidden></label></span>
        </div>
        <div class="kv">
          <span class="k">🧪 Sample data</span>
          <span class="v"><button class="btn small secondary" id="btnSample">Load demo data</button></span>
        </div>
      </div>
      <div class="help-text">Backups include settings, categories, budgets and recurring rules. Restoring replaces all current data.</div>
    </div>

    <div class="card">
      <div class="card-title">Use on your phone</div>
      <p style="color:var(--text-2);font-size:14px;margin:0 0 10px">
        ${isLocal
          ? `This app is running on your computer. To use it from your Android phone, connect both devices to the same Wi-Fi, then open
             <b>http://YOUR-PC-IP:${location.port}</b> in the phone's browser (the IP is printed in the server window).
             If it won't load, disable any VPN / "Private DNS" on the phone, or start a public tunnel on the PC with
             <b><code>npm run tunnel</code></b> and open the printed https://…trycloudflare.com URL instead.`
          : `Open <b>${esc(phoneURL)}</b> on your phone, then use the browser menu
             <b>“Add to Home screen”</b> to install it like an app.`}
      </p>
    </div>

    <div class="card danger-zone">
      <div class="card-title" style="color:var(--danger)">Danger zone</div>
      <div class="kv-list">
        <div class="kv">
          <span class="k">🗑️ Delete all transactions</span>
          <span class="v"><button class="btn small danger" id="btnWipe">Delete everything</button></span>
        </div>
      </div>
      <div class="help-text">Removes all transactions, budgets and recurring rules. Categories and settings are kept.</div>
    </div>

    <div class="card">
      <div class="card-title">About</div>
      <div class="kv-list">
        <div class="kv"><span class="k">App</span><span class="v">Expense Tracker v1.1</span></div>
        <div class="kv"><span class="k">Storage</span><span class="v">SQLite database on the server</span></div>
        <div class="kv"><span class="k">Shortcuts</span><span class="v"><kbd>N</kbd> new · <kbd>/</kbd> search</span></div>
        <div class="kv"><span class="k">Smart Engine</span><span class="v">Offline insights, auto-categories & forecasts — no setup needed</span></div>
      </div>
    </div>`;

  // currency
  $('#setCurrency').addEventListener('change', async e => {
    const currency = e.target.value;
    try {
      await api.put('/api/settings', { currency });
      State.settings.currency = currency;
      showToast(`Currency set to ${currency}`);
      refreshView();
    } catch (err) { showToast(err.message, 'error'); }
  });

  // theme segmented
  const activeTheme = localStorage.getItem('theme') || State.settings.theme || 'system';
  $$('#setTheme button').forEach(b => b.classList.toggle('active', b.dataset.themeOpt === activeTheme));
  $$('#setTheme button').forEach(b => b.addEventListener('click', () => {
    applyTheme(b.dataset.themeOpt);
    $$('#setTheme button').forEach(x => x.classList.toggle('active', x === b));
  }));

  // AI setup
  wireAISettings(aiStatus, aiSettings, aiDefaultModel);

  // categories
  $$('[data-edit-cat]').forEach(b => b.addEventListener('click', () => {
    const cat = State.categories.find(c => String(c.id) === b.dataset.editCat);
    if (cat) openCategoryModal(cat);
  }));
  $$('[data-add-cat]').forEach(b => b.addEventListener('click', () => openCategoryModal()));

  // data buttons
  $('#btnExportCsv').addEventListener('click', () => downloadExport('csv'));
  $('#btnBackup').addEventListener('click', () => downloadExport('json'));
  $('#btnSample').addEventListener('click', () => loadSampleData());
  $('#fileImport').addEventListener('change', importBackup);
  $('#btnWipe').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete ALL data?',
      message: 'Every transaction, budget and recurring rule will be permanently deleted. Export a backup first if you might want it back.',
      confirmLabel: 'Delete everything',
    });
    if (!ok) return;
    try {
      await api.del('/api/data?confirm=DELETE');
      showToast('All data deleted');
      refreshView();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function wireAISettings(aiStatus, aiSettings, aiDefaultModel) {
  const providerSel = $('#aiProvider');
  const noteEl = $('#aiProviderNote');
  if (!providerSel) return;

  const providers = Object.fromEntries((aiStatus.providers || []).map(p => [p.id, p]));
  const updateProviderUI = () => {
    const p = providers[providerSel.value];
    const using = providerSel.value !== 'none';
    $('#aiKeyField').style.display = using ? '' : 'none';
    $('#aiModelField').style.display = using ? '' : 'none';
    $('#aiBaseUrlField').style.display = providerSel.value === 'custom' ? '' : 'none';
    $('#aiTestBtn').disabled = !using && !aiStatus.configured;
    if (!p) {
      noteEl.innerHTML = 'Everything works offline — the Smart Engine keeps learning your habits without any key.';
      return;
    }
    noteEl.innerHTML = `${esc(p.note || '')}${p.keyUrl ? ` · <a href="${esc(p.keyUrl)}" target="_blank" rel="noreferrer">Get a free key ↗</a>` : ''}`;
    $('#aiModel').placeholder = p.defaultModel || 'provider default';
  };
  providerSel.addEventListener('change', updateProviderUI);
  updateProviderUI();

  $('#aiSave').addEventListener('click', async () => {
    const payload = {
      ai_provider: providerSel.value,
      ai_model: $('#aiModel').value.trim(),
      ai_base_url: $('#aiBaseUrl').value.trim(),
    };
    const key = $('#aiKey').value.trim();
    if (key) payload.ai_key = key;
    try {
      await api.put('/api/settings', payload);
      State.ai = await api.get('/api/ai/status');
      showToast(payload.ai_provider === 'none' ? 'AI disconnected' : 'AI settings saved');
      refreshView();
    } catch (err) { showToast(err.message, 'error'); }
  });

  $('#aiTestBtn').addEventListener('click', async () => {
    const btn = $('#aiTestBtn');
    const out = $('#aiTestResult');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    out.style.display = '';
    out.textContent = 'Contacting the provider…';
    try {
      // save any unsaved edits first so the test hits the current form values
      const key = $('#aiKey').value.trim();
      const payload = {
        ai_provider: providerSel.value,
        ai_model: $('#aiModel').value.trim(),
        ai_base_url: $('#aiBaseUrl').value.trim(),
      };
      if (key) payload.ai_key = key;
      if (providerSel.value !== 'none' || key || payload.ai_model || payload.ai_base_url) {
        await api.put('/api/settings', payload);
      }
      const r = await api.post('/api/ai/test');
      State.ai = await api.get('/api/ai/status');
      out.innerHTML = `✅ <b>${esc(r.model)}</b> replied in ${r.ms} ms — you're connected.`;
      showToast('AI is working');
    } catch (err) {
      out.innerHTML = `⚠️ ${esc(err.message)}`;
    }
    btn.disabled = false;
    btn.textContent = 'Test connection';
  });
}

async function loadSampleData() {
  let ok = true;
  try {
    ok = await confirmDialog({
      title: 'Load sample data?',
      message: 'Adds ~3 months of realistic demo transactions, budgets and recurring rules. Only works when the app is empty.',
      confirmLabel: 'Load sample data',
      danger: false,
    });
  } catch { return; }
  if (!ok) return;
  try {
    await api.post('/api/sample-data');
    showToast('Sample data loaded');
    await reloadBootstrap();
    refreshView();
  } catch (err) { showToast(err.message, 'error'); }
}

async function downloadExport(format) {
  try {
    const res = await fetch(`/api/export?format=${format}`);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = format === 'csv' ? `expenses-${todayStr()}.csv` : `expense-tracker-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    showToast(format === 'csv' ? 'CSV exported' : 'Backup downloaded');
  } catch (err) { showToast(err.message, 'error'); }
}

async function importBackup(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const result = await api.post('/api/import', json);
    showToast(`Restored ${result.transactions} transactions`);
    await reloadBootstrap();
    refreshView();
  } catch (err) {
    showToast(err.message || 'Invalid backup file', 'error');
  }
  e.target.value = '';
}

async function reloadBootstrap() {
  const boot = await api.get('/api/bootstrap');
  State.settings = boot.settings;
  State.categories = boot.categories;
  State.currencies = boot.currencies;
  if (boot.ai) State.ai = boot.ai;
}
