'use strict';

/**
 * Expense Tracker — backend
 * Express + node:sqlite (built into Node 22.5+). No native build deps.
 *
 * Run:  npm start   (http://localhost:3000)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 so phones on the same Wi-Fi can reach it

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'expenses.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
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
  date         TEXT NOT NULL,                -- YYYY-MM-DD
  note         TEXT NOT NULL DEFAULT '',
  method       TEXT NOT NULL DEFAULT 'cash',
  recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_category  ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_recurring ON transactions(recurring_id);

CREATE TABLE IF NOT EXISTS budgets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
  amount      REAL NOT NULL CHECK (amount > 0)
);
`);

/* ---- migrations ---- */
if (!db.prepare('PRAGMA table_info(transactions)').all().some(c => c.name === 'tags')) {
  db.exec("ALTER TABLE transactions ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
}

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

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function getCategory(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function txRow(id) {
  return db.prepare(`
    SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.id = ?`).get(id);
}

function escapeLike(s) { return String(s).replace(/[\\%_]/g, c => '\\' + c); }

/* ------------------------------------------------------------------ */
/* Seed defaults                                                       */
/* ------------------------------------------------------------------ */

(function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO categories (name, type, icon, color, is_default) VALUES (?, ?, ?, ?, 1)');
    for (const c of DEFAULT_CATEGORIES) ins.run(c.name, c.type, c.icon, c.color);
  }
  if (!db.prepare('SELECT value FROM settings WHERE key = ?').get('currency')) setSetting('currency', 'INR');
  if (!db.prepare('SELECT value FROM settings WHERE key = ?').get('theme')) setSetting('theme', 'system');
})();

/* ------------------------------------------------------------------ */
/* Smart engine + AI layer                                             */
/* ------------------------------------------------------------------ */

const Smart = require('./smart')({
  db, monthRange, currentMonthKey, addMonthsKey, todayStr,
  currencySymbol: () => (CURRENCIES.find(c => c.code === getSetting('currency', 'INR')) || { symbol: '₹' }).symbol,
});

const AI = require('./ai')({
  db, getSetting, setSetting, todayStr, monthRange, addMonthsKey, currentMonthKey,
});

/* ------------------------------------------------------------------ */
/* Recurring engine                                                    */
/* ------------------------------------------------------------------ */

/**
 * Posts any recurring transactions that are due (next_date <= today) and
 * advances the rules. Safe to call repeatedly — each occurrence is only
 * posted once because next_date advances in the same transaction.
 */
