/**
 * Quick-start catalog seeder for Empire Fashion House.
 * Run with `npm run seed` (after the server has started once so tables exist).
 *
 * Idempotent: existing products keep their uploaded photo; only missing fields
 * (category, sizes, colors, stock) are filled in. New products get a branded
 * placeholder image so the store renders out of the box — replace them with
 * real photos via the admin dashboard.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load .env the same way server.js does (Render sets real env vars instead)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('FATAL: DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
}

const needsSsl = !/localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined
});

function xmlEscape(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Branded SVG placeholder (data URI) so seeded products always render
function placeholderImage(name) {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">' +
        '<rect width="600" height="600" fill="#111"/>' +
        '<rect x="12" y="12" width="576" height="576" fill="none" stroke="#D4AF37" stroke-width="2"/>' +
        '<text x="300" y="270" text-anchor="middle" font-family="Georgia, serif" font-size="40" letter-spacing="5" fill="#D4AF37">EMPIRE</text>' +
        `<text x="300" y="330" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#fff">${xmlEscape(name)}</text>` +
        '<text x="300" y="370" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" letter-spacing="3" fill="#999">ADD YOUR PHOTO IN ADMIN</text>' +
        '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const SEED_PRODUCTS = [
    { name: 'Nike Air Force 1', price: 300, category: 'shoes', sizes: ['39', '40', '41', '42', '43', '44'], colors: ['White', 'Black', 'Gold'], stock: 8 },
    { name: 'Classic Black Bomber Jacket', price: 850, category: 'men', sizes: ['S', 'M', 'L', 'XL'], colors: ['Black'], stock: 5 },
    { name: 'Emperor Luxury Tee', price: 180, category: 'men', sizes: ['S', 'M', 'L', 'XL'], colors: ['Black', 'White', 'Gold'], stock: 12 },
    { name: 'Slim-Fit Denim Jeans', price: 420, category: 'men', sizes: ['30', '32', '34', '36'], colors: ['Blue', 'Black'], stock: 7 },
    { name: 'Regina Elegant Dress', price: 690, category: 'women', sizes: ['S', 'M', 'L'], colors: ['Wine', 'Black', 'Cream'], stock: 4 },
    { name: 'Silk Luxe Scarf', price: 120, category: 'women', sizes: [''], colors: ['Gold', 'Cream'], stock: null },
    { name: 'Classic Shoulder Handbag', price: 540, category: 'women', sizes: [''], colors: ['Black', 'Brown', 'Beige'], stock: 6 },
    { name: 'Air Jordan Retro 4', price: 520, category: 'shoes', sizes: ['40', '41', '42', '43', '44'], colors: ['Black', 'Red', 'White'], stock: 6 },
    { name: 'Premium Leather Oxfords', price: 610, category: 'shoes', sizes: ['40', '41', '42', '43', '44'], colors: ['Brown', 'Black'], stock: 5 },
    { name: 'Gold Chain Necklace', price: 250, category: 'accessories', sizes: [''], colors: ['Gold'], stock: null },
    { name: 'Champion Snapback Cap', price: 95, category: 'accessories', sizes: [''], colors: ['Black', 'Gold', 'Navy'], stock: 15 },
    { name: 'Luxury Aviator Sunglasses', price: 200, category: 'accessories', sizes: [''], colors: ['Gold', 'Black'], stock: 9 }
];

(async () => {
    const client = await pool.connect();
    try {
        const table = await client.query("SELECT to_regclass('public.products') AS t");
        if (!table.rows[0].t) {
            console.log('Products table not found. Start the server once (npm start), then re-run: npm run seed');
            return;
        }
        let added = 0, updated = 0;
        for (const p of SEED_PRODUCTS) {
            const existing = await client.query('SELECT id, stock FROM products WHERE name = $1', [p.name]);
            const sizes = p.sizes.join(',');
            const colors = p.colors.join(',');
            const stock = p.stock === null || p.stock === undefined ? null : p.stock;
            if (existing.rows.length > 0) {
                await client.query(
                    'UPDATE products SET category = $1, sizes = $2, colors = $3, stock = COALESCE($4, stock) WHERE id = $5',
                    [p.category, sizes, colors, stock, existing.rows[0].id]);
                updated++;
            } else {
                await client.query(
                    'INSERT INTO products (name, price, category, image, sizes, colors, stock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [p.name, p.price, p.category, placeholderImage(p.name), sizes, colors, stock]);
                added++;
            }
        }
        console.log(`Seed complete: ${added} products added, ${updated} updated across men/women/shoes/accessories.`);
        console.log('Log in at /login.html (default admin / empire123) to add real product photos.');
    } catch (e) {
        console.error('Seed error:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        pool.end().then(() => process.exit());
    }
})();