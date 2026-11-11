'use strict';

/**
 * Expense Tracker — backend (runtime-agnostic)
 *
 * One Hono app that runs unchanged on two runtimes:
 *   - Node.js             server.js  (npm start, node:sqlite in DATA_DIR)
 *   - Cloudflare Workers  worker.js  (npm run deploy, D1 binding "DB")
 *
 * All database access goes through the async adapter in db.js, so the API
 * code never knows which runtime or storage engine is underneath.
 */

const { Hono } = require('hono');
const Smart = require('./smart');
const AI = require('./ai');

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  { code: 'MXN', symbol: 'Mex$', name: 'Mexican Peso' },
  { code: 'PKR', symbol: '₨', name: 'Pakistani Rupee' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka' },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht' },
];

const METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'netbanking', label: 'Net Banking' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'other', label: 'Other' },
];

const DEFAULT_CATEGORIES = [
  // expenses
  { name: 'Food & Dining', type: 'expense', icon: '🍜', color: '#FF6B6B' },
  { name: 'Groceries', type: 'expense', icon: '🛒', color: '#00B894' },
  { name: 'Transport', type: 'expense', icon: '🚗', color: '#0984E3' },
  { name: 'Rent', type: 'expense', icon: '🏠', color: '#6C5CE7' },
  { name: 'Utilities', type: 'expense', icon: '💡', color: '#FDCB6E' },
  { name: 'Shopping', type: 'expense', icon: '🛍️', color: '#E17055' },
  { name: 'Entertainment', type: 'expense', icon: '🎬', color: '#D63057' },
  { name: 'Health', type: 'expense', icon: '💊', color: '#00CEC9' },
  { name: 'Education', type: 'expense', icon: '📚', color: '#FD79A8' },
  { name: 'Travel', type: 'expense', icon: '✈️', color: '#A29BFE' },
  { name: 'Subscriptions', type: 'expense', icon: '🔁', color: '#74B9FF' },
  { name: 'Personal Care', type: 'expense', icon: '🧴', color: '#FF9FF3' },
  { name: 'Others', type: 'expense', icon: '📦', color: '#B2BEC3' },
  // income
  { name: 'Salary', type: 'income', icon: '💼', color: '#00B894' },
  { name: 'Freelance', type: 'income', icon: '💻', color: '#0984E3' },
  { name: 'Business', type: 'income', icon: '🏪', color: '#E17055' },
  { name: 'Investments', type: 'income', icon: '📈', color: '#00CEC9' },
  { name: 'Interest', type: 'income', icon: '🏦', color: '#FDCB6E' },
  { name: 'Gifts', type: 'income', icon: '🎁', color: '#FD79A8' },
  { name: 'Refunds', type: 'income', icon: '↩️', color: '#A29BFE' },
  { name: 'Other Income', type: 'income', icon: '💰', color: '#B2BEC3' },
];

/* No PRAGMAs here (D1 manages its own), no comments (d1.exec splits statements). */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  type      TEXT    NOT NULL CHECK (type IN ('income','expense')),
  icon      TEXT    NOT NULL,
  color     TEXT    NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE (name, type)
);
CREATE TABLE IF NOT EXISTS recurring (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount      REAL NOT NULL CHECK (amount > 0),
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  note        TEXT NOT NULL DEFAULT '',
  method      TEXT NOT NULL DEFAULT 'cash',
  frequency   TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  next_date   TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  last_run    TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount       REAL NOT NULL CHECK (amount > 0),
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  date         TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  method       TEXT NOT NULL DEFAULT 'cash',
  recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  tags         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_category  ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_recurring ON transactions(recurring_id);
CREATE TABLE IF NOT EXISTS budgets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
  amount      REAL NOT NULL CHECK (amount > 0)
);
`;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayStr() { return fmtDate(new Date()); }
function currentMonthKey() { return todayStr().slice(0, 7); }

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function validMonth(s) {
  if (typeof s !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return false;
  return true;
}
function validAmount(n) {
  const v = Number(n);
  return typeof v === 'number' && isFinite(v) && v > 0 && v < 1e13;
}
function validMonthKeyOrCurrent(s) { return validMonth(s) ? s : currentMonthKey(); }

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${pad2(last)}`, days: last };
}

function addMonthsKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function advanceDate(dateStr, frequency) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let dt;
  switch (frequency) {
    case 'daily': dt = new Date(y, m - 1, d + 1); break;
    case 'weekly': dt = new Date(y, m - 1, d + 7); break;
    case 'monthly': {
      const nm = m + 1, ny = nm > 12 ? y + 1 : y, mm = nm > 12 ? 1 : nm;
      const maxDay = new Date(ny, mm, 0).getDate();
      dt = new Date(ny, mm - 1, Math.min(d, maxDay));
      break;
    }
    case 'yearly': {
      const ny = y + 1;
      const maxDay = new Date(ny, m, 0).getDate();
      dt = new Date(ny, m - 1, Math.min(d, maxDay));
      break;
    }
    default: dt = new Date(y, m - 1, d);
  }
  return fmtDate(dt);
}

function escapeLike(s) { return String(s).replace(/[\\%_]/g, c => '\\' + c); }

/* ------------------------------------------------------------------ */
/* Schema init (idempotent, race-safe across isolates/processes)       */
/* ------------------------------------------------------------------ */

