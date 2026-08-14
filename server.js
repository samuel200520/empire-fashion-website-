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
    const { customer, email, phone, address, items, amount } = req.body || {};
    if (!customer || !Array.isArray(items) || items.length === 0 || !amount) {
        return res.status(400).json({ error: 'Missing order details' });
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
    const allowed = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
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

app.listen(PORT, () => {
    console.log(`Empire Fashion House running at http://localhost:${PORT}`);
});