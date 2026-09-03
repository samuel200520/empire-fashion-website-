const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);

// Load .env for local development (Render sets real env vars instead)
const envFile = path.join(__dirname, '.env');
if (process.env.NODE_ENV !== 'production' && fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('FATAL: DATABASE_URL is not set. Create a PostgreSQL database and add its URL as an environment variable.');
    process.exit(1);
}

// Local PostgreSQL has no SSL; Render's requires it
const needsSsl = !/localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined
});
pool.on('error', err => console.error('Unexpected Postgres pool error:', err.message));

const ADMIN_USER = process.env.ADMIN_USER || 'admin';

app.disable('x-powered-by');

const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD) app.set('trust proxy', 1); // we sit behind Render's proxy / nginx in production

// ---- Security: sensible headers on every response ----
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    next();
});

// The static site is served from the project root, so formally block internal files.
// The API routes are the only intended way to read data.
const BLOCKED_STATIC_PATHS = [
    '/server.js', '/db.json', '/package.json', '/package-lock.json',
    '/seed.js', '/yarn.lock', '/npm-debug.log',
    '/.env', '/.env.example', '/.env.local', '/.env.production', '/.dev.vars',
    '/README.md', '/render.yaml', '/.gitignore',
    '/.git', '/node_modules'
];
app.use((req, res, next) => {
    const p = (req.path || '/').toLowerCase();
    if (BLOCKED_STATIC_PATHS.some(blocked => {
        const b = blocked.toLowerCase();
        return p === b || p.startsWith(b + '/');
    })) {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
});

app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));

// ---- Login throttling (in-memory; slows brute-force without adding a dependency) ----
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
    const now = Date.now();
    const rec = loginAttempts.get(req.ip) || {};
    if (!rec.resetAt || now > rec.resetAt) {
        loginAttempts.set(req.ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
        return next();
    }
    rec.count += 1;
    if (rec.count > LOGIN_MAX_ATTEMPTS) {
        const mins = Math.max(1, Math.ceil((rec.resetAt - now) / 60000));
        return res.status(429).json({ ok: false, error: `Too many attempts. Please try again in ${mins} minute(s).` });
    }
    next();
}

