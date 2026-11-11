'use strict';

/**
 * AI layer — connects the app to an LLM via bring-your-own-key.
 *
 * Works with free-tier providers (all OpenAI-compatible):
 *  - Groq        (console.groq.com — generous free tier)
 *  - Google Gemini (aistudio.google.com — free tier)
 *  - OpenRouter  (openrouter.ai — :free models)
 *  - Custom      (any OpenAI-compatible endpoint, incl. local Ollama)
 *
 * The key is stored server-side; the browser never sees it. All calls are
 * proxied through this module.
 */

module.exports = function createAI(ctx) {
  const { db, getSetting, setSetting, todayStr } = ctx;

  const PROVIDERS = {
    groq: {
      label: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      defaultModel: 'llama-3.3-70b-versatile',
      keyUrl: 'https://console.groq.com/keys',
      note: 'Fast + genuinely free tier (no card). Recommended.',
    },
    gemini: {
      label: 'Google Gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      defaultModel: 'gemini-2.0-flash',
      keyUrl: 'https://aistudio.google.com/apikey',
      note: 'Free tier from Google AI Studio.',
    },
    openrouter: {
      label: 'OpenRouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
      keyUrl: 'https://openrouter.ai/keys',
      note: 'Many models with a ":free" suffix.',
    },
    custom: {
      label: 'Custom (OpenAI-compatible)',
      url: '',
      defaultModel: '',
      keyUrl: '',
      note: 'Any OpenAI-compatible endpoint — including local Ollama (http://localhost:11434/v1).',
    },
  };

  function config() {
    const provider = getSetting('ai_provider', 'none');
    if (provider === 'none' || !PROVIDERS[provider]) return null;
    const key = getSetting('ai_key', '');
    if (!key) return null;
    const model = getSetting('ai_model', '') || PROVIDERS[provider].defaultModel;
    const baseUrl = provider === 'custom' ? getSetting('ai_base_url', '') : PROVIDERS[provider].url;
    if (!baseUrl || !model) return null;
    return { provider, key, model, baseUrl };
  }

  function status() {
    const provider = getSetting('ai_provider', 'none');
    const c = config();
    return {
      configured: !!c,
      provider,
      providerLabel: PROVIDERS[provider] ? PROVIDERS[provider].label : 'None',
      model: c ? c.model : (getSetting('ai_model', '') || (PROVIDERS[provider] ? PROVIDERS[provider].defaultModel : '')),
      providers: Object.entries(PROVIDERS).map(([id, p]) => ({
        id, label: p.label, defaultModel: p.defaultModel, keyUrl: p.keyUrl, note: p.note,
      })),
    };
  }

  /* ---------------- provider call ---------------- */

  async function chatComplete(messages, { json = false, maxTokens = 800, temperature = 0.3 } = {}) {
    const c = config();
    if (!c) throw new Error('AI is not configured — add a provider and API key in Settings.');

    const body = {
      model: c.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (json) body.response_format = { type: 'json_object' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    let res;
    try {
      res = await fetch(c.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + c.key,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(err.name === 'AbortError' ? 'AI request timed out' : 'Could not reach the AI provider');
    }
    clearTimeout(timer);

    let data = null;
    try { data = await res.json(); } catch { /* non-json error */ }

    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error.type)) || '';
      if (/response_format/i.test(String(msg))) {
        // provider doesn't support JSON mode — retry without it
        delete body.response_format;
        return chatCompletePlain(c, body);
      }
      if (res.status === 401 || res.status === 403) throw new Error('AI provider rejected the API key — check it in Settings.');
      if (res.status === 429) throw new Error('AI rate limit hit — try again in a moment.');
      throw new Error('AI provider error: ' + (msg || res.status));
    }

    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : null;
    if (!content) throw new Error('AI returned an empty response');
    return content;
  }

  async function chatCompletePlain(c, body) {
    const res = await fetch(c.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error('AI provider error: ' + res.status);
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : null;
    if (!content) throw new Error('AI returned an empty response');
    return content;
  }

  /* ---------------- data digest ---------------- */

  function buildDigest(month) {
    const settingsCurrency = getSetting('currency', 'INR');
    const { start, end } = ctx.monthRange(month);
    const histStart = ctx.addMonthsKey(month, -5) + '-01';

    const monthTotals = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
      FROM transactions WHERE date >= ? AND date <= ?`).get(start, end);

    const trend = db.prepare(`
      SELECT substr(date,1,7) AS ym,
             COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
      FROM transactions WHERE date >= ? GROUP BY ym ORDER BY ym`).all(histStart);

    const byCategory = db.prepare(`
      SELECT c.name, SUM(t.amount) AS total, COUNT(*) AS n
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.type='expense' AND t.date >= ? AND t.date <= ?
      GROUP BY c.name ORDER BY total DESC LIMIT 10`).all(start, end);

    const budgets = db.prepare(`
      SELECT c.name, b.amount,
             COALESCE((SELECT SUM(t.amount) FROM transactions t
                       WHERE t.category_id=b.category_id AND t.type='expense'
                         AND t.date >= ? AND t.date <= ?),0) AS spent
      FROM budgets b JOIN categories c ON c.id = b.category_id ORDER BY c.name`).all(start, end);

    const recent = db.prepare(`
      SELECT t.date, t.type, t.amount, c.name AS category, t.note, t.method
      FROM transactions t JOIN categories c ON c.id = t.category_id
      ORDER BY t.date DESC, t.id DESC LIMIT 25`).all();

    const topMerchants = db.prepare(`
      SELECT note, SUM(amount) AS total, COUNT(*) AS n
      FROM transactions WHERE type='expense' AND date >= ? AND date <= ?
      GROUP BY note ORDER BY total DESC LIMIT 8`).all(start, end);

    const txCount = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;

    return {
      currency: settingsCurrency,
      months_of_history: trend.length,
      viewing_month: month,
      month_totals: { income: round2(monthTotals.income), expense: round2(monthTotals.expense) },
      last6months: trend.map(t => ({ month: t.ym, income: round2(t.income), expenses: round2(t.expense) })),
      this_month_top_categories: byCategory.map(c => ({ name: c.name, spent: round2(c.total), transactions: c.n })),
      budgets: budgets.map(b => ({ name: b.name, limit: b.amount, spent: round2(b.spent) })),
      this_month_top_merchants_notes: topMerchants.map(m => ({ note: m.note, total: round2(m.total), times: m.n })),
      recent_transactions: recent.map(r => ({ date: r.date, type: r.type, amount: r.amount, category: r.category, note: r.note, method: r.method })),
      total_transactions: txCount,
    };
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /* ---------------- ask (chat with your data) ---------------- */

  async function ask(question, month) {
    const digest = buildDigest(month || todayStr().slice(0, 7));
    const system = `You are a concise personal finance assistant inside a self-hosted expense tracker.
You are given the user's real financial data as JSON. Answer their question using ONLY this data.
Rules:
- Be brief: 1-4 sentences, plain language, no markdown tables.
- Format amounts with the currency from the data.
- Show a small calculation when useful (e.g. "₹4,200 of ₹6,000 — 70%").
- If the data can't answer it, say so and suggest what to record.
- Never invent numbers. Today's date is ${todayStr()}. The user is viewing the month ${digest.viewing_month}.
DATA:
${JSON.stringify(digest)}`;

    const answer = await chatComplete([
      { role: 'system', content: system },
      { role: 'user', content: String(question).slice(0, 500) },
    ], { temperature: 0.4, maxTokens: 600 });

    return { answer: answer.trim() };
  }

  /* ---------------- parse (natural language → transaction) ---------------- */

  async function parse(text) {
    const cats = db.prepare('SELECT name, type FROM categories ORDER BY type, name').all();
    const categoryList = cats.map(c => c.name).join('", "');
    const system = `You convert natural language into a personal finance transaction.
Today's date is ${todayStr()}. The user's currency is ${getSetting('currency', 'INR')}.
Valid expense categories: choose from ["${cats.filter(c => c.type === 'expense').map(c => c.name).join('", "')}", ...]
Valid income categories: choose from ["${cats.filter(c => c.type === 'income').map(c => c.name).join('", "')}", ...]
Payment methods: Cash, UPI, Card, Net Banking, Wallet, Other.

Rules:
- Amounts are in the user's currency; strip currency words/symbols.
- Relative dates ("yesterday", "last friday") become YYYY-MM-DD dates.
- If no date is mentioned, use null.
- note: short (max 60 chars), lowercase-ish, human; keep merchant/place if given.
- category: pick the closest match by meaning. If truly nothing fits, use "Others" (expense) or "Other Income" (income).
- method: only set if clearly implied (e.g. "paid by UPI", "on card"); otherwise null.

Respond with ONLY this JSON object:
{"type":"expense"|"income","amount":number,"date":"YYYY-MM-DD"|null,"note":"...","merchant":"..."|null,"category":"exact category name","method":"method name"|null}
If the text is not describing a transaction, respond: {"error":"not a transaction"}`;

    const raw = await chatComplete([
      { role: 'system', content: system },
      { role: 'user', content: String(text).slice(0, 300) },
    ], { json: true, temperature: 0, maxTokens: 300 });

    let parsed;
    try {
      const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return { error: 'Could not understand that as a transaction — try something like "spent 250 on lunch yesterday".' };
    }
    if (parsed.error) return { error: 'That does not look like a transaction — try "spent 250 on lunch" or "got 5000 salary".' };

    // validate & map to ids
    const type = parsed.type === 'income' ? 'income' : 'expense';
    const amount = Number(parsed.amount);
    if (!isFinite(amount) || amount <= 0) return { error: 'Could not find a valid amount in that text.' };

    const catRow = db.prepare('SELECT id, name, type FROM categories WHERE lower(name) = ? AND type = ?')
      .get(String(parsed.category || '').toLowerCase(), type);
    let category_id = catRow ? catRow.id : null;
    let category_name = catRow ? catRow.name : null;
    if (!category_id) {
      const fallback = db.prepare('SELECT id, name FROM categories WHERE type = ? AND (name = ? OR is_default = 1)').get(type, type === 'expense' ? 'Others' : 'Other Income');
      category_id = fallback.id; category_name = fallback.name;
    }

    const METHODS = ['cash', 'upi', 'card', 'netbanking', 'wallet', 'other'];
    const methodMap = { cash: 'cash', upi: 'upi', card: 'card', 'net banking': 'netbanking', netbanking: 'netbanking', wallet: 'wallet', other: 'other' };
    let method = null;
    if (parsed.method) method = methodMap[String(parsed.method).toLowerCase().trim()] || null;

    let date = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;

    let note = String(parsed.note || parsed.merchant || '').trim().slice(0, 100);

    return {
      type, amount: Math.round(amount * 100) / 100, category_id, category_name,
      method, date, note: note || category_name,
    };
  }

  /* ---------------- test ---------------- */

  async function test() {
    const t0 = Date.now();
    const reply = await chatComplete([
      { role: 'user', content: 'Reply with exactly: OK' },
    ], { temperature: 0, maxTokens: 10 });
    return { ok: true, ms: Date.now() - t0, model: config().model, reply: reply.trim().slice(0, 40) };
  }

  return { status, ask, parse, test, PROVIDERS };
};
