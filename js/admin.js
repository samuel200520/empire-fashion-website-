const API_URL = "";

let allOrders = [];
let allProducts = [];
let allCustomers = [];
let allReviews = [];
let allPromos = [];
let searchTerm = "";

// ---- Helpers ----
function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
}

// Branded fallback so products without a working photo don't show a broken image in admin
const IMG_FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">' +
    '<rect width="600" height="600" fill="#111"/>' +
    '<rect x="12" y="12" width="576" height="576" fill="none" stroke="#D4AF37" stroke-width="2"/>' +
    '<text x="300" y="285" text-anchor="middle" font-family="Georgia, serif" font-size="46" letter-spacing="6" fill="#D4AF37">EMPIRE</text>' +
    '<text x="300" y="330" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" letter-spacing="3" fill="#ccc">FASHION HOUSE</text>' +
    '</svg>'
);
function imgAttr(src, alt) {
    return `src="${esc(src)}" alt="${esc(alt)}" onerror="this.onerror=null;this.src='${IMG_FALLBACK}';"`;
}

function waLink(phone, text) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function matchesSearch(...fields) {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return fields.some(f => String(f || '').toLowerCase().includes(term));
}

function calcTrend(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
}

function renderTrend(elId, current, previous) {
    const el = document.getElementById(elId);
    if (!el) return;
    const pct = calcTrend(current, previous);
    const up = pct >= 0;
    el.className = `trend ${up ? 'up' : 'down'}`;
    el.innerHTML = `<i class="fas fa-arrow-${up ? 'up' : 'down'}"></i> ${Math.abs(pct).toFixed(1)}% vs last month`;
}

// ---- 1. Auth ----
async function checkAuth() {
    try {
        const res = await fetch(`${API_URL}/api/me`);
        const data = await res.json();
        if (!data.loggedIn) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    } catch (e) {
        window.location.href = 'login.html';
        return false;
    }
}

function logout() {
    fetch(`${API_URL}/api/logout`, { method: 'POST' }).finally(() => {
        window.location.href = 'login.html';
    });
}

// ---- 2. UI Toggles ----
function toggleSidebar() {
    const side = document.getElementById('sidebar');
    // On mobile the sidebar is an off-canvas drawer that slides in/out
    if (window.innerWidth <= 768) {
        const open = side.classList.toggle('open');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (backdrop) backdrop.classList.toggle('show', open);
        return;
    }
    side.classList.toggle('collapsed');
    localStorage.setItem('sidebar_collapsed', side.classList.contains('collapsed'));
}
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('dark_mode', isDark);
    const icon = document.getElementById('theme-icon');
    icon.classList.toggle('fa-moon', !isDark);
    icon.classList.toggle('fa-sun', isDark);
}

// ---- 3. SPA View Switcher ----
function switchView(viewName, event) {
    // On mobile, close the off-canvas sidebar once a view is chosen
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (backdrop) backdrop.classList.remove('show');
    }
    document.querySelectorAll('.content-view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + viewName).classList.add('active');

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(nav => nav.classList.remove('active'));
    if (event && event.currentTarget && event.currentTarget.closest('.sidebar-nav')) {
        event.currentTarget.classList.add('active');
    } else {
        // Highlight nav item for programmatic switches (e.g. bell click)
        const idx = { dashboard: 0, orders: 1, products: 2, customers: 3, settings: 4 }[viewName];
        if (idx !== undefined) {
            const items = document.querySelectorAll('.sidebar-nav .nav-item');
            if (items[idx]) items[idx].classList.add('active');
        }
    }
}

// ---- 4. Toast ----
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ---- 5. Data loading ----
async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
}

async function loadAllData() {
    try {
        const [orders, customers, products, reviews, promos] = await Promise.all([
            fetchJson(`${API_URL}/api/orders`),
            fetchJson(`${API_URL}/api/customers`),
            fetchJson(`${API_URL}/api/products`),
            fetchJson(`${API_URL}/api/reviews`),
            fetchJson(`${API_URL}/api/promos`)
        ]);
        allOrders = orders.sort((a, b) => new Date(b.date) - new Date(a.date));
        allCustomers = customers;
        allProducts = products;
        allReviews = reviews;
        allPromos = promos;
    } catch (error) {
        console.error("Failed to fetch data:", error);
        showToast("Error connecting to database.");
        return;
    }
    renderDashboard();
    renderOrders();
    renderInventory();
    renderCustomers();
    renderReviews();
    renderPromos();
    updateBadges();
}