// ---- Session/auth setup (sessions live in PostgreSQL, survive server restarts) ----
const SESSION_SECRET = process.env.SESSION_SECRET || 'empire-fashion-dev-secret-change-me';
if (IS_PROD && SESSION_SECRET === 'empire-fashion-dev-secret-change-me') {
    console.warn('WARNING: SESSION_SECRET is the insecure default. Set a long random value in production.');
}
app.use(session({
    store: new pgSession({
        pool,
        tableName: 'admin_sessions',
        pruneSessionInterval: 60 * 60 // clean expired rows hourly
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 1000 * 60 * 60 * 8 }
}));

// ---- Database schema + one-time import from the old db.json ----
async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            price NUMERIC(10,2) NOT NULL,
            category TEXT NOT NULL DEFAULT 'uncategorized',
            image TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            customer TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            address TEXT,
            product TEXT,
            items JSONB NOT NULL DEFAULT '[]',
            amount NUMERIC(10,2) NOT NULL DEFAULT 0,
            payment_method TEXT NOT NULL DEFAULT 'cod',
            payment_ref TEXT NOT NULL DEFAULT '',
            monime_session_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'Pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            email TEXT,
            spent NUMERIC(12,2) NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS admin (
            id INT PRIMARY KEY,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            product_id INT NOT NULL,
            name TEXT NOT NULL,
            rating INT NOT NULL,
            comment TEXT NOT NULL,
            approved BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS promos (
            code TEXT PRIMARY KEY,
            percent INT NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS admin_sessions (
            sid varchar NOT NULL PRIMARY KEY,
            sess json NOT NULL,
            expire timestamp(6) NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_expire ON admin_sessions (expire);
    `);

    // Migration: add sizes/stock to products created before this feature.
    // stock NULL means unlimited (legacy products keep selling).
    await pool.query(`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS colors TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code TEXT NOT NULL DEFAULT '';
        UPDATE products SET stock = NULL WHERE stock = 0 AND sizes = '';
    `);

    const adminCount = await pool.query('SELECT COUNT(*)::int AS n FROM admin');
    if (adminCount.rows[0].n === 0) {
        await pool.query('INSERT INTO admin (id, username, password_hash) VALUES (1, $1, $2)',
            [ADMIN_USER, bcrypt.hashSync('empire123', 10)]);
    }

    // First boot on a fresh database: import old db.json data if the DB is empty
    const dbFile = path.join(__dirname, 'db.json');
    const prodCount = await pool.query('SELECT COUNT(*)::int AS n FROM products');
    if (prodCount.rows[0].n === 0 && fs.existsSync(dbFile)) {
        try {
            const old = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
            for (const p of old.products || []) {
                await pool.query('INSERT INTO products (name, price, category, image) VALUES ($1, $2, $3, $4)',
                    [String(p.name).slice(0, 100), Number(p.price) || 0, String(p.category || '').toLowerCase(), p.image || '']);
            }
            for (const c of old.customers || []) {
                await pool.query('INSERT INTO customers (name, email, spent) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING',
                    [String(c.name).slice(0, 100), c.email || 'unknown@example.com', parseFloat(c.spent) || 0]);
            }
            for (const o of old.orders || []) {
                await pool.query(
                    `INSERT INTO orders (customer, email, phone, address, product, items, amount, payment_method, payment_ref, status)
                     VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7, $8, $9)`,
                    [String(o.customer).slice(0, 100), o.email || '', o.phone || '', o.address || '',
                     o.product || '', parseFloat(o.amount) || 0, o.paymentMethod || 'cod', o.paymentRef || '', o.status || 'Pending']);
            }
            console.log(`Imported ${(old.products || []).length} products and ${(old.orders || []).length} orders from db.json`);
        } catch (e) {
            console.error('db.json import skipped:', e.message);
        }
    }
}

// ---- Row mappers (keep the same JSON shape the frontend already uses) ----
function parseImages(raw) {
    try {
        const arr = JSON.parse(raw || '[]');
        return Array.isArray(arr) ? arr.filter(i => typeof i === 'string').slice(0, 4) : [];
    } catch (e) { return []; }
}
function mapProduct(r) {
    return {
        id: r.id, name: r.name, price: Number(r.price), category: r.category, image: r.image,
        sizes: String(r.sizes || '').split(',').map(s => s.trim()).filter(Boolean),
        colors: String(r.colors || '').split(',').map(c => c.trim()).filter(Boolean),
        stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
        images: parseImages(r.images),
        created: r.created || null
    };
}
function normList(list) {
    const arr = Array.isArray(list) ? list : String(list || '').split(',');
    return arr.map(s => String(s).trim()).filter(Boolean).join(',');
}
function normStock(stock) {
    if (stock === '' || stock === null || stock === undefined) return null;
    const n = parseInt(stock, 10);
    return Number.isFinite(n) ? Math.max(0, n) : null;
}
function normImages(images) {
    if (!Array.isArray(images)) return null; // leave unchanged
    return JSON.stringify(images.filter(i => typeof i === 'string' && i.length > 10).slice(0, 4));
}
async function validatePromo(code) {
    if (!code) return null;
    const r = await pool.query('SELECT code, percent FROM promos WHERE UPPER(code) = UPPER($1) AND active = TRUE',
        [String(code).slice(0, 30)]);
    return r.rows[0] || null;
}
function itemsSummary(items) {
    return items.map(i => {
        const parts = [i.size, i.color].filter(Boolean);
        return i.name + (parts.length ? ` (${parts.join(', ')})` : '');
    }).join(', ');
}
async function applyStock(items) {
    for (const i of items) {
        const pid = Number(i.id);
        if (pid) {
            await pool.query('UPDATE products SET stock = GREATEST(stock - 1, 0) WHERE id = $1 AND stock IS NOT NULL', [pid]);
        }
    }
}
function mapOrder(r) {
    return {
        id: r.id, customer: r.customer, email: r.email, phone: r.phone, address: r.address,
        product: r.product, items: r.items || [], amount: Number(r.amount),
        paymentMethod: r.payment_method, paymentRef: r.payment_ref, monimeSessionId: r.monime_session_id,
        promoCode: r.promo_code || '', status: r.status, date: r.date
    };
}

async function getAdmin() {
    const r = await pool.query('SELECT username, password_hash FROM admin WHERE id = 1');
    return r.rows[0];
}

// ---- Auth ----
app.post('/api/login', loginRateLimit, async (req, res) => {
    const { username, password } = req.body || {};
    try {
        const admin = await getAdmin();
        if (admin && username === admin.username && await bcrypt.compare(password || '', admin.password_hash)) {
            loginAttempts.delete(req.ip); // reset the counter on a successful login
            req.session.admin = true;
            res.json({ ok: true });
        } else {
            res.status(401).json({ ok: false, error: 'Invalid username or password' });
        }
    } catch (e) {
        console.error('Login error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/password', requireAdmin, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    try {
        const admin = await getAdmin();
        if (!await bcrypt.compare(currentPassword || '', admin.password_hash)) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        if (!newPassword || String(newPassword).length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }
        await pool.query('UPDATE admin SET password_hash = $1 WHERE id = 1', [bcrypt.hashSync(String(newPassword), 10)]);
        res.json({ ok: true });
    } catch (e) {
        console.error('Password change error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
    res.json({ loggedIn: !!req.session.admin });
});

function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) return next();
    res.status(403).json({ error: 'Unauthorized' });
}

// ---- Public API ----
app.get('/api/products', async (req, res) => {
    const r = await pool.query(`SELECT *, to_char(created_at, 'YYYY-MM-DD') AS created FROM products ORDER BY id DESC`);
    res.json(r.rows.map(mapProduct));
});

app.post('/api/orders', async (req, res) => {
    const { customer, email, phone, address, items, paymentMethod, paymentRef, promoCode } = req.body || {};
    if (!customer || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Missing order details' });
    }
    const method = ['cod'].includes(paymentMethod) ? paymentMethod : 'cod';
    try {
        // Totals are computed server-side — never trust the client amount
        const subtotal = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
        const promo = await validatePromo(promoCode);
        const discount = promo ? Math.round(subtotal * promo.percent) / 100 : 0;
        const amount = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

        const r = await pool.query(
            `INSERT INTO orders (customer, email, phone, address, product, items, amount, payment_method, payment_ref, promo_code, status)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, 'Pending')
             RETURNING *, to_char(created_at, 'YYYY-MM-DD') AS date`,
            [String(customer).slice(0, 100), String(email || '').slice(0, 100), String(phone || '').slice(0, 30),
             String(address || '').slice(0, 200), itemsSummary(items),
             JSON.stringify(items), amount, method, paymentRef ? String(paymentRef).slice(0, 50) : '',
             promo ? promo.code : '']);
        const order = mapOrder(r.rows[0]);

        await applyStock(items);
        await pool.query(
            `INSERT INTO customers (name, email, spent) VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET spent = customers.spent + EXCLUDED.spent`,
            [order.customer, order.email || 'unknown@example.com', order.amount]);

        res.status(201).json(order);
    } catch (e) {
        console.error('Create order error:', e.message);
        res.status(500).json({ error: 'Could not save order' });
    }
});

// ---- Admin-only API ----
app.get('/api/orders', requireAdmin, async (req, res) => {
    const r = await pool.query(`SELECT *, to_char(created_at, 'YYYY-MM-DD') AS date FROM orders ORDER BY created_at DESC`);
    res.json(r.rows.map(mapOrder));
});

app.get('/api/customers', requireAdmin, async (req, res) => {
    const r = await pool.query('SELECT id, name, email, spent FROM customers ORDER BY spent DESC');
    res.json(r.rows.map(c => ({ id: c.id, name: c.name, email: c.email, spent: Number(c.spent) })));
});

app.patch('/api/orders/:id', requireAdmin, async (req, res) => {
    const allowed = ['Pending', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!allowed.includes(req.body.status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    try {
        const r = await pool.query(
            `UPDATE orders SET status = $1 WHERE id = $2
             RETURNING *, to_char(created_at, 'YYYY-MM-DD') AS date`,
            [req.body.status, Number(req.params.id)]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
        res.json(mapOrder(r.rows[0]));
    } catch (e) {
        console.error('Update order error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/products', requireAdmin, async (req, res) => {
    const { name, price, image, category, sizes, colors, stock, images } = req.body || {};
    if (!name || !price || !image) return res.status(400).json({ error: 'Missing product fields' });
    try {
        const imgJson = normImages(images) || '[]';
        const r = await pool.query(
            `INSERT INTO products (name, price, category, image, sizes, colors, stock, images)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *, to_char(created_at, 'YYYY-MM-DD') AS created`,
            [String(name).slice(0, 100), Number(price), String(category || '').toLowerCase().slice(0, 30), image,
             normList(sizes), normList(colors), normStock(stock), imgJson]);
        res.status(201).json(mapProduct(r.rows[0]));
    } catch (e) {
        console.error('Create product error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/products/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { name, price, image, category, sizes, colors, stock, images } = req.body || {};
        const r = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
        const p = r.rows[0];
        const merged = {
            name: name !== undefined ? String(name).slice(0, 100) : p.name,
            price: price !== undefined ? Number(price) : Number(p.price),
            image: image !== undefined ? image : p.image,
            category: category !== undefined ? String(category).toLowerCase().slice(0, 30) : p.category,
            sizes: sizes !== undefined ? normList(sizes) : p.sizes,
            colors: colors !== undefined ? normList(colors) : p.colors,
            stock: stock !== undefined ? normStock(stock) : (p.stock ?? null),
            images: normImages(images) || (p.images || '[]')
        };
        const u = await pool.query(
            `UPDATE products SET name = $1, price = $2, image = $3, category = $4, sizes = $5, colors = $6, stock = $7, images = $8
             WHERE id = $9 RETURNING *, to_char(created_at, 'YYYY-MM-DD') AS created`,
            [merged.name, merged.price, merged.image, merged.category, merged.sizes, merged.colors, merged.stock, merged.images, id]);
        res.json(mapProduct(u.rows[0]));
    } catch (e) {
        console.error('Update product error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
    const r = await pool.query('DELETE FROM products WHERE id = $1', [Number(req.params.id)]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true });
});

// ---- Public order tracking (no login; no personal details exposed) ----
app.get('/api/track', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 40);
    if (q.length < 3) return res.status(400).json({ error: 'Please enter your order number or phone number.' });
    try {
        const cols = `id, product, amount, status, payment_method, to_char(created_at, 'YYYY-MM-DD') AS date`;
        const num = q.replace(/^emp/i, '');
        let rows = [];
        if (/^\d+$/.test(num) && num.length <= 8) {
            rows = (await pool.query(`SELECT ${cols} FROM orders WHERE id = $1`, [Number(num)])).rows;
        }
        if (rows.length === 0) {
            const digits = q.replace(/\D/g, '');
            if (digits.length >= 7) {
                rows = (await pool.query(
                    `SELECT ${cols} FROM orders WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || $1
                     ORDER BY created_at DESC LIMIT 20`, [digits])).rows;
            }
        }
        if (rows.length === 0) {
            return res.status(404).json({ error: 'No order found. Check the order number or the phone number you ordered with.' });
        }
        res.json({
            orders: rows.map(r => ({
                id: r.id, date: r.date, product: r.product, amount: Number(r.amount),
                status: r.status, paymentMethod: r.payment_method
            }))
        });
    } catch (e) {
        console.error('Track error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ---- Reviews ----
// Public: approved reviews + average for one product
app.get('/api/products/:id/reviews', async (req, res) => {
    try {
        const pid = Number(req.params.id);
        const r = await pool.query(
            `SELECT id, name, rating, comment, to_char(created_at, 'YYYY-MM-DD') AS date
             FROM reviews WHERE product_id = $1 AND approved = TRUE ORDER BY created_at DESC LIMIT 50`, [pid]);
        const avg = r.rows.length
            ? Math.round(r.rows.reduce((s, v) => s + v.rating, 0) / r.rows.length * 10) / 10
            : 0;
        res.json({ avg, count: r.rows.length, reviews: r.rows });
    } catch (e) {
        console.error('Reviews fetch error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Public: submit a review (held for admin approval)
app.post('/api/products/:id/reviews', async (req, res) => {
    try {
        const pid = Number(req.params.id);
        const { name, rating, comment } = req.body || {};
        const stars = parseInt(rating, 10);
        if (!name || !comment || !Number.isInteger(stars) || stars < 1 || stars > 5) {
            return res.status(400).json({ error: 'Please add your name, a 1-5 star rating, and a comment.' });
        }
        await pool.query('INSERT INTO reviews (product_id, name, rating, comment) VALUES ($1, $2, $3, $4)',
            [pid, String(name).slice(0, 60), stars, String(comment).slice(0, 500)]);
        res.status(201).json({ ok: true });
    } catch (e) {
        console.error('Review submit error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin: all reviews, approve, delete
app.get('/api/reviews', requireAdmin, async (req, res) => {
    const r = await pool.query(
        `SELECT r.id, r.product_id, r.name, r.rating, r.comment, r.approved, to_char(r.created_at, 'YYYY-MM-DD') AS date,
                p.name AS product_name
         FROM reviews r LEFT JOIN products p ON p.id = r.product_id
         ORDER BY r.approved ASC, r.created_at DESC LIMIT 200`);
    res.json(r.rows);
});

app.patch('/api/reviews/:id', requireAdmin, async (req, res) => {
    const r = await pool.query('UPDATE reviews SET approved = $1 WHERE id = $2 RETURNING id',
        [!!req.body.approved, Number(req.params.id)]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Review not found' });
    res.json({ ok: true });
});

app.delete('/api/reviews/:id', requireAdmin, async (req, res) => {
    await pool.query('DELETE FROM reviews WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
});

// ---- Promo codes ----
// Public: check a code and preview the discount
app.post('/api/promo/validate', async (req, res) => {
    const { code, amount } = req.body || {};
    const promo = await validatePromo(code);
    if (!promo) return res.status(404).json({ valid: false, error: 'That promo code is not valid.' });
    const subtotal = Number(amount) || 0;
    const discount = Math.round(subtotal * promo.percent) / 100;
    res.json({ valid: true, code: promo.code, percent: promo.percent, discount: Math.round(discount * 100) / 100, total: Math.max(0, Math.round((subtotal - discount) * 100) / 100) });
});

// Admin: manage promos
app.get('/api/promos', requireAdmin, async (req, res) => {
    const r = await pool.query('SELECT code, percent, active, to_char(created_at, \'YYYY-MM-DD\') AS date FROM promos ORDER BY created_at DESC');
    res.json(r.rows.map(p => ({ code: p.code, percent: Number(p.percent), active: p.active, date: p.date })));
});

app.post('/api/promos', requireAdmin, async (req, res) => {
    const { code, percent } = req.body || {};
    const clean = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    const pct = parseInt(percent, 10);
    if (!clean || !Number.isInteger(pct) || pct < 1 || pct > 90) {
        return res.status(400).json({ error: 'Enter a code and a discount between 1 and 90 percent.' });
    }
    try {
        await pool.query('INSERT INTO promos (code, percent) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET percent = $2, active = TRUE',
            [clean, pct]);
        res.status(201).json({ ok: true, code: clean, percent: pct });
    } catch (e) {
        console.error('Promo create error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/promos/:code', requireAdmin, async (req, res) => {
    const r = await pool.query('UPDATE promos SET active = $1 WHERE code = $2',
        [!!req.body.active, String(req.params.code).toUpperCase()]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Promo not found' });
    res.json({ ok: true });
});

app.delete('/api/promos/:code', requireAdmin, async (req, res) => {
    await pool.query('DELETE FROM promos WHERE code = $1', [String(req.params.code).toUpperCase()]);
    res.json({ ok: true });
});

// ---- Monime Payment Gateway ----
const MONIME_TOKEN = process.env.MONIME_TOKEN || '';
const MONIME_SPACE = process.env.MONIME_SPACE || '';
const MONIME_API = 'https://api.monime.io';

// HTML escape helper for server-rendered pages
function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function monimeHeaders(idempotencyKey) {
    return {
        'Authorization': `Bearer ${MONIME_TOKEN}`,
        'Monime-Space-Id': MONIME_SPACE,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json'
    };
}

// Create a Monime checkout session for an order, then return the redirect URL
app.post('/api/checkout/monime', async (req, res) => {
    if (!MONIME_TOKEN || !MONIME_SPACE) {
        return res.status(500).json({ error: 'Monime not configured. Set MONIME_TOKEN and MONIME_SPACE environment variables.' });
    }

    const { customer, email, phone, address, items, promoCode } = req.body || {};
    if (!customer || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Missing order details' });
    }

    const origin = req.get('origin') || req.protocol + '://' + req.get('host');
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}`;

    try {
        // Totals computed server-side
        const subtotal = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
        const promo = await validatePromo(promoCode);
        const discount = promo ? Math.round(subtotal * promo.percent) / 100 : 0;
        const amount = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

        // 1. Create the order locally first (status: Pending)
        const ins = await pool.query(
            `INSERT INTO orders (customer, email, phone, address, product, items, amount, payment_method, payment_ref, monime_session_id, promo_code, status)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'monime', '', '', $8, 'Pending')
             RETURNING id`,
            [String(customer).slice(0, 100), String(email || '').slice(0, 100), String(phone || '').slice(0, 30),
             String(address || '').slice(0, 200), itemsSummary(items),
             JSON.stringify(items), amount, promo ? promo.code : '']);
        const orderId = ins.rows[0].id;

        await applyStock(items);

        await pool.query(
            `INSERT INTO customers (name, email, spent) VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET spent = customers.spent + EXCLUDED.spent`,
            [String(customer).slice(0, 100), String(email || '').slice(0, 100) || 'unknown@example.com', amount]);

        // 2. Call Monime to create a hosted checkout session
        // Amounts in minor units: SLE 25 = value 2500
        // With a promo, charge one line for the discounted total; otherwise per item
        const lineItems = promo
            ? [{
                type: 'custom',
                name: `Empire Order #EMP${orderId}${promo ? ` (promo ${promo.code} -${promo.percent}%)` : ''}`,
                price: { currency: 'SLE', value: Math.round(amount * 100) },
                quantity: 1
            }]
            : items.map(i => ({
                type: 'custom',
                name: i.name,
                price: { currency: 'SLE', value: Math.round(Number(i.price) * 100) },
                quantity: 1
            }));

        const sessionBody = {
            name: `Empire Fashion House - Order #EMP${orderId}`,
            successUrl: `${origin}/checkout-success.html?order_id=${orderId}`,
            cancelUrl: `${origin}/checkout-cancel.html?order_id=${orderId}`,
            callbackState: `${orderId}`,
            lineItems
        };

        const monimeRes = await fetch(`${MONIME_API}/v1/checkout-sessions`, {
            method: 'POST',
            headers: monimeHeaders(idempotencyKey),
            body: JSON.stringify(sessionBody)
        });

        if (!monimeRes.ok) {
            const errBody = await monimeRes.text();
            console.error('Monime API error:', monimeRes.status, errBody);
            return res.status(502).json({ error: `Monime error (${monimeRes.status}): ${errBody}` });
        }

        const sessionData = await monimeRes.json();
        const redirectUrl = sessionData?.result?.redirectUrl;

        if (!redirectUrl) {
            console.error('Monime response missing redirectUrl:', JSON.stringify(sessionData).slice(0, 500));
            return res.status(502).json({ error: 'Monime returned no redirect URL. Try Cash on Delivery instead.' });
        }

        await pool.query('UPDATE orders SET monime_session_id = $1 WHERE id = $2',
            [sessionData.result.id || '', orderId]);

        // 3. Return the redirect URL so the frontend can send the customer there
        res.json({ redirectUrl, orderId });

    } catch (error) {
        console.error('Monime checkout error:', error);
        res.status(500).json({ error: `Checkout error: ${error.message}` });
    }
});

