'use strict';

/* ============================================================
   Modals, dialogs & toasts
   ============================================================ */

const modalStack = [];

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Opens a modal. html should contain a .modal element.
 * Returns a close(result) function.
 */
function openModal(html, { onMount, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = html;

  const entry = {
    overlay,
    closed: false,
    close(result) {
      if (entry.closed) return;
      entry.closed = true;
      const i = modalStack.indexOf(entry);
      if (i >= 0) modalStack.splice(i, 1);
      if (!modalStack.length) document.body.style.overflow = '';

      const finish = () => {
        overlay.remove();
        if (onClose) onClose(result);
      };
      if (prefersReducedMotion()) {
        finish();
      } else {
        overlay.classList.add('closing');
        setTimeout(finish, 180);
      }
    },
  };

  modalStack.push(entry);
  document.body.style.overflow = 'hidden';
  $('#modalRoot').appendChild(overlay);

  const modal = overlay.querySelector('.modal');
  overlay.addEventListener('click', e => { if (e.target === overlay) entry.close(false); });
  overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => entry.close(false)));
  if (onMount) onMount(modal, entry.close);
  setupSheetDrag(modal, entry.close);
  return entry.close;
}

/* Drag the mobile bottom sheet down by its header to dismiss it. */
function setupSheetDrag(modal, close) {
  if (!modal || prefersReducedMotion()) return;
  if (!window.matchMedia('(max-width: 639px)').matches) return;
  const head = modal.querySelector('.modal-head');
  if (!head) return;

  let startY = 0, startX = 0, dy = 0, dragging = false;

  head.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    dragging = true;
    startY = e.clientY;
    startX = e.clientX;
    dy = 0;
    modal.classList.add('dragging');
    try { head.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  head.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = Math.abs(e.clientX - startX);
    dy = Math.max(0, e.clientY - startY);
    if (dx > dy && dx > 20) return; // horizontal intent: don't lift the sheet
    modal.style.transform = `translateY(${dy}px)`;
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    modal.classList.remove('dragging');
    const height = modal.getBoundingClientRect().height;
    const shouldClose = dy > Math.min(140, height * 0.3);
    modal.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
    modal.style.transform = '';
    setTimeout(() => { modal.style.transition = ''; }, 240);
    dy = 0;
    if (shouldClose) close(false);
  };

  head.addEventListener('pointerup', finish);
  head.addEventListener('pointercancel', finish);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close(false);
});

/* ---------- toast ---------- */

function showToast(msg, type = 'info', { action, onAction, duration } = {}) {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '') + (action ? ' has-action' : '');
  const text = document.createElement('span');
  text.className = 'toast-msg';
  text.textContent = msg;
  t.appendChild(text);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  };

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action;
    btn.addEventListener('click', () => {
      dismiss();
      if (onAction) onAction();
    });
    t.appendChild(btn);
  }

  $('#toastRoot').appendChild(t);
  timer = setTimeout(dismiss, duration || (action ? 6000 : 2400));
}

/* ---------- confirm dialog ---------- */

function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Delete', danger = true }) {
  return new Promise(resolve => {
    openModal(`
      <div class="modal" style="max-width:400px">
        <div class="modal-head"><h3>${esc(title)}</h3></div>
        <div class="modal-body"><p style="margin:0;color:var(--text-2)">${esc(message)}</p></div>
        <div class="modal-foot">
          <button class="btn secondary" data-close>Cancel</button>
          <button class="btn ${danger ? 'danger' : ''}" data-confirm>${esc(confirmLabel)}</button>
        </div>
      </div>`, {
      onMount(root, close) {
        root.querySelector('[data-confirm]').addEventListener('click', () => close(true));
      },
      onClose(result) { resolve(Boolean(result)); },
    });
  });
}

/* ---------- shared bits ---------- */

function modalShell(title, body, footExtra = '', okLabel = 'Save') {
  return `
    <div class="modal">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        ${footExtra}
        <button class="btn secondary" data-close>Cancel</button>
        <button class="btn" data-ok>${esc(okLabel)}</button>
      </div>
    </div>`;
}