function updateBadges() {
    const pending = allOrders.filter(o => o.status === 'Pending').length;
    const ordersBadge = document.getElementById('orders-badge');
    const notifBadge = document.getElementById('notif-badge');
    if (ordersBadge) ordersBadge.textContent = pending > 0 ? pending : '';
    if (notifBadge) notifBadge.textContent = pending > 0 ? pending : '';
}

// Order product names — prefer the items array; variant commas would break naive splitting
function orderItems(o) {
    if (Array.isArray(o.items) && o.items.length > 0) return o.items.map(i => i.name);
    return String(o.product || '').split(',').map(s => s.trim()).filter(Boolean);
}

// ---- 6. Dashboard ----
function renderDashboard() {
    const revenue = allOrders.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
    const totalItems = allOrders.reduce((sum, o) => sum + orderItems(o).length, 0);

    // This month vs last month for real trends
    const now = new Date();
    const thisKey = now.toISOString().substring(0, 7);
    const lastKey = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().substring(0, 7);

    const revThis = allOrders.filter(o => (o.date || '').startsWith(thisKey)).reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
    const revLast = allOrders.filter(o => (o.date || '').startsWith(lastKey)).reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
    const ordThis = allOrders.filter(o => (o.date || '').startsWith(thisKey)).length;
    const ordLast = allOrders.filter(o => (o.date || '').startsWith(lastKey)).length;
    const itemsThis = allOrders.filter(o => (o.date || '').startsWith(thisKey)).reduce((s, o) => s + orderItems(o).length, 0);
    const itemsLast = allOrders.filter(o => (o.date || '').startsWith(lastKey)).reduce((s, o) => s + orderItems(o).length, 0);

    const custsThisMonth = new Set(allOrders.filter(o => (o.date || '').startsWith(thisKey)).map(o => o.customer)).size;
    const custsLastMonth = new Set(allOrders.filter(o => (o.date || '').startsWith(lastKey)).map(o => o.customer)).size;

    document.getElementById('kpi-revenue').innerText = `NLE ${revenue.toLocaleString()}`;
    document.getElementById('kpi-orders').innerText = allOrders.length.toLocaleString();
    document.getElementById('kpi-customers').innerText = allCustomers.length.toLocaleString();
    document.getElementById('kpi-products').innerText = totalItems.toLocaleString();

    renderTrend('kpi-trend-revenue', revThis, revLast);
    renderTrend('kpi-trend-orders', ordThis, ordLast);
    renderTrend('kpi-trend-customers', custsThisMonth, custsLastMonth);
    renderTrend('kpi-trend-products', itemsThis, itemsLast);

    const tbody = document.getElementById('recent-orders-body');
    if (tbody) {
        tbody.innerHTML = allOrders.slice(0, 5).map(o => `
            <tr>
                <td><strong>#EMP${o.id}</strong></td>
                <td>${esc(o.customer)}</td>
                <td>${esc(o.product)}</td>
                <td>NLE ${(parseFloat(o.amount) || 0).toLocaleString()}</td>
                <td>${o.date ? new Date(o.date).toLocaleDateString() : '--'}</td>
                <td><span class="status-badge status-${String(o.status).toLowerCase()}">${esc(o.status)}</span></td>
            </tr>
        `).join('');
    }

    renderLowStock();
    renderBestSellers();
}

function renderLowStock() {
    const el = document.getElementById('lowstock-list');
    if (!el) return;
    const low = allProducts.filter(p => p.stock !== null && p.stock !== undefined && p.stock <= 3);
    const countEl = document.getElementById('lowstock-count');
    if (countEl) countEl.innerText = low.length;
    if (low.length === 0) {
        el.innerHTML = '<p style="color:var(--text-muted);">All stocked up 👍 (or stock not tracked)</p>';
        return;
    }
    el.innerHTML = low.slice(0, 6).map(p => `
        <div class="mini-list-row">
            <img src="${esc(p.image)}" alt="">
            <span class="mini-name">${esc(p.name)}</span>
            <span class="${p.stock === 0 ? 'stock-out' : 'stock-low'}">${p.stock === 0 ? 'OUT OF STOCK' : p.stock + ' left'}</span>
        </div>
    `).join('');
}

