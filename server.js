const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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

app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));

// ---- Session/auth setup ----
app.use(session({
    secret: process.env.SESSION_SECRET || 'empire-fashion-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
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
    `);

    // Migration: add sizes/stock to products created before this feature.
    // stock NULL means unlimited (legacy products keep selling).
    await pool.query(`
        ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS colors TEXT NOT NULL DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT;
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
function mapProduct(r) {
    return {
        id: r.id, name: r.name, price: Number(r.price), category: r.category, image: r.image,
        sizes: String(r.sizes || '').split(',').map(s => s.trim()).filter(Boolean),
        colors: String(r.colors || '').split(',').map(c => c.trim()).filter(Boolean),
        stock: r.stock === null || r.stock === undefined ? null : Number(r.stock)
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
        status: r.status, date: r.date
    };
}

async function getAdmin() {
    const r = await pool.query('SELECT username, password_hash FROM admin WHERE id = 1');
    return r.rows[0];
}

// ---- Auth ----
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    try {
        const admin = await getAdmin();
        if (admin && username === admin.username && await bcrypt.compare(password || '', admin.password_hash)) {
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
    const r = await pool.query('SELECT * FROM products ORDER BY id');
    res.json(r.rows.map(mapProduct));
});

app.post('/api/orders', async (req, res) => {
    const { customer, email, phone, address, items, amount, paymentMethod, paymentRef } = req.body || {};
    if (!customer || !Array.isArray(items) || items.length === 0 || !amount) {
        return res.status(400).json({ error: 'Missing order details' });
    }
    const method = ['cod'].includes(paymentMethod) ? paymentMethod : 'cod';
    try {
        const r = await pool.query(
            `INSERT INTO orders (customer, email, phone, address, product, items, amount, payment_method, payment_ref, status)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 'Pending')
             RETURNING *, to_char(created_at, 'YYYY-MM-DD') AS date`,
            [String(customer).slice(0, 100), String(email || '').slice(0, 100), String(phone || '').slice(0, 30),
             String(address || '').slice(0, 200), itemsSummary(items),
             JSON.stringify(items), Number(amount), method, paymentRef ? String(paymentRef).slice(0, 50) : '']);
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
    const { name, price, image, category, sizes, colors, stock } = req.body || {};
    if (!name || !price || !image) return res.status(400).json({ error: 'Missing product fields' });
    try {
        const r = await pool.query(
            'INSERT INTO products (name, price, category, image, sizes, colors, stock) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [String(name).slice(0, 100), Number(price), String(category || '').toLowerCase().slice(0, 30), image,
             normList(sizes), normList(colors), normStock(stock)]);
        res.status(201).json(mapProduct(r.rows[0]));
    } catch (e) {
        console.error('Create product error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/products/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { name, price, image, category, sizes, colors, stock } = req.body || {};
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
            stock: stock !== undefined ? normStock(stock) : (p.stock ?? null)
        };
        const u = await pool.query(
            'UPDATE products SET name = $1, price = $2, image = $3, category = $4, sizes = $5, colors = $6, stock = $7 WHERE id = $8 RETURNING *',
            [merged.name, merged.price, merged.image, merged.category, merged.sizes, merged.colors, merged.stock, id]);
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

    const { customer, email, phone, address, items, amount } = req.body || {};
    if (!customer || !Array.isArray(items) || items.length === 0 || !amount) {
        return res.status(400).json({ error: 'Missing order details' });
    }

    const origin = req.get('origin') || req.protocol + '://' + req.get('host');
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}`;

    try {
        // 1. Create the order locally first (status: Pending)
        const ins = await pool.query(
            `INSERT INTO orders (customer, email, phone, address, product, items, amount, payment_method, payment_ref, monime_session_id, status)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'monime', '', '', 'Pending')
             RETURNING id`,
            [String(customer).slice(0, 100), String(email || '').slice(0, 100), String(phone || '').slice(0, 30),
             String(address || '').slice(0, 200), itemsSummary(items),
             JSON.stringify(items), Number(amount)]);
        const orderId = ins.rows[0].id;

        await applyStock(items);

        await pool.query(
            `INSERT INTO customers (name, email, spent) VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET spent = customers.spent + EXCLUDED.spent`,
            [String(customer).slice(0, 100), String(email || '').slice(0, 100) || 'unknown@example.com', Number(amount)]);

        // 2. Call Monime to create a hosted checkout session
        // Amounts in minor units: SLE 25 = value 2500
        const sessionBody = {
            name: `Empire Fashion House - Order #EMP${orderId}`,
            successUrl: `${origin}/checkout-success.html?order_id=${orderId}`,
            cancelUrl: `${origin}/checkout-cancel.html?order_id=${orderId}`,
            callbackState: `${orderId}`,
            lineItems: items.map(i => ({
                type: 'custom',
                name: i.name,
                price: {
                    currency: 'SLE',
                    value: Math.round(Number(i.price) * 100)
                },
                quantity: 1
            }))
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
