# 💸 Expense Tracker

A full-stack personal expense tracker — add income and expenses, manage
accounts and transfers, and see where your money goes with charts. Works on
desktop and Android/iOS phones (installable as an app).

Includes a **local Smart Engine** (offline intelligence: auto-categorization,
insights, subscription detection and weekday-aware forecasts) and an optional
**AI assistant** — chat with your data and add transactions by typing plain
English, using a free-tier LLM key of your choice.

Runs on **Node.js (Hono + SQLite)** for local/LAN use and on **Cloudflare
Workers + D1** when deployed — the same shared codebase (`app.js`) serves
both runtimes. The front end is a fast, dependency-free web app.

---

## Quick start

Requires [Node.js 22.5+](https://nodejs.org) (uses the built-in SQLite module —
no native compilation or external database needed).

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

The database is created automatically at `data/expenses.db`.

> To develop against Cloudflare's actual runtime instead: `npm run dev:cf`
> (workerd + simulated D1 on port 8787). See **Deployment** below for the
> free Cloudflare hosting setup.

### Use it on your phone (Android/iOS)

**Option A — same Wi-Fi (local network)**

1. Make sure the phone and the computer are on the **same Wi-Fi**.
2. Find your computer's IP — it's printed in the terminal when the server
   starts (e.g. `http://192.168.1.20:3000`).
3. Open that address in the phone's browser.
4. Use the browser menu → **"Add to Home screen" / "Install app"** to get an
   icon in your app drawer that opens full-screen like a native app (PWA).

If the page won't load on the phone even on the same Wi-Fi, check:

- **VPN / Private DNS on the phone** — Android's "Private DNS" (Settings →
  Network) or any VPN app can block local addresses. Turn them off and retry.
- **Router "AP/client isolation"** — some routers block devices from talking
  to each other. Check the router admin page.
- **Firewall on the PC** — Windows usually asks to allow Node the first time;
  allow it for private networks.

**Option B — Cloudflare tunnel (works anywhere, even on mobile data)**

```bash
npm run tunnel
```

This prints a public `https://…trycloudflare.com` URL that routes to your
server through Cloudflare. Open it on your phone — HTTPS also enables full
PWA install. The URL is temporary and changes each time you start the
tunnel; re-run `npm run tunnel` to get a fresh one.

---

## Features

**Transactions**
- Add income and expenses with amount, category, date, **account**, note
  and **tags**
- 20 default categories (food, rent, transport, salary, freelance…) — fully
  customizable with your own names, emoji icons and colors
- Every transaction belongs to an **account**; the old payment method is
  derived from the account type (bank → net banking, card → card, cash → cash,
  UPI → UPI…) so method analytics keep working
