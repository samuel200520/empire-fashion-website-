const API_URL = "";

let allOrders = [];
let allProducts = [];
let allCustomers = [];
let searchTerm = "";

// ---- Helpers ----
function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
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
    document.getElementById('sidebar').classList.toggle('collapsed');
    localStorage.setItem('sidebar_collapsed', document.getElementById('sidebar').classList.contains('collapsed'));
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
        const [orders, customers, products] = await Promise.all([
            fetchJson(`${API_URL}/api/orders`),
            fetchJson(`${API_URL}/api/customers`),
            fetchJson(`${API_URL}/api/products`)
        ]);
        allOrders = orders.sort((a, b) => new Date(b.date) - new Date(a.date));
        allCustomers = customers;
        allProducts = products;
    } catch (error) {
        console.error("Failed to fetch data:", error);
        showToast("Error connecting to database.");
        return;
    }
    renderDashboard();
    renderOrders();
    renderInventory();
    renderCustomers();
    updateBadges();
    initCharts();
}

function updateBadges() {
    const pending = allOrders.filter(o => o.status === 'Pending').length;
    const ordersBadge = document.getElementById('orders-badge');
    const notifBadge = document.getElementById('notif-badge');
    if (ordersBadge) ordersBadge.textContent = pending > 0 ? pending : '';
    if (notifBadge) notifBadge.textContent = pending > 0 ? pending : '';
}

// ---- 6. Dashboard ----
function renderDashboard() {
    const revenue = allOrders.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
    const totalItems = allOrders.reduce((sum, o) => o.product ? sum + o.product.split(',').length : sum, 0);

    // This month vs last month for real trends
    const now = new Date();
    const thisKey = now.toISOString().substring(0, 7);
    const lastKey = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().substring(0, 7);

    const revThis = allOrders.filter(o => (o.date || '').startsWith(thisKey)).reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
    const revLast = allOrders.filter(o => (o.date || '').startsWith(lastKey)).reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
    const ordThis = allOrders.filter(o => (o.date || '').startsWith(thisKey)).length;
    const ordLast = allOrders.filter(o => (o.date || '').startsWith(lastKey)).length;
    const itemsThis = allOrders.filter(o => (o.date || '').startsWith(thisKey)).reduce((s, o) => s + (o.product ? o.product.split(',').length : 0), 0);
    const itemsLast = allOrders.filter(o => (o.date || '').startsWith(lastKey)).reduce((s, o) => s + (o.product ? o.product.split(',').length : 0), 0);

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
                <td>
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

// ---- 8. Charts ----
let revenueChart = null;
let categoryChart = null;

async function initCharts() {
    // Revenue line - last 7 days real data
    let labels = [], data = [];
    let today = new Date();
    for (let i = 6; i >= 0; i--) {
        let day = new Date(today);
        day.setDate(today.getDate() - i);
        const dateString = day.toISOString().split('T')[0];
        labels.push(day.toLocaleDateString('en-US', { weekday: 'short' }));
        data.push(allOrders.filter(o => o.date === dateString).reduce((s, o) => s + (parseFloat(o.amount) || 0), 0));
    }

    const revCtx = document.getElementById('revenueChart');
    if (revCtx) {
        if (revenueChart) revenueChart.destroy();
        revenueChart = new Chart(revCtx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Revenue (NLE)',
                    data,
                    borderColor: '#D4AF37',
                    backgroundColor: 'rgba(212, 175, 55, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // Category doughnut - real data from orders
    const catTotals = {};
    allOrders.forEach(o => {
        if (!o.product) return;
        const parts = o.product.split(',');
        parts.forEach(p => {
            const cat = guessCategory(p.trim());
            catTotals[cat] = (catTotals[cat] || 0) + (parseFloat(o.amount) || 0) / parts.length;
        });
    });

    const catCtx = document.getElementById('categoryChart');
    if (catCtx) {
        if (categoryChart) categoryChart.destroy();
        const entries = Object.entries(catTotals);
        if (entries.length === 0) {
            categoryChart = new Chart(catCtx, {
                type: 'doughnut',
                data: { labels: ['No sales yet'], datasets: [{ data: [1], backgroundColor: ['#e0e0e0'] }] },
                options: { responsive: true, maintainAspectRatio: false }
            });
        } else {
            const colors = ['#111111', '#D4AF37', '#333333', '#b8941f', '#888888', '#555555'];
            categoryChart = new Chart(catCtx, {
                type: 'doughnut',
                data: {
                    labels: entries.map(e => e[0]),
                    datasets: [{ data: entries.map(e => e[1]), backgroundColor: colors.slice(0, entries.length) }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
    }
}

function guessCategory(name) {
    const n = String(name || '').toLowerCase();
    if (/shoe|sneaker|boot|trainer|sandal|air force|jordan|nike/.test(n)) return 'Shoes';
    if (/bag|purse|wallet|backpack/.test(n)) return 'Bags';
    if (/watch|clock|sunglass|cap|hat|belt/.test(n)) return 'Accessories';
    return 'Clothes';
}

// ---- 9. Products ----
function renderInventory() {
    const tableBody = document.getElementById('inventory-list');
    if (!tableBody) return;

    const filtered = allProducts.filter(p => matchesSearch(p.name, p.category, p.price));
    tableBody.innerHTML = '';

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No products found.</td></tr>`;
        return;
    }
    filtered.forEach(product => {
        tableBody.innerHTML += `
            <tr>
                <td><img src="${esc(product.image)}" alt="${esc(product.name)}"></td>
                <td>${esc(product.name)}</td>
                <td><span class="cat-badge">${esc(product.category || 'uncategorized')}</span></td>
                <td>NLE ${(parseFloat(product.price) || 0).toLocaleString()}</td>
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

async function submitProduct(name, price, category, image) {
    const editId = document.getElementById('product-edit-id').value;
    if (editId) {
        const body = { name, price, category };
        if (image) body.image = image;
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
            body: JSON.stringify({ name, price, category, image })
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
    const submitBtn = document.getElementById('product-submit-btn');

    let image = null;
    try {
        if (imageInput.files && imageInput.files[0]) {
            submitBtn.disabled = true;
            submitBtn.innerText = 'Saving...';
            image = await compressImage(imageInput.files[0]);
        }
        await submitProduct(name, price, category, image);
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

    const passwordForm = document.getElementById('password-form');
    if (passwordForm) passwordForm.addEventListener('submit', handlePasswordSubmit);

    loadAllData();
});
