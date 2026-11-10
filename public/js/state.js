'use strict';

/* ============================================================
   Shared state + helpers
   ============================================================ */

/* tiny DOM helpers */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/* app state */
const State = {
  settings: { currency: 'INR', theme: 'system' },
  categories: [],
  currencies: [],
  methods: [],
  view: 'dashboard',
  month: null,          // 'YYYY-MM'
  dashboard: null,      // last summary payload
  budgetsCache: null,
  tx: {
    filters: { type: '', category: '', range: 'month', from: '', to: '', q: '', sort: 'date_desc' },
    rows: [], total: 0, income: 0, expense: 0, loading: false, loadedAll: false,
  },
};

/* ---------- constants (mirror server.js) ---------- */

const METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'netbanking', label: 'Net Banking' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'other', label: 'Other' },
];

const METHOD_LABEL = Object.fromEntries(METHODS.map(m => [m.id, m.label]));

const FREQUENCIES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];
const FREQ_LABEL = Object.fromEntries(FREQUENCIES.map(f => [f.id, f.label]));

const EMOJIS = [
  '🍜','🍔','🍕','☕','🍰','🛒','🚗','🛺','⛽','🚕','🏠','💡','💧','🛍️','👕','👟','🎬','🎮','🎧','📺',
  '💊','🏥','🩺','📚','🎓','✈️','🏝️','🚆','🔁','📱','💻','🌐','🧴','💇','🐾','🎁','🎉','💐','🍺','🥂',
  '💼','💰','💸','🏦','📈','💼','💻','🏪','🧾','🪙','💳','🧮','🛠️','🧹','🧺','👶','⚽','🏏','🏋️','🎨',
];

const COLORS = [
  '#FF6B6B','#FF9F43','#FDCB6E','#00B894','#55EFC4','#00CEC9',
  '#74B9FF','#0984E3','#A29BFE','#6C5CE7','#FD79A8','#E17055',
  '#B2BEC3','#636E72','#D63057','#00CEC9',
];

/* ---------- date helpers ---------- */

const pad2 = n => String(n).padStart(2, '0');

function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayStr() { return fmtDate(new Date()); }
function currentMonthKey() { return todayStr().slice(0, 7); }

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addMonthsKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function daysInMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function monthShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'short' });
}

function dayLabel(dateStr) {
  const t = parseDate(todayStr());
  const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const d = parseDate(dateStr);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((t0 - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== t0.getFullYear() ? 'numeric' : undefined });
}
function shortDate(dateStr) {
  return parseDate(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---------- money formatting ---------- */

const _fmtCache = new Map();
function getFormatter(currency, opts = {}) {
  const key = currency + JSON.stringify(opts);
  if (!_fmtCache.has(key)) {
    try {
      _fmtCache.set(key, new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: opts.compact ? 0 : undefined,
        maximumFractionDigits: opts.compact ? 1 : 2,
        notation: opts.compact ? 'compact' : 'standard',
      }));
    } catch {
      _fmtCache.set(key, new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }));
    }
  }
  return _fmtCache.get(key);
}

function fmtMoney(v, { compact = false } = {}) {
  const cur = State.settings.currency || 'INR';
  const f = getFormatter(cur, { compact });
  return f.format(Number(v) || 0);
}

function pct(n) {
  if (n === null || n === undefined || !isFinite(n)) return null;
  return Math.round(n);
}

/* ---------- categories ---------- */

function catsOf(type) {
  return State.categories.filter(c => c.type === type);
}
function catById(id) {
  return State.categories.find(c => c.id === Number(id));
}

/* ---------- misc ---------- */

function debounce(fn, ms) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

function rangeToDates(range) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const iso = d => fmtDate(d);
  switch (range) {
    case 'month': {
      const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
      return { from: iso(first), to: iso(last) };
    }
    case 'last_month': {
      const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
      return { from: iso(first), to: iso(last) };
    }
    case '3months': {
      const first = new Date(y, m - 2, 1), last = new Date(y, m + 1, 0);
      return { from: iso(first), to: iso(last) };
    }
    case 'year': {
      const first = new Date(y, 0, 1), last = new Date(y, 11, 31);
      return { from: iso(first), to: iso(last) };
    }
    case 'last_year': {
      const first = new Date(y - 1, 0, 1), last = new Date(y - 1, 11, 31);
      return { from: iso(first), to: iso(last) };
    }
    case 'all':
    case 'custom':
    default:
      return { from: '', to: '' };
  }
}