- Search, filter (type/category/**account**/date range/**tag**), and sort
  (date/amount)
- Infinite scroll with date grouping and per-day totals
- **Bulk actions** — switch to Select mode, then delete, recategorize or
  add/remove tags on many transactions at once; deletes (single or bulk) show
  an **Undo** toast

**Accounts & net worth**
- Multiple accounts: **cash, bank, credit card, wallet, UPI, investment,
  other** — create as many as you like (HDFC Savings, SBI Card, Paytm…)
- **Opening balance** per account — the amount you had before you started
  tracking. Negative values are allowed (credit-card dues, overdrafts)
- Live balance per account = opening balance + income − expenses + transfers in
  − transfers out
- **Transfers** between accounts (bank → cash ATM withdrawal, paying a credit
  card) that never pollute income/expense stats
- Accounts page with total balance, **assets**, **liabilities** and
  **net worth**; archive accounts instead of deleting so history is kept
- Transactions created before accounts existed show up as *unassigned* and are
  counted in the total until you assign them
- Dashboard snapshot card shows your top accounts + net worth at a glance

**CSV bank statement import**
- Upload a CSV exported from your bank, then map columns in the UI — date,
  description, amount, or separate debit/credit columns, an optional type
  column and category column
- Handles `DD/MM/YYYY`, `YYYY-MM-DD` and written dates, thousands separators,
  parenthesised negatives and quoted fields; comma, semicolon and tab
  delimiters are auto-detected
- Rows are auto-categorized by the Smart Engine, assigned to the account you
  pick and optionally tagged
- **Duplicate detection** skips rows already in the app (and repeats inside the
  file), so re-importing an overlapping statement is safe
- Preview before importing; per-row errors are reported, max 5,000 rows / 5 MB

**Smart Engine** (offline, no API keys, always free)
- **Auto-categorization** while you type — learns from your history
  ("swiggy order" → Food & Dining) and falls back to built-in keyword
  knowledge for first-time notes
- **Insights feed** on the dashboard: category anomalies ("Shopping is ₹2,400
  above your 3-month average"), savings-rate changes, weekend patterns and
  streaks
- **Subscription detection** — finds near-regular charges (Netflix, rent,
  utilities) and flags them for review
- **Weekday-aware forecast** — projects month-end spend from how you actually
  spend on each weekday, not a flat daily average

**Analytics** (new page)
- Calendar heatmap of daily spend (GitHub-style)
- Weekday spending habits (weekends highlighted)
- Top-merchants leaderboard with visit counts
- Payment-method breakdown
- No-spend streak + best streak, active days
- 6-month per-category trend grid

**AI assistant** (optional, bring-your-own-key — see below)
- **Ask** — chat with your real data: "how much did I spend on food this
  month vs last?", "am I saving more than last month?"
- **Quick add** — type "spent 250 on lunch yesterday by UPI" and the
  transaction form is prefilled (category, amount, date, method)
- Works with free-tier providers: Groq, Google Gemini, OpenRouter, or any
  OpenAI-compatible endpoint (including local Ollama)
- Your API key is stored **server-side only** — the browser never sees it

**Dashboard**
- Balance, monthly income & expenses with month-over-month change
- Savings rate
- Expenses-by-category donut chart
- Last 6 months income vs. expenses bar chart
- Month navigation to view any month

**Settings & data**
- **App lock** — optional passphrase gate for the public URL (PBKDF2-hashed,
  HttpOnly signed session cookie, 30-day devices, per-IP login rate limit);
  change or turn it off from Settings with the current passphrase
- 20 currencies (INR default) — switch anytime; insight text follows the
  active currency
- Light / dark / system theme
- AI assistant configuration (provider, key, model) with connection test
- CSV export of transactions (includes account + tags)
- Full JSON backup & restore (settings, accounts, categories, transfers,
  transactions, tags) — v2 backups include accounts and transfers, and older
  v1 backups still import
- One-click sample data for exploring
- Danger zone to wipe all data (accounts and categories are kept)

**Platform**
- Responsive: sidebar on desktop; 5-item bottom navigation (Home, Activity,
  Accounts, Stats, Settings) + FAB on mobile
- Smooth, reduced-motion-aware animations, a liquid bottom-nav indicator,
  tap ripples, and pill-shaped controls
- Mobile gestures: swipe left/right between bottom-nav tabs, pull down at the
  top to refresh, drag a bottom sheet down by its handle to dismiss
- Installable PWA with offline app shell (data needs the server)
- Keyboard shortcuts: `N` new transaction, `/` search
- Mobile bottom-sheet modals, desktop dialogs
- SQLite with WAL mode, input validation everywhere

---

## Project structure

```
server.js               Node.js entry — Hono app + static files (npm start)
worker.js                Cloudflare Workers entry — D1 binding (npm run deploy)
app.js                   Shared backend — all API routes and schema
db.js                   Database adapters: node:sqlite ↔ Cloudflare D1
smart.js                Smart Engine (suggestions, insights, analytics)
ai.js                   AI layer (BYO-key provider proxy)
wrangler.toml            Cloudflare deploy config (D1 binding + static assets)
public/
  index.html            App shell
  manifest.json         PWA manifest
  sw.js                 Service worker (offline shell, network-first)
  css/styles.css        Light/dark design system
  js/
    state.js            Shared state, helpers, formatting
    api.js              Fetch wrapper
    charts.js           SVG donut + bar charts, heatmap, weekday chart
    modals.js           Transaction/account/transfer/CSV/category dialogs
    views.js            Dashboard/transactions/accounts/analytics/settings
    app.js              Router, theme, keyboard shortcuts, init
scripts/gen-icons.js    Regenerates PWA icons (npm run icons)
data/expenses.db        SQLite database (Node mode, created on first run)
```

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/bootstrap` | Settings, categories, accounts, currencies, AI status |
| GET/PUT | `/api/settings` | Currency, theme, AI provider/key/model/base URL |
| GET/POST/PUT/DELETE | `/api/transactions` | CRUD + filters/sort/search/tag/account/pagination |
| GET/POST/PUT/DELETE | `/api/accounts` | Accounts with balances, opening balance, archive |
| GET/POST/DELETE | `/api/transfers` | Move money between accounts |
| POST | `/api/import/csv/preview` | Parse a bank CSV → headers + sample rows |
| POST | `/api/import/csv` | Import a mapped bank CSV with duplicate skipping |
| GET | `/api/tags` | All tags in use |
| GET/POST/PUT/DELETE | `/api/categories` | CRUD with usage protection |
| GET | `/api/summary` | Dashboard aggregates + account balances/net worth |
| GET | `/api/smart/insights` | Generated insights feed for a month |
| POST | `/api/smart/suggest` | Category/method suggestion for a note |
| GET | `/api/smart/subscriptions` | Detected near-regular charges |
| GET | `/api/analytics` | Heatmap/weekday/merchants/methods/streaks/trend |
| GET | `/api/ai/status` | AI configuration status + provider list |
| POST | `/api/ai/ask` | Chat with your data (needs key) |
| POST | `/api/ai/parse` | Sentence → prefilled transaction (needs key) |
| POST | `/api/ai/test` | Test the AI connection (needs key) |
| GET | `/api/health` | Health check (for uptime monitors) |
| GET | `/api/export?format=json\|csv` | Backup (v2 incl. accounts + transfers) / CSV export |
| POST | `/api/import` | Restore backup (v1 or v2) |
| POST | `/api/sample-data` | Load demo data (only when empty) |
| DELETE | `/api/data?confirm=DELETE` | Wipe transactions and transfers |

Older backups that contain budgets or recurring rules still import safely.
Those tables are kept in the database for backup compatibility, but they are
hidden in the app and no longer post transactions automatically.

`npm run tunnel` — expose the app on a temporary public `https://…trycloudflare.com`
URL (for phone access when local Wi-Fi access is blocked).

## AI assistant setup (optional)

The AI features are **off by default** — the Smart Engine works without any
of this. To enable chat + natural-language quick add:

1. Get a free API key from one of these providers:

   | Provider | Get a key | Notes |
   |---|---|---|
   | [Groq](https://console.groq.com/keys) | console.groq.com/keys | Fast, generous free tier, no card — **recommended** |
   | [Google Gemini](https://aistudio.google.com/apikey) | aistudio.google.com | Free tier from AI Studio |
   | [OpenRouter](https://openrouter.ai/keys) | openrouter.ai | Use models with a `:free` suffix |
   | Custom | — | Any OpenAI-compatible endpoint, incl. local Ollama |

2. In the app: **Settings → AI assistant → Provider** → pick one → paste the
   key → **Save** → **Test connection**.
3. A 🤖 AI assistant card appears on the dashboard with two modes:
   **Ask** (chat about your data) and **Quick add** (type a sentence, review
   the prefilled transaction, save).

The key is stored in the server's SQLite settings table and is never sent to
the browser. All AI calls are proxied server-side with a 45s timeout.

## App lock (optional)

The deployed URL is public by default. **Settings → App lock** lets you set a
passphrase so every device must unlock before any data is served:

- The passphrase is stored as a **PBKDF2-SHA256** hash (15,000 iterations) —
  never in plain text.
- A successful unlock sets an **HttpOnly, HMAC-signed** session cookie that
  lasts 30 days on that device (`SameSite=Lax`, `Secure` on HTTPS).
- Login attempts are rate-limited to **8 per 10 minutes per IP**; AI endpoints
  are capped at 30 requests per minute per IP.
- Changing or turning the lock off requires the current passphrase.
- There is **no recovery** — if you forget it, reset the lock from the
  database (this does not touch your transactions):

  ```bash
  # Local (Node + SQLite)
  npm run auth:reset

  # Cloudflare D1 (remote)
  npx wrangler d1 execute expense-tracker --remote --command "DELETE FROM settings WHERE key IN ('auth_hash','auth_secret')"
  ```

## Deployment

One codebase, two runtimes:

| Mode | Command | Entry point | Storage | Best for |
|---|---|---|---|---|
| Local | `npm start` | `server.js` (Node.js) | SQLite file `data/expenses.db` | your computer + phone on same Wi-Fi |
| Cloudflare | `npm run deploy` | `worker.js` (Workers) | Cloudflare D1 | free 24/7 hosting, installable PWA |

### Deploy to Cloudflare (~5 minutes, free, no card)

The Workers free plan gives you **100,000 API requests/day**, **unlimited
static asset requests** (the frontend never hits the Worker), and **D1** —
Cloudflare's SQLite — with 5M row reads + 100k row writes/day. That's far
more than a personal tracker will ever use, free forever, with no cold
starts.

1. **Log in** (opens your browser once to authorize):

   ```bash
   npx wrangler login
   ```

2. **Create the D1 database** (one time):

   ```bash
   npx wrangler d1 create expense-tracker
   ```

   Copy the printed `database_id` (a UUID).

3. **Paste it into `wrangler.toml`**, replacing the placeholder value
   `00000000-0000-4000-8000-000000000000`.

4. **Deploy**:

   ```bash
   npm run deploy
   ```

   The schema, default categories and two starter accounts (Cash, Bank
   Account) are created automatically on the first request — no migration
   step needed. Existing databases are upgraded in place.

5. Open the printed `https://expense-tracker.<your-subdomain>.workers.dev`
   URL. On your phone: browser menu → **Add to Home screen** → the app
   installs as a full-screen PWA, exactly like the local version.

Notes on the Cloudflare deployment:

- **Free plan daily limits** (all far above a single user's needs): 100k
  Worker requests, 5M D1 row reads, 100k D1 row writes, 5 GB storage total.
- **Restoring data**: export a JSON backup from your local instance
  (Settings → Full backup) and restore it in the deployed app's Settings.
  Imports are automatically chunked to respect D1's per-invocation query
  limit on the free plan.
- **Timezone**: Workers run in UTC, so "today" flips at 05:30 IST — date
  boundaries and forecasts use UTC days.
- `npm run dev:cf` runs the *same* code locally on workerd (Cloudflare's
  actual runtime) with a simulated D1 in `.wrangler/` — useful to verify the
  deploy path before deploying. Re-run `npm run deploy` to update the live
  app; there is no build step.

### Alternative: any Node/Docker host (Railway, VPS…)

`server.js` is a normal Node service with a SQLite file database — deployable
anywhere that supports Docker or Node with a **persistent disk**:

- **Railway** (~2 min): push the repo to GitHub → new project → deploy from
  repo (Dockerfile auto-detected) → add a volume mounted at `/data` (the
  Dockerfile sets `DATA_DIR=/data`) → generate a domain. The $5 trial credit
  covers roughly two months of this app.
- **Oracle Cloud free tier** (always-free ARM VM, 4 core / 24GB RAM —
  generous; needs a card for signup but is never charged) + this Dockerfile,
  with a volume at `/data`
- **Hetzner / Hostinger VPS** (~$3-5/mo) — full control, best long-term
  value: `docker run -d -v ./data:/data -p 80:3000 ghcr.io/you/expense-tracker`
- Not suitable: serverless Node hosts (Render free / Vercel / Fly free tier)
  — they wipe the SQLite file between restarts since they lack persistent
  disks

### Migrating your data to the deployed app

Open the deployed app → Settings → **Restore backup** → upload the JSON backup
you exported from your local instance (Settings → Full backup → Download JSON).

## Tips

- All npm scripts:

  | Command | What it does |
  |---|---|
  | `npm start` / `npm run dev` | Run locally on Node.js (port 3000) |
  | `npm run dev:cf` | Run locally on Cloudflare's workerd runtime (port 8787) |
  | `npm run deploy` | Deploy to Cloudflare Workers + D1 |
  | `npm run tunnel` | Temporary public HTTPS URL for the local server |
  | `npm run icons` | Regenerate PWA icons |

- Regenerate icons after changing the design: `npm run icons`
- **Set opening balances first** (Accounts → ✏️) so balances and net worth
  start from reality. Negative opening balances model credit-card dues.
- Deleting an account is blocked while transactions or transfers use it —
  **archive** it instead to keep history but hide it from pickers.
- Transactions from before accounts existed appear under the **No account**
  filter; edit them to assign an account and tighten your net worth.
- Change the port: `PORT=8080 npm start` (or `set PORT=8080` on Windows)
