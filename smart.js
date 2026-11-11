'use strict';

/**
 * Smart Engine — local, offline intelligence for the expense tracker.
 *
 * Learns from your transaction history and computes:
 *  - auto-category suggestions (note → category/method, no external API)
 *  - a generated insights feed (anomalies, pacing, subscriptions, streaks…)
 *  - subscription detection from near-regular charges
 *  - smart budget suggestions from trailing averages
 *  - weekday-aware month-end forecasting
 *  - analytics aggregates (heatmap, weekday patterns, merchants, methods)
 *
 * No API keys, no cloud, no cost. That's the point.
 *
 * All database calls go through the async adapter (db.js) so this module
 * runs identically on Node.js and Cloudflare Workers.
 */

module.exports = function createSmart(ctx) {
  const { db, monthRange, currentMonthKey, addMonthsKey, todayStr, currencySymbol } = ctx;

  /** money formatter for human-readable insight text (uses the active currency) */
  function mkMoney(sym) {
    return n => `${sym}${Math.round(Number(n) || 0)}`;
  }

  /* ---------------- text normalization ---------------- */

  const STOP = new Set(['a', 'an', 'the', 'at', 'for', 'of', 'on', 'in', 'with', 'and', 'to', 'my', 'me', 'from', 'by', 'was', 'were', 'is', 'paid', 'pay', 'buy', 'bought', 'get', 'got']);

  function tokens(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOP.has(t));
  }
  function normKey(s) { return tokens(s).sort().join(' '); }

  /** well-known merchant/keyword → category-name hints (seed knowledge) */
  const HINTS = {
    expense: {
      'Food & Dining': ['swiggy', 'zomato', 'domino', 'pizza', 'kfc', 'mcdonald', 'burger', 'cafe', 'coffee', 'chai', 'tea', 'lunch', 'dinner', 'breakfast', 'restaurant', 'hotel food', 'snack', 'bakery', 'starbucks', 'eat'],
      'Groceries': ['bigbasket', 'big basket', 'grocery', 'groceries', 'vegetable', 'fruit', 'supermarket', 'dmart', 'blinkit', 'zepto', 'milk', 'egg', 'kirana'],
      'Transport': ['uber', 'ola', 'rapido', 'metro', 'petrol', 'fuel', 'diesel', 'cab', 'taxi', 'auto', 'rickshaw', 'parking', 'bus', 'toll', 'fuel'],
      'Rent': ['rent', 'landlord', 'maintenance charge'],
      'Utilities': ['electricity', 'water bill', 'internet', 'broadband', 'wifi', 'gas bill', 'bill payment', 'recharge'],
      'Shopping': ['amazon', 'flipkart', 'myntra', 'ajio', 'mall', 'decathlon', 'ikea', 'croma', 'reliance digital', 'shop'],
      'Entertainment': ['movie', 'cinema', 'pvr', 'concert', 'game', 'steam', 'bowling', 'party'],
      'Health': ['pharmacy', 'apollo', 'doctor', 'hospital', 'medicine', 'clinic', 'gym', 'dentist'],
      'Education': ['course', 'udemy', 'coursera', 'book', 'tuition', 'college', 'school fee', 'exam'],
      'Travel': ['irctc', 'flight', 'airline', 'indigo', 'airbnb', 'booking.com', 'train ticket', 'trip', 'hotel'],
      'Subscriptions': ['netflix', 'spotify', 'youtube premium', 'hotstar', 'prime video', 'subscription', 'apple one', 'icloud', 'chatgpt', 'notion'],
      'Personal Care': ['haircut', 'salon', 'spa', 'skincare', 'dental clean'],
      'Others': ['misc', 'other', 'unknown'],
    },
    income: {
      'Salary': ['salary', 'paycheck', 'pay slip', 'wages', 'monthly pay'],
      'Freelance': ['freelance', 'client', 'project payment', 'gig', 'consulting'],
      'Business': ['business', 'sale', 'shop revenue', 'profit'],
      'Investments': ['dividend', 'mutual fund', 'stock', 'sip redemption', 'capital gain'],
      'Interest': ['interest', 'fd interest', 'savings interest'],
      'Gifts': ['gift', 'received from', 'birthday money'],
      'Refunds': ['refund', 'cashback', 'reversal', 'returned'],
      'Other Income': ['bonus', 'other income', 'misc income'],
    },
  };

  async function categoryIdByName(name, type) {
    const row = await db.get('SELECT id FROM categories WHERE lower(name) = ? AND type = ?', [String(name).toLowerCase(), type]);
    return row ? row.id : null;
  }

  /* ---------------- learned patterns (cached) ---------------- */

  let patternCache = { at: 0, byType: null };
  const PATTERN_TTL = 60 * 1000;

  async function learnedPatterns() {
    if (patternCache.byType && Date.now() - patternCache.at < PATTERN_TTL) return patternCache.byType;
    const rows = await db.all(`
      SELECT note, type, category_id, method, amount FROM transactions
      ORDER BY id DESC LIMIT 800`);
    const byType = { expense: [], income: [] };
    for (const r of rows) {
      const tk = tokens(r.note);
      if (!tk.length) continue;
      byType[r.type].push({ key: normKey(r.note), tokens: tk, category_id: r.category_id, method: r.method, amount: r.amount });
    }
    patternCache = { at: Date.now(), byType };
    return byType;
  }

  function invalidatePatterns() { patternCache = { at: 0, byType: null }; }

  /**
   * Suggest a category + payment method for a new transaction.
   * Returns { category_id, method, confidence, source } or null.
   */
  async function suggest({ type, note, amount }) {
    if (type !== 'income' && type !== 'expense') return null;
    const text = String(note || '');
    if (!tokens(text).length) return null;

    // 1) exact learned note match ("swiggy order" seen before)
    const learned = (await learnedPatterns())[type];
    const key = normKey(text);
    const exact = learned.filter(p => p.key === key);
    if (exact.length) {
      const byCat = {};
      for (const p of exact) byCat[p.category_id] = (byCat[p.category_id] || 0) + 1;
      const best = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
      const method = exact[0].method;
      return { category_id: Number(best[0]), method, confidence: Math.min(0.55 + best[1] * 0.1, 0.95), source: 'history' };
    }

    // 2) token overlap scoring (partial match on learned notes)
    const tk = tokens(text);
    let bestOverlap = null;
    for (const p of learned) {
      const shared = tk.filter(t => p.tokens.includes(t)).length;
      if (!shared) continue;
      const union = new Set([...tk, ...p.tokens]).size;
      const score = shared / union;
      if (score >= 0.34 && (!bestOverlap || score > bestOverlap.score)) {
        bestOverlap = { score, category_id: p.category_id, method: p.method };
      }
    }
    if (bestOverlap) {
      return { category_id: bestOverlap.category_id, method: bestOverlap.method, confidence: bestOverlap.score, source: 'history-similar' };
    }

    // 3) keyword hints (seed knowledge for first-time use)
    const n = text.toLowerCase();
    const hints = HINTS[type];
    let bestHint = null;
    for (const [catName, words] of Object.entries(hints)) {
      const hit = words.some(w => n.includes(w));
      if (hit) {
        const id = await categoryIdByName(catName, type);
        if (id && (!bestHint || words.length > bestHint.words)) bestHint = { id, words: words.length, name: catName };
      }
    }
    if (bestHint) return { category_id: bestHint.id, method: null, confidence: 0.5, source: 'keyword' };

    return null;
  }

  /* ---------------- core data loading ---------------- */

  async function loadWindow(month, backMonths) {
    const start = addMonthsKey(month, -backMonths) + '-01';
    const { start: mStart, end: mEnd } = monthRange(month);
    const rows = await db.all(`
      SELECT date, type, amount, category_id, note, method, recurring_id
      FROM transactions WHERE date >= ? AND date <= ?`, [start, mEnd]);
    return { rows, start };
  }

  async function catMap() {
    const m = {};
    for (const c of await db.all('SELECT id, name, icon, color, type FROM categories')) m[c.id] = c;
    return m;
  }

  function weekdayOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).getDay(); // 0 = Sun
  }

  /* ---------------- insights feed ---------------- */

  async function insights(month) {
    const sym = currencySymbol ? await currencySymbol() : '₹';
    const money = mkMoney(sym);

    const { rows } = await loadWindow(month, 3);
    const cats = await catMap();
    const yms = [-3, -2, -1, 0].map(i => addMonthsKey(month, i));

    const perCat = {};                 // catId → { ym: expense }
    const perMonth = {};               // ym → { income, expense }
    const perMerchant = {};            // normKey → { total, count, samples }
    const daily = {};                  // date → expense
    for (const r of rows) {
      const ym = r.date.slice(0, 7);
      perMonth[ym] = perMonth[ym] || { income: 0, expense: 0 };
      perMonth[ym][r.type] += r.amount;

      if (r.type === 'expense') {
        daily[r.date] = (daily[r.date] || 0) + r.amount;
        perCat[r.category_id] = perCat[r.category_id] || {};
        perCat[r.category_id][ym] = (perCat[r.category_id][ym] || 0) + r.amount;

        // merchants: viewing month only (used for the top-merchant insight)
        if (ym === month) {
          const nk = normKey(r.note);
          if (nk) {
            perMerchant[nk] = perMerchant[nk] || { total: 0, count: 0, sample: r.note };
            perMerchant[nk].total += r.amount;
            perMerchant[nk].count++;
          }
        }
      }
    }

    const cur = perMonth[month] || { income: 0, expense: 0 };
    const prev = perMonth[yms[2]] || { income: 0, expense: 0 };
    const out = [];

    /* anomalies: category spend vs trailing 3-month average */
    const anomalies = [];
    for (const [catId, byYm] of Object.entries(perCat)) {
      const now = byYm[month] || 0;
      const trail = yms.slice(0, 3).map(ym2 => byYm[ym2] || 0);
      const activeMonths = trail.filter(v => v > 0).length;
      const baseline = trail.reduce((a, b) => a + b, 0) / 3;
      const cat = cats[catId];
      if (!cat || !now) continue;
      if (activeMonths >= 2 && baseline > 0) {
        if (now > baseline * 1.25 && now - baseline > Math.max(200, cur.expense * 0.02)) {
          anomalies.push({ kind: 'up', cat, now, baseline, diff: now - baseline });
        } else if (now < baseline * 0.7 && baseline - now > Math.max(200, cur.expense * 0.02)) {
          anomalies.push({ kind: 'down', cat, now, baseline, diff: baseline - now });
        }
      }
    }
    anomalies.sort((a, b) => b.diff - a.diff);
    for (const a of anomalies.slice(0, 3)) {
      if (a.kind === 'up') {
        out.push({
          id: `anom-up-${a.cat.id}`,
          severity: 'warn',
          icon: a.cat.icon,
          title: `${a.cat.name} is running high`,
          body: `${money(a.now)} this month vs your ~${money(a.baseline)} 3-month average — that's ${money(a.diff)} above usual.`,
        });
      } else {
        out.push({
          id: `anom-down-${a.cat.id}`,
          severity: 'good',
          icon: a.cat.icon,
          title: `${a.cat.name} is down nicely`,
          body: `${money(a.now)} vs your ~${money(a.baseline)} average — ${money(a.diff)} saved this month.`,
        });
      }
    }

    /* budget pacing */
    const budgets = await db.all(`
      SELECT b.category_id, b.amount, c.name, c.icon FROM budgets b JOIN categories c ON c.id = b.category_id`);
    const isCurrentMonth = month === currentMonthKey();
    for (const b of budgets) {
      const spent = perCat[b.category_id] ? (perCat[b.category_id][month] || 0) : 0;
      const used = b.amount > 0 ? spent / b.amount : 0;
      if (used >= 1) {
        out.push({
          id: `budget-over-${b.category_id}`,
          severity: 'warn',
          icon: '🚨',
          title: `${b.name} budget exceeded`,
          body: `${money(spent)} spent of the ${money(b.amount)} budget.`,
        });
      } else if (isCurrentMonth && used >= 0.75) {
        out.push({
          id: `budget-near-${b.category_id}`,
          severity: 'warn',
          icon: '⚠️',
          title: `${b.name} budget is ${Math.round(used * 100)}% used`,
          body: `${money(b.amount - spent)} left with ${monthDaysLeft(month)} days to go.`,
        });
      }
    }

    /* subscriptions found in the wild */
    for (const s of (await detectSubscriptions()).slice(0, 2)) {
      out.push({
        id: `sub-${s.key}`,
        severity: 'info',
        icon: '🔁',
        title: `Possible ${s.frequency} charge: ${s.note}`,
        body: `${money(s.amount)} ≈ every ${s.gap} days (last: ${s.last_date}). Automate it so it's never missed.`,
        cta: { kind: 'recurring', label: 'Automate', payload: {
          type: 'expense', amount: s.amount, category_id: s.category_id,
          frequency: s.frequency, next_date: s.next_date, note: s.note,
        } },
      });
    }

    /* budget suggestions for unbudgeted active categories */
    for (const s of (await budgetSuggestions(month)).slice(0, 2)) {
      out.push({
        id: `sug-${s.category_id}`,
        severity: 'info',
        icon: '💡',
        title: `No budget for ${s.name}`,
        body: `You averaged ${money(s.based_on)} over the last ${s.months} months. A ${money(s.suggested)} budget would fit your habits.`,
        cta: { kind: 'budget', label: `Set ${money(s.suggested)}`, payload: { category_id: s.category_id, amount: s.suggested } },
      });
    }

    /* savings rate & month comparison */
    if (cur.income > 0) {
      const rate = (cur.income - cur.expense) / cur.income;
      if (prev.income > 0) {
        const prevRate = (prev.income - prev.expense) / prev.income;
        if (rate > prevRate + 0.05) {
          out.push({
            id: 'savings-up', severity: 'good', icon: '🎉',
            title: 'Savings rate improved',
            body: `You're keeping ${Math.round(rate * 100)}% of income this month (was ${Math.round(prevRate * 100)}%).`,
          });
        } else if (rate < prevRate - 0.05) {
          out.push({
            id: 'savings-down', severity: 'warn', icon: '📉',
            title: 'Savings rate slipped',
            body: `You're keeping ${Math.round(rate * 100)}% of income this month (was ${Math.round(prevRate * 100)}%).`,
          });
        }
      }
      if (rate >= 0.3) {
        out.push({
          id: 'savings-great', severity: 'good', icon: '🏆',
          title: 'Strong savings month',
          body: `30%+ savings rate — you're ahead of most people. Keep it up.`,
        });
      }
    }

    /* top merchant (viewing month only) */
    const merchants = Object.entries(perMerchant).sort((a, b) => b[1].total - a[1].total);
    if (merchants.length) {
      const [nk, m] = merchants[0];
      if (m.total > 0 && m.count >= 2) {
        out.push({
          id: `top-merchant-${nk}`, severity: 'info', icon: '🏪',
          title: `Top spend: ${m.sample}`,
          body: `${money(m.total)} across ${m.count} visits this month — your most frequent expense.`,
        });
      }
    }

    /* weekday pattern */
    const wAvg = await weekdayAverages(month);
    if (wAvg) {
      const weekend = (wAvg[0] + wAvg[6]) / 2;   // Sun + Sat
      const weekday = (wAvg[1] + wAvg[2] + wAvg[3] + wAvg[4] + wAvg[5]) / 5;
      if (weekend > weekday * 1.4 && weekend > 50) {
        out.push({
          id: 'weekend-pattern', severity: 'info', icon: '📅',
          title: 'Weekends cost you more',
          body: `~${money(weekend)}/day on weekends vs ~${money(weekday)}/day on weekdays.`,
        });
      }
    }

    /* no-spend streak */
    const st = await streaks();
    if (st.current >= 2) {
      out.push({
        id: 'streak', severity: 'good', icon: '🔥',
        title: `${st.current}-day no-spend streak`,
        body: st.best > st.current ? `Your best is ${st.best} days — ${st.best - st.current} to beat it.` : 'A new personal best!',
      });
    }

    /* no income recorded */
    if (cur.expense > 0 && cur.income === 0 && prev.income > 0) {
      out.push({
        id: 'no-income', severity: 'info', icon: '📭',
        title: 'No income recorded this month',
        body: 'Add salary or other income so savings rate and budgets are accurate.',
      });
    }

    const order = { warn: 0, good: 1, info: 2 };
    out.sort((a, b) => order[a.severity] - order[b.severity]);
    return out;
  }

  function monthDaysLeft(month) {
    const today = todayStr();
    if (month !== currentMonthKey()) return 0;
    const { end } = monthRange(month);
    return Math.max(0, Math.round((parse(end) - parse(today)) / 86400000));
  }
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

  /* ---------------- subscription detection ---------------- */

  async function detectSubscriptions() {
    const since = new Date();
    since.setDate(since.getDate() - 120);
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
    const rows = await db.all(`
      SELECT date, amount, category_id, note, recurring_id FROM transactions
      WHERE type = 'expense' AND date >= ? ORDER BY date`, [sinceStr]);

    const groups = new Map();
    for (const r of rows) {
      if (r.recurring_id) continue;
      const nk = normKey(r.note);
      const k1 = nk ? `n:${r.category_id}:${nk}` : `a:${r.category_id}:${Math.round(r.amount)}`;
      if (!groups.has(k1)) groups.set(k1, []);
      groups.get(k1).push(r);
    }

    const rules = await db.all('SELECT category_id, amount FROM recurring');
    const out = [];
    for (const [key, list] of groups) {
      if (list.length < 3) continue;
      const dates = list.map(r => r.date).sort();
      const amounts = list.map(r => r.amount);
      const gaps = [];
      for (let i = 1; i < dates.length; i++) gaps.push(Math.round((parse(dates[i]) - parse(dates[i - 1])) / 86400000));
      const gap = median(gaps);
      const spread = Math.max(...gaps) - Math.min(...gaps);
      let frequency = null;
      if (gap >= 27 && gap <= 33) frequency = 'monthly';
      else if (gap >= 6 && gap <= 8) frequency = 'weekly';
      else if (gap >= 350 && gap <= 380) frequency = 'yearly';
      if (!frequency || spread > 5) continue;

      const amount = median(amounts);
      const cat = list[0].category_id;
      // skip if an active rule already covers this
      if (rules.some(r => r.category_id === cat && Math.abs(r.amount - amount) < 1)) continue;

      const last = dates[dates.length - 1];
      const next = new Date(parse(last).getTime() + gap * 86400000);
      const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      out.push({
        key: key.replace(/[^a-z0-9]+/g, '-').slice(0, 40),
        category_id: cat,
        note: list[list.length - 1].note || 'unnamed',
        amount: Math.round(amount * 100) / 100,
        frequency, gap,
        occurrences: list.length,
        last_date: last,
        next_date: nextStr,
      });
    }
    out.sort((a, b) => b.amount - a.amount);
    return out;
  }

  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ---------------- budget suggestions ---------------- */

  async function budgetSuggestions(month) {
    const { rows } = await loadWindow(month, 5);
    const perCat = {};
    for (const r of rows) {
      if (r.type !== 'expense') continue;
      const ym = r.date.slice(0, 7);
      if (ym === month) continue; // suggest from history, not current spend
      perCat[r.category_id] = perCat[r.category_id] || {};
      perCat[r.category_id][ym] = (perCat[r.category_id][ym] || 0) + r.amount;
    }
    const budgeted = new Set((await db.all('SELECT category_id FROM budgets')).map(b => b.category_id));
    const cats = await catMap();
    const out = [];
    for (const [catId, byYm] of Object.entries(perCat)) {
      if (budgeted.has(Number(catId))) continue;
      const months = Object.keys(byYm).length;
      if (months < 2) continue;
      const total = Object.values(byYm).reduce((a, b) => a + b, 0);
      const avg = total / 6; // per-month average across the 6-month window
      if (avg <= 0) continue;
      const cat = cats[catId];
      if (!cat) continue;
      const suggested = Math.max(100, Math.ceil(avg * 1.05 / 100) * 100);
      out.push({ category_id: cat.id, name: cat.name, icon: cat.icon, suggested, based_on: avg, months });
    }
    out.sort((a, b) => b.suggested - a.suggested);
    return out;
  }

  /* ---------------- weekday forecasting ---------------- */

  async function weekdayAverages(month) {
    const { rows } = await loadWindow(month, 3);
    const sums = Array(7).fill(0);
    const counts = Array(7).fill(0);
    for (const r of rows) {
      if (r.type !== 'expense') continue;
      const w = weekdayOf(r.date);
      sums[w] += r.amount;
      counts[w]++;
    }
    // single transactions (count 1) make averages noisy; require ≥ 2 data days
    return sums.map((s, i) => (counts[i] >= 2 ? s / counts[i] : (counts[i] === 1 ? s : 0)));
  }

  async function weekdayForecast(month) {
    if (month !== currentMonthKey()) return null;
    const avgs = await weekdayAverages(month);
    const { end } = monthRange(month);
    const today = todayStr();
    let projected = 0;
    let spentSoFar = 0;
    // spend so far this month
    const rows = await db.all(`SELECT amount FROM transactions WHERE type='expense' AND date >= ? AND date <= ?`,
      [month + '-01', today]);
    for (const r of rows) spentSoFar += r.amount;

    let d = parse(today);
    const last = parse(end);
    while (d < last) {
      d = new Date(d.getTime() + 86400000);
      projected += avgs[d.getDay()] || 0;
    }
    const total = spentSoFar + projected;
    return total > 0 ? Math.round(total * 100) / 100 : null;
  }

  /* ---------------- streaks ---------------- */

  async function streaks() {
    const first = (await db.get('SELECT MIN(date) AS d FROM transactions')).d;
    if (!first) return { current: 0, best: 0 };
    const today = parse(todayStr());
    const daily = new Set((await db.all(`SELECT date FROM transactions WHERE type='expense' AND amount > 0`)).map(r => r.date));

    // current: consecutive no-spend days ending today (today counts if nothing spent yet)
    let current = 0;
    let d = new Date(today);
    while (d >= parse(first)) {
      const ds = fmt(d);
      if (daily.has(ds)) break;
      current++;
      d = new Date(d.getTime() - 86400000);
    }

    // best: longest run in the last 90 days
    let best = 0, run = 0;
    const start = new Date(today.getTime() - 90 * 86400000);
    const from = parse(first) > start ? parse(first) : start;
    d = new Date(from);
    while (d <= today) {
      if (daily.has(fmt(d))) { run = 0; } else { run++; best = Math.max(best, run); }
      d = new Date(d.getTime() + 86400000);
    }
    return { current, best };
  }

  function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  /* ---------------- analytics aggregates ---------------- */

  async function analytics(month) {
    const { start, end, days } = monthRange(month);
    const rows = await db.all(`
      SELECT date, type, amount, category_id, note, method, tags FROM transactions
      WHERE date >= ? AND date <= ? ORDER BY date`, [start, end]);
    const cats = await catMap();

    const daily = {};                 // date → {expense, income}
    const merchants = {};             // normKey → {total, count, sample, icon}
    const methods = {};               // method → {total, count}
    const perCat = {};                // catId → total (expenses)
    let income = 0, expense = 0;

    for (const r of rows) {
      daily[r.date] = daily[r.date] || { expense: 0, income: 0 };
      daily[r.date][r.type] += r.amount;
      if (r.type === 'income') { income += r.amount; continue; }
      expense += r.amount;

      const m = r.method || 'cash';
      methods[m] = methods[m] || { total: 0, count: 0 };
      methods[m].total += r.amount; methods[m].count++;

      const nk = normKey(r.note);
      if (nk) {
        merchants[nk] = merchants[nk] || { total: 0, count: 0, sample: r.note, icon: (cats[r.category_id] || {}).icon || '📦' };
        merchants[nk].total += r.amount; merchants[nk].count++;
      }
      perCat[r.category_id] = (perCat[r.category_id] || 0) + r.amount;
    }

    // calendar cells for the month (Mon-first grid)
    const firstWeekday = (weekdayOf(start) + 6) % 7;
    const calendar = [];
    for (let i = 0; i < firstWeekday; i++) calendar.push(null);
    for (let i = 1; i <= days; i++) {
      const ds = `${month}-${String(i).padStart(2, '0')}`;
      calendar.push({ date: ds, day: i, expense: daily[ds] ? daily[ds].expense : 0 });
    }

    // 6-month category trend for top categories
    const trendStart = addMonthsKey(month, -5);
    const trendRows = await db.all(`
      SELECT date, amount, category_id FROM transactions
      WHERE type='expense' AND date >= ? AND date <= ?`, [trendStart + '-01', end]);
    const trendPerCat = {};
    for (const r of trendRows) {
      const ym = r.date.slice(0, 7);
      trendPerCat[r.category_id] = trendPerCat[r.category_id] || {};
      trendPerCat[r.category_id][ym] = (trendPerCat[r.category_id][ym] || 0) + r.amount;
    }
    const yms = [-5, -4, -3, -2, -1, 0].map(i => addMonthsKey(month, i));
    const trend = Object.entries(trendPerCat)
      .map(([catId, byYm]) => ({
        category: cats[catId] || { name: '?', icon: '📦', color: '#888' },
        values: yms.map(ym2 => Math.round(byYm[ym2] || 0)),
        total: yms.reduce((a, ym2) => a + (byYm[ym2] || 0), 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    return {
      month, income, expense,
      calendar,
      weekdayAverages: await weekdayAverages(month),
      weekdayTotals: (() => {
        const sums = Array(7).fill(0);
        for (const r of rows) if (r.type === 'expense') sums[weekdayOf(r.date)] += r.amount;
        return sums;
      })(),
      merchants: Object.entries(merchants)
        .map(([k, v]) => ({ ...v, key: k }))
        .sort((a, b) => b.total - a.total).slice(0, 10),
      methods: Object.entries(methods)
        .map(([m, v]) => ({ method: m, ...v }))
        .sort((a, b) => b.total - a.total),
      streaks: await streaks(),
      noSpendDays: days - Object.values(daily).filter(d => d.expense > 0).length,
      activeDays: Object.keys(daily).length,
      trend: { months: yms, rows: trend },
    };
  }

  return {
    suggest, insights, detectSubscriptions, budgetSuggestions,
    weekdayForecast, weekdayAverages, streaks, analytics,
    invalidatePatterns,
  };
};