function renderBestSellers() {
    const el = document.getElementById('bestsellers-list');
    if (!el) return;
    const tally = {};
    allOrders.forEach(o => orderItems(o).forEach(name => { tally[name] = (tally[name] || 0) + 1; }));
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (top.length === 0) {
        el.innerHTML = '<p style="color:var(--text-muted);">No sales yet.</p>';
        return;
    }
    el.innerHTML = top.map(([name, qty], i) => `
        <div class="mini-list-row">
            <span class="rank">${i + 1}</span>
            <span class="mini-name">${esc(name)}</span>
            <span class="qty">${qty} sold</span>
        </div>
    `).join('');
}

// ---- 7. Orders ----
function renderOrders() {
    const tbody = document.getElementById('all-orders-body');
    if (!tbody) return;

    const filterSel = document.getElementById('order-status-filter');
    const statusFilter = filterSel ? filterSel.value : 'All';

    const filtered = allOrders.filter(o =>
        (statusFilter === 'All' || o.status === statusFilter) &&
        matchesSearch(o.id, o.customer, o.product, o.status, o.email, o.phone, o.paymentMethod, o.paymentRef)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">No orders found.</td></tr>`;
        return;
    }

    const PAYMENT_LABELS = { cod: '💵 COD', orange: '🟠 Orange Money', afrimoney: '🔴 Afrimoney', monime: '💳 Monime' };

    tbody.innerHTML = filtered.map(o => {
        const link = waLink(o.phone, `Hello ${o.customer}, this is Empire Fashion House regarding your order #EMP${o.id} (${o.product}) for NLE ${o.amount}.`);
        const contactBtn = link
            ? `<a href="${link}" target="_blank" class="whatsapp-btn" title="Message on WhatsApp"><i class="fab fa-whatsapp"></i></a>`
            : `<span style="color:var(--text-muted)">--</span>`;
        const payment = PAYMENT_LABELS[o.paymentMethod] || esc(o.paymentMethod || '--');
        const ref = o.paymentRef ? `<br><small style="color:var(--text-muted)">Ref: ${esc(o.paymentRef)}</small>` : '';
        return `
            <tr>
                <td><strong>#EMP${o.id}</strong></td>
                <td>${esc(o.customer)}<br><small style="color:var(--text-muted)">${esc(o.address || '')}</small></td>
                <td>${esc(o.product)}</td>
                <td>NLE ${(parseFloat(o.amount) || 0).toLocaleString()}</td>
                <td>${payment}${ref}</td>
                <td>${o.date ? new Date(o.date).toLocaleDateString() : '--'}</td>
                <td><span class="status-badge status-${String(o.status).toLowerCase()}">${esc(o.status)}</span></td>
                <td>${contactBtn}</td>
                <td style="white-space:nowrap;">
                    <button onclick="viewOrder(${o.id})" class="icon-btn" title="View / Receipt"><i class="fas fa-receipt"></i></button>
                    <select onchange="updateOrderStatus(${o.id}, this.value)" class="chart-filter" style="padding: 5px;">
                        ${['Pending', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].map(s =>
                            `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`
                        ).join('')}
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

async function updateOrderStatus(orderId, newStatus) {
    try {
        const res = await fetch(`${API_URL}/api/orders/${orderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error();
        const updated = await res.json();
        const order = allOrders.find(o => o.id === orderId);
        if (order) order.status = updated.status;
        showToast(`Order #EMP${orderId} updated to ${newStatus}`);
        renderOrders();
        renderDashboard();
        updateBadges();
    } catch (error) {
        console.error("Error updating order:", error);
        showToast("Failed to update order status.");
    }
}

// ---- 7b. Order detail / receipt ----
function groupedItems(o) {
    const out = [];
    if (Array.isArray(o.items) && o.items.length > 0) {
        const map = new Map();
        o.items.forEach(i => {
            const k = `${i.name}|${i.size || ''}|${i.color || ''}`;
            if (map.has(k)) map.get(k).qty++;
            else map.set(k, { name: i.name, size: i.size || '', color: i.color || '', price: Number(i.price) || 0, qty: 1 });
        });
        map.forEach(v => out.push(v));
    } else {
        String(o.product || '').split(',').forEach(n => {
            const t = n.trim();
            if (t) out.push({ name: t, size: '', color: '', price: 0, qty: 1 });
        });
    }
    return out;
}

function itemLabel(i) {
    const parts = [i.size, i.color].filter(Boolean);
    return i.name + (parts.length ? ` (${parts.join(', ')})` : '');
}

const PAYMENT_NAMES = { cod: 'Cash on Delivery', orange: 'Orange Money', afrimoney: 'Afrimoney', monime: 'Monime (Card/MoMo/Bank)' };

function receiptText(o) {
    const items = groupedItems(o);
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const promoLine = o.promoCode ? `\nPromo ${o.promoCode}: -NLE ${(subtotal - o.amount).toFixed(2)}` : '';
    let text = `*EMPIRE FASHION HOUSE* 👑\nReceipt — Order #EMP${o.id}\nDate: ${o.date || ''}\n\nCustomer: ${o.customer}\n\n*Items:*\n`;
    items.forEach(i => { text += `• ${itemLabel(i)}${i.qty > 1 ? ` x${i.qty}` : ''} — NLE ${(i.price * i.qty).toFixed(2)}\n`; });
    text += `\nSubtotal: NLE ${subtotal.toFixed(2)}${promoLine}\n*Total: NLE ${(parseFloat(o.amount) || 0).toFixed(2)}*\nPayment: ${PAYMENT_NAMES[o.paymentMethod] || o.paymentMethod}${o.paymentRef ? ` (Ref: ${o.paymentRef})` : ''}\nStatus: ${o.status}\n\nThank you for shopping with Empire Fashion House!`;
    return text;
}

function viewOrder(id) {
    const o = allOrders.find(x => x.id === id);
    if (!o) return;
    const items = groupedItems(o);
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const link = waLink(o.phone, receiptText(o));

    document.getElementById('order-modal-body').innerHTML = `
        <div class="receipt">
            <h2 style="text-align:center;">EMPIRE FASHION HOUSE</h2>
            <p style="text-align:center; color:#777;">Order Receipt — #EMP${o.id}</p>
            <div class="receipt-row"><span>Customer</span><strong>${esc(o.customer)}</strong></div>
            <div class="receipt-row"><span>Phone</span><strong>${esc(o.phone || '--')}</strong></div>
            <div class="receipt-row"><span>Email</span><strong>${esc(o.email || '--')}</strong></div>
            <div class="receipt-row"><span>Address</span><strong>${esc(o.address || '--')}</strong></div>
            <div class="receipt-row"><span>Date</span><strong>${o.date || '--'}</strong></div>
            <div class="receipt-row"><span>Status</span><span class="status-badge status-${String(o.status).toLowerCase()}">${esc(o.status)}</span></div>
            <div class="receipt-row"><span>Payment</span><strong>${PAYMENT_NAMES[o.paymentMethod] || esc(o.paymentMethod || '--')}${o.paymentRef ? `<br><small>Ref: ${esc(o.paymentRef)}</small>` : ''}</strong></div>
            <h3 style="margin:18px 0 8px;">Items</h3>
            ${items.map(i => `
                <div class="receipt-row">
                    <span>${esc(itemLabel(i))}${i.qty > 1 ? ` <strong>×${i.qty}</strong>` : ''}</span>
                    <strong>NLE ${(i.price * i.qty).toFixed(2)}</strong>
                </div>
            `).join('')}
            <div class="receipt-row" style="border-top:2px solid #111; margin-top:8px; padding-top:8px;"><span>Subtotal</span><strong>NLE ${subtotal.toFixed(2)}</strong></div>
            ${o.promoCode ? `<div class="receipt-row" style="color:#28a745;"><span>Promo ${esc(o.promoCode)}</span><strong>-NLE ${(subtotal - parseFloat(o.amount)).toFixed(2)}</strong></div>` : ''}
            <div class="receipt-row" style="font-size:18px;"><span><strong>TOTAL</strong></span><strong style="color:#b8941f;">NLE ${(parseFloat(o.amount) || 0).toFixed(2)}</strong></div>
        </div>
    `;
    document.getElementById('order-modal-actions').innerHTML = `
        <button class="btn-primary" onclick="window.print()">🖨 Print Receipt</button>
        ${link ? `<a href="${link}" target="_blank" class="btn-primary" style="background:#25D366; text-decoration:none; display:inline-block;">🟢 Send on WhatsApp</a>` : ''}
    `;
    document.getElementById('order-modal').style.display = 'flex';
    document.getElementById('order-modal-overlay').style.display = 'block';
}

function closeOrderModal() {
    document.getElementById('order-modal').style.display = 'none';
    document.getElementById('order-modal-overlay').style.display = 'none';
}

function exportOrdersCSV() {
    if (allOrders.length === 0) {
        showToast("No orders to export.");
        return;
    }
    const headers = ['ID', 'Customer', 'Email', 'Phone', 'Address', 'Product', 'Amount', 'Payment Method', 'Payment Ref', 'Date', 'Status'];
    const PAYMENT_LABELS = { cod: 'Cash on Delivery', orange: 'Orange Money', afrimoney: 'Afrimoney', monime: 'Monime (Card/MoMo/Bank)' };
    const rows = allOrders.map(o => [
        `EMP${o.id}`, o.customer, o.email || '', o.phone || '', o.address || '',
        o.product, o.amount, PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod || '', o.paymentRef || '', o.date, o.status
    ]);
    const csv = '\ufeff' + [headers, ...rows]
        .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `empire-orders-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Orders exported to CSV.');
}

// ---- 9. Products ----
function renderInventory() {
    const tableBody = document.getElementById('inventory-list');
    if (!tableBody) return;

    const filtered = allProducts.filter(p => matchesSearch(p.name, p.category, p.price));
    tableBody.innerHTML = '';

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No products found.</td></tr>`;
        return;
    }
    filtered.forEach(product => {
        const sizes = product.sizes || [];
        const colors = product.colors || [];
        const stockCell = product.stock === null || product.stock === undefined
            ? '<span title="Unlimited">∞</span>'
            : `<span class="${product.stock === 0 ? 'stock-out' : product.stock <= 3 ? 'stock-low' : ''}">${product.stock}</span>`;
        tableBody.innerHTML += `
            <tr>
                <td><img ${imgAttr(product.image, product.name)}></td>
                <td>${esc(product.name)}</td>
                <td><span class="cat-badge">${esc(product.category || 'uncategorized')}</span></td>
                <td>NLE ${(parseFloat(product.price) || 0).toLocaleString()}</td>
                <td>${sizes.length > 0 ? sizes.map(s => `<span class="cat-badge">${esc(s)}</span>`).join(' ') : '--'}</td>
                <td>${colors.length > 0 ? colors.map(c => `<span class="cat-badge">${esc(c)}</span>`).join(' ') : '--'}</td>
                <td>${stockCell}</td>
                <td>
                    <button onclick="startEditProduct(${product.id})" class="icon-btn" title="Edit"><i class="fas fa-pen"></i></button>
                    <button onclick="deleteProduct(${product.id})" class="icon-btn" style="color: var(--danger);" title="Delete"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function startEditProduct(id) {
    const product = allProducts.find(p => p.id === id);
    if (!product) return;

    document.getElementById('product-form-title').innerText = `Edit: ${product.name}`;
    document.getElementById('product-edit-id').value = id;
    document.getElementById('product-name').value = product.name;
    document.getElementById('product-price').value = product.price;
    document.getElementById('product-category').value = product.category || 'men';
    document.getElementById('product-sizes').value = (product.sizes || []).join(', ');
    document.getElementById('product-colors').value = (product.colors || []).join(', ');
    document.getElementById('product-stock').value = product.stock ?? '';
    document.getElementById('image-hint').innerText = 'Leave empty to keep the current image.';
    document.getElementById('product-submit-btn').innerText = 'Update Product';
    document.getElementById('cancel-edit-btn').style.display = 'inline-block';

    document.getElementById('view-products').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
    document.getElementById('product-form-title').innerText = 'Add New Product';
    document.getElementById('product-form').reset();
    document.getElementById('product-edit-id').value = '';
    document.getElementById('image-hint').innerText = '';
    document.getElementById('product-submit-btn').innerText = 'Publish to Store';
    document.getElementById('cancel-edit-btn').style.display = 'none';
}

async function submitProduct(name, price, category, image, images) {
    const editId = document.getElementById('product-edit-id').value;
    const sizes = document.getElementById('product-sizes').value;
    const colors = document.getElementById('product-colors').value;
    const stock = document.getElementById('product-stock').value;
    if (editId) {
        const body = { name, price, category, sizes, colors, stock };
        if (image) body.image = image;
        if (images) body.images = images;
        const res = await fetch(`${API_URL}/api/products/${editId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(await serverError(res));
        showToast('Product updated!');
    } else {
        if (!image) {
            alert('Please choose a product image.');
            return false;
        }
        const res = await fetch(`${API_URL}/api/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, price, category, image, sizes, colors, stock, images: images || [] })
        });
        if (!res.ok) throw new Error(await serverError(res));
        showToast('Product saved to database!');
    }
    cancelEdit();
    await refreshProducts();
    return true;
}

async function serverError(res) {
    let msg = `Server error (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch (e) { }
    return msg;
}

// Resize + compress in the browser so photos from a phone don't blow up the upload
function compressImage(file, maxSide = 900, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the image file.'));
        reader.onload = ev => {
            const img = new Image();
            img.onerror = () => reject(new Error('Could not load the image. Try a JPG or PNG.'));
            img.onload = () => {
                const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleProductSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('product-name').value;
    const price = parseFloat(document.getElementById('product-price').value);
    const category = document.getElementById('product-category').value;
    const imageInput = document.getElementById('product-image');
    const imagesInput = document.getElementById('product-images');
    const submitBtn = document.getElementById('product-submit-btn');

    let image = null;
    let images = null;
    try {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Saving...';
        if (imageInput.files && imageInput.files[0]) {
            image = await compressImage(imageInput.files[0]);
        }
        // Extra gallery photos (up to 4), compressed smaller
        if (imagesInput.files && imagesInput.files.length > 0) {
            images = [];
            for (const file of Array.from(imagesInput.files).slice(0, 4)) {
                images.push(await compressImage(file, 700, 0.75));
            }
        }
        await submitProduct(name, price, category, image, images);
    } catch (err) {
        console.error(err);
        showToast('Failed to save product: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Publish to Store';
    }
}

async function refreshProducts() {
    try {
        allProducts = await fetchJson(`${API_URL}/api/products`);
        renderInventory();
    } catch (e) { console.error(e); }
}

// ---- 9b. Reviews moderation ----
function renderReviews() {
    const tbody = document.getElementById('reviews-list');
    if (!tbody) return;
    const filtered = allReviews.filter(r => matchesSearch(r.name, r.comment, r.product_name));
    const pending = allReviews.filter(r => !r.approved).length;
    const hint = document.getElementById('reviews-pending-hint');
    if (hint) hint.textContent = pending > 0 ? `${pending} waiting for approval` : '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No reviews yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = filtered.map(r => `
        <tr>
            <td>${esc(r.product_name || '#' + r.product_id)}</td>
            <td style="color:#D4AF37; white-space:nowrap;">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
            <td>${esc(r.name)}</td>
            <td style="max-width:250px;">${esc(r.comment)}</td>
            <td>${r.date || ''}</td>
            <td>${r.approved
                ? '<span class="status-badge status-delivered">Approved</span>'
                : '<span class="status-badge status-pending">Pending</span>'}</td>
            <td style="white-space:nowrap;">
                <button onclick="approveReview(${r.id}, ${!r.approved})" class="btn-text" title="${r.approved ? 'Unapprove' : 'Approve'}">${r.approved ? 'Unapprove' : '✓ Approve'}</button>
                <button onclick="deleteReview(${r.id})" class="icon-btn" style="color:var(--danger);" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function approveReview(id, approved) {
    try {
        const res = await fetch(`${API_URL}/api/reviews/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved })
        });
        if (!res.ok) throw new Error();
        const r = allReviews.find(x => x.id === id);
        if (r) r.approved = approved;
        showToast(approved ? 'Review approved — now visible on the store.' : 'Review hidden.');
        renderReviews();
    } catch (e) { showToast('Failed to update review.'); }
}

async function deleteReview(id) {
    if (!confirm('Delete this review permanently?')) return;
    try {
        const res = await fetch(`${API_URL}/api/reviews/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        allReviews = allReviews.filter(r => r.id !== id);
        showToast('Review deleted.');
        renderReviews();
    } catch (e) { showToast('Failed to delete review.'); }
}

// ---- 9c. Promo codes ----
function renderPromos() {
    const tbody = document.getElementById('promos-list');
    if (!tbody) return;
    if (allPromos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No promo codes yet — create one above!</td></tr>`;
        return;
    }
    tbody.innerHTML = allPromos.map(p => `
        <tr>
            <td><strong style="font-size:15px;">${esc(p.code)}</strong></td>
            <td>${p.percent}% off</td>
            <td>${p.date || ''}</td>
            <td>${p.active
                ? '<span class="status-badge status-delivered">Active</span>'
                : '<span class="status-badge status-cancelled">Paused</span>'}</td>
            <td style="white-space:nowrap;">
                <button onclick="togglePromo('${esc(p.code)}', ${!p.active})" class="btn-text">${p.active ? 'Pause' : 'Activate'}</button>
                <button onclick="deletePromo('${esc(p.code)}')" class="icon-btn" style="color:var(--danger);" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function handlePromoSubmit(e) {
    e.preventDefault();
    const code = document.getElementById('promo-code').value.trim();
    const percent = document.getElementById('promo-percent').value;
    if (!code || !percent) { showToast('Enter a code and a percentage.'); return; }
    try {
        const res = await fetch(`${API_URL}/api/promos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, percent })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed to create promo.'); return; }
        showToast(`Promo ${data.code} created (${data.percent}% off)!`);
        document.getElementById('promo-form').reset();
        allPromos = await fetchJson(`${API_URL}/api/promos`);
        renderPromos();
    } catch (e) { showToast('Failed to create promo.'); }
}

async function togglePromo(code, active) {
    try {
        const res = await fetch(`${API_URL}/api/promos/${code}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active })
        });
        if (!res.ok) throw new Error();
        const p = allPromos.find(x => x.code === code);
        if (p) p.active = active;
        showToast(active ? `${code} activated.` : `${code} paused.`);
        renderPromos();
    } catch (e) { showToast('Failed to update promo.'); }
}

async function deletePromo(code) {
    if (!confirm(`Delete promo ${code}?`)) return;
    try {
        const res = await fetch(`${API_URL}/api/promos/${code}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        allPromos = allPromos.filter(p => p.code !== code);
        showToast('Promo deleted.');
        renderPromos();
    } catch (e) { showToast('Failed to delete promo.'); }
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;
    try {
        const res = await fetch(`${API_URL}/api/products/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        showToast('Product deleted.');
        await refreshProducts();
    } catch (err) {
        console.error(err);
        showToast('Failed to delete product.');
    }
}

// ---- 10. Customers ----
function renderCustomers() {
    const tbody = document.getElementById('customers-body');
    if (!tbody) return;

    // Join customers with their orders to get phone + order counts
    const rows = allCustomers.map(c => {
        const myOrders = allOrders.filter(o => o.customer === c.name);
        const phone = myOrders.map(o => o.phone).find(Boolean) || '';
        const lastDate = myOrders.length > 0
            ? myOrders.map(o => o.date).sort().reverse()[0]
            : '';
        return { ...c, phone, orderCount: myOrders.length, lastDate };
    }).filter(c => matchesSearch(c.name, c.email, c.phone));

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No customers found.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(c => {
        const link = waLink(c.phone, `Hello ${c.name}, this is Empire Fashion House. Thank you for shopping with us!`);
        const contactBtn = link
            ? `<a href="${link}" target="_blank" class="whatsapp-btn" title="Message on WhatsApp"><i class="fab fa-whatsapp"></i></a>`
            : `<span style="color:var(--text-muted)">--</span>`;
        return `
            <tr>
                <td><strong>${esc(c.name)}</strong></td>
                <td>${esc(c.email || '--')}</td>
                <td>${esc(c.phone || '--')}</td>
                <td>${c.orderCount}</td>
                <td>NLE ${(parseFloat(c.spent) || 0).toLocaleString()}</td>
                <td>${c.lastDate ? new Date(c.lastDate).toLocaleDateString() : '--'}</td>
                <td>${contactBtn}</td>
            </tr>
        `;
    }).join('');
}

// ---- 11. Settings ----
async function handlePasswordSubmit(e) {
    e.preventDefault();
    const current = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPw = document.getElementById('confirm-password').value;

    if (newPassword !== confirmPw) {
        showToast('New passwords do not match.');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/api/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: current, newPassword })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Failed to change password.');
            return;
        }
        showToast('Password updated successfully!');
        document.getElementById('password-form').reset();
    } catch (err) {
        console.error(err);
        showToast('Failed to change password.');
    }
}

// ---- 13. New Order Alerts ----
let maxOrderId = 0;
let alertsOn = localStorage.getItem('order_alerts') !== 'off';

function beep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.35].forEach(t => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.001, ctx.currentTime + t);
            gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + t);
            osc.stop(ctx.currentTime + t + 0.32);
        });
    } catch (e) { }
}

function notifyNewOrders(fresh) {
    if (!alertsOn) return;
    beep();
    showToast(`🔔 ${fresh.length} new order${fresh.length > 1 ? 's' : ''}! ${fresh.map(o => `#EMP${o.id} (NLE ${o.amount})`).join(', ')}`);
    if ('Notification' in window && Notification.permission === 'granted') {
        fresh.slice(0, 3).forEach(o => {
            const pay = o.paymentMethod === 'monime' ? 'Monime' : 'COD';
            new Notification(`🛒 New Order #EMP${o.id}`, {
                body: `${o.customer} — NLE ${o.amount} (${pay})`,
                tag: 'order-' + o.id
            });
        });
    }
}

// Poll for new orders every 30s while the dashboard is open
async function pollOrders() {
    try {
        const orders = await fetchJson(`${API_URL}/api/orders`);
        const fresh = orders.filter(o => o.id > maxOrderId);
        allOrders = orders.sort((a, b) => new Date(b.date) - new Date(a.date));
        if (fresh.length > 0 && maxOrderId > 0) {
            notifyNewOrders(fresh);
            renderOrders();
            renderDashboard();
            renderCustomers();
            updateBadges();
        }
        maxOrderId = orders.reduce((m, o) => Math.max(m, o.id), 0);
    } catch (e) { /* transient network error — retry on next tick */ }
}

// ---- 12. Initialize ----
document.addEventListener('DOMContentLoaded', async () => {
    const authed = await checkAuth();
    if (!authed) return;

    if (localStorage.getItem('dark_mode') === 'true') {
        document.body.classList.add('dark-mode');
        const icon = document.getElementById('theme-icon');
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
    }
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
        document.getElementById('sidebar').classList.add('collapsed');
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            searchTerm = this.value.trim();
            renderOrders();
            renderInventory();
            renderCustomers();
        });
    }

    const productForm = document.getElementById('product-form');
    if (productForm) productForm.addEventListener('submit', handleProductSubmit);

    const promoForm = document.getElementById('promo-form');
    if (promoForm) promoForm.addEventListener('submit', handlePromoSubmit);

    const passwordForm = document.getElementById('password-form');
    if (passwordForm) passwordForm.addEventListener('submit', handlePasswordSubmit);

    // Order alerts toggle
    const alertsBtn = document.getElementById('alerts-toggle');
    if (alertsBtn) {
        const syncBtn = () => { alertsBtn.innerText = alertsOn ? 'Alerts: ON 🔔' : 'Alerts: OFF 🔕'; };
        syncBtn();
        alertsBtn.addEventListener('click', async () => {
            alertsOn = !alertsOn;
            localStorage.setItem('order_alerts', alertsOn ? 'on' : 'off');
            if (alertsOn && 'Notification' in window && Notification.permission === 'default') {
                await Notification.requestPermission();
            }
            syncBtn();
            showToast(alertsOn ? 'Order alerts enabled.' : 'Order alerts disabled.');
        });
    }
    // Browsers need a user click before showing notification permission prompts
    if (alertsOn && 'Notification' in window && Notification.permission === 'default') {
        document.addEventListener('click', () => Notification.requestPermission(), { once: true });
    }

    loadAllData();
    setInterval(pollOrders, 30000);
});