function catGridHTML(type, selectedId) {
  const cats = catsOf(type);
  const chips = cats.map(c => `
    <button type="button" class="cat-chip ${Number(selectedId) === c.id ? 'selected' : ''}" data-cat-id="${c.id}">
      <span class="ci">${esc(c.icon)}</span><span>${esc(c.name)}</span>
    </button>`).join('');
  return `
    <div class="cat-grid" data-role="cat-grid">
      ${chips}
      <button type="button" class="cat-chip" data-add-cat data-type="${esc(type)}">
        <span class="ci">➕</span><span>New</span>
      </button>
    </div>`;
}

function wireCatGrid(modal, get, set) {
  modal.querySelectorAll('[data-role="cat-grid"] .cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.hasAttribute('data-add-cat')) {
        openCategoryModal(null, chip.dataset.type, async () => {
          await reloadCategories();
          // re-render the grid keeping current selection if still valid
          const holder = modal.querySelector('[data-role="cat-grid"]');
          const sel = get();
          holder.outerHTML = catGridHTML(chip.dataset.type, catById(sel) && catById(sel).type === chip.dataset.type ? sel : null);
          wireCatGrid(modal, get, set);
        });
        return;
      }
      set(Number(chip.dataset.catId));
      modal.querySelectorAll('[data-role="cat-grid"] .cat-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });
}

async function reloadCategories() {
  State.categories = await api.get('/api/categories');
}

/* ============================================================
   Transaction modal
   ============================================================ */

function openTxModal(tx = null, prefill = null) {
  const base = tx || prefill || {};
  let type = base.type || 'expense';
  let categoryId = base.category_id || null;
  let categoryTouched = !!base.category_id;   // don't auto-suggest over an explicit choice
  const isNew = !tx;
  const firstAccount = activeAccounts()[0];
  let accountId = base.account_id != null
    ? Number(base.account_id)
    : (isNew ? (State.lastAccountId != null ? Number(State.lastAccountId) : (firstAccount ? firstAccount.id : null)) : null);

  const body = () => `
    <div class="field">
      <div class="segmented" data-role="tx-type">
        <button type="button" data-seg="expense" class="${type === 'expense' ? 'active' : ''}">Expense</button>
        <button type="button" data-seg="income" class="${type === 'income' ? 'active' : ''}">Income</button>
      </div>
    </div>
    <div class="field">
      <label>Amount</label>
      <input class="input input-lg" data-role="tx-amount" type="number" inputmode="decimal" step="0.01" min="0"
        placeholder="0.00" value="${base.amount != null ? esc(base.amount) : ''}" autocomplete="off">
    </div>
    <div class="field">
      <label>Category</label>
      ${catGridHTML(type, categoryId)}
      <div class="help-text" data-role="tx-suggest" style="display:none"></div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Date</label>
        <input class="input" data-role="tx-date" type="date" value="${base.date || todayStr()}">
      </div>
      <div class="field">
        <label>Account</label>
        <select class="input" data-role="tx-account">
          ${accountOptionsHTML(accountId, !isNew)}
        </select>
        <div class="help-text">Which balance did this come from? Payment method is set automatically.</div>
      </div>
    </div>
    <div class="field">
      <label>Note (optional)</label>
      <input class="input" data-role="tx-note" placeholder="e.g. Lunch with team" maxlength="500"
        value="${base.note ? esc(base.note) : ''}" autocomplete="off">
      <div class="help-text">✨ The engine learns your notes — categories auto-fill over time.</div>
    </div>
    <div class="field">
      <label>Tags (optional)</label>
      <input class="input" data-role="tx-tags" placeholder="e.g. work, reimbursable" maxlength="120"
        value="${base.tags ? esc(parseTags(base.tags).join(', ')) : ''}" autocomplete="off">
      <div class="help-text">Comma separated. Filter by them later on the Transactions page.</div>
    </div>`;

  const close = openModal(modalShell(tx ? 'Edit transaction' : 'Add transaction', body(), tx ? '<button class="btn danger" data-del>Delete</button>' : ''), {
    async onMount(modal, closeModal) {
      const rerender = () => {
        modal.querySelector('.modal-body').innerHTML = body();
        wire(modal);
      };
      const wire = (m) => {
        // type segmented
        m.querySelectorAll('[data-role="tx-type"] button').forEach(btn => {
          btn.addEventListener('click', () => {
            type = btn.dataset.seg;
            if (catById(categoryId) && catById(categoryId).type !== type) { categoryId = null; categoryTouched = false; }
            rerender();
          });
        });
        wireCatGrid(m, () => categoryId, v => { categoryId = v; categoryTouched = true; });
      };
      wire(modal);

      // smart auto-category: suggest as the note is typed (new entries only)
      const noteInput = modal.querySelector('[data-role="tx-note"]');
      noteInput.addEventListener('input', debounce(async () => {
        if (!isNew || categoryTouched) return;
        const note = noteInput.value.trim();
        if (!note) return;
        try {
          const s = await api.post('/api/smart/suggest', { type, note, amount: Number(m2(modal, 'tx-amount').value) || undefined });
          if (!s || !s.category_id) return;
          const cat = catById(s.category_id);
          if (!cat || cat.type !== type) return;
          const hint = modal.querySelector('[data-role="tx-suggest"]');
          if (categoryId !== s.category_id) {
            categoryId = s.category_id;
            modal.querySelectorAll('[data-role="cat-grid"] .cat-chip').forEach(c => {
              c.classList.toggle('selected', Number(c.dataset.catId) === s.category_id);
            });
            if (hint) {
              hint.style.display = '';
              hint.textContent = `✨ Auto-filled ${cat.name} (${Math.round((s.confidence || 0.5) * 100)}% sure)`;
            }
          }
        } catch { /* suggestion is best-effort */ }
      }, 500));

      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        const amount = Number(m2(modal, 'tx-amount').value);
        const date = m2(modal, 'tx-date').value;
        const account_id = m2(modal, 'tx-account').value ? Number(m2(modal, 'tx-account').value) : null;
        const note = m2(modal, 'tx-note').value.trim();
        const tags = m2(modal, 'tx-tags').value;

        if (!amount || amount <= 0) return showToast('Enter an amount greater than zero', 'error');
        if (!categoryId) return showToast('Pick a category', 'error');
        if (!date) return showToast('Pick a date', 'error');

        const payload = { type, amount, category_id: categoryId, date, note, tags, account_id };
        try {
          modal.querySelector('[data-ok]').disabled = true;
          if (tx) await api.put(`/api/transactions/${tx.id}`, payload);
          else await api.post('/api/transactions', payload);
          if (account_id) State.lastAccountId = account_id;
          showToast(tx ? 'Transaction updated' : `${type === 'income' ? 'Income' : 'Expense'} added`);
          closeModal(true);
          refreshView();
        } catch (err) {
          modal.querySelector('[data-ok]').disabled = false;
          showToast(err.message, 'error');
        }
      });

      const delBtn = modal.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Delete transaction?', message: 'You can undo this right after.', confirmLabel: 'Delete' });
        if (!ok) return;
        try {
          const res = await api.del(`/api/transactions/${tx.id}`);
          showToast('Transaction deleted', 'info', {
            action: 'Undo',
            duration: 7000,
            onAction: async () => {
              try {
                await api.post('/api/transactions/bulk', { action: 'restore', rows: res && res.row ? [res.row] : [] });
                showToast('Restored');
                refreshView();
              } catch (err) { showToast(err.message, 'error'); }
            },
          });
          closeModal(true);
          refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });
    },
    onClose() { close && undefined; },
  });
  return close;
}