function processRecurring() {
  const today = todayStr();
  const due = db.prepare('SELECT COUNT(*) AS c FROM recurring WHERE active = 1 AND next_date <= ?').get(today).c;
  if (due === 0) return 0;

  const insert = db.prepare(`
    INSERT INTO transactions (type, amount, category_id, date, note, method, recurring_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare('UPDATE recurring SET next_date = ?, last_run = ?, active = ? WHERE id = ?');

  let created = 0;
  db.exec('BEGIN');
  try {
    const rules = db.prepare('SELECT * FROM recurring WHERE active = 1 AND next_date <= ?').all(today);
    for (const rule of rules) {
      let next = rule.next_date;
      let guard = 0;
      while (next <= today && guard < 5000) {
        insert.run(rule.type, rule.amount, rule.category_id, next, rule.note || '', rule.method || 'cash', rule.id);
        next = advanceDate(next, rule.frequency);
        guard++;
        created++;
      }
      const active = guard < 5000 ? 1 : 0; // safety: disable runaway rules
      update.run(next, today, active, rule.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return created;
}

/* ------------------------------------------------------------------ */
/* App & API                                                           */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

const LOG_ACCESS = process.env.ACCESS_LOG === '1';

/* request log — enable with ACCESS_LOG=1 (useful for diagnosing access) */
app.use((req, res, next) => {
  if (LOG_ACCESS) {
    const ip = (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '?') {
      console.log(`[request] ${req.method} ${req.url} from ${ip}`);
    }
  }
  next();
});

const api = express.Router();

/* ---- health ---- */
api.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ---- bootstrap ---- */
api.get('/bootstrap', (req, res) => {
  processRecurring();
  res.json({
    settings: { currency: getSetting('currency', 'INR'), theme: getSetting('theme', 'system') },
    categories: db.prepare('SELECT * FROM categories ORDER BY type, name').all(),
    methods: METHODS,
    currencies: CURRENCIES,
    ai: AI.status(),
  });
});

/* ---- settings ---- */
api.get('/settings', (req, res) => {
  res.json({
    currency: getSetting('currency', 'INR'),
    theme: getSetting('theme', 'system'),
    ai_provider: getSetting('ai_provider', 'none'),
    ai_model: getSetting('ai_model', ''),
    ai_base_url: getSetting('ai_base_url', ''),
    ai_has_key: !!getSetting('ai_key', ''),
  });
});

api.put('/settings', (req, res) => {
  const { currency, theme, ai_provider, ai_key, ai_model, ai_base_url } = req.body || {};
  if (currency !== undefined) {
    if (!CURRENCIES.some(c => c.code === currency)) return res.status(400).json({ error: 'Unsupported currency' });
    setSetting('currency', currency);
  }
  if (theme !== undefined) {
    if (!['system', 'light', 'dark'].includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
    setSetting('theme', theme);
  }
  if (ai_provider !== undefined) {
    if (!['none', 'groq', 'gemini', 'openrouter', 'custom'].includes(ai_provider)) return res.status(400).json({ error: 'Invalid AI provider' });
    setSetting('ai_provider', ai_provider);
  }
  if (ai_key !== undefined && typeof ai_key === 'string' && ai_key.length > 0 && ai_key.length < 500) {
    setSetting('ai_key', ai_key.trim());
  }
  if (ai_model !== undefined && typeof ai_model === 'string') setSetting('ai_model', ai_model.trim().slice(0, 120));
  if (ai_base_url !== undefined && typeof ai_base_url === 'string') setSetting('ai_base_url', ai_base_url.trim().slice(0, 300));
  res.json({
    currency: getSetting('currency', 'INR'),
    theme: getSetting('theme', 'system'),
    ai_provider: getSetting('ai_provider', 'none'),
    ai_model: getSetting('ai_model', ''),
    ai_base_url: getSetting('ai_base_url', ''),
    ai_has_key: !!getSetting('ai_key', ''),
  });
});

/* ---- transactions ---- */
api.get('/transactions', (req, res) => {
  processRecurring();
  const { type, category, from, to, q, tag, sort } = req.query;

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

  const lim = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const off = Math.max(Number(req.query.offset) || 0, 0);

  const rows = db.prepare(`
    SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM transactions t JOIN categories c ON c.id = t.category_id
    ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`).all(...params, lim, off);

  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM transactions t JOIN categories c ON c.id = t.category_id ${whereSql}`)
    .get(...params).c;

  const sums = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount END), 0) AS income,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS expense
    FROM transactions t JOIN categories c ON c.id = t.category_id ${whereSql}`)
    .get(...params);

  res.json({ rows, total, income: sums.income, expense: sums.expense, limit: lim, offset: off });
});

function validateTxBody(body, { partial = false, existing = null } = {}) {
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
    const cat = getCategory(catId);
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

api.post('/transactions', (req, res) => {
  const v = validateTxBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { type, amount, category_id, date, note, method, tags } = v.value;
  const info = db.prepare(`
    INSERT INTO transactions (type, amount, category_id, date, note, method, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(type, amount, category_id, date, note, method, tags || '');
  Smart.invalidatePatterns();
  res.status(201).json(txRow(info.lastInsertRowid));
});

