'use strict';

/* End-to-end API test.
   Usage:  npm test                       → temp server + all suites
           BASE=http://localhost:3000 node tests/api.test.js
           BASE=http://localhost:8787 node tests/api.test.js  → wrangler dev */

const BASE = process.env.BASE || 'http://localhost:3000';
let passed = 0, failed = 0;

function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  console.log('— health/bootstrap —');
  let r = await req('GET', '/api/bootstrap');
  ok('bootstrap returns settings+categories', r.status === 200 && r.data.categories.length >= 20 && r.data.settings.currency === 'INR');

  console.log('— sample data —');
  r = await req('POST', '/api/sample-data');
  ok('sample data loads', r.status === 200 || r.status === 409, JSON.stringify(r.data));
  if (r.status === 409) {
    // wipe and retry so the test is deterministic
    await req('DELETE', '/api/data?confirm=DELETE');
    r = await req('POST', '/api/sample-data');
    ok('sample data loads after wipe', r.status === 200, JSON.stringify(r.data));
  }

  console.log('— summary —');
  r = await req('GET', '/api/summary');
  ok('summary has monthTotals', r.status === 200 && typeof r.data.monthTotals.income === 'number');
  ok('summary has budgets', Array.isArray(r.data.budgets));
  ok('summary has trend', Array.isArray(r.data.trend) && r.data.trend.length >= 3);
  ok('summary has recent', Array.isArray(r.data.recent) && r.data.recent.length > 0);
  ok('summary has byCategory', Array.isArray(r.data.byCategory) && r.data.byCategory.length > 0);
  const monthIncome = r.data.monthTotals.income;

  console.log('— transactions CRUD —');
  const boot = await req('GET', '/api/bootstrap');
  const foodCat = boot.data.categories.find(c => c.name === 'Food & Dining');
  const salaryCat = boot.data.categories.find(c => c.name === 'Salary');

  r = await req('POST', '/api/transactions', { type: 'expense', amount: 123.45, category_id: foodCat.id, date: '2026-11-08', note: 'Test lunch', method: 'upi' });
  ok('create expense', r.status === 201 && Math.abs(r.data.amount - 123.45) < 0.001, JSON.stringify(r.data));
  const txId = r.data.id;

  r = await req('POST', '/api/transactions', { type: 'expense', amount: 5, category_id: salaryCat.id, date: '2026-11-08' });
  ok('category type mismatch rejected', r.status === 400);

  r = await req('POST', '/api/transactions', { type: 'income', amount: -3, category_id: foodCat.id, date: '2026-11-08' });
  ok('negative amount rejected', r.status === 400);

  r = await req('POST', '/api/transactions', { type: 'expense', amount: 10, category_id: foodCat.id, date: '2026-13-45' });
  ok('invalid date rejected', r.status === 400);

  r = await req('PUT', `/api/transactions/${txId}`, { amount: 200, note: 'updated' });
  ok('update transaction', r.status === 200 && r.data.amount === 200 && r.data.note === 'updated');

  r = await req('GET', '/api/transactions?q=updated&sort=amount_desc');
  ok('search + sort works', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].id === txId);

  r = await req('GET', '/api/transactions?type=income&from=2026-11-01&to=2026-11-30');
  ok('filter by type+range', r.status === 200 && r.data.rows.every(t => t.type === 'income'));

  r = await req('DELETE', `/api/transactions/${txId}`);
  ok('delete transaction', r.status === 200);
  r = await req('GET', `/api/transactions?limit=200`);
  ok('transaction gone', !r.data.rows.some(t => t.id === txId));

  console.log('— receipts —');
  // 1x1 transparent PNG
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  r = await req('POST', '/api/transactions', { type: 'expense', amount: 42, category_id: foodCat.id, date: '2026-11-10', note: 'Receipt test', method: 'upi' });
  const receiptTxId = r.data.id;
  ok('receipt fixture created', r.status === 201 && !!receiptTxId);

  r = await req('PUT', `/api/transactions/${receiptTxId}/receipt`, { mime: 'image/png', data: PNG });
  ok('upload receipt', r.status === 200 && r.data.has_receipt === true && r.data.size > 0, JSON.stringify(r.data));

  r = await req('GET', `/api/transactions/${receiptTxId}/receipt`);
  ok('fetch receipt', r.status === 200 && r.data.mime === 'image/png' && r.data.data === PNG);

  r = await req('GET', '/api/transactions?q=Receipt test');
  ok('transaction row flags receipt', r.data.rows.length === 1 && r.data.rows[0].has_receipt === 1, JSON.stringify(r.data.rows[0]));

  r = await req('PUT', `/api/transactions/${receiptTxId}/receipt`, { mime: 'text/plain', data: PNG });
  ok('bad receipt mime rejected', r.status === 400);
  r = await req('PUT', `/api/transactions/${receiptTxId}/receipt`, { mime: 'image/png', data: 'not base64!!!' });
  ok('bad receipt data rejected', r.status === 400);
  r = await req('PUT', '/api/transactions/999999/receipt', { mime: 'image/png', data: PNG });
  ok('receipt for missing transaction rejected', r.status === 404);

  const withReceipt = await (await fetch(BASE + '/api/export?format=json')).json();
  ok('backup includes receipts', Array.isArray(withReceipt.receipts) && withReceipt.receipts.some(x => x.transaction_id === receiptTxId));
  r = await req('POST', '/api/import', withReceipt);
  ok('backup with receipts restores', r.status === 200, JSON.stringify(r.data));
  r = await req('GET', `/api/transactions/${receiptTxId}/receipt`);
  ok('receipt data intact after restore', r.status === 200 && r.data.data === PNG);

  r = await req('DELETE', `/api/transactions/${receiptTxId}/receipt`);
  ok('delete receipt', r.status === 200 && r.data.has_receipt === false);
  r = await req('DELETE', `/api/transactions/${receiptTxId}/receipt`);
  ok('delete missing receipt 404', r.status === 404);
  r = await req('DELETE', `/api/transactions/${receiptTxId}`);
  ok('cleanup receipt transaction', r.status === 200);

  console.log('— categories CRUD —');
  r = await req('POST', '/api/categories', { name: 'Test Cat', type: 'expense', icon: '🧪', color: '#123456' });
  ok('create category', r.status === 201 && r.data.id > 0);
  const newCatId = r.data.id;
  r = await req('POST', '/api/categories', { name: 'Test Cat', type: 'expense', icon: 'x', color: '#123456' });
  ok('duplicate category rejected', r.status === 409);
  r = await req('PUT', `/api/categories/${newCatId}`, { name: 'Test Cat 2', color: '#ABCDEF' });
  ok('update category', r.status === 200 && r.data.name === 'Test Cat 2');
  r = await req('DELETE', `/api/categories/${newCatId}`);
  ok('delete unused category', r.status === 200);
  r = await req('DELETE', `/api/categories/${foodCat.id}`);
  ok('delete used category rejected', r.status === 409);

  console.log('— budgets —');
  r = await req('PUT', '/api/budgets', { category_id: foodCat.id, amount: 5000 });
  ok('set budget', r.status === 200);
  r = await req('GET', '/api/budgets');
  const bud = r.data.budgets.find(b => b.category_id === foodCat.id);
  ok('budget listed with spent', bud && bud.amount === 5000 && typeof bud.spent === 'number');
  r = await req('PUT', '/api/budgets', { category_id: salaryCat.id, amount: 500 });
  ok('income category budget rejected', r.status === 400);
  r = await req('DELETE', `/api/budgets/${bud.id}`);
  ok('delete budget', r.status === 200);

  console.log('— recurring —');
  r = await req('POST', '/api/recurring', { type: 'expense', amount: 100, category_id: foodCat.id, frequency: 'monthly', next_date: '2026-11-05', note: 'test rule', method: 'upi' });
  ok('create recurring rule', r.status === 201 && r.data.id > 0);
  const recId = r.data.id;
  // recurring auto-posting is disabled: reading the rule must not create a transaction
  r = await req('GET', '/api/recurring');
  ok('past-due rule is not auto-posted', r.data.some(x => x.id === recId && x.next_date === '2026-11-05'));
  const posted = await req('GET', '/api/transactions?q=test rule');
  ok('no recurring transaction is created', posted.data.rows.length === 0, JSON.stringify(posted.data.total));
  r = await req('PUT', `/api/recurring/${recId}`, { active: 0 });
  ok('pause rule', r.status === 200 && r.data.active === 0);
  r = await req('DELETE', `/api/recurring/${recId}`);
  ok('delete rule', r.status === 200);

  console.log('— settings —');
  r = await req('PUT', '/api/settings', { currency: 'USD', theme: 'dark' });
  ok('update settings', r.status === 200 && r.data.currency === 'USD');
  r = await req('PUT', '/api/settings', { currency: 'XXX' });
  ok('bad currency rejected', r.status === 400);
  await req('PUT', '/api/settings', { currency: 'INR', theme: 'system' });

  console.log('— export/import —');
  const csvRes = await fetch(BASE + '/api/export?format=csv');
  const csv = await csvRes.text();
  ok('CSV export has header + rows', csvRes.status === 200 && csv.includes('date,type,category') && csv.split('\n').length > 5);

  const jsonRes = await fetch(BASE + '/api/export?format=json');
  const backup = await jsonRes.json();
  ok('JSON backup complete', jsonRes.status === 200 && backup.categories.length > 0 && backup.transactions.length > 50);

  const txCountBefore = backup.transactions.length;
  const imported = await req('POST', '/api/import', backup);
  ok('import round-trip', imported.status === 200 && imported.data.transactions === txCountBefore);

  r = await req('POST', '/api/import', { foo: 'bar' });
  ok('invalid import rejected', r.status === 400);

  console.log('— tags —');
  r = await req('POST', '/api/transactions', { type: 'expense', amount: 300, category_id: foodCat.id, date: '2026-11-09', note: 'Tagged lunch', method: 'cash', tags: 'Work, Lunch , work,REIMBURSABLE' });
  ok('create tx with tags', r.status === 201 && r.data.tags === 'work,lunch,reimbursable', JSON.stringify(r.data.tags));
  const tagTxId = r.data.id;

  r = await req('GET', '/api/tags');
  ok('tags endpoint lists normalized tags', r.status === 200 && ['work', 'lunch', 'reimbursable'].every(t => r.data.includes(t)), JSON.stringify(r.data));

  r = await req('GET', '/api/transactions?tag=work');
  ok('filter by tag', r.status === 200 && r.data.rows.some(t => t.id === tagTxId) && r.data.rows.every(t => (t.tags || '').split(',').includes('work')));

  r = await req('GET', '/api/transactions?tag=nonexistent-tag');
  ok('unknown tag yields empty', r.status === 200 && r.data.rows.length === 0);

  r = await req('PUT', `/api/transactions/${tagTxId}`, { tags: 'solo' });
  ok('update tags', r.status === 200 && r.data.tags === 'solo');
  r = await req('DELETE', `/api/transactions/${tagTxId}`);
  ok('delete tagged tx', r.status === 200);

  console.log('— smart engine —');
  r = await req('POST', '/api/smart/suggest', { type: 'expense', note: 'swiggy order' });
  ok('suggest learns from history', r.status === 200 && r.data && r.data.category_id === foodCat.id && r.data.source === 'history', JSON.stringify(r.data));

  r = await req('POST', '/api/smart/suggest', { type: 'expense', note: 'pizza at dominos' });
  ok('suggest keyword fallback', r.status === 200 && r.data && r.data.source === 'keyword' && r.data.category_id === foodCat.id, JSON.stringify(r.data));

  r = await req('POST', '/api/smart/suggest', { type: 'expense', note: '' });
  ok('suggest empty note → null', r.status === 200 && r.data === null);

  r = await req('GET', '/api/smart/insights');
  ok('insights well-formed', r.status === 200 && Array.isArray(r.data.insights)
    && r.data.insights.every(i => ['warn', 'good', 'info'].includes(i.severity) && i.title && i.body && i.icon));
  ok('insight CTAs have payloads', r.data.insights.filter(i => i.cta).every(i => i.cta.kind && i.cta.payload));

  r = await req('GET', '/api/smart/subscriptions');
  ok('subscription detection runs', r.status === 200 && Array.isArray(r.data) && r.data.every(s => s.amount > 0 && s.frequency && s.next_date));

  r = await req('GET', '/api/smart/budget-suggestions');
  ok('budget suggestions run', r.status === 200 && Array.isArray(r.data) && r.data.every(s => s.suggested > 0 && s.category_id > 0));

  console.log('— analytics —');
  r = await req('GET', '/api/analytics');
  const a = r.data;
  ok('analytics structure', r.status === 200 && Array.isArray(a.calendar) && a.calendar.length >= 28
    && Array.isArray(a.merchants) && Array.isArray(a.methods) && a.streaks && typeof a.streaks.current === 'number'
    && a.trend && Array.isArray(a.trend.rows) && a.trend.months.length === 6);
  ok('analytics calendar aligns weekday', new Date(a.calendar.find(c => c).date).getDay() !== null
    && a.calendar.filter(Boolean).length >= 28);
  ok('weekday averages are 7-slot', Array.isArray(a.weekdayAverages) && a.weekdayAverages.length === 7);

  console.log('— month-over-month compare —');
  r = await req('GET', '/api/smart/compare?month=2026-11');
  ok('compare structure', r.status === 200 && r.data.month === '2026-11' && r.data.previous === '2026-10'
    && typeof r.data.expense.current === 'number' && typeof r.data.previousTotals.expense === 'number'
    && Array.isArray(r.data.categories), JSON.stringify(r.data).slice(0, 160));
  ok('compare has diff + savings rate', typeof r.data.expense.diff === 'number'
    && r.data.net && typeof r.data.net.current === 'number'
    && r.data.savingsRate && 'current' in r.data.savingsRate && 'previous' in r.data.savingsRate);
  r = await req('GET', '/api/smart/compare?month=not-a-month');
  ok('compare falls back to current month', r.status === 200 && /^\d{4}-\d{2}$/.test(r.data.month), r.data.month);

  console.log('— AI layer (unconfigured) —');
  r = await req('GET', '/api/ai/status');
  ok('ai status defaults', r.status === 200 && r.data.configured === false && r.data.provider === 'none'
    && r.data.providers.length === 4 && r.data.providers.some(p => p.id === 'groq' && p.keyUrl));

  r = await req('POST', '/api/ai/ask', { question: 'how much did I spend?' });
  ok('ask without key → friendly 502', r.status === 502 && /configured/i.test(r.data.error));

  r = await req('POST', '/api/ai/parse', { text: 'spent 250 on lunch' });
  ok('parse without key → friendly 502', r.status === 502 && /configured/i.test(r.data.error));

  r = await req('POST', '/api/ai/ask', {});
  ok('ask empty question rejected', r.status === 400);

  r = await req('PUT', '/api/settings', { ai_provider: 'openai' });
  ok('unknown AI provider rejected', r.status === 400);

  r = await req('PUT', '/api/settings', { ai_provider: 'groq' });
  ok('AI provider saved', r.status === 200 && r.data.ai_provider === 'groq');
  r = await req('GET', '/api/ai/status');
  ok('status shows unconfigured without key', r.data.provider === 'groq' && r.data.configured === false);
  await req('PUT', '/api/settings', { ai_provider: 'none' });

  console.log('— insights use active currency symbol —');
  await req('PUT', '/api/settings', { currency: 'USD' });
  r = await req('GET', '/api/smart/insights');
  const texts = r.data.insights.map(i => i.title + ' ' + i.body).join(' ');
  ok('insight text uses $ for USD', texts.includes('$') && !texts.includes('₹'), texts.slice(0, 120));
  await req('PUT', '/api/settings', { currency: 'INR' });

  console.log('— validation of summary consistency —');
  r = await req('GET', '/api/summary');
  ok('month income consistent after import', Math.abs(r.data.monthTotals.income - monthIncome) < 0.01,
     `before=${monthIncome} after=${r.data.monthTotals.income}`);

  console.log('— accounts —');
  r = await req('GET', '/api/accounts');
  ok('accounts list with balances', r.status === 200 && Array.isArray(r.data.accounts) && r.data.accounts.length >= 2
    && r.data.accounts.every(a => typeof a.balance === 'number')
    && typeof r.data.totalBalance === 'number' && typeof r.data.assets === 'number' && typeof r.data.liabilities === 'number',
    JSON.stringify(r.data).slice(0, 200));
  ok('account types exposed', Array.isArray(r.data.accountTypes) && r.data.accountTypes.some(t => t.id === 'credit_card'));

  const bankAcc = r.data.accounts.find(a => a.type === 'bank');
  const cashAcc = r.data.accounts.find(a => a.type === 'cash');
  ok('seeded bank + cash accounts', !!bankAcc && !!cashAcc);

  r = await req('POST', '/api/accounts', { name: 'Test Wallet', type: 'wallet', opening_balance: 500, icon: '👛', color: '#FDCB6E' });
  ok('create account', r.status === 201 && r.data.name === 'Test Wallet' && r.data.opening_balance === 500, JSON.stringify(r.data));
  const walletId = r.data.id;

  r = await req('POST', '/api/accounts', { name: '', type: 'bank' });
  ok('empty account name rejected', r.status === 400);
  r = await req('POST', '/api/accounts', { name: 'Bad', type: 'nope' });
  ok('bad account type rejected', r.status === 400);
  r = await req('POST', '/api/accounts', { name: 'Bad', type: 'bank', opening_balance: 'abc' });
  ok('bad opening balance rejected', r.status === 400);

  r = await req('PUT', `/api/accounts/${walletId}`, { opening_balance: 750, archived: true });
  ok('update + archive account', r.status === 200 && r.data.opening_balance === 750 && r.data.archived === 1);

  r = await req('GET', '/api/accounts');
  const walletAfter = r.data.accounts.find(a => a.id === walletId);
  ok('archived account keeps balance', walletAfter && walletAfter.balance === 750 && walletAfter.archived === 1);
  const totalBefore = r.data.totalBalance;

  console.log('— account-linked transactions —');
  r = await req('POST', '/api/transactions', { type: 'expense', amount: 50, category_id: foodCat.id, date: '2026-11-07', note: 'Account test', account_id: bankAcc.id });
  ok('tx inherits method from account', r.status === 201 && r.data.method === 'netbanking' && r.data.account_name === bankAcc.name, JSON.stringify(r.data));
  const accTxId = r.data.id;

  r = await req('POST', '/api/transactions', { type: 'expense', amount: 20, category_id: foodCat.id, date: '2026-11-07', note: 'Cash test', account_id: cashAcc.id });
  ok('cash account → cash method', r.status === 201 && r.data.method === 'cash');

  r = await req('POST', '/api/transactions', { type: 'expense', amount: 20, category_id: foodCat.id, date: '2026-11-07', account_id: 999999 });
  ok('unknown account rejected', r.status === 400);

  r = await req('GET', `/api/transactions?account=${bankAcc.id}`);
  ok('filter transactions by account', r.status === 200 && r.data.rows.every(t => t.account_id === bankAcc.id)
    && r.data.rows.some(t => t.id === accTxId));

  r = await req('GET', '/api/accounts');
  const bankAfter = r.data.accounts.find(a => a.id === bankAcc.id);
  ok('account balance reflects transaction', bankAfter && Math.abs(bankAfter.balance - (bankAcc.balance - 50)) < 0.01,
    `${bankAcc.balance} → ${bankAfter && bankAfter.balance}`);
  ok('total balance unchanged by archived opening', Math.abs(r.data.totalBalance - (totalBefore - 50 - 20)) < 0.01,
    `${totalBefore} → ${r.data.totalBalance}`);

  console.log('— transfers —');
  const bankBalBefore = (await req('GET', '/api/accounts')).data.accounts.find(a => a.id === bankAcc.id).balance;
  const cashBalBefore = (await req('GET', '/api/accounts')).data.accounts.find(a => a.id === cashAcc.id).balance;
  const sumsBefore = (await req('GET', '/api/summary')).data.allTime;
  r = await req('POST', '/api/transfers', { from_account_id: bankAcc.id, to_account_id: cashAcc.id, amount: 500, date: '2026-11-07', note: 'ATM' });
  ok('create transfer', r.status === 201 && r.data.amount === 500 && r.data.from_name === bankAcc.name, JSON.stringify(r.data));
  const transferId = r.data.id;

  r = await req('POST', '/api/transfers', { from_account_id: bankAcc.id, to_account_id: bankAcc.id, amount: 10, date: '2026-11-07' });
  ok('same-account transfer rejected', r.status === 400);
  r = await req('POST', '/api/transfers', { from_account_id: bankAcc.id, to_account_id: cashAcc.id, amount: -5, date: '2026-11-07' });
  ok('negative transfer rejected', r.status === 400);
  r = await req('POST', '/api/transfers', { from_account_id: bankAcc.id, to_account_id: 999999, amount: 5, date: '2026-11-07' });
  ok('transfer to unknown account rejected', r.status === 400);

  r = await req('GET', '/api/accounts');
  const bankT = r.data.accounts.find(a => a.id === bankAcc.id).balance;
  const cashT = r.data.accounts.find(a => a.id === cashAcc.id).balance;
  ok('transfer moves money between accounts', Math.abs(bankT - (bankBalBefore - 500)) < 0.01 && Math.abs(cashT - (cashBalBefore + 500)) < 0.01,
    `bank ${bankBalBefore}→${bankT}, cash ${cashBalBefore}→${cashT}`);

  r = await req('GET', '/api/transfers');
  ok('transfers listed', r.status === 200 && r.data.some(t => t.id === transferId));

  r = await req('GET', '/api/summary');
  ok('summary includes account totals', typeof r.data.totalBalance === 'number' && Array.isArray(r.data.accounts)
    && typeof r.data.unassigned === 'object' && r.data.unassigned.count >= 0);
  ok('transfers do not count as income/expense',
    Math.abs(r.data.allTime.income - sumsBefore.income) < 0.01 && Math.abs(r.data.allTime.expense - sumsBefore.expense) < 0.01,
    `income ${sumsBefore.income}→${r.data.allTime.income}, expense ${sumsBefore.expense}→${r.data.allTime.expense}`);

  r = await req('DELETE', `/api/transfers/${transferId}`);
  ok('delete transfer', r.status === 200);
  r = await req('GET', '/api/accounts');
  ok('balances restored after transfer delete',
    Math.abs(r.data.accounts.find(a => a.id === bankAcc.id).balance - bankBalBefore) < 0.01);

  console.log('— CSV import —');
  const csvText = 'Date,Narration,Debit,Credit\n'
    + '01/11/2026,Salary credit,,50000\n'
    + '02/11/2026,Grocery store,1200,\n'
    + '02/11/2026,Grocery store,1200,\n'
    + '03/11/2026,Coffee shop,150,\n';
  r = await req('POST', '/api/import/csv/preview', { csv: csvText });
  ok('csv preview returns headers', r.status === 200 && r.data.headers.join('|') === 'Date|Narration|Debit|Credit' && r.data.total === 4, JSON.stringify(r.data));
  ok('csv preview includes sample rows', Array.isArray(r.data.preview) && r.data.preview.length === 4);

  r = await req('POST', '/api/import/csv/preview', { csv: '' });
  ok('empty csv rejected', r.status === 400);

  r = await req('POST', '/api/import/csv', {
    csv: csvText,
    mapping: { date: 'Date', description: 'Narration', debit: 'Debit', credit: 'Credit' },
    account_id: bankAcc.id, tags: 'imported',
  });
  ok('csv import inserts rows', r.status === 200 && r.data.inserted === 3 && r.data.skipped === 1 && r.data.failed === 0, JSON.stringify(r.data));

  r = await req('POST', '/api/import/csv', {
    csv: csvText,
    mapping: { date: 'Date', description: 'Narration', debit: 'Debit', credit: 'Credit' },
    account_id: bankAcc.id,
  });
  ok('csv import skips existing duplicates', r.status === 200 && r.data.inserted === 0 && r.data.skipped === 4, JSON.stringify(r.data));

  r = await req('POST', '/api/import/csv', { csv: csvText, mapping: { description: 'Narration' }, account_id: bankAcc.id });
  ok('csv import requires date mapping', r.status === 400);
  r = await req('POST', '/api/import/csv', { csv: csvText, mapping: { date: 'Date' }, account_id: bankAcc.id });
  ok('csv import requires amount mapping', r.status === 400);

  r = await req('GET', `/api/transactions?account=${bankAcc.id}&tag=imported`);
  ok('imported rows tagged + assigned', r.status === 200 && r.data.rows.length === 3 && r.data.rows.every(t => t.account_id === bankAcc.id));

  // single amount column with negative = expense
  const csv2 = 'When,Details,Amount\n2026-11-04,Refund,250.50\n2026-11-05,Bus fare,-40\n';
  r = await req('POST', '/api/import/csv', {
    csv: csv2,
    mapping: { date: 'When', description: 'Details', amount: 'Amount' },
    account_id: cashAcc.id, default_type: 'income', skip_duplicates: false,
  });
  ok('csv single amount column + sign', r.status === 200 && r.data.inserted === 2, JSON.stringify(r.data));
  r = await req('GET', '/api/transactions?account=' + cashAcc.id + '&q=Bus fare');
  ok('negative csv amount becomes expense', r.data.rows.length === 1 && r.data.rows[0].type === 'expense' && Math.abs(r.data.rows[0].amount - 40) < 0.01, JSON.stringify(r.data.rows[0]));

  console.log('— account safety —');
  r = await req('DELETE', `/api/accounts/${bankAcc.id}`);
  ok('delete in-use account rejected', r.status === 409, JSON.stringify(r.data));
  r = await req('DELETE', `/api/accounts/${walletId}`);
  ok('delete unused account', r.status === 200);

  console.log('— backup v2 —');
  const backup2 = (await fetch(BASE + '/api/export?format=json')).json();
  const b2 = await backup2;
  ok('backup v2 has accounts + transfers', b2.version === 2 && Array.isArray(b2.accounts) && Array.isArray(b2.transfers), `v=${b2.version}`);
  r = await req('POST', '/api/import', b2);
  ok('v2 backup round-trip', r.status === 200 && r.data.transactions === b2.transactions.length, JSON.stringify(r.data));
  r = await req('GET', '/api/accounts');
  ok('accounts survive backup restore', r.data.accounts.some(a => a.id === bankAcc.id));

  // v1 backup (no accounts) still accepted
  const v1 = { ...b2, version: 1 };
  delete v1.accounts; delete v1.transfers;
  v1.transactions = v1.transactions.map(t => ({ ...t, account_id: null }));
  r = await req('POST', '/api/import', v1);
  ok('v1 backup still imports', r.status === 200 && r.data.transactions === v1.transactions.length, JSON.stringify(r.data));

  console.log('— cleanup tools —');
  const dupeBody = { type: 'expense', amount: 77.77, category_id: foodCat.id, date: '2026-11-12', note: 'Cleanup dupe', account_id: cashAcc.id };
  const d1 = await req('POST', '/api/transactions', dupeBody);
  const d2 = await req('POST', '/api/transactions', dupeBody);
  ok('duplicate fixtures created', d1.status === 201 && d2.status === 201);

  r = await req('GET', '/api/cleanup/scan');
  ok('cleanup scan previews duplicates', r.status === 200
    && r.data.duplicates.group_count >= 1 && r.data.duplicates.delete_count >= 1
    && Array.isArray(r.data.duplicates.groups)
    && r.data.duplicates.groups.some(g => g.ids.includes(d1.data.id) && g.ids.includes(d2.data.id)),
    JSON.stringify(r.data.duplicates).slice(0, 200));
  ok('cleanup scan has every preview group',
    ['duplicates', 'missing_account', 'recategorize', 'legacy', 'orphan_receipts', 'totals'].every(k => k in r.data));
  ok('cleanup scan totals match preview', r.data.totals.duplicate_rows === r.data.duplicates.delete_count
    && r.data.totals.missing_account === r.data.missing_account.count
    && r.data.totals.orphan_receipts === r.data.orphan_receipts.count);

  r = await req('POST', '/api/cleanup/apply', { delete_duplicates: true });
  ok('cleanup deletes duplicates', r.status === 200 && r.data.applied.duplicates_deleted >= 1, JSON.stringify(r.data));
  r = await req('GET', '/api/transactions?q=Cleanup dupe');
  ok('one duplicate kept (oldest)', r.data.rows.length === 1 && r.data.rows[0].id === d1.data.id, JSON.stringify(r.data.rows.map(x => x.id)));

  r = await req('POST', '/api/transactions', { type: 'expense', amount: 11, category_id: foodCat.id, date: '2026-11-12', note: 'Cleanup no account' });
  const noAccId = r.data.id;
  r = await req('GET', '/api/cleanup/scan');
  ok('scan counts missing accounts', r.data.missing_account.count >= 1 && r.data.missing_account.rows.some(x => x.id === noAccId));
  r = await req('POST', '/api/cleanup/apply', { assign_missing_account: cashAcc.id });
  ok('cleanup assigns missing account', r.status === 200 && r.data.applied.accounts_assigned >= 1, JSON.stringify(r.data));
  r = await req('GET', '/api/transactions?q=Cleanup no account');
  ok('missing account fixed', r.data.rows[0].account_id === cashAcc.id && r.data.rows[0].method === 'cash');
  r = await req('POST', '/api/cleanup/apply', { assign_missing_account: 999999 });
  ok('cleanup rejects unknown account', r.status === 400);

  await req('PUT', '/api/budgets', { category_id: foodCat.id, amount: 1000 });
  r = await req('GET', '/api/cleanup/scan');
  ok('scan sees legacy budgets', r.data.legacy.budgets >= 1 && r.data.totals.legacy >= 1, JSON.stringify(r.data.legacy));
  r = await req('POST', '/api/cleanup/apply', { delete_legacy: true });
  ok('cleanup deletes legacy data', r.status === 200 && r.data.applied.legacy_deleted >= 1, JSON.stringify(r.data));
  r = await req('GET', '/api/cleanup/scan');
  ok('legacy data gone after apply', r.data.legacy.budgets === 0 && r.data.legacy.recurring === 0);

  r = await req('POST', '/api/cleanup/apply', {});
  ok('cleanup no-op is safe', r.status === 200 && r.data.ok === true);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('TEST RUNNER ERROR:', err); process.exit(1); });