async function ensureSchema(db) {
  // On a brand-new database the settings table doesn't exist yet — treat that
  // as "not initialized" instead of an error.
  let marker = null;
  try {
    marker = await db.get("SELECT value FROM settings WHERE key = 'schema_v1'");
  } catch { /* no schema yet */ }
  if (marker && marker.value === 'ok') return;

  await db.exec(SCHEMA_SQL);
  // databases from before the tags feature (tags is in SCHEMA_SQL for new ones)
  try { await db.exec("ALTER TABLE transactions ADD COLUMN tags TEXT NOT NULL DEFAULT ''"); }
  catch (err) { if (!/duplicate column/i.test(String(err && err.message))) throw err; }

  const seedCat = 'INSERT INTO categories (name, type, icon, color, is_default) VALUES (?, ?, ?, ?, 1) ON CONFLICT (name, type) DO NOTHING';
  for (const c of DEFAULT_CATEGORIES) await db.run(seedCat, [c.name, c.type, c.icon, c.color]);
  await db.run("INSERT INTO settings (key, value) VALUES ('currency', 'INR') ON CONFLICT (key) DO NOTHING");
  await db.run("INSERT INTO settings (key, value) VALUES ('theme', 'system') ON CONFLICT (key) DO NOTHING");
  await db.run("INSERT INTO settings (key, value) VALUES ('schema_v1', 'ok') ON CONFLICT (key) DO NOTHING");
}

/* ------------------------------------------------------------------ */
/* App factory                                                         */
/* ------------------------------------------------------------------ */