api.put('/transactions/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });
  const v = validateTxBody(req.body, { partial: true, existing });
  if (v.error) return res.status(400).json({ error: v.error });
  const next = { ...existing, ...v.value };
  db.prepare(`
    UPDATE transactions SET type = ?, amount = ?, category_id = ?, date = ?, note = ?, method = ?, tags = ?
    WHERE id = ?`).run(next.type, next.amount, next.category_id, next.date, next.note, next.method, next.tags || '', id);
  Smart.invalidatePatterns();
  res.json(txRow(id));
});

api.delete('/transactions/:id', (req, res) => {
  const info = db.prepare('DELETE FROM transactions WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Transaction not found' });
  Smart.invalidatePatterns();
  res.json({ ok: true });
});

/* ---- categories ---- */
api.get('/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usage_count,
                (SELECT COUNT(*) FROM recurring r WHERE r.category_id = c.id) AS recurring_count
    FROM categories c ORDER BY c.type, c.name`).all();
  res.json(rows);
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

api.post('/categories', (req, res) => {
  const v = validateCategory(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const { name, type, icon, color } = v.value;
  try {
    const info = db.prepare('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)')
      .run(name, type, icon, color);
    res.status(201).json(getCategory(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'A category with this name and type already exists' });
    throw err;
  }
});

api.put('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getCategory(id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const v = validateCategory(req.body, existing);
  if (v.error) return res.status(400).json({ error: v.error });
  const usage = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?').get(id).c;
  if (usage > 0 && v.value.type !== existing.type) {
    return res.status(400).json({ error: 'Cannot change type: category is used by existing transactions' });
  }
  try {
    db.prepare('UPDATE categories SET name = ?, type = ?, icon = ?, color = ? WHERE id = ?')
      .run(v.value.name, v.value.type, v.value.icon, v.value.color, id);
    res.json(getCategory(id));
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'A category with this name and type already exists' });
    throw err;
  }
});

api.delete('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const usage = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE category_id = ?').get(id).c;
  if (usage > 0) {
    return res.status(409).json({ error: `Cannot delete: used by ${usage} transaction${usage === 1 ? '' : 's'}. Reassign them first.` });
  }
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
});

/* ---- budgets ---- */
function budgetsWithSpent(month) {
  const { start, end } = monthRange(month);
  return db.prepare(`
    SELECT b.id, b.category_id, b.amount, c.name, c.icon, c.color,
           COALESCE((SELECT SUM(t.amount) FROM transactions t
                     WHERE t.category_id = b.category_id AND t.type = 'expense'
                       AND t.date >= ? AND t.date <= ?), 0) AS spent
    FROM budgets b JOIN categories c ON c.id = b.category_id
    ORDER BY c.name`).all(start, end);
}

api.get('/budgets', (req, res) => {
  const month = validMonthKeyOrCurrent(req.query.month);
  res.json({ month, budgets: budgetsWithSpent(month) });
});

api.put('/budgets', (req, res) => {
  const b = req.body || {};
  const catId = Number(b.category_id);
  const cat = getCategory(catId);
  if (!cat) return res.status(400).json({ error: 'Category not found' });
  if (cat.type !== 'expense') return res.status(400).json({ error: 'Budgets can only be set for expense categories' });
  const amount = Number(b.amount);
  if (!validAmount(amount)) return res.status(400).json({ error: 'Amount must be a positive number' });
  db.prepare(`
    INSERT INTO budgets (category_id, amount) VALUES (?, ?)
    ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount`).run(catId, Math.round(amount * 100) / 100);
  res.json({ ok: true });
});

api.delete('/budgets/:id', (req, res) => {
  const info = db.prepare('DELETE FROM budgets WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Budget not found' });
  res.json({ ok: true });
});

/* ---- recurring ---- */
api.get('/recurring', (req, res) => {
  processRecurring();
  const rows = db.prepare(`
    SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM recurring r JOIN categories c ON c.id = r.category_id
    ORDER BY r.active DESC, r.next_date`).all();
  res.json(rows);
});

function validateRecurringBody(body, existing) {
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
    const cat = getCategory(Number(b.category_id ?? existing?.category_id));
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

api.post('/recurring', (req, res) => {
  const v = validateRecurringBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const x = v.value;
  const info = db.prepare(`
    INSERT INTO recurring (type, amount, category_id, note, method, frequency, next_date, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(x.type, x.amount, x.category_id, x.note || '', x.method, x.frequency, x.next_date, x.active ?? 1);
  res.status(201).json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(info.lastInsertRowid));
});