const m2 = (modal, role) => modal.querySelector(`[data-role="${role}"]`);

function accountOptionsHTML(selectedId, includeNone = false) {
  const list = activeAccounts();
  const sel = selectedId != null ? Number(selectedId) : null;
  const selectedAccount = sel != null ? State.accounts.find(a => a.id === sel) : null;
  const options = [];
  if (includeNone && sel == null) options.push('<option value="" selected>— Unassigned —</option>');
  for (const a of list) {
    options.push(`<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`);
  }
  if (selectedAccount && selectedAccount.archived && !list.some(a => a.id === sel)) {
    options.push(`<option value="${sel}" selected>${esc(selectedAccount.icon)} ${esc(selectedAccount.name)} (archived)</option>`);
  }
  if (!options.length) options.push('<option value="">No accounts — create one first</option>');
  return options.join('');
}

/* ============================================================
   Category modal
   ============================================================ */

function openCategoryModal(cat = null, presetType = 'expense', onSaved = null) {
  let type = cat ? cat.type : presetType;
  let icon = cat ? cat.icon : '🍜';
  let color = cat ? cat.color : COLORS[Math.floor(Math.random() * 8)];

  const emojiGrid = EMOJIS.map(e => `<button type="button" class="emoji-opt ${e === icon ? 'selected' : ''}" data-emoji="${e}">${e}</button>`).join('');
  const colorGrid = COLORS.map(c => `<button type="button" class="color-opt ${c === color ? 'selected' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');

  const body = () => `
    <div class="field">
      <label>Name</label>
      <input class="input" data-role="cat-name" maxlength="40" placeholder="e.g. Coffee runs" value="${cat ? esc(cat.name) : ''}" autocomplete="off">
    </div>
    <div class="field">
      <label>Type</label>
      <div class="segmented" data-role="cat-type">
        <button type="button" data-seg="expense" class="${type === 'expense' ? 'active' : ''}" ${cat && cat.usage_count > 0 ? 'disabled title="Cannot change type while category is in use"' : ''}>Expense</button>
        <button type="button" data-seg="income" class="${type === 'income' ? 'active' : ''}" ${cat && cat.usage_count > 0 ? 'disabled title="Cannot change type while category is in use"' : ''}>Income</button>
      </div>
    </div>
    <div class="field">
      <label>Icon</label>
      <div class="picker-grid">${emojiGrid}</div>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-grid">${colorGrid}</div>
    </div>`;

  openModal(modalShell(cat ? 'Edit category' : 'New category', body(), cat ? '<button class="btn danger" data-del>Delete</button>' : ''), {
    async onMount(modal, closeModal) {
      modal.querySelectorAll('[data-role="cat-type"] button').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          type = btn.dataset.seg;
          modal.querySelectorAll('[data-role="cat-type"] button').forEach(b => b.classList.toggle('active', b === btn));
        });
      });
      modal.querySelectorAll('.emoji-opt').forEach(btn => btn.addEventListener('click', () => {
        icon = btn.dataset.emoji;
        modal.querySelectorAll('.emoji-opt').forEach(b => b.classList.toggle('selected', b === btn));
      }));
      modal.querySelectorAll('.color-opt').forEach(btn => btn.addEventListener('click', () => {
        color = btn.dataset.color;
        modal.querySelectorAll('.color-opt').forEach(b => b.classList.toggle('selected', b === btn));
      }));

      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        const name = modal.querySelector('[data-role="cat-name"]').value.trim();
        if (!name) return showToast('Enter a name', 'error');
        const payload = { name, type, icon, color };
        try {
          if (cat) await api.put(`/api/categories/${cat.id}`, payload);
          else await api.post('/api/categories', payload);
          await reloadCategories();
          showToast('Category saved');
          closeModal(true);
          if (onSaved) onSaved();
          else refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });

      const delBtn = modal.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: `Delete "${cat.name}"?`, message: 'Categories used by transactions cannot be deleted. Reassign those transactions first.' });
        if (!ok) return;
        try {
          await api.del(`/api/categories/${cat.id}`);
          await reloadCategories();
          showToast('Category deleted');
          closeModal(true);
          if (onSaved) onSaved();
          else refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });
    },
  });
}

/* ============================================================
   Budget modal
   ============================================================ */

function openBudgetModal(budget = null) {
  const expenseCats = catsOf('expense');
  if (!expenseCats.length) return showToast('Create an expense category first', 'error');

  const body = `
    <div class="field">
      <label>Category</label>
      <select class="input" data-role="bud-cat">
        ${expenseCats.map(c => `<option value="${c.id}" ${budget && budget.category_id === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Monthly budget</label>
      <input class="input input-lg" data-role="bud-amount" type="number" inputmode="decimal" step="0.01" min="0"
        placeholder="0.00" value="${budget ? esc(budget.amount) : ''}" autocomplete="off">
      <div class="help-text">Applies to every month. Alerts show when you go over.</div>
    </div>`;

  openModal(modalShell(budget ? 'Edit budget' : 'Set budget', body, budget ? '<button class="btn danger" data-del>Delete</button>' : ''), {
    async onMount(modal, closeModal) {
      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        const category_id = Number(modal.querySelector('[data-role="bud-cat"]').value);
        const amount = Number(modal.querySelector('[data-role="bud-amount"]').value);
        if (!amount || amount <= 0) return showToast('Enter a budget amount', 'error');
        try {
          await api.put('/api/budgets', { category_id, amount });
          showToast('Budget saved');
          closeModal(true);
          refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });

      const delBtn = modal.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Remove budget?', message: `Spending in this category will no longer be tracked against a budget.` });
        if (!ok) return;
        try {
          await api.del(`/api/budgets/${budget.id}`);
          showToast('Budget removed');
          closeModal(true);
          refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });
    },
  });
}

/* ============================================================
   Recurring modal
   ============================================================ */

function openRecurringModal(rule = null, prefill = null) {
  const base = rule || prefill || {};
  let type = base.type || 'expense';
  let categoryId = base.category_id || null;
  const firstAccount = activeAccounts()[0];
  let accountId = base.account_id != null
    ? Number(base.account_id)
    : (rule ? null : (firstAccount ? firstAccount.id : null));

  const body = () => `
    <div class="field">
      <div class="segmented" data-role="rec-type">
        <button type="button" data-seg="expense" class="${type === 'expense' ? 'active' : ''}">Expense</button>
        <button type="button" data-seg="income" class="${type === 'income' ? 'active' : ''}">Income</button>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Amount</label>
        <input class="input" data-role="rec-amount" type="number" inputmode="decimal" step="0.01" min="0"
          placeholder="0.00" value="${base.amount != null ? esc(base.amount) : ''}" autocomplete="off">
      </div>
      <div class="field">
        <label>Repeats</label>
        <select class="input" data-role="rec-freq">
          ${FREQUENCIES.map(f => `<option value="${f.id}" ${base.frequency === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field">
      <label>Category</label>
      ${catGridHTML(type, categoryId)}
    </div>
    <div class="field-row">
      <div class="field">
        <label>Next date</label>
        <input class="input" data-role="rec-next" type="date" min="${todayStr()}" value="${base.next_date || todayStr()}">
        <div class="help-text">The rule posts on this date and every cycle after.</div>
      </div>
      <div class="field">
        <label>Account</label>
        <select class="input" data-role="rec-account">
          ${accountOptionsHTML(accountId, !!rule)}
        </select>
      </div>
    </div>
    <div class="field">
      <label>Note (optional)</label>
      <input class="input" data-role="rec-note" maxlength="500" placeholder="e.g. Netflix subscription"
        value="${base.note ? esc(base.note) : ''}" autocomplete="off">
    </div>
    <div class="field flex" style="gap:12px">
      <button type="button" class="toggle ${rule && rule.active ? 'on' : !rule ? 'on' : ''}" data-role="rec-active" aria-label="Active"></button>
      <span style="font-size:13.5px;color:var(--text-2)">Rule is active</span>
    </div>`;

  openModal(modalShell(rule ? 'Edit recurring rule' : 'New recurring rule', body(), rule ? '<button class="btn danger" data-del>Delete</button>' : ''), {
    async onMount(modal, closeModal) {
      let active = rule ? !!rule.active : true;
      const toggle = modal.querySelector('[data-role="rec-active"]');
      toggle.addEventListener('click', () => {
        active = !active;
        toggle.classList.toggle('on', active);
      });

      const rerender = () => {
        const amount = modal.querySelector('[data-role="rec-amount"]').value;
        const freq = modal.querySelector('[data-role="rec-freq"]').value;
        const next = modal.querySelector('[data-role="rec-next"]').value;
        const note = modal.querySelector('[data-role="rec-note"]').value;
        modal.querySelector('.modal-body').innerHTML = body();
        modal.querySelector('[data-role="rec-amount"]').value = amount;
        modal.querySelector('[data-role="rec-freq"]').value = freq;
        modal.querySelector('[data-role="rec-next"]').value = next;
        modal.querySelector('[data-role="rec-note"]').value = note;
        wire();
        // re-read active state
        const t2 = modal.querySelector('[data-role="rec-active"]');
        t2.classList.toggle('on', active);
        t2.addEventListener('click', () => { active = !active; t2.classList.toggle('on', active); });
      };

      const wire = () => {
        modal.querySelectorAll('[data-role="rec-type"] button').forEach(btn => {
          btn.addEventListener('click', () => {
            type = btn.dataset.seg;
            if (catById(categoryId) && catById(categoryId).type !== type) categoryId = null;
            rerender();
          });
        });
        const accSel = modal.querySelector('[data-role="rec-account"]');
        if (accSel) accSel.addEventListener('change', e => { accountId = e.target.value ? Number(e.target.value) : null; });
        wireCatGrid(modal, () => categoryId, v => { categoryId = v; });
      };
      wire();

      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        const amount = Number(modal.querySelector('[data-role="rec-amount"]').value);
        const frequency = modal.querySelector('[data-role="rec-freq"]').value;
        const next_date = modal.querySelector('[data-role="rec-next"]').value;
        const note = modal.querySelector('[data-role="rec-note"]').value.trim();
        if (!amount || amount <= 0) return showToast('Enter an amount', 'error');
        if (!categoryId) return showToast('Pick a category', 'error');
        if (!next_date) return showToast('Pick the next date', 'error');
        const payload = { type, amount, category_id: categoryId, frequency, next_date, note, active, account_id: accountId };
        try {
          if (rule) await api.put(`/api/recurring/${rule.id}`, payload);
          else await api.post('/api/recurring', payload);
          showToast('Recurring rule saved');
          closeModal(true);
          refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });

      const delBtn = modal.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Delete recurring rule?', message: 'Already-posted transactions are kept.' });
        if (!ok) return;
        try {
          await api.del(`/api/recurring/${rule.id}`);
          showToast('Rule deleted');
          closeModal(true);
          refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });
    },
  });
}

/* ============================================================
   Account modal
   ============================================================ */

function openAccountModal(account = null) {
  const isNew = !account;
  let type = account ? account.type : 'bank';
  let archived = account ? !!account.archived : false;
  const meta = accountTypeMeta(type);

  const body = `
    <div class="field">
      <label>Account name</label>
      <input class="input" data-role="acc-name" maxlength="40" placeholder="e.g. HDFC Savings"
        value="${account ? esc(account.name) : ''}" autocomplete="off">
    </div>
    <div class="field">
      <label>Type</label>
      <select class="input" data-role="acc-type">
        ${accountTypes().map(t => `<option value="${t.id}" ${t.id === type ? 'selected' : ''}>${esc(t.icon)} ${esc(t.label)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Opening balance</label>
      <input class="input input-lg" data-role="acc-opening" type="number" inputmode="decimal" step="0.01"
        placeholder="0.00" value="${account ? esc(account.opening_balance) : ''}" autocomplete="off">
      <div class="help-text">The balance you had before tracking started. Use a negative number for credit-card dues or overdrafts.</div>
    </div>
    ${isNew ? '' : `
      <div class="field flex" style="gap:12px">
        <button type="button" class="toggle ${archived ? 'on' : ''}" data-role="acc-archived" aria-label="Archived"></button>
        <span style="font-size:13.5px;color:var(--text-2)">Archive this account (hidden from pickers, kept in history)</span>
      </div>`}`;

  openModal(modalShell(account ? 'Edit account' : 'New account', body,
    account ? '<button class="btn danger" data-del>Delete</button>' : ''), {
    async onMount(modal, closeModal) {
      const typeSel = modal.querySelector('[data-role="acc-type"]');
      typeSel.addEventListener('change', () => { type = typeSel.value; });

      const tog = modal.querySelector('[data-role="acc-archived"]');
      if (tog) tog.addEventListener('click', () => {
        archived = !archived;
        tog.classList.toggle('on', archived);
      });

      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        const name = modal.querySelector('[data-role="acc-name"]').value.trim();
        const rawOpening = modal.querySelector('[data-role="acc-opening"]').value;
        const opening = rawOpening === '' ? 0 : Number(rawOpening);
        if (!name) return showToast('Enter an account name', 'error');
        if (!isFinite(opening)) return showToast('Opening balance must be a number', 'error');
        const tm = accountTypeMeta(type);
        const payload = {
          name, type, opening_balance: opening, archived,
          icon: account && account.type === type ? account.icon : tm.icon,
          color: account && account.type === type ? account.color : tm.color,
        };
        try {
          if (account) await api.put(`/api/accounts/${account.id}`, payload);
          else await api.post('/api/accounts', payload);
          const acc = await api.get('/api/accounts');
          State.accounts = acc.accounts || State.accounts;
          showToast(account ? 'Account updated' : 'Account created');
          closeModal(true);
          refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });

      const delBtn = modal.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `Delete "${account.name}"?`,
          message: 'Only accounts with no transactions, recurring rules or transfers can be deleted. Archive it instead to keep its history.',
        });
        if (!ok) return;
        try {
          await api.del(`/api/accounts/${account.id}`);
          const acc = await api.get('/api/accounts');
          State.accounts = acc.accounts || State.accounts;
          showToast('Account deleted');
          closeModal(true);
          refreshView();
        } catch (err) { showToast(err.message, 'error'); }
      });
    },
  });
}