function createApp(db, opts = {}) {

  async function getSetting(key, fallback) {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : fallback;
  }
  async function setSetting(key, value) {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, String(value)]);
  }
  async function getCategory(id) {
    return db.get('SELECT * FROM categories WHERE id = ?', [id]);
  }
  async function txRow(id) {
    return db.get(`
      SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.id = ?`, [id]);
  }
  async function currencySymbol() {
    const code = await getSetting('currency', 'INR');
    return (CURRENCIES.find(c => c.code === code) || { symbol: '₹' }).symbol;
  }

  const SmartEngine = Smart({
    db, monthRange, currentMonthKey, addMonthsKey, todayStr, currencySymbol,
  });
  const AILayer = AI({
    db, getSetting, setSetting, todayStr, monthRange, addMonthsKey, currentMonthKey,
  });

  /* ---- recurring engine ---- */

  /**
   * Posts any recurring transactions that are due (next_date <= today) and
   * advances the rules. Safe under concurrency: a short-lived lock in the
   * settings table claims the job across processes/isolates, and all writes
   * land atomically via db.batch.
   */
  async function processRecurring() {
    const today = todayStr();
    const due = await db.get('SELECT COUNT(*) AS c FROM recurring WHERE active = 1 AND next_date <= ?', [today]);
    if (!due || !due.c) return 0;

    await db.run("INSERT INTO settings (key, value) VALUES ('recurring_lock', '') ON CONFLICT (key) DO NOTHING");
    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + 30000).toISOString();
    const claim = await db.run(
      "UPDATE settings SET value = ? WHERE key = 'recurring_lock' AND (value = '' OR value < ?)",
      [expiry, now]);
    if (!claim.changes) return 0; // someone else is processing

    try {
      const rules = await db.all('SELECT * FROM recurring WHERE active = 1 AND next_date <= ?', [today]);
      const stmts = [];
      let created = 0;
      for (const rule of rules) {
        let next = rule.next_date;
        let guard = 0;
        while (next <= today && guard < 5000) {
          stmts.push({
            sql: 'INSERT INTO transactions (type, amount, category_id, date, note, method, recurring_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            params: [rule.type, rule.amount, rule.category_id, next, rule.note || '', rule.method || 'cash', rule.id],
          });
          next = advanceDate(next, rule.frequency);
          guard++;
          created++;
        }
        const active = guard < 5000 ? 1 : 0; // safety: disable runaway rules
        stmts.push({
          sql: 'UPDATE recurring SET next_date = ?, last_run = ?, active = ? WHERE id = ?',
          params: [next, today, active, rule.id],
        });
      }
      if (stmts.length) await db.batch(stmts);
      return created;
    } finally {
      await db.run("UPDATE settings SET value = '' WHERE key = 'recurring_lock'");
    }
  }

  // Node entry only: post anything already due at boot + once an hour.
  if (opts.recurringTimer) {
    processRecurring().catch(err => console.error('[recurring] failed:', err));
    const timer = setInterval(() => {
      processRecurring()
        .then(n => { if (n) console.log(`[recurring] posted ${n} transaction(s)`); })
        .catch(err => console.error('[recurring] failed:', err));
    }, 60 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  /* ---- app ---- */

  const app = new Hono();

  /** JSON body: empty body → {}, malformed JSON → 400 (like express.json). */
  async function readJson(c) {
    const raw = await c.req.text().catch(() => '');
    if (!raw) return {};
    try { return JSON.parse(raw); }
    catch {
      const err = new Error('Invalid JSON body');
      err.status = 400;
      throw err;
    }
  }

  /* ---- health ---- */
  app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

  /* ---- bootstrap ---- */
  app.get('/api/bootstrap', async (c) => {
    await processRecurring();
    return c.json({
      settings: { currency: await getSetting('currency', 'INR'), theme: await getSetting('theme', 'system') },
      categories: await db.all('SELECT * FROM categories ORDER BY type, name'),
      methods: METHODS,
      currencies: CURRENCIES,
      ai: await AILayer.status(),
    });
  });

  /* ---- settings ---- */
  app.get('/api/settings', async (c) => c.json({
    currency: await getSetting('currency', 'INR'),
    theme: await getSetting('theme', 'system'),
    ai_provider: await getSetting('ai_provider', 'none'),
    ai_model: await getSetting('ai_model', ''),
    ai_base_url: await getSetting('ai_base_url', ''),
    ai_has_key: !!(await getSetting('ai_key', '')),
  }));

  app.put('/api/settings', async (c) => {
    const { currency, theme, ai_provider, ai_key, ai_model, ai_base_url } = await readJson(c);
    if (currency !== undefined) {
      if (!CURRENCIES.some(x => x.code === currency)) return c.json({ error: 'Unsupported currency' }, 400);
      await setSetting('currency', currency);
    }
    if (theme !== undefined) {
      if (!['system', 'light', 'dark'].includes(theme)) return c.json({ error: 'Invalid theme' }, 400);
      await setSetting('theme', theme);
    }
    if (ai_provider !== undefined) {
      if (!['none', 'groq', 'gemini', 'openrouter', 'custom'].includes(ai_provider)) return c.json({ error: 'Invalid AI provider' }, 400);
      await setSetting('ai_provider', ai_provider);
    }
    if (ai_key !== undefined && typeof ai_key === 'string' && ai_key.length > 0 && ai_key.length < 500) {
      await setSetting('ai_key', ai_key.trim());
    }
    if (ai_model !== undefined && typeof ai_model === 'string') await setSetting('ai_model', ai_model.trim().slice(0, 120));
    if (ai_base_url !== undefined && typeof ai_base_url === 'string') await setSetting('ai_base_url', ai_base_url.trim().slice(0, 300));
    return c.json({
      currency: await getSetting('currency', 'INR'),
      theme: await getSetting('theme', 'system'),
      ai_provider: await getSetting('ai_provider', 'none'),
      ai_model: await getSetting('ai_model', ''),
      ai_base_url: await getSetting('ai_base_url', ''),
      ai_has_key: !!(await getSetting('ai_key', '')),
    });
  });

  /* ---- transactions ---- */
  app.get('/api/transactions', async (c) => {
    await processRecurring();
    const { type, category, from, to, q, tag, sort } = c.req.query();

    const where = [];
    const params = [];
    if (type === 'income' || type === 'expense') { where.push('t.type = ?'); params.push(type); }
    if (category && Number.isInteger(Number(category))) { where.push('t.category_id = ?'); params.push(Number(category)); }
    if (validDate(from)) { where.push('t.date >= ?'); params.push(from); }
    if (validDate(to)) { where.push('t.date <= ?'); params.push(to); }
    if (tag && String(tag).trim()) {
      where.push("(',' || t.tags || ',' LIKE ?)");
      params.push('%,' + String(tag).trim().toLowerCase() + ',%');
    }
    if (q && String(q).trim()) {
      const like = `%${escapeLike(String(q).trim())}%`;
      where.push("(t.note LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const SORTS = {
      date_desc: 't.date DESC, t.id DESC',
      date_asc: 't.date ASC, t.id ASC',
      amount_desc: 't.amount DESC, t.id DESC',
      amount_asc: 't.amount ASC, t.id ASC',
    };
    const sortSql = SORTS[sort] || SORTS.date_desc;

    const lim = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200);
    const off = Math.max(Number(c.req.query('offset')) || 0, 0);

    const rows = await db.all(`
      SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
      FROM transactions t JOIN categories c ON c.id = t.category_id
      ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`, [...params, lim, off]);

    const total = (await db.get(`
      SELECT COUNT(*) AS c FROM transactions t JOIN categories c ON c.id = t.category_id ${whereSql}`, params)).c;

    const sums = await db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS expense
      FROM transactions t JOIN categories c ON c.id = t.category_id ${whereSql}`, params);

    return c.json({ rows, total, income: sums.income, expense: sums.expense, limit: lim, offset: off });
  });

  async function validateTxBody(body, { partial = false, existing = null } = {}) {
    const out = {};
    const b = body || {};

    if (!partial || b.type !== undefined) {
      const type = b.type ?? existing?.type;
      if (type !== 'income' && type !== 'expense') return { error: 'Type must be income or expense' };
      out.type = type;
    }
    if (!partial || b.amount !== undefined) {
      if (!validAmount(b.amount ?? existing?.amount)) return { error: 'Amount must be a positive number' };
      out.amount = Math.round(Number(b.amount ?? existing?.amount) * 100) / 100;
    }
    if (!partial || b.category_id !== undefined) {
      const catId = Number(b.category_id ?? existing?.category_id);
      const cat = await getCategory(catId);
      if (!cat) return { error: 'Category not found' };
      const type = out.type ?? existing?.type;
      if (cat.type !== type) return { error: 'Category type does not match transaction type' };
      out.category_id = catId;
    }
    if (!partial || b.date !== undefined) {
      const date = b.date ?? existing?.date;
      if (!validDate(date)) return { error: 'Invalid date (expected YYYY-MM-DD)' };
      out.date = date;
    }
    if (!partial || b.method !== undefined) {
      const method = b.method ?? existing?.method ?? 'cash';
      if (!METHODS.some(m => m.id === method)) return { error: 'Invalid payment method' };
      out.method = method;
    }
    if (!partial || b.note !== undefined) {
      const note = b.note ?? existing?.note ?? '';
      if (typeof note !== 'string' || note.length > 500) return { error: 'Note must be 500 characters or fewer' };
      out.note = note.trim();
    }
    if (!partial || b.tags !== undefined) {
      let tags = b.tags ?? existing?.tags ?? '';
      if (Array.isArray(tags)) tags = tags.join(',');
      if (typeof tags !== 'string') return { error: 'Invalid tags' };
      const list = tags.split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
        .map(t => t.slice(0, 24));
      out.tags = [...new Set(list)].join(',');
    }
    return { value: out };
  }

  app.post('/api/transactions', async (c) => {
    const v = await validateTxBody(await readJson(c));
    if (v.error) return c.json({ error: v.error }, 400);
    const { type, amount, category_id, date, note, method, tags } = v.value;
    const info = await db.run(`
      INSERT INTO transactions (type, amount, category_id, date, note, method, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [type, amount, category_id, date, note, method, tags || '']);
    SmartEngine.invalidatePatterns();
    return c.json(await txRow(info.lastInsertRowid), 201);
  });

  app.put('/api/transactions/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!existing) return c.json({ error: 'Transaction not found' }, 404);
    const v = await validateTxBody(await readJson(c), { partial: true, existing });
    if (v.error) return c.json({ error: v.error }, 400);
    const next = { ...existing, ...v.value };
    await db.run(`
      UPDATE transactions SET type = ?, amount = ?, category_id = ?, date = ?, note = ?, method = ?, tags = ?
      WHERE id = ?`,
      [next.type, next.amount, next.category_id, next.date, next.note, next.method, next.tags || '', id]);
    SmartEngine.invalidatePatterns();
    return c.json(await txRow(id));
  });

  app.delete('/api/transactions/:id', async (c) => {
    const info = await db.run('DELETE FROM transactions WHERE id = ?', [Number(c.req.param('id'))]);
    if (info.changes === 0) return c.json({ error: 'Transaction not found' }, 404);
    SmartEngine.invalidatePatterns();
    return c.json({ ok: true });
  });

  /* ---- categories ---- */
  app.get('/api/categories', async (c) => {
    const rows = await db.all(`
      SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usage_count,
                  (SELECT COUNT(*) FROM recurring r WHERE r.category_id = c.id) AS recurring_count
      FROM categories c ORDER BY c.type, c.name`);
    return c.json(rows);
  });

  function validateCategory(body, existing) {
    const b = body || {};
    const name = (b.name ?? existing?.name ?? '').trim();
    if (!name || name.length > 40) return { error: 'Name must be 1-40 characters' };
    const type = b.type ?? existing?.type;
    if (type !== 'income' && type !== 'expense') return { error: 'Type must be income or expense' };
    const icon = String(b.icon ?? existing?.icon ?? '📦');
    if (!icon.length || icon.length > 8) return { error: 'Invalid icon' };
    const color = String(b.color ?? existing?.color ?? '#6C5CE7');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'Invalid color' };
    return { value: { name, type, icon, color } };
  }

  app.post('/api/categories', async (c) => {
    const v = validateCategory(await readJson(c));
    if (v.error) return c.json({ error: v.error }, 400);
    const { name, type, icon, color } = v.value;
    try {
      const info = await db.run('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)',
        [name, type, icon, color]);
      return c.json(await getCategory(info.lastInsertRowid), 201);
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) return c.json({ error: 'A category with this name and type already exists' }, 409);
      throw err;
    }
  });

  app.put('/api/categories/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = await getCategory(id);
    if (!existing) return c.json({ error: 'Category not found' }, 404);
    const v = validateCategory(await readJson(c), existing);
    if (v.error) return c.json({ error: v.error }, 400);
    const usage = (await db.get('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?', [id])).c;
    if (usage > 0 && v.value.type !== existing.type) {
      return c.json({ error: 'Cannot change type: category is used by existing transactions' }, 400);
    }
    try {
      await db.run('UPDATE categories SET name = ?, type = ?, icon = ?, color = ? WHERE id = ?',
        [v.value.name, v.value.type, v.value.icon, v.value.color, id]);
      return c.json(await getCategory(id));
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) return c.json({ error: 'A category with this name and type already exists' }, 409);
      throw err;
    }
  });

  app.delete('/api/categories/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const usage = (await db.get('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?', [id])).c;
    if (usage > 0) {
      return c.json({ error: `Cannot delete: used by ${usage} transaction${usage === 1 ? '' : 's'}. Reassign them first.` }, 409);
    }
    const info = await db.run('DELETE FROM categories WHERE id = ?', [id]);
    if (info.changes === 0) return c.json({ error: 'Category not found' }, 404);
    return c.json({ ok: true });
  });

  /* ---- budgets ---- */
  async function budgetsWithSpent(month) {
    const { start, end } = monthRange(month);
    return db.all(`
      SELECT b.id, b.category_id, b.amount, c.name, c.icon, c.color,
             COALESCE((SELECT SUM(t.amount) FROM transactions t
                       WHERE t.category_id = b.category_id AND t.type = 'expense'
                         AND t.date >= ? AND t.date <= ?), 0) AS spent
      FROM budgets b JOIN categories c ON c.id = b.category_id
      ORDER BY c.name`, [start, end]);
  }

  app.get('/api/budgets', async (c) => {
    const month = validMonthKeyOrCurrent(c.req.query('month'));
    return c.json({ month, budgets: await budgetsWithSpent(month) });
  });

  app.put('/api/budgets', async (c) => {
    const b = await readJson(c);
    const catId = Number(b.category_id);
    const cat = await getCategory(catId);
    if (!cat) return c.json({ error: 'Category not found' }, 400);
    if (cat.type !== 'expense') return c.json({ error: 'Budgets can only be set for expense categories' }, 400);
    const amount = Number(b.amount);
    if (!validAmount(amount)) return c.json({ error: 'Amount must be a positive number' }, 400);
    await db.run(`
      INSERT INTO budgets (category_id, amount) VALUES (?, ?)
      ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount`,
      [catId, Math.round(amount * 100) / 100]);
    return c.json({ ok: true });
  });

  app.delete('/api/budgets/:id', async (c) => {
    const info = await db.run('DELETE FROM budgets WHERE id = ?', [Number(c.req.param('id'))]);
    if (info.changes === 0) return c.json({ error: 'Budget not found' }, 404);
    return c.json({ ok: true });
  });

  /* ---- recurring ---- */
  app.get('/api/recurring', async (c) => {
    await processRecurring();
    const rows = await db.all(`
      SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
      FROM recurring r JOIN categories c ON c.id = r.category_id
      ORDER BY r.active DESC, r.next_date`);
    return c.json(rows);
  });

  async function validateRecurringBody(body, existing) {
    const b = body || {};
    const out = {};
    if (b.type !== undefined || !existing) {
      const type = b.type ?? existing?.type;
      if (type !== 'income' && type !== 'expense') return { error: 'Type must be income or expense' };
      out.type = type;
    }
    if (b.amount !== undefined || !existing) {
      if (!validAmount(b.amount ?? existing?.amount)) return { error: 'Amount must be a positive number' };
      out.amount = Math.round(Number(b.amount ?? existing?.amount) * 100) / 100;
    }
    if (b.category_id !== undefined || !existing) {
      const cat = await getCategory(Number(b.category_id ?? existing?.category_id));
      if (!cat) return { error: 'Category not found' };
      if (cat.type !== (out.type ?? existing?.type)) return { error: 'Category type must match the rule type' };
      out.category_id = cat.id;
    }
    if (b.frequency !== undefined || !existing) {
      const f = b.frequency ?? existing?.frequency;
      if (!['daily', 'weekly', 'monthly', 'yearly'].includes(f)) return { error: 'Invalid frequency' };
      out.frequency = f;
    }
    if (b.next_date !== undefined || !existing) {
      const nd = b.next_date ?? existing?.next_date;
      if (!validDate(nd)) return { error: 'Invalid next date (expected YYYY-MM-DD)' };
      out.next_date = nd;
    }
    if (b.method !== undefined || !existing) {
      const m = b.method ?? existing?.method ?? 'cash';
      if (!METHODS.some(x => x.id === m)) return { error: 'Invalid payment method' };
      out.method = m;
    }
    if (b.note !== undefined || !existing) {
      const note = b.note ?? existing?.note ?? '';
      if (typeof note !== 'string' || note.length > 500) return { error: 'Note must be 500 characters or fewer' };
      out.note = note.trim();
    }
    if (b.active !== undefined) out.active = b.active ? 1 : 0;
    return { value: out };
  }

  app.post('/api/recurring', async (c) => {
    const v = await validateRecurringBody(await readJson(c));
    if (v.error) return c.json({ error: v.error }, 400);
    const x = v.value;
    const info = await db.run(`
      INSERT INTO recurring (type, amount, category_id, note, method, frequency, next_date, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [x.type, x.amount, x.category_id, x.note || '', x.method, x.frequency, x.next_date, x.active ?? 1]);
    return c.json(await db.get('SELECT * FROM recurring WHERE id = ?', [info.lastInsertRowid]), 201);
  });

  app.put('/api/recurring/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = await db.get('SELECT * FROM recurring WHERE id = ?', [id]);
    if (!existing) return c.json({ error: 'Rule not found' }, 404);
    const v = await validateRecurringBody(await readJson(c), existing);
    if (v.error) return c.json({ error: v.error }, 400);
    const x = { ...existing, ...v.value };
    await db.run(`
      UPDATE recurring SET type = ?, amount = ?, category_id = ?, note = ?, method = ?, frequency = ?, next_date = ?, active = ?
      WHERE id = ?`,
      [x.type, x.amount, x.category_id, x.note, x.method, x.frequency, x.next_date, x.active, id]);
    return c.json(await db.get('SELECT * FROM recurring WHERE id = ?', [id]));
  });

  app.delete('/api/recurring/:id', async (c) => {
    const info = await db.run('DELETE FROM recurring WHERE id = ?', [Number(c.req.param('id'))]);
    if (info.changes === 0) return c.json({ error: 'Rule not found' }, 404);
    return c.json({ ok: true });
  });

  /* ---- summary / dashboard ---- */
  app.get('/api/summary', async (c) => {
    await processRecurring();
    const month = validMonthKeyOrCurrent(c.req.query('month'));
    const { start, end, days } = monthRange(month);
    const prevMonth = addMonthsKey(month, -1);
    const prevRange = monthRange(prevMonth);
    const trendStart = addMonthsKey(month, -5);

    const monthTotals = await db.get(`
      SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
             COUNT(*) AS count
      FROM transactions WHERE date >= ? AND date <= ?`, [start, end]);

    const prevTotals = await db.get(`
      SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
      FROM transactions WHERE date >= ? AND date <= ?`, [prevRange.start, prevRange.end]);

    const allTime = await db.get(`
      SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
             COUNT(*) AS count
      FROM transactions`);

    const byCategory = await db.all(`
      SELECT c.id, c.name, c.icon, c.color, SUM(t.amount) AS amount, COUNT(*) AS count
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.type = 'expense' AND t.date >= ? AND t.date <= ?
      GROUP BY c.id ORDER BY amount DESC`, [start, end]);

    const daily = await db.all(`
      SELECT date,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income
      FROM transactions WHERE date >= ? AND date <= ?
      GROUP BY date ORDER BY date`, [start, end]);

    const trend = await db.all(`
      SELECT substr(date, 1, 7) AS ym,
             COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
      FROM transactions WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ?
      GROUP BY ym ORDER BY ym`, [trendStart, month]);

    const budgets = await budgetsWithSpent(month);

    // project month-end spend using weekday-aware forecasting (current month only)
    const projected = month === currentMonthKey() ? await SmartEngine.weekdayForecast(month) : null;

    const recent = await db.all(`
      SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
      FROM transactions t JOIN categories c ON c.id = t.category_id
      ORDER BY t.date DESC, t.id DESC LIMIT 8`);

    return c.json({
      month, days,
      monthTotals, prevTotals, allTime,
      byCategory, daily, trend, budgets, projected, recent,
      savingsRate: monthTotals.income > 0 ? (monthTotals.income - monthTotals.expense) / monthTotals.income : null,
    });
  });

  /* ---- tags ---- */
  app.get('/api/tags', async (c) => {
    const rows = await db.all("SELECT tags FROM transactions WHERE tags != ''");
    const set = new Set();
    for (const r of rows) for (const t of r.tags.split(',')) if (t.trim()) set.add(t.trim());
    return c.json([...set].sort());
  });

  /* ---- smart engine ---- */
  app.get('/api/smart/insights', async (c) => {
    await processRecurring();
    const month = validMonthKeyOrCurrent(c.req.query('month'));
    return c.json({ month, insights: await SmartEngine.insights(month) });
  });

  app.post('/api/smart/suggest', async (c) => {
    const { type, note, amount } = await readJson(c);
    return c.json(await SmartEngine.suggest({ type, note, amount }));
  });

  app.get('/api/smart/subscriptions', async (c) => c.json(await SmartEngine.detectSubscriptions()));

  app.get('/api/smart/budget-suggestions', async (c) => {
    const month = validMonthKeyOrCurrent(c.req.query('month'));
    return c.json(await SmartEngine.budgetSuggestions(month));
  });

  app.get('/api/analytics', async (c) => {
    await processRecurring();
    const month = validMonthKeyOrCurrent(c.req.query('month'));
    return c.json(await SmartEngine.analytics(month));
  });

  /* ---- AI (bring-your-own-key LLM) ---- */
  app.get('/api/ai/status', async (c) => c.json(await AILayer.status()));

  app.post('/api/ai/ask', async (c) => {
    const { question, month } = await readJson(c);
    if (!question || !String(question).trim()) return c.json({ error: 'Ask a question first' }, 400);
    const m = validMonth(month) ? month : currentMonthKey();
    try {
      return c.json(await AILayer.ask(String(question).trim(), m));
    } catch (err) {
      return c.json({ error: err.message }, 502);
    }
  });

  app.post('/api/ai/parse', async (c) => {
    const { text } = await readJson(c);
    if (!text || !String(text).trim()) return c.json({ error: 'Enter some text first' }, 400);
    try {
      return c.json(await AILayer.parse(String(text).trim()));
    } catch (err) {
      return c.json({ error: err.message }, 502);
    }
  });

  app.post('/api/ai/test', async (c) => {
    try {
      return c.json(await AILayer.test());
    } catch (err) {
      return c.json({ error: err.message }, 502);
    }
  });

  /* ---- export / import / maintenance ---- */
  async function exportJson() {
    return {
      app: 'expense-tracker',
      version: 1,
      exported_at: new Date().toISOString(),
      settings: { currency: await getSetting('currency', 'INR'), theme: await getSetting('theme', 'system') },
      categories: await db.all('SELECT * FROM categories ORDER BY id'),
      transactions: await db.all('SELECT * FROM transactions ORDER BY id'),
      budgets: await db.all('SELECT * FROM budgets ORDER BY id'),
      recurring: await db.all('SELECT * FROM recurring ORDER BY id'),
    };
  }

  app.get('/api/export', async (c) => {
    const format = c.req.query('format') === 'csv' ? 'csv' : 'json';
    if (format === 'csv') {
      const rows = await db.all(`
        SELECT t.id, t.date, t.type, c.name AS category, t.amount, t.method, t.note, t.recurring_id, t.tags
        FROM transactions t JOIN categories c ON c.id = t.category_id
        ORDER BY t.date DESC, t.id DESC`);
      const header = ['id', 'date', 'type', 'category', 'amount', 'method', 'note', 'recurring_id', 'tags'];
      const escCsv = v => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [header.join(',')];
      for (const r of rows) lines.push([r.id, r.date, r.type, r.category, r.amount, r.method, r.note, r.recurring_id ?? '', r.tags ?? ''].map(escCsv).join(','));
      const csv = '\uFEFF' + lines.join('\r\n');
      return c.body(csv, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="expenses-${todayStr()}.csv"`,
      });
    }
    return c.json(await exportJson(), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="expense-tracker-backup-${todayStr()}.json"`,
    });
  });

  app.post('/api/import', async (c) => {
    const data = await readJson(c);
    if (!data || typeof data !== 'object' || !Array.isArray(data.categories) || !Array.isArray(data.transactions)) {
      return c.json({ error: 'Not a valid backup file (expected JSON export from this app)' }, 400);
    }
    const catIds = new Set(data.categories.map(x => Number(x.id)).filter(Number.isInteger));
    const txOk = data.transactions.every(t =>
      Number.isInteger(Number(t.id)) && validAmount(t.amount) &&
      (t.type === 'income' || t.type === 'expense') && validDate(t.date) && catIds.has(Number(t.category_id)));
    if (!txOk) return c.json({ error: 'Backup contains invalid transactions' }, 400);

    try {
      const stmts = [
        { sql: 'DELETE FROM transactions' },
        { sql: 'DELETE FROM budgets' },
        { sql: 'DELETE FROM recurring' },
        { sql: 'DELETE FROM categories' },
      ];
      for (const x of data.categories) {
        if (!(x.type === 'income' || x.type === 'expense')) throw new Error('Invalid category type');
        stmts.push({
          sql: 'INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)',
          params: [Number(x.id), String(x.name).slice(0, 40), x.type, String(x.icon || '📦').slice(0, 8),
            /^#[0-9a-fA-F]{6}$/.test(String(x.color)) ? x.color : '#6C5CE7', x.is_default ? 1 : 0],
        });
      }
      for (const t of data.transactions) {
        const tags = String(t.tags || '').split(',')
          .map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 10).map(x => x.slice(0, 24));
        stmts.push({
          sql: 'INSERT INTO transactions (id, type, amount, category_id, date, note, method, recurring_id, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          params: [Number(t.id), t.type, Number(t.amount), Number(t.category_id), t.date,
            String(t.note || '').slice(0, 500), METHODS.some(m => m.id === t.method) ? t.method : 'cash',
            t.recurring_id != null && Number.isInteger(Number(t.recurring_id)) ? Number(t.recurring_id) : null,
            [...new Set(tags)].join(',')],
        });
      }
      if (Array.isArray(data.budgets)) {
        for (const b of data.budgets) {
          if (validAmount(b.amount) && catIds.has(Number(b.category_id))) {
            stmts.push({
              sql: 'INSERT INTO budgets (id, category_id, amount) VALUES (?, ?, ?)',
              params: [Number(b.id), Number(b.category_id), Number(b.amount)],
            });
          }
        }
      }
      if (Array.isArray(data.recurring)) {
        const freqs = ['daily', 'weekly', 'monthly', 'yearly'];
        for (const r of data.recurring) {
          if (validAmount(r.amount) && catIds.has(Number(r.category_id)) && validDate(r.next_date) && freqs.includes(r.frequency)) {
            stmts.push({
              sql: 'INSERT INTO recurring (id, type, amount, category_id, note, method, frequency, next_date, active, last_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              params: [Number(r.id), r.type === 'income' ? 'income' : 'expense', Number(r.amount), Number(r.category_id),
                String(r.note || '').slice(0, 500), METHODS.some(m => m.id === r.method) ? r.method : 'cash',
                r.frequency, r.next_date, r.active ? 1 : 0, r.last_run || null],
            });
          }
        }
      }
      await db.batch(stmts);
      try { await db.exec("DELETE FROM sqlite_sequence WHERE name IN ('categories','transactions','budgets','recurring')"); } catch { /* not available everywhere */ }
      SmartEngine.invalidatePatterns();
    } catch (err) {
      return c.json({ error: 'Import failed: ' + err.message }, 400);
    }
    if (data.settings && typeof data.settings === 'object') {
      if (CURRENCIES.some(x => x.code === data.settings.currency)) await setSetting('currency', data.settings.currency);
      if (['system', 'light', 'dark'].includes(data.settings.theme)) await setSetting('theme', data.settings.theme);
    }
    return c.json({ ok: true, transactions: data.transactions.length });
  });

  app.post('/api/sample-data', async (c) => {
    const count = await db.get('SELECT COUNT(*) AS c FROM transactions');
    if (count.c > 0) return c.json({ error: 'Sample data can only be loaded when there are no transactions. Export & delete data first.' }, 409);

    const cats = await db.all('SELECT id, name FROM categories');
    const catId = name => { const r = cats.find(x => x.name === name); return r ? r.id : null; };

    const rnd = (min, max) => Math.round((min + Math.random() * (max - min)) * 100) / 100;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const today = new Date();
    const notes = {
      'Food & Dining': ['Lunch', 'Coffee', 'Dinner out', 'Snacks', 'Food court', 'Swiggy order'],
      'Groceries': ['Weekly groceries', 'Vegetables', 'Milk & eggs', 'Big basket run'],
      'Transport': ['Cab ride', 'Metro card', 'Petrol', 'Auto rickshaw', 'Parking'],
      'Shopping': ['Clothes', 'Amazon order', 'Shoes', 'Home stuff', 'Gadgets'],
      'Entertainment': ['Movie', 'Concert', 'Game', 'Bowling'],
      'Health': ['Pharmacy', 'Doctor visit', 'Gym fee'],
      'Subscriptions': ['Netflix', 'Spotify', 'YouTube Premium'],
      'Personal Care': ['Haircut', 'Skincare'],
    };
    // occasional tag pools to showcase tag analytics
    const tagPools = {
      'Food & Dining': ['work,office', 'friends', 'family', 'weekend'],
      'Transport': ['commute', 'office'],
      'Shopping': ['wants', 'gift'],
      'Entertainment': ['weekend', 'friends'],
      'Health': ['health'],
      'Groceries': ['household'],
    };

    const stmts = [];
    const ins = (type, amount, catName, ds, note, method, tags) => {
      const cid = catId(catName);
      if (cid == null) return;
      stmts.push({
        sql: 'INSERT INTO transactions (type, amount, category_id, date, note, method, tags) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [type, amount, cid, ds, note, method, tags],
      });
    };

    const earliest = new Date(today.getFullYear(), today.getMonth() - 3, 1);
    for (let d = new Date(earliest); d <= today; d.setDate(d.getDate() + 1)) {
      const ds = fmtDate(d);
      const dow = d.getDay();
      // salary on the 1st of each month
      if (d.getDate() === 1) ins('income', rnd(62000, 68000), 'Salary', ds, 'Monthly salary', 'netbanking', '');
      // freelance occasionally
      if (d.getDate() === 15 && Math.random() < 0.5) ins('income', rnd(3000, 15000), 'Freelance', ds, 'Side project', 'upi', 'side-hustle');
      // rent on the 3rd
      if (d.getDate() === 3) ins('expense', 16000, 'Rent', ds, 'Rent', 'netbanking', 'household');
      // utilities on the 10th
      if (d.getDate() === 10) ins('expense', rnd(1800, 4200), 'Utilities', ds, 'Electricity & internet', 'upi', 'household,bills');
      // subscriptions on the 5th
      if (d.getDate() === 5) {
        ins('expense', 649, 'Subscriptions', ds, 'Netflix', 'card', 'subscriptions,shared');
        ins('expense', 119, 'Subscriptions', ds, 'Spotify', 'card', 'subscriptions');
      }
      // groceries about twice a week
      if (dow === 0 || dow === 3 || (dow === 5 && Math.random() < 0.5)) {
        ins('expense', rnd(700, 2600), 'Groceries', ds, pick(notes['Groceries']), 'upi', pick(tagPools['Groceries']));
      }
      // food & dining most days
      if (Math.random() < 0.75) ins('expense', rnd(90, 750), 'Food & Dining', ds, pick(notes['Food & Dining']), pick(['upi', 'cash', 'card']), Math.random() < 0.35 ? pick(tagPools['Food & Dining']) : '');
      // transport most weekdays
      if (dow >= 1 && dow <= 5 && Math.random() < 0.8) ins('expense', rnd(30, 220), 'Transport', ds, pick(notes['Transport']), pick(['upi', 'cash']), Math.random() < 0.3 ? pick(tagPools['Transport']) : '');
      // shopping / entertainment / health occasionally
      if (Math.random() < 0.12) ins('expense', rnd(300, 3200), 'Shopping', ds, pick(notes['Shopping']), 'card', Math.random() < 0.4 ? pick(tagPools['Shopping']) : '');
      if (Math.random() < 0.10) ins('expense', rnd(200, 1100), 'Entertainment', ds, pick(notes['Entertainment']), 'upi', Math.random() < 0.5 ? pick(tagPools['Entertainment']) : '');
      if (Math.random() < 0.05) ins('expense', rnd(200, 1500), 'Health', ds, pick(notes['Health']), 'upi', pick(tagPools['Health']));
    }

    // a couple of budgets to showcase the feature
    for (const [name, amt] of [['Food & Dining', 6000], ['Groceries', 9000], ['Transport', 2500], ['Shopping', 4000], ['Entertainment', 2000]]) {
      const cid = catId(name);
      if (cid != null) stmts.push({
        sql: 'INSERT INTO budgets (category_id, amount) VALUES (?, ?) ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount',
        params: [cid, amt],
      });
    }

    // recurring rules for salary & rent, starting next month
    const next1st = advanceDate(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`, 'monthly');
    const next3rd = advanceDate(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}-03`, 'monthly');
    if (catId('Salary') != null) stmts.push({
      sql: 'INSERT INTO recurring (type, amount, category_id, note, method, frequency, next_date, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      params: ['income', 65000, catId('Salary'), 'Monthly salary', 'netbanking', 'monthly', next1st],
    });
    if (catId('Rent') != null) stmts.push({
      sql: 'INSERT INTO recurring (type, amount, category_id, note, method, frequency, next_date, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      params: ['expense', 16000, catId('Rent'), 'Rent', 'netbanking', 'monthly', next3rd],
    });

    await db.batch(stmts);
    SmartEngine.invalidatePatterns();
    return c.json({ ok: true });
  });

  app.delete('/api/data', async (c) => {
    if (c.req.query('confirm') !== 'DELETE') return c.json({ error: 'Pass ?confirm=DELETE to confirm' }, 400);
    await db.batch([{ sql: 'DELETE FROM transactions' }, { sql: 'DELETE FROM budgets' }, { sql: 'DELETE FROM recurring' }]);
    SmartEngine.invalidatePatterns();
    return c.json({ ok: true });
  });

  /* ---- fallbacks ---- */
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    return c.text('Not found', 404);
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.status ? err.message : 'Server error' }, err.status || 500);
  });

  return app;
}

module.exports = { createApp, ensureSchema, CURRENCIES, METHODS };
