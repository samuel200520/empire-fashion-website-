const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const DB_FILE = path.join(__dirname, 'db.json');
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH ||
    bcrypt.hashSync('empire123', 10);

// Passwords changed via Settings are stored in db.json and override the defaults
function getAdmin() {
    const db = readDb();
    if (db.admin && db.admin.passwordHash) {
        return { username: db.admin.username || ADMIN_USER, passwordHash: db.admin.passwordHash };
    }
    return { username: ADMIN_USER, passwordHash: ADMIN_PASS_HASH };
}

app.use(express.json({ limit: '15mb' }));

// ---- JSON file database ----
function readDb() {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDb(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function nextId(collection) {
    return collection.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

// ---- Serve the static website ----
app.use(express.static(__dirname));

// ---- Session/auth setup ----
app.use(session({
    secret: process.env.SESSION_SECRET || 'empire-fashion-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    const admin = getAdmin();
    if (username === admin.username && await bcrypt.compare(password || '', admin.passwordHash)) {
        req.session.admin = true;
        res.json({ ok: true });
    } else {
        res.status(401).json({ ok: false, error: 'Invalid username or password' });
    }
});

app.post('/api/password', requireAdmin, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const admin = getAdmin();
    if (!await bcrypt.compare(currentPassword || '', admin.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (!newPassword || String(newPassword).length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const db = readDb();
    db.admin = { username: admin.username, passwordHash: bcrypt.hashSync(String(newPassword), 10) };
    writeDb(db);
    res.json({ ok: true });
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

// ---- Public API (anyone can use) ----
app.get('/api/products', (req, res) => res.json(readDb().products));

app.post('/api/orders', (req, res) => {
    const { customer, email, phone, address, items, amount, paymentMethod, paymentRef } = req.body || {};
    if (!customer || !Array.isArray(items) || items.length === 0 || !amount) {
        return res.status(400).json({ error: 'Missing order details' });
    }
    const PAYMENT_METHODS = ['cod', 'orange', 'afrimoney'];
    const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'cod';
    if ((method === 'orange' || method === 'afrimoney') && !paymentRef) {
        return res.status(400).json({ error: 'Transaction reference required for mobile money orders' });
    }
    const db = readDb();
    const order = {
        id: nextId(db.orders),
        customer: String(customer).slice(0, 100),
        email: String(email || '').slice(0, 100),
        phone: String(phone || '').slice(0, 30),
        address: String(address || '').slice(0, 200),
        product: items.map(i => i.name).join(', '),
        amount: Number(amount),
        paymentMethod: method,
        paymentRef: paymentRef ? String(paymentRef).slice(0, 50) : '',
        date: new Date().toISOString().split('T')[0],
        status: 'Pending'
    };
    db.orders.push(order);

    let cust = db.customers.find(c => c.name === order.customer);
    if (cust) {
        cust.spent = (parseFloat(cust.spent) || 0) + order.amount;
    } else {
        db.customers.push({
            id: nextId(db.customers),
            name: order.customer,
            email: order.email || 'unknown@example.com',
            spent: order.amount
        });
    }
    writeDb(db);
    res.status(201).json(order);
});

// ---- Admin-only API ----
app.get('/api/orders', requireAdmin, (req, res) => res.json(readDb().orders));
app.get('/api/customers', requireAdmin, (req, res) => res.json(readDb().customers));

app.patch('/api/orders/:id', requireAdmin, (req, res) => {
    const db = readDb();
    const order = db.orders.find(o => o.id === Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const allowed = ['Pending', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!allowed.includes(req.body.status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    order.status = req.body.status;
    writeDb(db);
    res.json(order);
});

app.post('/api/products', requireAdmin, (req, res) => {
    const { name, price, image, category } = req.body || {};
    if (!name || !price || !image) return res.status(400).json({ error: 'Missing product fields' });
    const db = readDb();
    const product = {
        id: nextId(db.products),
        name: String(name).slice(0, 100),
        price: Number(price),
        category: String(category || '').toLowerCase().slice(0, 30),
        image
    };
    db.products.push(product);
    writeDb(db);
    res.status(201).json(product);
});

app.patch('/api/products/:id', requireAdmin, (req, res) => {
    const db = readDb();
    const product = db.products.find(p => p.id === Number(req.params.id));
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const { name, price, image, category } = req.body || {};
    if (name !== undefined) product.name = String(name).slice(0, 100);
    if (price !== undefined) product.price = Number(price);
    if (image !== undefined) product.image = image;
    if (category !== undefined) product.category = String(category).toLowerCase().slice(0, 30);
    writeDb(db);
    res.json(product);
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
    const db = readDb();
    const before = db.products.length;
    db.products = db.products.filter(p => p.id !== Number(req.params.id));
    if (db.products.length === before) return res.status(404).json({ error: 'Product not found' });
    writeDb(db);
    res.json({ ok: true });
});

// Redirect old json-server URLs
app.use(['/products', '/orders', '/customers'], (req, res) => {
    res.redirect(308, req.originalUrl.replace(/^\/(products|orders|customers)/, m => '/api' + m));
});

// ---- Monime Payment Gateway ----
const MONIME_TOKEN = process.env.MONIME_TOKEN || '';
const MONIME_SPACE = process.env.MONIME_SPACE || '';
const MONIME_API = 'https://api.monime.io';

function monimeHeaders(idempotencyKey) {
    return {
        'Authorization': `Bearer ${MONIME_TOKEN}`,
        'Content-Type': 'application/json',
        'Monime-Version': 'caph.2025-08-23',
        'Monime-Space-Id': MONIME_SPACE,
        'Idempotency-Key': idempotencyKey
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
    const idempotencyKey = `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
        // 1. Create the order locally first (status: Pending)
        const db = readDb();
        const orderId = nextId(db.orders);
        const order = {
            id: orderId,
            customer: String(customer).slice(0, 100),
            email: String(email || '').slice(0, 100),
            phone: String(phone || '').slice(0, 30),
            address: String(address || '').slice(0, 200),
            product: items.map(i => i.name).join(', '),
            amount: Number(amount),
            paymentMethod: 'monime',
            paymentRef: '',
            monimeSessionId: '',
            date: new Date().toISOString().split('T')[0],
            status: 'Pending'
        };
        db.orders.push(order);

        let cust = db.customers.find(c => c.name === order.customer);
        if (cust) {
            cust.spent = (parseFloat(cust.spent) || 0) + order.amount;
        } else {
            db.customers.push({
                id: nextId(db.customers),
                name: order.customer,
                email: order.email || 'unknown@example.com',
                spent: order.amount
            });
        }
        writeDb(db);

        // 2. Call Monime to create a hosted checkout session
        // Amounts are in the currency's minor unit: SLE 1 = 100 (cents)
        const amountInCents = Math.round(Number(amount) * 100);

        const sessionBody = {
            name: `Empire Fashion House - Order #EMP${orderId}`,
            description: items.map(i => i.name).join(', '),
            successUrl: `${origin}/checkout-success.html?order_id=${orderId}`,
            cancelUrl: `${origin}/checkout-cancel.html?order_id=${orderId}`,
            reference: `EMP${orderId}`,
            callbackState: `${orderId}`,
            lineItems: items.map(i => ({
                type: 'custom',
                name: i.name,
                price: {
                    currency: 'SLE',
                    value: Math.round(Number(i.price) * 100)
                },
                quantity: 1
            })),
            paymentOptions: {
                momo: { disable: false },
                card: { disable: false },
                bank: { disable: false },
                wallet: { disable: false }
            },
            brandingOptions: {
                primaryColor: '#D4AF37'
            }
        };

        const monimeRes = await fetch(`${MONIME_API}/v1/checkout-sessions`, {
            method: 'POST',
            headers: monimeHeaders(idempotencyKey),
            body: JSON.stringify(sessionBody)
        });

        if (!monimeRes.ok) {
            const errBody = await monimeRes.text();
            console.error('Monime error:', monimeRes.status, errBody);
            return res.status(502).json({ error: 'Failed to create Monime checkout session. Try Cash on Delivery instead.' });
        }

        const sessionData = await monimeRes.json();
        const redirectUrl = sessionData?.result?.redirectUrl;

        if (!redirectUrl) {
            console.error('Monime response missing redirectUrl:', JSON.stringify(sessionData).slice(0, 500));
            return res.status(502).json({ error: 'Monime returned an unexpected response. Try again or use Cash on Delivery.' });
        }

        // Save the Monime session ID on our order
        const db2 = readDb();
        const savedOrder = db2.orders.find(o => o.id === orderId);
        if (savedOrder) {
            savedOrder.monimeSessionId = sessionData.result.id || '';
            writeDb(db2);
        }

        // 3. Return the redirect URL so the frontend can send the customer there
        res.json({ redirectUrl, orderId });

    } catch (error) {
        console.error('Monime checkout error:', error);
        res.status(500).json({ error: 'Something went wrong. Try Cash on Delivery instead.' });
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

        // Only process checkout_session.completed events
        if (eventName === 'checkout_session.completed' && status === 'completed') {
            const db = readDb();
            // Find order by callbackState (our order ID) or by monimeSessionId
            let order = null;
            if (callbackState) {
                order = db.orders.find(o => o.id === Number(callbackState));
            }
            if (!order && sessionId) {
                order = db.orders.find(o => o.monimeSessionId === sessionId);
            }
            if (!order && orderNumber) {
                order = db.orders.find(o => `EMP${o.id}` === orderNumber);
            }

            if (order && order.status === 'Pending') {
                order.status = 'Paid';
                if (sessionId) order.monimeSessionId = sessionId;
                if (orderNumber) order.paymentRef = orderNumber;
                writeDb(db);
                console.log(`Order #EMP${order.id} marked as Paid via Monime`);
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
<a href="/">Continue Shopping</a><a href="/">Try Again</a></div></body></html>`);
});

app.listen(PORT, () => {
    console.log(`Empire Fashion House running at http://localhost:${PORT}`);
});