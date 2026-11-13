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

/* Account types. `method` is what the old payment-method field becomes when
   a transaction is linked to an account, so analytics keep working. */
const ACCOUNT_TYPES = [
  { id: 'cash', label: 'Cash', icon: '💵', color: '#00B894', method: 'cash' },
  { id: 'bank', label: 'Bank', icon: '🏦', color: '#0984E3', method: 'netbanking' },
  { id: 'credit_card', label: 'Credit card', icon: '💳', color: '#D63057', method: 'card' },
  { id: 'wallet', label: 'Wallet', icon: '👛', color: '#FDCB6E', method: 'wallet' },
  { id: 'upi', label: 'UPI', icon: '📱', color: '#6C5CE7', method: 'upi' },
  { id: 'investment', label: 'Investment', icon: '📈', color: '#00CEC9', method: 'other' },
  { id: 'other', label: 'Other', icon: '🧾', color: '#B2BEC3', method: 'other' },
];
const ACCOUNT_TYPE_MAP = Object.fromEntries(ACCOUNT_TYPES.map(t => [t.id, t]));

const DEFAULT_ACCOUNTS = [
  { name: 'Cash', type: 'cash', icon: '💵', color: '#00B894' },
  { name: 'Bank Account', type: 'bank', icon: '🏦', color: '#0984E3' },
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
CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  type            TEXT    NOT NULL CHECK (type IN ('cash','bank','credit_card','wallet','upi','investment','other')),
  opening_balance REAL    NOT NULL DEFAULT 0,
  icon            TEXT    NOT NULL DEFAULT '💵',
  color           TEXT    NOT NULL DEFAULT '#00B894',
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
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
  last_run    TEXT,
  account_id  INTEGER REFERENCES accounts(id)
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
  tags         TEXT NOT NULL DEFAULT '',
  account_id   INTEGER REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_tx_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_category  ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_recurring ON transactions(recurring_id);
CREATE TABLE IF NOT EXISTS transfers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount          REAL NOT NULL CHECK (amount > 0),
  date            TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers(date);
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

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ */
/* CSV helpers (bank statement import)                                 */
/* ------------------------------------------------------------------ */

function detectDelimiter(text) {
  const first = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
  const commas = (first.match(/,/g) || []).length;
  const semis = (first.match(/;/g) || []).length;
  const tabs = (first.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semis) return '\t';
  return semis > commas ? ';' : ',';
}

function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const delim = detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function parseCsvDate(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    const out = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    return validDate(out) ? out : null;
  }
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    const out = `${y}-${pad2(mo)}-${pad2(d)}`;
    return validDate(out) ? out : null;
  }
  // "12 Nov 2026", "Nov 12, 2026"
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const d = new Date(t);
    return validDate(fmtDate(d)) ? fmtDate(d) : null;
  }
  return null;
}

