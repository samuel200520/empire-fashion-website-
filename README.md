# 👑 Empire Fashion House

Full-stack e-commerce store for **Freetown, Sierra Leone** — premium streetwear, shoes, and accessories.
Vanilla HTML/CSS/JS storefront with an **Express + PostgreSQL** backend. No build step.

## Pages

| Page | URL | What it does |
|---|---|---|
| Storefront | `/` | Product grid, category + search + sort, wishlist, cart, checkout |
| Order tracking | `/track.html` | Look up an order by `#EMP<id>` or phone number |
| Admin login | `/admin.html` → `/login.html` | Session-based admin dashboard |
| Receipt / cancel | `/checkout-success.html`, `/checkout-cancel.html` | Monime payment redirect pages |

## Features

- **Storefront** — sizes, colors, stock tracking, photo galleries, reviews, wishlist,
  "NEW"/"SOLD OUT" badges, related products, share links (`/#product=3`)
- **Checkout** — Cash on Delivery **or** Monime (card / mobile money / bank transfer),
  promo codes, and an "Order via WhatsApp" shortcut
- **Admin dashboard** — revenue & category charts, order management, product CRUD with
  image compression, review moderation, promo codes, customer leaderboard, real-time
  new-order alerts, light/dark theme
- **Backend hardening** — parameterized SQL, server-side price calculation, stock
  decrement, XSS-output escaping, login throttling, secure session cookies, security
  headers, and sensitive project files are never served over HTTP

## Quick start (local)

1. **Prerequisites** — Node 18+, PostgreSQL running locally.
2. **Configure the database**:
   ```bash
   cp .env.example .env   # then edit DATABASE_URL
   ```
3. **Install & start**:
   ```bash
   npm install
   npm start              # http://localhost:3000
   ```
   On first boot the server creates all tables automatically and imports the legacy
   `db.json` catalog if the products table is empty.
4. **Log in as admin** at `/login.html` — username from `ADMIN_USER` (default `admin`),
   initial password **`empire123`** (change it in Admin → Settings).
5. **Optional demo catalog** (12 products across Men / Women / Shoes / Accessories):
   ```bash
   npm run seed
   ```

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ in prod | Long random string; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USER` | | Admin username created on first boot (default `admin`) |
| `MONIME_TOKEN`, `MONIME_SPACE` | for Monime | Payment gateway credentials — leave blank to disable card/mobile-money checkout |
| `PORT` | | Server port (Render sets this) |
| `NODE_ENV` | in prod | `production` enables Secure cookies + trusting the hosting proxy |

## Scripts

- `npm start` — run the server
- `npm run seed` — idempotent demo-catalog loader (safe to re-run)

## Deploying to Render

A ready-made blueprint is included — **New → Blueprint** and point it at this repo.

```yaml
# render.yaml — auto-provisions the web service + managed PostgreSQL
```

Manual setup is equally simple:

1. Create a **PostgreSQL** instance. Copy its *Internal Database URL*.
2. Create a **Web Service** (`node` runtime, `npm install` build, `node server.js` start).
   Add env vars: `DATABASE_URL`, `NODE_ENV=production`, `SESSION_SECRET` (random),
   `MONIME_TOKEN`, `MONIME_SPACE`.
3. First deploy creates the tables and the admin account. Log in at `/login.html`
   (default `admin` / `empire123`) and change the password immediately.

## Security notes

- Projects files (`server.js`, `db.json`, `package*.json`, `node_modules`, `.git`, env files…)
  return **404** — data only leaves through the JSON API.
- Admin login is throttled (10 tries / 15 min per IP).
- Sessions live in PostgreSQL, so logins survive restarts — important on free-tier
  hosting where the server sleeps.
- The admin credentials above are the **only** default secrets; rotate them before going live.