// Monime webhook: payment confirmed -> mark order as Paid
app.post('/api/monime/webhook', async (req, res) => {
    console.log('Monime webhook received:', JSON.stringify(req.body).slice(0, 500));

    try {
        const eventName = req.body?.event?.name;
        const sessionId = req.body?.object?.id;
        const status = req.body?.data?.status;
        const orderNumber = req.body?.data?.orderNumber;
        const callbackState = req.body?.data?.callbackState;

        if (eventName === 'checkout_session.completed' && status === 'completed') {
            let orderId = null;
            if (callbackState) {
                const byState = await pool.query('SELECT id FROM orders WHERE id = $1 AND status = $2', [Number(callbackState), 'Pending']);
                if (byState.rows.length > 0) orderId = byState.rows[0].id;
            }
            if (orderId === null && sessionId) {
                const bySession = await pool.query('SELECT id FROM orders WHERE monime_session_id = $1', [sessionId]);
                if (bySession.rows.length > 0) orderId = bySession.rows[0].id;
            }
            if (orderId === null && orderNumber) {
                const num = String(orderNumber).replace(/^EMP/, '');
                if (/^\d+$/.test(num)) {
                    const byNum = await pool.query('SELECT id FROM orders WHERE id = $1', [Number(num)]);
                    if (byNum.rows.length > 0) orderId = byNum.rows[0].id;
                }
            }

            if (orderId !== null) {
                await pool.query('UPDATE orders SET status = $1, payment_ref = $2, monime_session_id = COALESCE(NULLIF($3, \'\'), monime_session_id) WHERE id = $4',
                    ['Paid', orderNumber || '', sessionId || '', orderId]);
                console.log(`Order #EMP${orderId} marked as Paid via Monime`);
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Simple success/cancel pages for Monime redirects
app.get('/checkout-success.html', (req, res) => {
    const orderId = req.query.order_id || '';
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Successful - Empire Fashion House</title>
<style>body{font-family:Helvetica,Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f9f9f9;color:#111;}
.box{text-align:center;background:#fff;padding:50px;border-radius:10px;box-shadow:0 5px 20px rgba(0,0,0,.1);max-width:400px;width:90%;}
.box .check{font-size:70px;margin-bottom:15px;}
.box h1{color:#D4AF37;font-size:28px;margin-bottom:10px;}
.box p{color:#777;line-height:1.6;margin-bottom:25px;}
.box a{display:inline-block;padding:14px 35px;background:#D4AF37;color:#111;border-radius:5px;font-weight:bold;text-decoration:none;transition:.3s;}
.box a:hover{background:#b8941f;}
</style></head><body><div class="box"><div class="check">✅</div><h1>Payment Successful!</h1>
<p>Your payment has been confirmed. Order #EMP${esc(orderId)} is being processed. We will contact you on WhatsApp shortly.</p>
<a href="/">Continue Shopping</a></div></body></html>`);
});

app.get('/checkout-cancel.html', (req, res) => {
    const orderId = req.query.order_id || '';
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Cancelled - Empire Fashion House</title>
<style>body{font-family:Helvetica,Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f9f9f9;color:#111;}
.box{text-align:center;background:#fff;padding:50px;border-radius:10px;box-shadow:0 5px 20px rgba(0,0,0,.1);max-width:400px;width:90%;}
.box .icon{font-size:70px;margin-bottom:15px;}
.box h1{color:#111;font-size:28px;margin-bottom:10px;}
.box p{color:#777;line-height:1.6;margin-bottom:25px;}
.box a{display:inline-block;padding:14px 35px;background:#111;color:#fff;border-radius:5px;font-weight:bold;text-decoration:none;transition:.3s;margin:5px;}
.box a:hover{background:#D4AF37;}
</style></head><body><div class="box"><div class="icon">💳</div><h1>Payment Cancelled</h1>
<p>Your payment was not completed. Order #EMP${esc(orderId)} remains pending. You can try again or pay with Cash on Delivery.</p>
<a href="/">Continue Shopping</a></div></body></html>`);
});

initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`Empire Fashion House running at http://localhost:${PORT} (PostgreSQL connected)`);
    });
}).catch(e => {
    console.error('Database init failed:', e);
    process.exit(1);
});