/* ============================================================
   Transfer modal
   ============================================================ */

function openTransferModal() {
  const accounts = activeAccounts();
  if (accounts.length < 2) return showToast('Create at least two accounts first', 'error');

  const options = sel => accounts.map(a =>
    `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.icon)} ${esc(a.name)} — ${esc(fmtMoney(a.balance))}</option>`).join('');

  const body = `
    <div class="field-row">
      <div class="field">
        <label>From</label>
        <select class="input" data-role="tr-from">${options(accounts[0].id)}</select>
      </div>
      <div class="field">
        <label>To</label>
        <select class="input" data-role="tr-to">${options(accounts[1].id)}</select>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Amount</label>
        <input class="input input-lg" data-role="tr-amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" autocomplete="off">
      </div>
      <div class="field">
        <label>Date</label>
        <input class="input" data-role="tr-date" type="date" value="${todayStr()}">
      </div>
    </div>
    <div class="field">
      <label>Note (optional)</label>
      <input class="input" data-role="tr-note" maxlength="500" placeholder="e.g. ATM withdrawal" autocomplete="off">
    </div>
    <div class="help-text">Transfers move money between your accounts and don't count as income or expense.</div>`;

  openModal(modalShell('Transfer between accounts', body, '', 'Transfer'), {
    async onMount(modal, closeModal) {
      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        const from_account_id = Number(modal.querySelector('[data-role="tr-from"]').value);
        const to_account_id = Number(modal.querySelector('[data-role="tr-to"]').value);
        const amount = Number(modal.querySelector('[data-role="tr-amount"]').value);
        const date = modal.querySelector('[data-role="tr-date"]').value;
        const note = modal.querySelector('[data-role="tr-note"]').value.trim();
        if (from_account_id === to_account_id) return showToast('Pick two different accounts', 'error');
        if (!amount || amount <= 0) return showToast('Enter an amount greater than zero', 'error');
        if (!date) return showToast('Pick a date', 'error');
        try {
          modal.querySelector('[data-ok]').disabled = true;
          await api.post('/api/transfers', { from_account_id, to_account_id, amount, date, note });
          showToast('Transfer recorded');
          closeModal(true);
          refreshView();
        } catch (err) {
          modal.querySelector('[data-ok]').disabled = false;
          showToast(err.message, 'error');
        }
      });
    },
  });
}