api.put('/recurring/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM recurring WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });
  const v = validateRecurringBody(req.body, existing);
  if (v.error) return res.status(400).json({ error: v.error });
  const x = { ...existing, ...v.value };
  db.prepare(`
    UPDATE recurring SET type = ?, amount = ?, category_id = ?, note = ?, method = ?, frequency = ?, next_date = ?, active = ?
    WHERE id = ?`).run(x.type, x.amount, x.category_id, x.note, x.method, x.frequency, x.next_date, x.active, id);
  res.json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(id));
});

api.delete('/recurring/:id', (req, res) => {
  const info = db.prepare('DELETE FROM recurring WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Rule not found' });
  res.json({ ok: true });
});

/* ---- summary / dashboard ---- */
api.get('/summary', (req, res) => {
  processRecurring();
  const month = validMonthKeyOrCurrent(req.query.month);
  const { start, end, days } = monthRange(month);
  const prevMonth = addMonthsKey(month, -1);
  const prevRange = monthRange(prevMonth);
  const trendStart = addMonthsKey(month, -5);

  const monthTotals = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
           COUNT(*) AS count
    FROM transactions WHERE date >= ? AND date <= ?`).get(start, end);

  const prevTotals = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
    FROM transactions WHERE date >= ? AND date <= ?`).get(prevRange.start, prevRange.end);

  const allTime = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
           COUNT(*) AS count
    FROM transactions`).get();

  const byCategory = db.prepare(`
    SELECT c.id, c.name, c.icon, c.color, SUM(t.amount) AS amount, COUNT(*) AS count
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.type = 'expense' AND t.date >= ? AND t.date <= ?
    GROUP BY c.id ORDER BY amount DESC`).all(start, end);

  const daily = db.prepare(`
    SELECT date,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
           COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income
    FROM transactions WHERE date >= ? AND date <= ?
    GROUP BY date ORDER BY date`).all(start, end);

  const trend = db.prepare(`
    SELECT substr(date, 1, 7) AS ym,
           COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
    FROM transactions WHERE substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ?
    GROUP BY ym ORDER BY ym`).all(trendStart, month);

  const budgets = budgetsWithSpent(month);

  // project month-end spend using weekday-aware forecasting (current month only)
  const projected = month === currentMonthKey() ? Smart.weekdayForecast(month) : null;

  const recent = db.prepare(`
    SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM transactions t JOIN categories c ON c.id = t.category_id
    ORDER BY t.date DESC, t.id DESC LIMIT 8`).all();

  res.json({
    month, days,
    monthTotals, prevTotals, allTime,
    byCategory, daily, trend, budgets, projected, recent,
    savingsRate: monthTotals.income > 0 ? (monthTotals.income - monthTotals.expense) / monthTotals.income : null,
  });
});

/* ---- tags ---- */
api.get('/tags', (req, res) => {
  const rows = db.prepare("SELECT tags FROM transactions WHERE tags != ''").all();
  const set = new Set();
  for (const r of rows) for (const t of r.tags.split(',')) if (t.trim()) set.add(t.trim());
  res.json([...set].sort());
});

/* ---- smart engine ---- */
api.get('/smart/insights', (req, res) => {
  processRecurring();
  const month = validMonthKeyOrCurrent(req.query.month);
  res.json({ month, insights: Smart.insights(month) });
});

api.post('/smart/suggest', (req, res) => {
  const { type, note, amount } = req.body || {};
  res.json(Smart.suggest({ type, note, amount }));
});

api.get('/smart/subscriptions', (req, res) => {
  res.json(Smart.detectSubscriptions());
});

api.get('/smart/budget-suggestions', (req, res) => {
  const month = validMonthKeyOrCurrent(req.query.month);
  res.json(Smart.budgetSuggestions(month));
});

api.get('/analytics', (req, res) => {
  processRecurring();
  const month = validMonthKeyOrCurrent(req.query.month);
  res.json(Smart.analytics(month));
});

/* ---- AI (bring-your-own-key LLM) ---- */
api.get('/ai/status', (req, res) => res.json(AI.status()));

api.post('/ai/ask', async (req, res) => {
  const { question, month } = req.body || {};
  if (!question || !String(question).trim()) return res.status(400).json({ error: 'Ask a question first' });
  const m = validMonth(month) ? month : currentMonthKey();
  try {
    res.json(await AI.ask(String(question).trim(), m));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

api.post('/ai/parse', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Enter some text first' });
  try {
    res.json(await AI.parse(String(text).trim()));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

api.post('/ai/test', async (req, res) => {
  try {
    res.json(await AI.test());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/* ---- export / import / maintenance ---- */
function exportJson() {
  return {
    app: 'expense-tracker',
    version: 1,
    exported_at: new Date().toISOString(),
    settings: { currency: getSetting('currency', 'INR'), theme: getSetting('theme', 'system') },
    categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
    transactions: db.prepare('SELECT * FROM transactions ORDER BY id').all(),
    budgets: db.prepare('SELECT * FROM budgets ORDER BY id').all(),
    recurring: db.prepare('SELECT * FROM recurring ORDER BY id').all(),
  };
}

api.get('/export', (req, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'json';
  if (format === 'csv') {
    const rows = db.prepare(`
      SELECT t.id, t.date, t.type, c.name AS category, t.amount, t.method, t.note, t.recurring_id, t.tags
      FROM transactions t JOIN categories c ON c.id = t.category_id
      ORDER BY t.date DESC, t.id DESC`).all();
    const header = ['id', 'date', 'type', 'category', 'amount', 'method', 'note', 'recurring_id', 'tags'];
    const escCsv = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.join(',')];
    for (const r of rows) lines.push([r.id, r.date, r.type, r.category, r.amount, r.method, r.note, r.recurring_id ?? '', r.tags ?? ''].map(escCsv).join(','));
    const csv = '\uFEFF' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${todayStr()}.csv"`);
    return res.send(csv);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="expense-tracker-backup-${todayStr()}.json"`);
  res.json(exportJson());
});

api.post('/import', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || !Array.isArray(data.categories) || !Array.isArray(data.transactions)) {
    return res.status(400).json({ error: 'Not a valid backup file (expected JSON export from this app)' });
  }
  const catIds = new Set(data.categories.map(c => Number(c.id)).filter(Number.isInteger));
  const txOk = data.transactions.every(t =>
    Number.isInteger(Number(t.id)) && validAmount(t.amount) &&
    (t.type === 'income' || t.type === 'expense') && validDate(t.date) && catIds.has(Number(t.category_id)));
  if (!txOk) return res.status(400).json({ error: 'Backup contains invalid transactions' });

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM transactions; DELETE FROM budgets; DELETE FROM recurring;');
    db.exec('DELETE FROM categories;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('categories','transactions','budgets','recurring')");

    const insCat = db.prepare('INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)');
    for (const c of data.categories) {
      if (!(c.type === 'income' || c.type === 'expense')) throw new Error('Invalid category type');
      insCat.run(Number(c.id), String(c.name).slice(0, 40), c.type, String(c.icon || '📦').slice(0, 8),
        /^#[0-9a-fA-F]{6}$/.test(String(c.color)) ? c.color : '#6C5CE7', c.is_default ? 1 : 0);
    }
    const insTx = db.prepare('INSERT INTO transactions (id, type, amount, category_id, date, note, method, recurring_id, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const t of data.transactions) {
      const tags = String(t.tags || '').split(',')
        .map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 10).map(x => x.slice(0, 24));
      insTx.run(Number(t.id), t.type, Number(t.amount), Number(t.category_id), t.date,
        String(t.note || '').slice(0, 500), METHODS.some(m => m.id === t.method) ? t.method : 'cash',
        t.recurring_id != null && Number.isInteger(Number(t.recurring_id)) ? Number(t.recurring_id) : null,
        [...new Set(tags)].join(','));
    }
    if (Array.isArray(data.budgets)) {
      const insB = db.prepare('INSERT INTO budgets (id, category_id, amount) VALUES (?, ?, ?)');
      for (const b of data.budgets) {
        if (validAmount(b.amount) && catIds.has(Number(b.category_id))) insB.run(Number(b.id), Number(b.category_id), Number(b.amount));
      }
    }
    if (Array.isArray(data.recurring)) {
      const insR = db.prepare('INSERT INTO recurring (id, type, amount, category_id, note, method, frequency, next_date, active, last_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const freqs = ['daily', 'weekly', 'monthly', 'yearly'];
      for (const r of data.recurring) {
        if (validAmount(r.amount) && catIds.has(Number(r.category_id)) && validDate(r.next_date) && freqs.includes(r.frequency)) {
          insR.run(Number(r.id), r.type === 'income' ? 'income' : 'expense', Number(r.amount), Number(r.category_id),
            String(r.note || '').slice(0, 500), METHODS.some(m => m.id === r.method) ? r.method : 'cash',
            r.frequency, r.next_date, r.active ? 1 : 0, r.last_run || null);
        }
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      if (CURRENCIES.some(c => c.code === data.settings.currency)) setSetting('currency', data.settings.currency);
      if (['system', 'light', 'dark'].includes(data.settings.theme)) setSetting('theme', data.settings.theme);
    }
    db.exec('COMMIT');
    Smart.invalidatePatterns();
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: 'Import failed: ' + err.message });
  }
  res.json({ ok: true, transactions: data.transactions.length });
});

api.post('/sample-data', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  if (count > 0) return res.status(409).json({ error: 'Sample data can only be loaded when there are no transactions. Export & delete data first.' });

  const rnd = (min, max) => Math.round((min + Math.random() * (max - min)) * 100) / 100;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const cat = name => db.prepare('SELECT id FROM categories WHERE name = ?').get(name)?.id;
  const ins = db.prepare('INSERT INTO transactions (type, amount, category_id, date, note, method, tags) VALUES (?, ?, ?, ?, ?, ?, ?)');

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

  db.exec('BEGIN');
  try {
    const earliest = new Date(today.getFullYear(), today.getMonth() - 3, 1);
    for (let d = new Date(earliest); d <= today; d.setDate(d.getDate() + 1)) {
      const ds = fmtDate(d);
      const dow = d.getDay();
      // salary on the 1st of each month
      if (d.getDate() === 1) ins.run('income', rnd(62000, 68000), cat('Salary'), ds, 'Monthly salary', 'netbanking', '');
      // freelance occasionally
      if (d.getDate() === 15 && Math.random() < 0.5) ins.run('income', rnd(3000, 15000), cat('Freelance'), ds, 'Side project', 'upi', 'side-hustle');
      // rent on the 3rd
      if (d.getDate() === 3) ins.run('expense', 16000, cat('Rent'), ds, 'Rent', 'netbanking', 'household');
      // utilities on the 10th
      if (d.getDate() === 10) ins.run('expense', rnd(1800, 4200), cat('Utilities'), ds, 'Electricity & internet', 'upi', 'household,bills');
      // subscriptions on the 5th
      if (d.getDate() === 5) {
        ins.run('expense', 649, cat('Subscriptions'), ds, 'Netflix', 'card', 'subscriptions,shared');
        ins.run('expense', 119, cat('Subscriptions'), ds, 'Spotify', 'card', 'subscriptions');
      }
      // groceries about twice a week
      if (dow === 0 || dow === 3 || (dow === 5 && Math.random() < 0.5)) {
        ins.run('expense', rnd(700, 2600), cat('Groceries'), ds, pick(notes['Groceries']), 'upi', pick(tagPools['Groceries']));
      }
      // food & dining most days
      if (Math.random() < 0.75) ins.run('expense', rnd(90, 750), cat('Food & Dining'), ds, pick(notes['Food & Dining']), pick(['upi', 'cash', 'card']), Math.random() < 0.35 ? pick(tagPools['Food & Dining']) : '');
      // transport most weekdays
      if (dow >= 1 && dow <= 5 && Math.random() < 0.8) ins.run('expense', rnd(30, 220), cat('Transport'), ds, pick(notes['Transport']), pick(['upi', 'cash']), Math.random() < 0.3 ? pick(tagPools['Transport']) : '');
      // shopping / entertainment / health occasionally
      if (Math.random() < 0.12) ins.run('expense', rnd(300, 3200), cat('Shopping'), ds, pick(notes['Shopping']), 'card', Math.random() < 0.4 ? pick(tagPools['Shopping']) : '');
      if (Math.random() < 0.10) ins.run('expense', rnd(200, 1100), cat('Entertainment'), ds, pick(notes['Entertainment']), 'upi', Math.random() < 0.5 ? pick(tagPools['Entertainment']) : '');
      if (Math.random() < 0.05) ins.run('expense', rnd(200, 1500), cat('Health'), ds, pick(notes['Health']), 'upi', pick(tagPools['Health']));
    }

    // a couple of budgets to showcase the feature
    const bud = db.prepare('INSERT INTO budgets (category_id, amount) VALUES (?, ?) ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount');
    for (const [name, amt] of [['Food & Dining', 6000], ['Groceries', 9000], ['Transport', 2500], ['Shopping', 4000], ['Entertainment', 2000]]) {
      const cid = cat(name);
      if (cid) bud.run(cid, amt);
    }

    // recurring rules for salary & rent, starting next month
    const next1st = advanceDate(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`, 'monthly');
    const next3rd = advanceDate(`${today.getFullYear()}-${pad2(today.getMonth() + 1)}-03`, 'monthly');
    const insR = db.prepare('INSERT INTO recurring (type, amount, category_id, note, method, frequency, next_date, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
    if (cat('Salary')) insR.run('income', 65000, cat('Salary'), 'Monthly salary', 'netbanking', 'monthly', next1st);
    if (cat('Rent')) insR.run('expense', 16000, cat('Rent'), 'Rent', 'netbanking', 'monthly', next3rd);

    db.exec('COMMIT');
    Smart.invalidatePatterns();
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true });
});

