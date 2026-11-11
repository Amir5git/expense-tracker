'use strict';

/* ============================================================
   Modals, dialogs & toasts
   ============================================================ */

const modalStack = [];

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
    close(result) {
      const i = modalStack.indexOf(entry);
      if (i >= 0) modalStack.splice(i, 1);
      overlay.remove();
      document.body.style.overflow = '';
      if (onClose) onClose(result);
    },
  };

  modalStack.push(entry);
  document.body.style.overflow = 'hidden';
  $('#modalRoot').appendChild(overlay);

  const modal = overlay.querySelector('.modal');
  overlay.addEventListener('click', e => { if (e.target === overlay) entry.close(false); });
  overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => entry.close(false)));
  if (onMount) onMount(modal, entry.close);
  return entry.close;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close(false);
});

/* ---------- toast ---------- */

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.textContent = msg;
  $('#toastRoot').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, 2400);
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
        <label>Payment method</label>
        <select class="input" data-role="tx-method">
          ${METHODS.map(m => `<option value="${m.id}" ${base.method === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
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
        const method = m2(modal, 'tx-method').value;
        const note = m2(modal, 'tx-note').value.trim();
        const tags = m2(modal, 'tx-tags').value;

        if (!amount || amount <= 0) return showToast('Enter an amount greater than zero', 'error');
        if (!categoryId) return showToast('Pick a category', 'error');
        if (!date) return showToast('Pick a date', 'error');

        const payload = { type, amount, category_id: categoryId, date, note, method, tags };
        try {
          modal.querySelector('[data-ok]').disabled = true;
          if (tx) await api.put(`/api/transactions/${tx.id}`, payload);
          else await api.post('/api/transactions', payload);
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
        const ok = await confirmDialog({ title: 'Delete transaction?', message: 'This cannot be undone.' });
        if (!ok) return;
        try {
          await api.del(`/api/transactions/${tx.id}`);
          showToast('Transaction deleted');
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

/* ============================================================
   Category modal
   ============================================================ */

function openCategoryModal(cat = null, presetType = 'expense', onSaved = null) {
  let type = cat ? cat.type : presetType;
  let icon = cat ? cat.icon : '🍜';
  let color = cat ? cat.color : COLORS[Math.floor(Math.random() * 8)];

  const emojiGrid = EMOJIS.map(e => `<button type="button" class="emoji-opt ${e === icon ? 'selected' : ''}" data-emoji="${e}">${e}</button>`).join('');
  const colorGrid = COLORS.map(c => `<button type="button" class="color-opt ${c === color ? 'selected' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');

  const body = `
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
        const ok = await confirmDialog({ title: `Delete "${cat.name}"?`, message: 'Budgets and recurring rules for this category will also be removed.' });
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
        <label>Payment method</label>
        <select class="input" data-role="rec-method">
          ${METHODS.map(m => `<option value="${m.id}" ${base.method === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
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
        const method = modal.querySelector('[data-role="rec-method"]').value;
        const note = modal.querySelector('[data-role="rec-note"]').value;
        modal.querySelector('.modal-body').innerHTML = body();
        modal.querySelector('[data-role="rec-amount"]').value = amount;
        modal.querySelector('[data-role="rec-freq"]').value = freq;
        modal.querySelector('[data-role="rec-next"]').value = next;
        modal.querySelector('[data-role="rec-method"]').value = method;
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
        wireCatGrid(modal, () => categoryId, v => { categoryId = v; });
      };
      wire();

      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        const amount = Number(modal.querySelector('[data-role="rec-amount"]').value);
        const frequency = modal.querySelector('[data-role="rec-freq"]').value;
        const next_date = modal.querySelector('[data-role="rec-next"]').value;
        const method = modal.querySelector('[data-role="rec-method"]').value;
        const note = modal.querySelector('[data-role="rec-note"]').value.trim();
        if (!amount || amount <= 0) return showToast('Enter an amount', 'error');
        if (!categoryId) return showToast('Pick a category', 'error');
        if (!next_date) return showToast('Pick the next date', 'error');
        const payload = { type, amount, category_id: categoryId, frequency, next_date, note, method, active };
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