/* ============================================================
   CSV bank statement import
   ============================================================ */

function openCsvImportModal() {
  let csvText = '';
  let headers = [];
  let total = 0;
  let ready = false;

  const accountOptions = () => {
    const list = activeAccounts();
    if (!list.length) return '<option value="">No account</option>';
    return list.map(a => `<option value="${a.id}">${esc(a.icon)} ${esc(a.name)}</option>`).join('');
  };

  const body = `
    <div class="field">
      <label>Bank statement CSV</label>
      <input class="input" type="file" data-role="csv-file" accept=".csv,text/csv">
      <div class="help-text">Export a CSV from your bank. The first row must contain column names.</div>
    </div>
    <div data-role="csv-map" style="display:none">
      <div class="field">
        <label>Import into account</label>
        <select class="input" data-role="csv-account">${accountOptions()}</select>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Date column</label>
          <select class="input" data-role="csv-date"></select>
        </div>
        <div class="field">
          <label>Description column</label>
          <select class="input" data-role="csv-desc"></select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Amount column</label>
          <select class="input" data-role="csv-amount"></select>
        </div>
        <div class="field">
          <label>Type column (optional)</label>
          <select class="input" data-role="csv-type"></select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Debit column (optional)</label>
          <select class="input" data-role="csv-debit"></select>
        </div>
        <div class="field">
          <label>Credit column (optional)</label>
          <select class="input" data-role="csv-credit"></select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Category column (optional)</label>
          <select class="input" data-role="csv-category"></select>
        </div>
        <div class="field">
          <label>Default type</label>
          <select class="input" data-role="csv-default">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label class="flex" style="align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13.5px">
          <input type="checkbox" data-role="csv-invert"> Treat positive amounts as expenses
        </label>
        <label class="flex" style="align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13.5px">
          <input type="checkbox" data-role="csv-skip" checked> Skip transactions that already exist
        </label>
      </div>
      <div class="field">
        <label>Tags for imported rows (optional)</label>
        <input class="input" data-role="csv-tags" maxlength="120" placeholder="e.g. imported,hdfc" autocomplete="off">
      </div>
      <div class="help-text" data-role="csv-summary"></div>
    </div>`;

  openModal(modalShell('Import bank statement', body, '', 'Import'), {
    async onMount(modal, closeModal) {
      const okBtn = modal.querySelector('[data-ok]');
      okBtn.disabled = true;
      const mapBox = modal.querySelector('[data-role="csv-map"]');
      const summary = modal.querySelector('[data-role="csv-summary"]');

      const select = role => modal.querySelector(`[data-role="${role}"]`);
      const fill = (role, guessWords, allowNone = true) => {
        const sel = select(role);
        const guess = headers.find(h => guessWords.some(w => h.toLowerCase().includes(w))) || '';
        sel.innerHTML = (allowNone ? '<option value="">— none —</option>' : '') +
          headers.map(h => `<option value="${esc(h)}" ${h === guess ? 'selected' : ''}>${esc(h)}</option>`).join('');
      };

      select('csv-file').addEventListener('change', async e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const r = await api.post('/api/import/csv/preview', { csv: text });
          csvText = text;
          headers = r.headers || [];
          total = r.total || 0;
          ready = true;
          fill('csv-date', ['date'], false);
          fill('csv-desc', ['description', 'narration', 'particular', 'details', 'remark', 'memo', 'payee']);
          fill('csv-amount', ['amount', 'value']);
          fill('csv-type', ['type', 'dr/cr', 'debit/credit']);
          fill('csv-debit', ['debit', 'withdrawal', 'dr']);
          fill('csv-credit', ['credit', 'deposit', 'cr']);
          fill('csv-category', ['category']);
          mapBox.style.display = '';
          okBtn.disabled = false;
          summary.textContent = `${total} data row${total === 1 ? '' : 's'} found. Check the mapping, then import.`;
          // If debit/credit columns exist, clear the single amount guess so they take priority.
          if (select('csv-debit').value || select('csv-credit').value) select('csv-amount').value = '';
        } catch (err) {
          showToast(err.message, 'error');
          ready = false;
          okBtn.disabled = true;
          mapBox.style.display = 'none';
        }
      });

      okBtn.addEventListener('click', async () => {
        if (!ready) return showToast('Choose a CSV file first', 'error');
        const mapping = {
          date: select('csv-date').value,
          description: select('csv-desc').value,
          amount: select('csv-amount').value,
          type: select('csv-type').value,
          debit: select('csv-debit').value,
          credit: select('csv-credit').value,
          category: select('csv-category').value,
        };
        if (!mapping.date) return showToast('Map the date column', 'error');
        if (!mapping.amount && !mapping.debit && !mapping.credit) {
          return showToast('Map an amount column, or debit/credit columns', 'error');
        }
        okBtn.disabled = true;
        okBtn.textContent = 'Importing…';
        try {
          const r = await api.post('/api/import/csv', {
            csv: csvText,
            mapping,
            account_id: select('csv-account').value || null,
            default_type: select('csv-default').value,
            invert_amount: select('csv-invert').checked,
            skip_duplicates: select('csv-skip').checked,
            tags: select('csv-tags').value,
          });
          const parts = [`Imported ${r.inserted}`];
          if (r.skipped) parts.push(`${r.skipped} skipped`);
          if (r.failed) parts.push(`${r.failed} failed`);
          showToast(parts.join(' · '));
          if (r.failed && r.errors && r.errors.length) console.warn('CSV import issues:', r.errors);
          closeModal(true);
          refreshView();
        } catch (err) {
          okBtn.disabled = false;
          okBtn.textContent = 'Import';
          showToast(err.message, 'error');
        }
      });
    },
  });
}
