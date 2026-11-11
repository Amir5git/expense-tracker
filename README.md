# 💸 Expense Tracker

A full-stack personal expense tracker — add income and expenses, set category
budgets, automate recurring payments, and see where your money goes with
charts. Works on desktop and Android/iOS phones (installable as an app).

Includes a **local Smart Engine** (offline intelligence: auto-categorization,
insights, subscription detection, budget suggestions, weekday-aware forecasts)
and an optional **AI assistant** — chat with your data and add transactions by
typing plain English, using a free-tier LLM key of your choice.

Built with **Node.js + Express + SQLite** on the back end and a fast,
dependency-free web app on the front end.

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
- Add income and expenses with amount, category, date, payment method, note
  and **tags**
- 20 default categories (food, rent, transport, salary, freelance…) — fully
  customizable with your own names, emoji icons and colors
- Payment methods: Cash, UPI, Card, Net Banking, Wallet, Other
- Search, filter (type/category/date range/**tag**), and sort (date/amount)
- Infinite scroll with date grouping and per-day totals

**Smart Engine** (offline, no API keys, always free)
- **Auto-categorization** while you type — learns from your history
  ("swiggy order" → Food & Dining) and falls back to built-in keyword
  knowledge for first-time notes
- **Insights feed** on the dashboard: category anomalies ("Shopping is ₹2,400
  above your 3-month average"), budget pacing, savings-rate changes, weekend
  patterns, streaks — each with one-click actions
- **Subscription detection** — finds near-regular charges (Netflix, rent,
  utilities) and offers to automate them
- **Budget suggestions** from trailing averages for unbudgeted categories
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
- Savings rate and projected month-end spend
- Expenses-by-category donut chart
- Last 6 months income vs. expenses bar chart
- Month navigation to view any month

**Budgets**
- Monthly limit per expense category
- Progress bars with color states (green / amber when 75%+ / red when over)
- Over-budget alerts and projected spend

**Recurring transactions**
- Daily / weekly / monthly / yearly rules (salary, rent, subscriptions…)
- Auto-posted with catch-up: if the app wasn't open on the due date, the
  transaction is still recorded — nothing is ever missed
- Pause/resume rules

**Settings & data**
- 20 currencies (INR default) — switch anytime; insight text follows the
  active currency
- Light / dark / system theme
- AI assistant configuration (provider, key, model) with connection test
- CSV export of transactions (includes tags)
- Full JSON backup & restore (settings, categories, budgets, rules, tags)
- One-click sample data for exploring
- Danger zone to wipe all data

**Platform**
- Responsive: sidebar on desktop, bottom navigation + FAB on mobile
- Installable PWA with offline app shell (data needs the server)
- Keyboard shortcuts: `N` new transaction, `/` search
- Mobile bottom-sheet modals, desktop dialogs
- SQLite with WAL mode, transaction-safe recurring engine, input validation
  everywhere

---

## Project structure

```
server.js               Express app + SQLite schema + API
smart.js                Smart Engine (suggestions, insights, analytics)
ai.js                   AI layer (BYO-key provider proxy)
public/
  index.html            App shell
  manifest.json         PWA manifest
  sw.js                 Service worker (offline shell, network-first)
  css/styles.css        Light/dark design system
  js/
    state.js            Shared state, helpers, formatting
    api.js              Fetch wrapper
    charts.js           SVG donut + bar charts, heatmap, weekday chart
    modals.js           Transaction/category/budget/recurring dialogs
    views.js            Dashboard/transactions/analytics/budgets/recurring/settings
    app.js              Router, theme, keyboard shortcuts, init
scripts/gen-icons.js    Regenerates PWA icons (npm run icons)
data/expenses.db        SQLite database (created on first run)
```

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/bootstrap` | Settings, categories, currencies, AI status |
| GET/PUT | `/api/settings` | Currency, theme, AI provider/key/model/base URL |
| GET/POST/PUT/DELETE | `/api/transactions` | CRUD + filters/sort/search/tag/pagination |
| GET | `/api/tags` | All tags in use |
| GET/POST/PUT/DELETE | `/api/categories` | CRUD with usage protection |
| GET/PUT/DELETE | `/api/budgets` | Monthly budgets + spent amounts |
| GET/POST/PUT/DELETE | `/api/recurring` | Recurring rules, auto-processing |
| GET | `/api/summary` | Dashboard aggregates (month, trends, charts, forecast) |
| GET | `/api/smart/insights` | Generated insights feed for a month |
| POST | `/api/smart/suggest` | Category/method suggestion for a note |
| GET | `/api/smart/subscriptions` | Detected near-regular charges |
| GET | `/api/smart/budget-suggestions` | Suggested budgets from history |
| GET | `/api/analytics` | Heatmap/weekday/merchants/methods/streaks/trend |
| GET | `/api/ai/status` | AI configuration status + provider list |
| POST | `/api/ai/ask` | Chat with your data (needs key) |
| POST | `/api/ai/parse` | Sentence → prefilled transaction (needs key) |
| POST | `/api/ai/test` | Test the AI connection (needs key) |
| GET | `/api/health` | Health check (for Railway/uptime monitors) |
| GET | `/api/export?format=json\|csv` | Backup / CSV export |
| POST | `/api/import` | Restore backup |
| POST | `/api/sample-data` | Load demo data (only when empty) |
| DELETE | `/api/data?confirm=DELETE` | Wipe transactions/budgets/rules |

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

## Deployment

The app is a single Node.js service with a SQLite file database — deployable
anywhere that supports Docker or Node with **persistent disk**.

### Deploy to Railway (~2 minutes)

1. Push this repo to GitHub (first time only):

   ```bash
   git init                          # already done
   git commit -m "Expense tracker"   # already done
   gh repo create expense-tracker --private --push   # needs GitHub CLI
   # or: create an empty repo on github.com, then:
   git remote add origin https://github.com/YOUR-USERNAME/expense-tracker.git
   git push -u origin master
   ```

2. Go to [railway.com](https://railway.com) → **New Project** →
   **Deploy from GitHub repo** → pick the repo. Railway auto-detects the
   Dockerfile.

3. Add persistent storage (important — this is where your data lives):
   - In the service → **Storage** tab → **New Volume** → mount at **`/data`**
   - (The Dockerfile sets `DATA_DIR=/data` already)

4. Settings → **Networking** → **Generate Domain** → you get a permanent
   `https://your-app.up.railway.app` URL. Open it on your phone →
   **Add to Home screen**.

5. Done. Every `git push` now redeploys automatically.

**Cost:** the trial starts free (no card) with $5 credit / 30 days; this app
uses roughly $2-3/month of usage. If it pauses when credit runs out, either
add the $5/mo Hobby plan or move to a free-forever host (below).

### Free-forever alternatives

- **Oracle Cloud free tier** (always-free ARM VM, 4 core / 24GB RAM — generous;
  needs a card for signup but is never charged) + this Dockerfile, with a
  volume at `/data`
- **Hetzner / Hostinger VPS** (~$3-5/mo) — full control, best long-term value:
  `docker run -d -v ./data:/data -p 80:3000 ghcr.io/you/expense-tracker`
- Not suitable: serverless hosts (Render free / Vercel / Fly free tier) —
  they wipe the SQLite file between restarts since they lack persistent disks

### Migrating your data to the deployed app

Open the deployed app → Settings → **Restore backup** → upload the JSON backup
you exported from your local instance (Settings → Full backup → Download JSON).



- Regenerate icons after changing the design: `npm run icons`
- Change the port: `PORT=8080 npm start` (or `set PORT=8080` on Windows)
- The recurring engine runs on server start, on each relevant API call, and
  hourly — so due transactions are posted even if nobody opens the app.
