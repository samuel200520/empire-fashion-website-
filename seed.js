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
    { name: 'Nike Air Force 1', price: 300, category: 'shoes', sizes: ['39', '40', '41', '42', '43', '44'], colors: ['White', 'Black', 'Gold'], stock: 8, description: 'The timeless classic. Clean leather uppers, cushioned sole and a look that never goes out of style.' },
    { name: 'Classic Black Bomber Jacket', price: 850, category: 'clothing', sizes: ['S', 'M', 'L', 'XL'], colors: ['Black'], stock: 5, description: 'Premium black bomber with ribbed cuffs and a modern slim fit. A wardrobe essential for every season.' },
    { name: 'Emperor Luxury Tee', price: 180, category: 'clothing', sizes: ['S', 'M', 'L', 'XL'], colors: ['Black', 'White', 'Gold'], stock: 12, description: 'Soft 100% cotton tee with a bold gold crown print. Comfortable, breathable and built to last.' },
    { name: 'Slim-Fit Denim Jeans', price: 420, category: 'clothing', sizes: ['30', '32', '34', '36'], colors: ['Blue', 'Black'], stock: 7, description: 'Stretch slim-fit denim with a clean finish. Pair it with anything for an effortless everyday look.' },
    { name: 'Regina Elegant Dress', price: 690, category: 'clothing', sizes: ['S', 'M', 'L'], colors: ['Wine', 'Black', 'Cream'], stock: 4, description: 'An elegant figure-hugging dress, perfect for weddings, parties and special occasions.' },
    { name: 'Silk Luxe Scarf', price: 120, category: 'ladies-accessories', sizes: [''], colors: ['Gold', 'Cream'], stock: null, description: 'Smooth luxury silk scarf. Lightweight and versatile — wear it around your neck, waist or bag.' },
    { name: 'Classic Shoulder Handbag', price: 540, category: 'ladies-accessories', sizes: [''], colors: ['Black', 'Brown', 'Beige'], stock: 6, description: 'Chic shoulder handbag with a structured shape and a spacious interior. Stylish enough for every day.' },
    { name: 'Air Jordan Retro 4', price: 520, category: 'shoes', sizes: ['40', '41', '42', '43', '44'], colors: ['Black', 'Red', 'White'], stock: 6, description: 'Retro basketball icon with premium leather and visible Air cushioning. A must-have for sneakerheads.' },
    { name: 'Premium Leather Oxfords', price: 610, category: 'shoes', sizes: ['40', '41', '42', '43', '44'], colors: ['Brown', 'Black'], stock: 5, description: 'Hand-finished leather oxfords for work or smart occasions. Polished, durable and comfortable.' },
    { name: 'Gold Chain Necklace', price: 250, category: 'ladies-accessories', sizes: [''], colors: ['Gold'], stock: null, description: 'Shiny gold-tone chain necklace with a secure clasp. Adds a touch of luxury to any outfit.' },
    { name: 'Champion Snapback Cap', price: 95, category: 'other', sizes: [''], colors: ['Black', 'Gold', 'Navy'], stock: 15, description: 'Classic snapback cap with an embroidered front. Adjustable fit for all head sizes.' },
    { name: 'Luxury Aviator Sunglasses', price: 200, category: 'other', sizes: [''], colors: ['Gold', 'Black'], stock: 9, description: 'Stylish aviator sunglasses with UV400 protection. Look sharp while shielding your eyes.' },
    { name: 'A5 Exercise Books (Pack of 4)', price: 40, category: 'school-supplies', sizes: [''], colors: ['Blue'], stock: 100, description: 'Quality A5 exercise books, 80 pages each. Perfect for class notes and homework.' },
    { name: 'Geometry Set', price: 25, category: 'school-supplies', sizes: [''], colors: ['White'], stock: 60, description: 'Complete geometry set — compass, ruler, protractor and set squares in a sturdy case.' },
    { name: 'School Backpack', price: 180, category: 'school-supplies', sizes: [''], colors: ['Black', 'Blue', 'Red'], stock: 20, description: 'Durable padded backpack with multiple compartments. Room for books, stationery and a laptop.' }
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
                    `UPDATE products SET category = $1, sizes = $2, colors = $3, stock = COALESCE($4, stock),
                     description = COALESCE(NULLIF($5, ''), description) WHERE id = $6`,
                    [p.category, sizes, colors, stock, p.description || '', existing.rows[0].id]);
                updated++;
            } else {
                await client.query(
                    `INSERT INTO products (name, price, category, image, sizes, colors, stock, description)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [p.name, p.price, p.category, placeholderImage(p.name), sizes, colors, stock, p.description || '']);
                added++;
            }
        }
        console.log(`Seed complete: ${added} products added, ${updated} updated across clothing/shoes/school-supplies/ladies-accessories/other.`);
        console.log('Log in at /login.html (default admin / empire123) to add real product photos.');
    } catch (e) {
        console.error('Seed error:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        pool.end().then(() => process.exit());
    }
})();