api.delete('/data', (req, res) => {
  if (req.query.confirm !== 'DELETE') return res.status(400).json({ error: 'Pass ?confirm=DELETE to confirm' });
  db.exec('DELETE FROM transactions; DELETE FROM budgets; DELETE FROM recurring;');
  Smart.invalidatePatterns();
  res.json({ ok: true });
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---- static frontend ---- */
app.use(express.static(path.join(__dirname, 'public')));

/* ---- errors ---- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON body' : 'Server error' });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

processRecurring(); // post anything already due
setInterval(() => {
  try { const n = processRecurring(); if (n) console.log(`[recurring] posted ${n} transaction(s)`); }
  catch (err) { console.error('[recurring] failed:', err); }
}, 60 * 60 * 1000).unref();

const server = app.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
    }
  }
  console.log('');
  console.log('  💸 Expense Tracker');
  console.log('  ------------------------------------');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Network: http://${ip}:${PORT}   ← open this on your phone (same Wi-Fi)`);
  console.log('');
  console.log(`  Database: ${DB_PATH}`);
  console.log('');
});

/* TCP-level logging: shows ANY inbound connection attempt (even ones that
   never become valid HTTP requests). Enable with ACCESS_LOG=1. */
server.on('connection', socket => {
  if (!LOG_ACCESS) return;
  const ip = (socket.remoteAddress || '?').replace(/^::ffff:/, '');
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '?') {
    console.log(`[tcp] connection from ${ip}:${socket.remotePort}`);
  }
});
