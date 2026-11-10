# 💸 Expense Tracker

A full-stack personal expense tracker — add income and expenses, set category
budgets, automate recurring payments, and see where your money goes with
charts. Works on desktop and Android/iOS phones (installable as an app).

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
- Add income and expenses with amount, category, date, payment method and note
- 20 default categories (food, rent, transport, salary, freelance…) — fully
  customizable with your own names, emoji icons and colors
- Payment methods: Cash, UPI, Card, Net Banking, Wallet, Other
- Search, filter (type/category/date range), and sort (date/amount)
- Infinite scroll with date grouping and per-day totals

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
- 20 currencies (INR default) — switch anytime
- Light / dark / system theme
- CSV export of transactions
- Full JSON backup & restore (settings, categories, budgets, rules)
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
public/
  index.html            App shell
  manifest.json         PWA manifest
  sw.js                 Service worker (offline shell, network-first)
  css/styles.css        Light/dark design system
  js/
    state.js            Shared state, helpers, formatting
    api.js              Fetch wrapper
    charts.js           SVG donut + bar charts (no libraries)
    modals.js           Transaction/category/budget/recurring dialogs
    views.js            Dashboard/transactions/budgets/recurring/settings
    app.js              Router, theme, keyboard shortcuts, init
scripts/gen-icons.js    Regenerates PWA icons (npm run icons)
data/expenses.db        SQLite database (created on first run)
```

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/bootstrap` | Settings, categories, currencies |
| GET/PUT | `/api/settings` | Currency, theme |
| GET/POST/PUT/DELETE | `/api/transactions` | CRUD + filters/sort/search/pagination |
| GET/POST/PUT/DELETE | `/api/categories` | CRUD with usage protection |
| GET/PUT/DELETE | `/api/budgets` | Monthly budgets + spent amounts |
| GET/POST/PUT/DELETE | `/api/recurring` | Recurring rules, auto-processing |
| GET | `/api/summary` | Dashboard aggregates (month, trends, charts) |
| GET | `/api/export?format=json\|csv` | Backup / CSV export |
| POST | `/api/import` | Restore backup |
| POST | `/api/sample-data` | Load demo data (only when empty) |
| DELETE | `/api/data?confirm=DELETE` | Wipe transactions/budgets/rules |

`npm run tunnel` — expose the app on a temporary public `https://…trycloudflare.com`
URL (for phone access when local Wi-Fi access is blocked).

## Development notes

- Regenerate icons after changing the design: `npm run icons`
- Change the port: `PORT=8080 npm start` (or `set PORT=8080` on Windows)
- The recurring engine runs on server start, on each relevant API call, and
  hourly — so due transactions are posted even if nobody opens the app.