function parseCsvAmount(value) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (s.includes(',')) {
    const parts = s.split(',');
    s = (parts.length === 2 && parts[1].length <= 2) ? parts[0] + '.' + parts[1] : s.replace(/,/g, '');
  }
  const n = Number(s);
  if (!isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

function normalizeHeader(h, index) {
  const s = String(h == null ? '' : h).trim();
  return s || `Column ${index + 1}`;
}

/* ------------------------------------------------------------------ */
/* Schema init (idempotent, race-safe across isolates/processes)       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* App lock (optional passphrase)                                      */
/* ------------------------------------------------------------------ */

const SESSION_COOKIE = 'et_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 15000;
const MIN_PASSPHRASE = 8;

function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  const x = b64urlDecode(a);
  const y = b64urlDecode(b);
  if (!x.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function pbkdf2(passphrase, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassphrase(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(passphrase, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

async function checkPassphrase(passphrase, stored) {
  try {
    const [scheme, iter, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2' || !salt || !hash) return false;
    const bits = await pbkdf2(String(passphrase || ''), b64urlDecode(salt), Number(iter) || PBKDF2_ITERATIONS);
    return timingSafeEqual(b64urlEncode(bits), hash);
  } catch {
    return false;
  }
}

async function signSession(secret, expires) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v1.${expires}`));
  return b64urlEncode(new Uint8Array(sig));
}

function cookieValue(c, name) {
  const raw = c.req.header('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
  }
  return '';
}

function requestIsHttps(c) {
  const proto = c.req.header('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  return /^https:/i.test(c.req.url);
}

function clientIp(c) {
  return (c.req.header('cf-connecting-ip')
    || c.req.header('x-real-ip')
    || (c.req.header('x-forwarded-for') || '').split(',')[0].trim()
    || 'local');
}

/* Fixed-window counters, per isolate. Enough to blunt passphrase guessing
   and runaway AI usage on a personal app without another table. */
const rateBuckets = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset <= now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true };
  }
  bucket.count++;
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) if (v.reset <= now) rateBuckets.delete(k);
  }
  return { ok: bucket.count <= limit };
}

async function ensureSchema(db) {
  // On a brand-new database the settings table doesn't exist yet — treat that
  // as "not initialized" instead of an error.
  let marker = null;
  try {
    marker = await db.get("SELECT value FROM settings WHERE key = 'schema_v2'");
  } catch { /* no schema yet */ }
  if (marker && marker.value === 'ok') return;

  await db.exec(SCHEMA_SQL);
  // databases from before the tags feature (tags is in SCHEMA_SQL for new ones)
  try { await db.exec("ALTER TABLE transactions ADD COLUMN tags TEXT NOT NULL DEFAULT ''"); }
  catch (err) { if (!/duplicate column/i.test(String(err && err.message))) throw err; }
  // databases from before accounts/opening balances
  try { await db.exec('ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id)'); }
  catch (err) { if (!/duplicate column/i.test(String(err && err.message))) throw err; }
  try { await db.exec('ALTER TABLE recurring ADD COLUMN account_id INTEGER REFERENCES accounts(id)'); }
  catch (err) { if (!/duplicate column/i.test(String(err && err.message))) throw err; }
  await db.exec('CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id)');

  const seedCat = 'INSERT INTO categories (name, type, icon, color, is_default) VALUES (?, ?, ?, ?, 1) ON CONFLICT (name, type) DO NOTHING';
  for (const c of DEFAULT_CATEGORIES) await db.run(seedCat, [c.name, c.type, c.icon, c.color]);

  // Give every database a sensible starting set of accounts (only once).
  const accountCount = await db.get('SELECT COUNT(*) AS c FROM accounts');
  if (!accountCount || !accountCount.c) {
    for (const a of DEFAULT_ACCOUNTS) {
      await db.run('INSERT INTO accounts (name, type, opening_balance, icon, color) VALUES (?, ?, 0, ?, ?)',
        [a.name, a.type, a.icon, a.color]);
    }
  }

  await db.run("INSERT INTO settings (key, value) VALUES ('currency', 'INR') ON CONFLICT (key) DO NOTHING");
  await db.run("INSERT INTO settings (key, value) VALUES ('theme', 'system') ON CONFLICT (key) DO NOTHING");
  await db.run("INSERT INTO settings (key, value) VALUES ('schema_v2', 'ok') ON CONFLICT (key) DO NOTHING");
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
  async function getAccount(id) {
    return db.get('SELECT * FROM accounts WHERE id = ?', [id]);
  }
  function accountMethod(account) {
    return (ACCOUNT_TYPE_MAP[account && account.type] || {}).method || 'other';
  }
  async function accountBalances() {
    return db.all(`
      SELECT a.*,
        a.opening_balance
        + COALESCE((SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
                    FROM transactions t WHERE t.account_id = a.id), 0)
        + COALESCE((SELECT SUM(amount) FROM transfers WHERE to_account_id = a.id), 0)
        - COALESCE((SELECT SUM(amount) FROM transfers WHERE from_account_id = a.id), 0) AS balance,
        (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS tx_count
      FROM accounts a
      ORDER BY a.archived, a.name`);
  }
  async function unassignedTotals() {
    return db.get(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS net
      FROM transactions WHERE account_id IS NULL`);
  }
  async function txRow(id) {
    return db.get(`
      SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
             a.name AS account_name, a.icon AS account_icon, a.color AS account_color, a.type AS account_type
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
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
            sql: 'INSERT INTO transactions (type, amount, category_id, date, note, method, recurring_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            params: [rule.type, rule.amount, rule.category_id, next, rule.note || '', rule.method || 'cash', rule.id, rule.account_id ?? null],
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

  /* ---- app lock helpers ---- */

  const authEnabled = async () => !!(await getSetting('auth_hash', ''));

  async function sessionValid(c) {
    const secret = await getSetting('auth_secret', '');
    const token = cookieValue(c, SESSION_COOKIE);
    if (!secret || !token) return false;
    const dot = token.indexOf('.');
    if (dot < 1) return false;
    const expires = Number(token.slice(0, dot));
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    const expected = await signSession(secret, expires);
    return timingSafeEqual(token.slice(dot + 1), expected);
  }

  async function startSession(c) {
    const secret = await getSetting('auth_secret', '');
    const expires = Date.now() + SESSION_TTL_MS;
    const signature = await signSession(secret, expires);
    const parts = [
      `${SESSION_COOKIE}=${encodeURIComponent(`${expires}.${signature}`)}`,
      'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (requestIsHttps(c)) parts.push('Secure');
    c.header('Set-Cookie', parts.join('; '));
  }

  function clearSession(c) {
    const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (requestIsHttps(c)) parts.push('Secure');
    c.header('Set-Cookie', parts.join('; '));
  }

  /* AI calls cost tokens (and money on paid keys), so cap them per client. */
  function aiRateLimited(c) {
    return !rateLimit(`ai:${clientIp(c)}`, 30, 60 * 1000).ok;
  }

  /* Every API route except the lock screen's own endpoints is protected
     once a passphrase is set. Static files stay public so the shell can
     load and ask for the passphrase. */
  app.use('/api/*', async (c, next) => {
    const path = c.req.path;
    if (path === '/api/health' || path === '/api/auth/status' || path === '/api/auth/login') return next();
    if (!(await authEnabled())) return next();
    if (await sessionValid(c)) return next();
    return c.json({ error: 'Locked. Enter your passphrase to continue.', code: 'auth_required' }, 401);
  });

  /* ---- app lock routes ---- */

  app.get('/api/auth/status', async (c) => {
    const enabled = await authEnabled();
    return c.json({ enabled, authed: !enabled || await sessionValid(c) });
  });

  app.post('/api/auth/login', async (c) => {
    const ip = clientIp(c);
    const limit = rateLimit(`login:${ip}`, 8, 10 * 60 * 1000);
    if (!limit.ok) return c.json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);

    const { passphrase } = await readJson(c);
    const stored = await getSetting('auth_hash', '');
    if (!stored) return c.json({ ok: true, enabled: false });
    if (!(await checkPassphrase(passphrase, stored))) {
      return c.json({ error: 'Incorrect passphrase.' }, 401);
    }
    rateBuckets.delete(`login:${ip}`);
    await startSession(c);
    return c.json({ ok: true, enabled: true });
  });

  app.post('/api/auth/enable', async (c) => {
    const { passphrase, current } = await readJson(c);
    const stored = await getSetting('auth_hash', '');
    if (stored && !(await checkPassphrase(current, stored))) {
      return c.json({ error: 'Current passphrase is incorrect.' }, 401);
    }
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE || passphrase.length > 200) {
      return c.json({ error: `Passphrase must be ${MIN_PASSPHRASE}–200 characters.` }, 400);
    }
    if (!(await getSetting('auth_secret', ''))) {
      await setSetting('auth_secret', b64urlEncode(crypto.getRandomValues(new Uint8Array(32))));
    }
    await setSetting('auth_hash', await hashPassphrase(passphrase));
    await startSession(c);
    return c.json({ ok: true, enabled: true });
  });

  app.post('/api/auth/disable', async (c) => {
    const { passphrase } = await readJson(c);
    const stored = await getSetting('auth_hash', '');
    if (stored && !(await checkPassphrase(passphrase, stored))) {
      return c.json({ error: 'Incorrect passphrase.' }, 401);
    }
    await setSetting('auth_hash', '');
    await setSetting('auth_secret', '');
    clearSession(c);
    return c.json({ ok: true, enabled: false });
  });

  app.post('/api/auth/logout', (c) => {
    clearSession(c);
    return c.json({ ok: true });
  });

  /* ---- health ---- */
  app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

  /* ---- bootstrap ---- */
  app.get('/api/bootstrap', async (c) => {
    return c.json({
      settings: { currency: await getSetting('currency', 'INR'), theme: await getSetting('theme', 'system') },
      categories: await db.all('SELECT * FROM categories ORDER BY type, name'),
      accounts: await accountBalances(),
      accountTypes: ACCOUNT_TYPES,
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
    const { type, category, account, from, to, q, tag, sort } = c.req.query();

    const where = [];
    const params = [];
    if (type === 'income' || type === 'expense') { where.push('t.type = ?'); params.push(type); }
    if (category && Number.isInteger(Number(category))) { where.push('t.category_id = ?'); params.push(Number(category)); }
    if (account === 'none') { where.push('t.account_id IS NULL'); }
    else if (account && Number.isInteger(Number(account))) { where.push('t.account_id = ?'); params.push(Number(account)); }
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
    const joins = 'FROM transactions t JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id';

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
      SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
             a.name AS account_name, a.icon AS account_icon, a.color AS account_color, a.type AS account_type
      ${joins}
      ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`, [...params, lim, off]);

    const total = (await db.get(`
      SELECT COUNT(*) AS c ${joins} ${whereSql}`, params)).c;

    const sums = await db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS expense
      ${joins} ${whereSql}`, params);

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
    if (!partial || b.account_id !== undefined) {
      const raw = b.account_id ?? existing?.account_id ?? null;
      if (raw === null || raw === '' || raw === 0) {
        out.account_id = null;
      } else {
        const acc = await getAccount(Number(raw));
        if (!acc) return { error: 'Account not found' };
        out.account_id = acc.id;
        out._account_method = accountMethod(acc);
      }
    }
    if (!partial || b.method !== undefined || out._account_method !== undefined) {
      const method = b.method ?? out._account_method ?? existing?.method ?? 'cash';
      if (!METHODS.some(m => m.id === method)) return { error: 'Invalid payment method' };
      out.method = method;
    }
    delete out._account_method;
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
    const { type, amount, category_id, date, note, method, tags, account_id } = v.value;
    const info = await db.run(`
      INSERT INTO transactions (type, amount, category_id, date, note, method, tags, account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [type, amount, category_id, date, note, method, tags || '', account_id ?? null]);
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
      UPDATE transactions SET type = ?, amount = ?, category_id = ?, date = ?, note = ?, method = ?, tags = ?, account_id = ?
      WHERE id = ?`,
      [next.type, next.amount, next.category_id, next.date, next.note, next.method, next.tags || '', next.account_id ?? null, id]);
    SmartEngine.invalidatePatterns();
    return c.json(await txRow(id));
  });

  app.delete('/api/transactions/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const row = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!row) return c.json({ error: 'Transaction not found' }, 404);
    await db.run('DELETE FROM transactions WHERE id = ?', [id]);
    SmartEngine.invalidatePatterns();
    return c.json({ ok: true, row });
  });

  /* Bulk select actions: delete (returns rows for undo), restore, and
     category/account/tag updates. Ids are chunked to respect D1's bound
     parameter limit on the free plan. */
  app.post('/api/transactions/bulk', async (c) => {
    const body = await readJson(c);
    const action = body.action;
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
      : [];
    if (ids.length > 500) return c.json({ error: 'Select at most 500 transactions at once' }, 400);

    const fetchRows = async () => {
      const rows = [];
      for (const chunk of chunkArray(ids, 90)) {
        rows.push(...await db.all(
          `SELECT * FROM transactions WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk));
      }
      return rows;
    };

    if (action === 'delete') {
      if (!ids.length) return c.json({ error: 'No transactions selected' }, 400);
      const rows = await fetchRows();
      if (rows.length) {
        await db.batch(chunkArray(ids, 90).map(chunk => ({
          sql: `DELETE FROM transactions WHERE id IN (${chunk.map(() => '?').join(',')})`,
          params: chunk,
        })));
      }
      SmartEngine.invalidatePatterns();
      return c.json({ deleted: rows.length, rows });
    }

    if (action === 'restore') {
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
      const stmts = [];
      for (const row of rows) {
        const v = await validateTxBody(row);
        if (v.error) continue;
        const t = v.value;
        stmts.push({
          sql: 'INSERT INTO transactions (type, amount, category_id, date, note, method, tags, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          params: [t.type, t.amount, t.category_id, t.date, t.note, t.method, t.tags || '', t.account_id ?? null],
        });
      }
      if (stmts.length) await db.batch(stmts);
      SmartEngine.invalidatePatterns();
      return c.json({ restored: stmts.length });
    }

    if (action === 'update') {
      if (!ids.length) return c.json({ error: 'No transactions selected' }, 400);
      const patch = body.patch || {};
      const rows = await fetchRows();
      if (!rows.length) return c.json({ updated: 0 });

      let category = null;
      if (patch.category_id !== undefined) {
        category = await getCategory(Number(patch.category_id));
        if (!category) return c.json({ error: 'Category not found' }, 400);
        if (rows.some(r => r.type !== category.type)) {
          return c.json({ error: 'Category type does not match every selected transaction' }, 400);
        }
      }

      let account = null;
      const changeAccount = patch.account_id !== undefined;
      if (changeAccount && patch.account_id !== null && patch.account_id !== '' && patch.account_id !== 0) {
        account = await getAccount(Number(patch.account_id));
        if (!account) return c.json({ error: 'Account not found' }, 400);
      }

      const addTags = String(patch.tags_add || '').split(',')
        .map(s => s.trim().toLowerCase()).filter(Boolean);
      const removeTags = new Set(String(patch.tags_remove || '').split(',')
        .map(s => s.trim().toLowerCase()).filter(Boolean));

      const stmts = rows.map(row => {
        let tags = String(row.tags || '').split(',').filter(Boolean);
        if (addTags.length || removeTags.size) {
          tags = tags.filter(t => !removeTags.has(t));
          for (const t of addTags) if (!tags.includes(t)) tags.push(t);
          tags = tags.slice(0, 10).map(t => t.slice(0, 24));
        }
        return {
          sql: 'UPDATE transactions SET category_id = ?, account_id = ?, method = ?, tags = ? WHERE id = ?',
          params: [
            category ? category.id : row.category_id,
            changeAccount ? (account ? account.id : null) : row.account_id,
            changeAccount ? (account ? accountMethod(account) : row.method) : row.method,
            tags.join(','),
            row.id,
          ],
        };
      });
      await db.batch(stmts);
      SmartEngine.invalidatePatterns();
      return c.json({ updated: stmts.length });
    }

    return c.json({ error: 'Unknown bulk action' }, 400);
  });

  /* ---- accounts ---- */
  function validateAccount(body, existing) {
    const b = body || {};
    const name = String(b.name ?? existing?.name ?? '').trim();
    if (!name || name.length > 40) return { error: 'Name must be 1-40 characters' };
    const type = b.type ?? existing?.type ?? 'cash';
    const meta = ACCOUNT_TYPE_MAP[type];
    if (!meta) return { error: 'Invalid account type' };
    const rawOpening = b.opening_balance ?? existing?.opening_balance ?? 0;
    const opening = Number(rawOpening);
    if (rawOpening === '' || !isFinite(opening) || Math.abs(opening) >= 1e13) {
      return { error: 'Opening balance must be a number' };
    }
    const icon = String(b.icon ?? existing?.icon ?? meta.icon);
    if (!icon.length || icon.length > 8) return { error: 'Invalid icon' };
    const color = String(b.color ?? existing?.color ?? meta.color);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: 'Invalid color' };
    const archived = b.archived === undefined ? (existing?.archived ? 1 : 0) : (b.archived ? 1 : 0);
    return {
      value: {
        name, type, opening_balance: Math.round(opening * 100) / 100,
        icon, color, archived,
      },
    };
  }

  app.get('/api/accounts', async (c) => {
    const accounts = await accountBalances();
    const unassigned = await unassignedTotals();
    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0) + unassigned.net;
    const assets = accounts.reduce((s, a) => s + Math.max(a.balance, 0), 0) + Math.max(unassigned.net, 0);
    const liabilities = accounts.reduce((s, a) => s + Math.max(-a.balance, 0), 0) + Math.max(-unassigned.net, 0);
    return c.json({
      accounts, accountTypes: ACCOUNT_TYPES, unassigned,
      totalBalance, assets, liabilities,
    });
  });

  app.post('/api/accounts', async (c) => {
    const v = validateAccount(await readJson(c));
    if (v.error) return c.json({ error: v.error }, 400);
    const a = v.value;
    const info = await db.run(`
      INSERT INTO accounts (name, type, opening_balance, icon, color, archived)
      VALUES (?, ?, ?, ?, ?, ?)`, [a.name, a.type, a.opening_balance, a.icon, a.color, a.archived]);
    return c.json(await db.get('SELECT * FROM accounts WHERE id = ?', [info.lastInsertRowid]), 201);
  });

  app.put('/api/accounts/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = await getAccount(id);
    if (!existing) return c.json({ error: 'Account not found' }, 404);
    const v = validateAccount(await readJson(c), existing);
    if (v.error) return c.json({ error: v.error }, 400);
    const a = v.value;
    await db.run(`
      UPDATE accounts SET name = ?, type = ?, opening_balance = ?, icon = ?, color = ?, archived = ?
      WHERE id = ?`, [a.name, a.type, a.opening_balance, a.icon, a.color, a.archived, id]);
    return c.json(await db.get('SELECT * FROM accounts WHERE id = ?', [id]));
  });

  app.delete('/api/accounts/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const account = await getAccount(id);
    if (!account) return c.json({ error: 'Account not found' }, 404);
    const txCount = (await db.get('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?', [id])).c;
    const recCount = (await db.get('SELECT COUNT(*) AS c FROM recurring WHERE account_id = ?', [id])).c;
    const trCount = (await db.get('SELECT COUNT(*) AS c FROM transfers WHERE from_account_id = ? OR to_account_id = ?', [id, id])).c;
    if (txCount || recCount || trCount) {
      return c.json({
        error: `Cannot delete: account is used by ${txCount} transaction(s), ${recCount} recurring rule(s) and ${trCount} transfer(s). Archive it instead, or reassign those entries.`,
      }, 409);
    }
    await db.run('DELETE FROM accounts WHERE id = ?', [id]);
    return c.json({ ok: true });
  });

  /* ---- transfers ---- */
  const transferSelect = `
    SELECT tr.*, f.name AS from_name, f.icon AS from_icon, f.color AS from_color,
           t.name AS to_name, t.icon AS to_icon, t.color AS to_color
    FROM transfers tr
    JOIN accounts f ON f.id = tr.from_account_id
    JOIN accounts t ON t.id = tr.to_account_id`;

  app.get('/api/transfers', async (c) => {
    const lim = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200);
    return c.json(await db.all(`${transferSelect} ORDER BY tr.date DESC, tr.id DESC LIMIT ?`, [lim]));
  });

  async function validateTransfer(body) {
    const b = body || {};
    const from = await getAccount(Number(b.from_account_id));
    const to = await getAccount(Number(b.to_account_id));
    if (!from) return { error: 'Source account not found' };
    if (!to) return { error: 'Destination account not found' };
    if (from.id === to.id) return { error: 'Pick two different accounts' };
    if (!validAmount(b.amount)) return { error: 'Amount must be a positive number' };
    if (!validDate(b.date)) return { error: 'Invalid date (expected YYYY-MM-DD)' };
    const note = b.note ?? '';
    if (typeof note !== 'string' || note.length > 500) return { error: 'Note must be 500 characters or fewer' };
    return {
      value: {
        from_account_id: from.id, to_account_id: to.id,
        amount: Math.round(Number(b.amount) * 100) / 100,
        date: b.date, note: note.trim(),
      },
    };
  }

  app.post('/api/transfers', async (c) => {
    const v = await validateTransfer(await readJson(c));
    if (v.error) return c.json({ error: v.error }, 400);
    const t = v.value;
    const info = await db.run(`
      INSERT INTO transfers (from_account_id, to_account_id, amount, date, note)
      VALUES (?, ?, ?, ?, ?)`, [t.from_account_id, t.to_account_id, t.amount, t.date, t.note]);
    return c.json(await db.get(`${transferSelect} WHERE tr.id = ?`, [info.lastInsertRowid]), 201);
  });

  app.delete('/api/transfers/:id', async (c) => {
    const info = await db.run('DELETE FROM transfers WHERE id = ?', [Number(c.req.param('id'))]);
    if (info.changes === 0) return c.json({ error: 'Transfer not found' }, 404);
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
    const rows = await db.all(`
      SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
             a.name AS account_name, a.icon AS account_icon, a.color AS account_color
      FROM recurring r
      JOIN categories c ON c.id = r.category_id
      LEFT JOIN accounts a ON a.id = r.account_id
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
    if (b.account_id !== undefined || !existing) {
      const raw = b.account_id ?? existing?.account_id ?? null;
      if (raw === null || raw === '' || raw === 0) {
        out.account_id = null;
      } else {
        const acc = await getAccount(Number(raw));
        if (!acc) return { error: 'Account not found' };
        out.account_id = acc.id;
        if (b.method === undefined) out.method = accountMethod(acc);
      }
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
      INSERT INTO recurring (type, amount, category_id, note, method, frequency, next_date, active, account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [x.type, x.amount, x.category_id, x.note || '', x.method, x.frequency, x.next_date, x.active ?? 1, x.account_id ?? null]);
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
      UPDATE recurring SET type = ?, amount = ?, category_id = ?, note = ?, method = ?, frequency = ?, next_date = ?, active = ?, account_id = ?
      WHERE id = ?`,
      [x.type, x.amount, x.category_id, x.note, x.method, x.frequency, x.next_date, x.active, x.account_id ?? null, id]);
    return c.json(await db.get('SELECT * FROM recurring WHERE id = ?', [id]));
  });

  app.delete('/api/recurring/:id', async (c) => {
    const info = await db.run('DELETE FROM recurring WHERE id = ?', [Number(c.req.param('id'))]);
    if (info.changes === 0) return c.json({ error: 'Rule not found' }, 404);
    return c.json({ ok: true });
  });

  /* ---- summary / dashboard ---- */
  app.get('/api/summary', async (c) => {
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
      SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
             a.name AS account_name, a.icon AS account_icon, a.color AS account_color
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      ORDER BY t.date DESC, t.id DESC LIMIT 8`);

    const accounts = await accountBalances();
    const unassigned = await unassignedTotals();
    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0) + unassigned.net;
    const assets = accounts.reduce((s, a) => s + Math.max(a.balance, 0), 0) + Math.max(unassigned.net, 0);
    const liabilities = accounts.reduce((s, a) => s + Math.max(-a.balance, 0), 0) + Math.max(-unassigned.net, 0);

    return c.json({
      month, days,
      monthTotals, prevTotals, allTime,
      byCategory, daily, trend, budgets, projected, recent,
      accounts, unassigned, totalBalance, assets, liabilities,
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
    const month = validMonthKeyOrCurrent(c.req.query('month'));
    return c.json(await SmartEngine.analytics(month));
  });

  /* ---- AI (bring-your-own-key LLM) ---- */
  app.get('/api/ai/status', async (c) => c.json(await AILayer.status()));

  app.post('/api/ai/ask', async (c) => {
    if (aiRateLimited(c)) return c.json({ error: 'Too many AI requests. Wait a minute and try again.' }, 429);
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
    if (aiRateLimited(c)) return c.json({ error: 'Too many AI requests. Wait a minute and try again.' }, 429);
    const { text } = await readJson(c);
    if (!text || !String(text).trim()) return c.json({ error: 'Enter some text first' }, 400);
    try {
      return c.json(await AILayer.parse(String(text).trim()));
    } catch (err) {
      return c.json({ error: err.message }, 502);
    }
  });

  app.post('/api/ai/test', async (c) => {
    if (aiRateLimited(c)) return c.json({ error: 'Too many AI requests. Wait a minute and try again.' }, 429);
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
      version: 2,
      exported_at: new Date().toISOString(),
      settings: { currency: await getSetting('currency', 'INR'), theme: await getSetting('theme', 'system') },
      accounts: await db.all('SELECT * FROM accounts ORDER BY id'),
      categories: await db.all('SELECT * FROM categories ORDER BY id'),
      transactions: await db.all('SELECT * FROM transactions ORDER BY id'),
      transfers: await db.all('SELECT * FROM transfers ORDER BY id'),
      budgets: await db.all('SELECT * FROM budgets ORDER BY id'),
      recurring: await db.all('SELECT * FROM recurring ORDER BY id'),
    };
  }

  app.get('/api/export', async (c) => {
    const format = c.req.query('format') === 'csv' ? 'csv' : 'json';
    if (format === 'csv') {
      const rows = await db.all(`
        SELECT t.id, t.date, t.type, c.name AS category, t.amount, t.method, a.name AS account, t.note, t.recurring_id, t.tags
        FROM transactions t
        JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts a ON a.id = t.account_id
        ORDER BY t.date DESC, t.id DESC`);
      const header = ['id', 'date', 'type', 'category', 'amount', 'method', 'account', 'note', 'recurring_id', 'tags'];
      const escCsv = v => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [header.join(',')];
      for (const r of rows) lines.push([r.id, r.date, r.type, r.category, r.amount, r.method, r.account ?? '', r.note, r.recurring_id ?? '', r.tags ?? ''].map(escCsv).join(','));
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
    const hasAccounts = Array.isArray(data.accounts);
    const accountRows = hasAccounts ? data.accounts.filter(x =>
      Number.isInteger(Number(x.id)) && String(x.name || '').trim() && ACCOUNT_TYPE_MAP[x.type]) : [];
    const accIds = new Set(accountRows.map(x => Number(x.id)));
    const txOk = data.transactions.every(t =>
      Number.isInteger(Number(t.id)) && validAmount(t.amount) &&
      (t.type === 'income' || t.type === 'expense') && validDate(t.date) && catIds.has(Number(t.category_id)) &&
      (t.account_id == null || !hasAccounts || accIds.has(Number(t.account_id))));
    if (!txOk) return c.json({ error: 'Backup contains invalid transactions' }, 400);

    try {
      const stmts = [
        { sql: 'DELETE FROM transfers' },
        { sql: 'DELETE FROM transactions' },
        { sql: 'DELETE FROM budgets' },
        { sql: 'DELETE FROM recurring' },
        { sql: 'DELETE FROM categories' },
      ];
      if (hasAccounts) stmts.push({ sql: 'DELETE FROM accounts' });

      for (const a of accountRows) {
        stmts.push({
          sql: 'INSERT INTO accounts (id, name, type, opening_balance, icon, color, archived) VALUES (?, ?, ?, ?, ?, ?, ?)',
          params: [Number(a.id), String(a.name).slice(0, 40), a.type,
            isFinite(Number(a.opening_balance)) ? Number(a.opening_balance) : 0,
            String(a.icon || ACCOUNT_TYPE_MAP[a.type].icon).slice(0, 8),
            /^#[0-9a-fA-F]{6}$/.test(String(a.color)) ? a.color : ACCOUNT_TYPE_MAP[a.type].color,
            a.archived ? 1 : 0],
        });
      }

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
        const accountId = t.account_id != null && accIds.has(Number(t.account_id)) ? Number(t.account_id) : null;
        stmts.push({
          sql: 'INSERT INTO transactions (id, type, amount, category_id, date, note, method, recurring_id, tags, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          params: [Number(t.id), t.type, Number(t.amount), Number(t.category_id), t.date,
            String(t.note || '').slice(0, 500), METHODS.some(m => m.id === t.method) ? t.method : 'cash',
            t.recurring_id != null && Number.isInteger(Number(t.recurring_id)) ? Number(t.recurring_id) : null,
            [...new Set(tags)].join(','), accountId],
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
            const accountId = r.account_id != null && accIds.has(Number(r.account_id)) ? Number(r.account_id) : null;
            stmts.push({
              sql: 'INSERT INTO recurring (id, type, amount, category_id, note, method, frequency, next_date, active, last_run, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              params: [Number(r.id), r.type === 'income' ? 'income' : 'expense', Number(r.amount), Number(r.category_id),
                String(r.note || '').slice(0, 500), METHODS.some(m => m.id === r.method) ? r.method : 'cash',
                r.frequency, r.next_date, r.active ? 1 : 0, r.last_run || null, accountId],
            });
          }
        }
      }
      if (Array.isArray(data.transfers)) {
        for (const tr of data.transfers) {
          if (validAmount(tr.amount) && validDate(tr.date) &&
              accIds.has(Number(tr.from_account_id)) && accIds.has(Number(tr.to_account_id)) &&
              Number(tr.from_account_id) !== Number(tr.to_account_id)) {
            stmts.push({
              sql: 'INSERT INTO transfers (id, from_account_id, to_account_id, amount, date, note) VALUES (?, ?, ?, ?, ?, ?)',
              params: [Number(tr.id), Number(tr.from_account_id), Number(tr.to_account_id), Number(tr.amount), tr.date,
                String(tr.note || '').slice(0, 500)],
            });
          }
        }
      }
      await db.batch(stmts);
      try { await db.exec("DELETE FROM sqlite_sequence WHERE name IN ('accounts','categories','transactions','transfers','budgets','recurring')"); } catch { /* not available everywhere */ }
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

  /* ---- CSV bank statement import ---- */
  function csvField(row, headers, mapping, field) {
    const key = mapping && mapping[field];
    if (key === undefined || key === null || key === '') return '';
    let idx = headers.findIndex(h => h.toLowerCase() === String(key).toLowerCase());
    if (idx < 0 && Number.isInteger(Number(key))) idx = Number(key);
    return idx >= 0 && idx < row.length ? String(row[idx]).trim() : '';
  }

  app.post('/api/import/csv/preview', async (c) => {
    const { csv } = await readJson(c);
    if (typeof csv !== 'string' || !csv.trim()) return c.json({ error: 'Choose a CSV file first' }, 400);
    if (csv.length > 5 * 1024 * 1024) return c.json({ error: 'CSV is too large (max 5 MB)' }, 413);
    const rows = parseCsv(csv);
    if (rows.length < 2) return c.json({ error: 'CSV needs a header row and at least one data row' }, 400);
    const headers = rows[0].map(normalizeHeader);
    return c.json({ headers, total: rows.length - 1, preview: rows.slice(1, 11) });
  });

  app.post('/api/import/csv', async (c) => {
    const body = await readJson(c);
    const csv = body.csv;
    if (typeof csv !== 'string' || !csv.trim()) return c.json({ error: 'Choose a CSV file first' }, 400);
    if (csv.length > 5 * 1024 * 1024) return c.json({ error: 'CSV is too large (max 5 MB)' }, 413);

    const rows = parseCsv(csv);
    if (rows.length < 2) return c.json({ error: 'CSV needs a header row and at least one data row' }, 400);
    if (rows.length - 1 > 5000) return c.json({ error: 'Too many rows (max 5000 per import). Split the file and try again.' }, 400);

    const headers = rows[0].map(normalizeHeader);
    const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
    if (!mapping.date) return c.json({ error: 'Map the date column' }, 400);
    if (!mapping.amount && !mapping.debit && !mapping.credit) {
      return c.json({ error: 'Map an amount column (or debit/credit columns)' }, 400);
    }

    let account = null;
    if (body.account_id !== undefined && body.account_id !== null && body.account_id !== '') {
      account = await getAccount(Number(body.account_id));
      if (!account) return c.json({ error: 'Account not found' }, 400);
    }

    const defaultType = body.default_type === 'income' ? 'income' : 'expense';
    const invert = !!body.invert_amount;
    const skipDuplicates = body.skip_duplicates !== false;
    const method = account ? accountMethod(account) : 'other';
    const tags = String(body.tags || '').split(',')
      .map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 10).map(t => t.slice(0, 24));

    const cats = await db.all('SELECT id, name, type FROM categories');
    const catByName = new Map(cats.map(x => [x.name.toLowerCase(), x]));
    const fallbackCat = type => cats.find(x => x.type === type && (type === 'expense' ? x.name === 'Others' : x.name === 'Other Income'));
    // Load the Smart Engine's matching data once, then classify in memory so a
    // big import doesn't issue one query per row (D1 free plan: 50 queries per
    // Worker invocation).
    const smartCtx = await SmartEngine.buildContext();

    const parsed = [];
    const errors = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 1;
      const date = parseCsvDate(csvField(row, headers, mapping, 'date'));
      if (!date) { errors.push(`Line ${line}: could not read the date`); continue; }

      let amount = null;
      let type = null;
      if (mapping.debit || mapping.credit) {
        const debit = parseCsvAmount(csvField(row, headers, mapping, 'debit'));
        const credit = parseCsvAmount(csvField(row, headers, mapping, 'credit'));
        if (credit && credit > 0) { amount = Math.abs(credit); type = 'income'; }
        else if (debit && debit > 0) { amount = Math.abs(debit); type = 'expense'; }
      } else {
        amount = parseCsvAmount(csvField(row, headers, mapping, 'amount'));
        if (amount !== null && invert) amount = -amount;
        if (amount !== null && amount !== 0) {
          if (amount < 0) { type = 'expense'; amount = Math.abs(amount); }
          else {
            const hint = csvField(row, headers, mapping, 'type');
            if (/credit|cr\b|income|deposit/i.test(hint)) type = 'income';
            else if (/debit|dr\b|expense|withdraw/i.test(hint)) type = 'expense';
            else type = defaultType;
          }
        }
      }

      if (amount === null || !isFinite(amount) || amount <= 0) {
        errors.push(`Line ${line}: could not read the amount`);
        continue;
      }
      if (amount >= 1e13) { errors.push(`Line ${line}: amount is too large`); continue; }

      const note = [csvField(row, headers, mapping, 'description'), csvField(row, headers, mapping, 'reference')]
        .filter(Boolean).join(' · ').slice(0, 500);

      let categoryId = null;
      const catName = csvField(row, headers, mapping, 'category');
      if (catName) {
        const match = catByName.get(catName.toLowerCase());
        if (match && match.type === type) categoryId = match.id;
      }
      if (categoryId == null) {
        try {
          const s = SmartEngine.suggestFromContext(smartCtx, { type, note, amount });
          if (s && s.category_id) {
            const sc = cats.find(x => x.id === Number(s.category_id));
            if (sc && sc.type === type) categoryId = sc.id;
          }
        } catch { /* fall through to the default category */ }
      }
      if (categoryId == null) {
        const fb = fallbackCat(type);
        if (fb) categoryId = fb.id;
      }
      if (categoryId == null) { errors.push(`Line ${line}: no matching category`); continue; }

      const rounded = Math.round(amount * 100) / 100;
      const key = `${date}|${rounded.toFixed(2)}|${type}|${account ? account.id : ''}|${note.toLowerCase()}`;
      parsed.push({ date, amount: rounded, type, note, categoryId, key });
    }

    let toInsert = parsed;
    if (skipDuplicates && parsed.length) {
      const dates = parsed.map(p => p.date).sort();
      const existing = await db.all(
        'SELECT date, amount, type, account_id, note FROM transactions WHERE date >= ? AND date <= ?',
        [dates[0], dates[dates.length - 1]]);
      const existingKeys = new Set(existing.map(r =>
        `${r.date}|${Number(r.amount).toFixed(2)}|${r.type}|${r.account_id ?? ''}|${String(r.note || '').toLowerCase()}`));
      const seen = new Set();
      toInsert = [];
      for (const p of parsed) {
        if (existingKeys.has(p.key) || seen.has(p.key)) { skipped++; continue; }
        seen.add(p.key);
        toInsert.push(p);
      }
    }

    if (toInsert.length) {
      await db.batch(toInsert.map(p => ({
        sql: 'INSERT INTO transactions (type, amount, category_id, date, note, method, tags, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: [p.type, p.amount, p.categoryId, p.date, p.note, method, [...new Set(tags)].join(','), account ? account.id : null],
      })));
      SmartEngine.invalidatePatterns();
    }

    return c.json({
      ok: true,
      total: rows.length - 1,
      inserted: toInsert.length,
      skipped,
      failed: errors.length,
      errors: errors.slice(0, 20),
    });
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
    const accountRows = await db.all('SELECT * FROM accounts');
    const accByType = t => (accountRows.find(a => a.type === t) || {}).id ?? null;
    const cashId = accByType('cash');
    const bankId = accByType('bank');
    let cardId = accByType('credit_card');
    if (cardId == null) {
      const info = await db.run("INSERT INTO accounts (name, type, opening_balance, icon, color) VALUES ('Credit Card', 'credit_card', 0, '💳', '#D63057')");
      cardId = info.lastInsertRowid;
    }
    const methodAccount = method => {
      if (method === 'card') return cardId;
      if (method === 'cash' || method === 'wallet') return cashId;
      return bankId;
    };
    // Give the demo a realistic starting point (only when the account is empty).
    if (bankId != null) stmts.push({ sql: 'UPDATE accounts SET opening_balance = 25000 WHERE id = ? AND opening_balance = 0', params: [bankId] });
    if (cashId != null) stmts.push({ sql: 'UPDATE accounts SET opening_balance = 2500 WHERE id = ? AND opening_balance = 0', params: [cashId] });

    const ins = (type, amount, catName, ds, note, method, tags) => {
      const cid = catId(catName);
      if (cid == null) return;
      stmts.push({
        sql: 'INSERT INTO transactions (type, amount, category_id, date, note, method, tags, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: [type, amount, cid, ds, note, method, tags, methodAccount(method)],
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
      sql: 'INSERT INTO recurring (type, amount, category_id, note, method, frequency, next_date, active, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      params: ['income', 65000, catId('Salary'), 'Monthly salary', 'netbanking', 'monthly', next1st, bankId],
    });
    if (catId('Rent') != null) stmts.push({
      sql: 'INSERT INTO recurring (type, amount, category_id, note, method, frequency, next_date, active, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      params: ['expense', 16000, catId('Rent'), 'Rent', 'netbanking', 'monthly', next3rd, bankId],
    });

    await db.batch(stmts);
    SmartEngine.invalidatePatterns();
    return c.json({ ok: true });
  });

  app.delete('/api/data', async (c) => {
    if (c.req.query('confirm') !== 'DELETE') return c.json({ error: 'Pass ?confirm=DELETE to confirm' }, 400);
    await db.batch([
      { sql: 'DELETE FROM transfers' },
      { sql: 'DELETE FROM transactions' },
      { sql: 'DELETE FROM budgets' },
      { sql: 'DELETE FROM recurring' },
    ]);
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

module.exports = { createApp, ensureSchema, CURRENCIES, METHODS, ACCOUNT_TYPES };
