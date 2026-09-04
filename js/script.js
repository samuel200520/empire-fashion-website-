const API_URL = "";

// The store's own WhatsApp number (with country code, digits only).
const STORE_WHATSAPP = "23233600560";

let cart = [];
let storeProducts = [];
let currentCategory = 'all';
let searchTerm = '';
let currentSort = 'featured';
let wishlist = [];

// ---- Wishlist (saved items, persists in localStorage) ----
function loadWishlist() {
    try { wishlist = JSON.parse(localStorage.getItem('empire_wishlist') || '[]') || []; }
    catch (e) { wishlist = []; }
}
function saveWishlist() {
    localStorage.setItem('empire_wishlist', JSON.stringify(wishlist));
    const count = document.getElementById('wishlist-count');
    if (count) count.innerText = wishlist.length;
}
function toggleWishlist(id, ev) {
    if (ev) ev.stopPropagation();
    id = Number(id);
    wishlist = wishlist.includes(id) ? wishlist.filter(w => w !== id) : [...wishlist, id];
    saveWishlist();
    applyFilters(); // refresh heart states on cards
    renderWishlistPanel();
}
function toggleWishlistPanel() {
    const panel = document.getElementById('wishlist-panel');
    const overlay = document.getElementById('wishlist-overlay');
    const isOpen = panel.classList.contains('open');
    document.getElementById('cart-sidebar').classList.remove('open');
    document.getElementById('cart-overlay').classList.remove('active');
    panel.classList.toggle('open', !isOpen);
    overlay.classList.toggle('active', !isOpen);
    if (!isOpen) renderWishlistPanel();
}
function renderWishlistPanel() {
    const box = document.getElementById('wishlist-items');
    if (!box) return;
    const items = storeProducts.filter(p => wishlist.includes(p.id));
    if (items.length === 0) {
        box.innerHTML = `<p style="text-align:center; color:#777;">Your wishlist is empty.<br>Tap the ♡ on any product to save it for later.</p>`;
        return;
    }
    box.innerHTML = items.map(p => `
        <div class="cart-item">
            <img ${imgAttr(p.image, p.name)} onclick="openProduct(${p.id})" style="cursor:pointer;">
            <div class="cart-item-details">
                <h4>${esc(p.name)}</h4>
                <p>NLE ${esc(p.price)}</p>
                <button class="remove-btn" onclick="wishlistToCart(${p.id})">Add to Cart</button>
                <button class="remove-btn" style="margin-left:8px;" onclick="toggleWishlist(${p.id})">Remove</button>
            </div>
        </div>
    `).join('');
}
function wishlistToCart(id) {
    const p = storeProducts.find(x => x.id === Number(id));
    if (!p) return;
    if ((p.sizes || []).length > 0 || (p.colors || []).length > 0) {
        openProduct(p.id); // needs size/color choice
        return;
    }
    if (addProductToCart(p, '', '')) {
        toggleWishlist(id); // remove from wishlist
        toggleWishlistPanel();
        toggleCart();
    }
}

// Cart survives page refreshes via localStorage
function saveCart() {
    localStorage.setItem('empire_cart', JSON.stringify(cart));
}
function loadCart() {
    try {
        cart = (JSON.parse(localStorage.getItem('empire_cart') || '[]') || [])
            .map(i => ({ id: i.id, name: i.name, price: i.price, image: i.image, size: i.size || '', color: i.color || '' }));
    } catch (e) {
        cart = [];
    }
}

// Safe HTML escaping to prevent XSS
function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

// Branded fallback image: shown whenever a product picture is missing or fails to load.
const IMG_FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">' +
    '<rect width="600" height="600" fill="#111"/>' +
    '<rect x="12" y="12" width="576" height="576" fill="none" stroke="#D4AF37" stroke-width="2"/>' +
    '<text x="300" y="285" text-anchor="middle" font-family="Georgia, serif" font-size="46" letter-spacing="6" fill="#D4AF37">EMPIRE</text>' +
    '<text x="300" y="330" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" letter-spacing="3" fill="#ccc">FASHION HOUSE</text>' +
    '</svg>'
);

// Builds a safe <img> tag with an automatic branded fallback if the picture 404s.
function imgAttr(src, alt) {
    return `src="${esc(src)}" alt="${esc(alt)}" onerror="this.onerror=null;this.src='${IMG_FALLBACK}';"`;
}

// Set an <img> element's source with the same fallback logic (for JS property assignments).
function setImage(el, src, alt) {
    el.onerror = function () { this.onerror = null; this.src = IMG_FALLBACK; };
    el.src = src;
    if (alt !== undefined) el.alt = alt;
}

// Known color names get a matching swatch dot; unknown names still show as text
const COLOR_HEX = {
    'black': '#111111', 'white': '#ffffff', 'red': '#dc3545', 'blue': '#0275d8',
    'navy': '#001f3f', 'navy blue': '#001f3f', 'royal blue': '#4169e1', 'sky blue': '#87ceeb',
    'green': '#28a745', 'yellow': '#ffc107', 'gold': '#D4AF37', 'orange': '#fd7e14',
    'pink': '#ff85a2', 'purple': '#6f42c1', 'brown': '#8b5a2b', 'grey': '#9a9a9a',
    'gray': '#9a9a9a', 'cream': '#f5f0dc', 'beige': '#e8dcc4', 'wine': '#722f37',
    'maroon': '#800000', 'olive': '#6b8e23', 'tan': '#d2b48c', 'silver': '#c0c0c0',
    'khaki': '#c3b091', 'turquoise': '#40e0d0', 'multicolor': 'linear-gradient(90deg,#dc3545,#ffc107,#0275d8,#28a745)'
};
function colorDot(name) {
    const hex = COLOR_HEX[String(name || '').toLowerCase().trim()];
    return hex ? `<span class="color-dot" style="background:${hex};"></span>` : '';
}

// 1. Load Storefront Products
function isNewProduct(product) {
    if (!product.created) return false;
    const days = (Date.now() - new Date(product.created).getTime()) / 86400000;
    return days <= 14;
}

function productCardHTML(product) {
    const index = storeProducts.indexOf(product);
    const soldOut = product.stock !== null && product.stock <= 0;
    const colors = product.colors || [];
    const wished = wishlist.includes(product.id);
    const colorDots = colors.length > 0
        ? `<div class="card-colors">${colors.slice(0, 5).map(c => colorDot(c)).join('')}${colors.length > 5 ? `<span class="more-colors">+${colors.length - 5}</span>` : ''}</div>`
        : '';
    return `
        <div class="product-card">
            <div class="product-image" onclick="openProduct(${product.id})">
                <img ${imgAttr(product.image, product.name)}>
                ${soldOut ? '<span class="soldout-badge">SOLD OUT</span>' : ''}
                ${isNewProduct(product) ? '<span class="new-badge">NEW</span>' : ''}
                <button class="heart-btn ${wished ? 'wished' : ''}" onclick="toggleWishlist(${product.id}, event)" title="${wished ? 'Remove from wishlist' : 'Save to wishlist'}">${wished ? '♥' : '♡'}</button>
            </div>
            <h3 class="product-title" onclick="openProduct(${product.id})">${esc(product.name)}</h3>
            <p class="price">NLE ${esc(product.price)}</p>
            ${colorDots}
            <button class="add-to-cart" onclick="quickAdd(${index})" ${soldOut ? 'disabled' : ''}>
                ${soldOut ? 'Sold Out' : 'Add to Cart'}
            </button>
        </div>
    `;
}

// Combined filtering: category + search + sort
function applyFilters() {
    const grid = document.getElementById('product-grid');
    let list = storeProducts.slice();

    if (currentCategory !== 'all') {
        list = list.filter(p => {
            const cats = (p.categories && p.categories.length ? p.categories : (p.category || '').split(','))
                .map(c => String(c).trim().toLowerCase())
                .filter(Boolean);
            return cats.includes(currentCategory);
        });
    }
    if (searchTerm) {
        const t = searchTerm.toLowerCase();
        list = list.filter(p =>
            (p.name || '').toLowerCase().includes(t) ||
            (p.categories || (p.category || '').split(',')).some(c => c.toLowerCase().includes(t)) ||
            (p.colors || []).some(c => c.toLowerCase().includes(t))
        );
    }
    if (currentSort === 'newest') list.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
    if (currentSort === 'price-asc') list.sort((a, b) => a.price - b.price);
    if (currentSort === 'price-desc') list.sort((a, b) => b.price - a.price);

    if (list.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <h3>No products found</h3>
                <p>Try a different search or category.</p>
            </div>
        `;
        return;
    }
    grid.innerHTML = list.map(p => productCardHTML(p)).join('');
}

async function loadStorefront() {
    try {
        const response = await fetch(`${API_URL}/api/products`);
        storeProducts = await response.json();
        applyFilters();

        // Deep link support: site.com/#product=3 opens that product
        const m = location.hash.match(/^#product=(\d+)/);
        if (m) renderProduct(m[1]);
    } catch (error) {
        console.error("Error fetching products:", error);
    }
}

// 2. Cart Functions
function countInCart(productId) {
    return cart.filter(i => i.id === productId).length;
}

function addProductToCart(product, size, color) {
    if (product.stock !== null && product.stock !== undefined && countInCart(product.id) >= product.stock) {
        alert(`Sorry, only ${product.stock} left in stock for this item.`);
        return false;
    }
    cart.push({ id: product.id, name: product.name, price: product.price, image: product.image, size: size || '', color: color || '' });
    updateCartUI();
    return true;
}

// "Add to Cart" on the grid card: items with sizes or colors open the detail page first
function quickAdd(index) {
    const p = storeProducts[index];
    if (!p) return;
    if ((p.sizes || []).length > 0 || (p.colors || []).length > 0) {
        openProduct(p.id);
        return;
    }
    if (p.stock !== null && p.stock !== undefined && p.stock <= 0) {
        alert('Sorry, this item is sold out.');
        return;
    }
    if (addProductToCart(p, '', '')) toggleCart();
}

function removeFromCart(cartIndex) {
    cart.splice(cartIndex, 1);
    updateCartUI();
}

function updateCartUI() {
    const cartItemsContainer = document.getElementById('cart-items');
    const cartCount = document.getElementById('cart-count');
    const cartTotal = document.getElementById('cart-total-price');

    cartItemsContainer.innerHTML = '';

    if (cart.length === 0) {
        cartItemsContainer.innerHTML = `<p style="text-align:center; color:#777;">Your cart is empty.</p>`;
    } else {
        cart.forEach((item, index) => {
            cartItemsContainer.innerHTML += `
                <div class="cart-item">
                    <img ${imgAttr(item.image, item.name)}>
                    <div class="cart-item-details">
                        <h4>${esc(item.name)}${item.size ? `<span class="cart-size">${esc(item.size)}</span>` : ''}${item.color ? `<span class="cart-color">${colorDot(item.color)}${esc(item.color)}</span>` : ''}</h4>
                        <p>NLE ${esc(item.price)}</p>
                        <button class="remove-btn" onclick="removeFromCart(${index})">Remove</button>
                    </div>
                </div>
            `;
        });
    }

    cartCount.innerText = cart.length;
    let total = cart.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
    cartTotal.innerText = `NLE ${total.toFixed(2)}`;
    saveCart();
}

// 3. Toggle Cart
function toggleCart() {
    document.getElementById('cart-sidebar').classList.toggle('open');
    document.getElementById('cart-overlay').classList.toggle('active');
}

// 4. Checkout - show the real form
let appliedPromo = null; // { code, percent, discount }

function cartSubtotal() {
    return cart.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
}

function renderCheckoutSummary() {
    const summary = document.getElementById('checkout-summary');
    const subtotal = cartSubtotal();
    const discount = appliedPromo ? appliedPromo.discount : 0;
    const total = Math.max(0, subtotal - discount);
    summary.innerHTML = `
        <div style="background:#f5f5f5; padding:15px; border-radius:6px; margin-bottom:20px;">
            <strong>${cart.length} item(s):</strong> ${cart.map(i => esc(i.name)).join(', ')}
            ${discount > 0 ? `<div style="margin-top:6px; color:#28a745;">Promo ${esc(appliedPromo.code)} (-${appliedPromo.percent}%): <strong>-NLE ${discount.toFixed(2)}</strong></div>` : ''}
            <br><strong style="font-size:18px; margin-top:8px; display:inline-block;">Total: NLE ${total.toFixed(2)}</strong>
        </div>
    `;
}

function showCheckoutForm() {
    if (cart.length === 0) {
        alert("Your cart is empty!");
        return;
    }
    appliedPromo = null;
    document.getElementById('promo-input').value = '';
    document.getElementById('promo-msg').style.display = 'none';
    renderCheckoutSummary();
    // Reset to form state (in case a previous order showed the success screen)
    document.getElementById('checkout-success').style.display = 'none';
    document.getElementById('checkout-form').style.display = 'block';
    summaryVisible(true);

    document.getElementById('checkout-modal').style.display = 'flex';
    document.getElementById('checkout-overlay').style.display = 'block';
}

function summaryVisible(show) {
    document.getElementById('checkout-summary').style.display = show ? 'block' : 'none';
}

async function applyPromo() {
    const code = document.getElementById('promo-input').value.trim();
    const msgEl = document.getElementById('promo-msg');
    if (!code) { msgEl.textContent = 'Enter a promo code first.'; msgEl.style.display = 'block'; return; }
    try {
        const res = await fetch(`${API_URL}/api/promo/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, amount: cartSubtotal() })
        });
        const data = await res.json();
        if (!res.ok || !data.valid) {
            appliedPromo = null;
            msgEl.textContent = data.error || 'Invalid promo code.';
            msgEl.style.color = '#dc3545';
            msgEl.style.display = 'block';
        } else {
            appliedPromo = data;
            msgEl.textContent = `✓ ${data.code} applied — you save NLE ${data.discount.toFixed(2)}!`;
            msgEl.style.color = '#28a745';
            msgEl.style.display = 'block';
        }
        renderCheckoutSummary();
    } catch (e) {
        msgEl.textContent = 'Could not check promo code.';
        msgEl.style.display = 'block';
    }
}

function hideCheckoutForm() {
    document.getElementById('checkout-modal').style.display = 'none';
    document.getElementById('checkout-overlay').style.display = 'none';
}

// Back to the cart from the checkout screen (keeps the cart contents intact)
function backToCart() {
    hideCheckoutForm();
    document.getElementById('cart-sidebar').classList.add('open');
    document.getElementById('cart-overlay').classList.add('active');
}

// Order via WhatsApp: send cart to the store's WhatsApp and let them confirm manually
function orderViaWhatsApp() {
    if (cart.length === 0) {
        alert("Your cart is empty!");
        return;
    }
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    const address = document.getElementById('cust-address').value.trim();
    const total = cart.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);

    let msg = `Hello Empire Fashion House! I want to place an order:\n\n`;
    cart.forEach(item => {
        const variants = [item.size ? `Size ${item.size}` : '', item.color ? `Color: ${item.color}` : ''].filter(Boolean).join(', ');
        msg += `• ${item.name}${variants ? ` (${variants})` : ''} - NLE ${item.price}\n`;
    });
    msg += `\nTotal: NLE ${total.toFixed(2)}`;
    if (name) msg += `\n\nName: ${name}`;
    if (phone) msg += `\nPhone: ${phone}`;
    if (address) msg += `\nAddress: ${address}`;

    if (STORE_WHATSAPP === "232XXXXXXXXX") {
        alert("Store WhatsApp number not set yet. Ask the developer to set STORE_WHATSAPP in js/script.js");
        return;
    }
    window.open(`https://wa.me/${STORE_WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank');
}

// 5. Mobile Nav & Category Filtering
function toggleMobileNav() {
    const nav = document.getElementById('mobile-nav');
    nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
}

function scrollToProducts() {
    document.getElementById('products-section').scrollIntoView({ behavior: 'smooth' });
}

function filterByCategory(category) {
    currentCategory = category;
    const title = document.getElementById('collection-title');
    title.textContent = category === 'all' ? 'Featured Collection' : `${category.charAt(0).toUpperCase() + category.slice(1)} Collection`;

    applyFilters();

    // Close mobile nav after click
    document.getElementById('mobile-nav').style.display = 'none';
}

// 7. Product Detail Modal (shareable link: #product=ID)
let pdProduct = null;
let pdSelectedSize = '';
let pdSelectedColor = '';

window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#product=(\d+)/);
    if (m) renderProduct(m[1]);
    else hideProductModal();
});

function openProduct(id) {
    location.hash = 'product=' + id; // hashchange listener renders it
}

function renderProduct(id) {
    const p = storeProducts.find(x => x.id === Number(id));
    if (!p) { hideProductModal(); return; }
    pdProduct = p;
    pdSelectedSize = '';
    pdSelectedColor = '';

    setImage(document.getElementById('pd-image'), p.image, p.name);
    document.getElementById('pd-name').innerText = p.name;
    document.getElementById('pd-price').innerText = 'NLE ' + p.price;
    document.getElementById('pd-link').innerText = location.origin + '/#product=' + p.id;

    // Photo gallery: main image + per-color photos + extra shots
    const colorPhotos = Object.values(p.colorImages || {});
    const seen = new Set();
    const gallery = [p.image, ...colorPhotos, ...(p.images || [])].filter(src => {
        if (!src || seen.has(src)) return false;
        seen.add(src);
        return true;
    });
    const thumbsEl = document.getElementById('pd-thumbs');
    if (gallery.length > 1) {
        thumbsEl.style.display = 'flex';
        thumbsEl.innerHTML = gallery.map((src, i) =>
            `<img src="${esc(src)}" class="pd-thumb ${i === 0 ? 'active' : ''}" onclick="swapPdImage(this, '${esc(src).replace(/'/g, '%27')}')" alt="Photo ${i + 1}" onerror="this.onerror=null;this.src='${IMG_FALLBACK}';">`
        ).join('');
    } else {
        thumbsEl.style.display = 'none';
        thumbsEl.innerHTML = '';
    }

    // Wishlist heart
    const heartBtn = document.getElementById('pd-heart');
    const wished = wishlist.includes(p.id);
    heartBtn.className = `heart-btn ${wished ? 'wished' : ''}`;
    heartBtn.innerText = wished ? '♥' : '♡';

    // Size picker
    const wrap = document.getElementById('pd-sizes-wrap');
    const box = document.getElementById('pd-sizes');
    const sizes = p.sizes || [];
    if (sizes.length > 0) {
        wrap.style.display = 'block';
        box.innerHTML = sizes.map(s => {
            const safe = String(s).replace(/'/g, "\\'");
            return `<button type="button" class="size-btn" onclick="selectSize(this, '${safe}')">${esc(s)}</button>`;
        }).join('');
    } else {
        wrap.style.display = 'none';
        box.innerHTML = '';
    }

    // Color picker
    const cWrap = document.getElementById('pd-colors-wrap');
    const cBox = document.getElementById('pd-colors');
    const colors = p.colors || [];
    if (colors.length > 0) {
        cWrap.style.display = 'block';
        cBox.innerHTML = colors.map(c => {
            const safe = String(c).replace(/'/g, "\\'");
            return `<button type="button" class="color-btn" onclick="selectColor(this, '${safe}')">${colorDot(c)}<span>${esc(c)}</span></button>`;
        }).join('');
    } else {
        cWrap.style.display = 'none';
        cBox.innerHTML = '';
    }
    // Stock line + Add button state
    const stEl = document.getElementById('pd-stock');
    const addBtn = document.getElementById('pd-add');
    const soldOut = p.stock !== null && p.stock !== undefined && p.stock <= 0;
    if (p.stock === null || p.stock === undefined) {
        stEl.innerText = '';
    } else if (soldOut) {
        stEl.innerHTML = '<span style="color:#dc3545; font-weight:bold;">Out of stock</span>';
    } else {
        stEl.innerHTML = `<span style="color:#28a745;">✔ ${p.stock} in stock</span>`;
    }
    addBtn.disabled = soldOut;
    addBtn.innerText = soldOut ? 'Sold Out' : 'Add to Cart';

    // Related items: same category first, fallback to anything else
    const relEl = document.getElementById('pd-related');
    const pCats = new Set((p.categories || (p.category || '').split(',')).map(c => String(c).trim().toLowerCase()));
    let rel = storeProducts.filter(x => x.id !== p.id &&
        (x.categories || (x.category || '').split(','))
            .map(c => String(c).trim().toLowerCase())
            .some(c => pCats.has(c))
    ).slice(0, 4);
    if (rel.length === 0) rel = storeProducts.filter(x => x.id !== p.id).slice(0, 4);
    relEl.innerHTML = rel.map(x => `
        <div class="rel-card" onclick="openProduct(${x.id})">
            <img ${imgAttr(x.image, x.name)}>
            <p>${esc(x.name)}</p>
            <span>NLE ${esc(x.price)}</span>
        </div>
    `).join('');

    document.getElementById('product-modal').style.display = 'block';
    document.getElementById('pd-overlay').style.display = 'block';
    document.body.style.overflow = 'hidden';
    window.scrollTo(0, 0);

    loadProductReviews(p.id);
}

function swapPdImage(thumb, src) {
    document.getElementById('pd-image').src = src;
    document.querySelectorAll('#pd-thumbs .pd-thumb').forEach(t => t.classList.remove('active'));
    thumb.classList.add('active');
}

// ---- Product reviews ----
function starsHTML(rating) {
    const full = Math.round(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
}

async function loadProductReviews(productId) {
    const box = document.getElementById('pd-reviews');
    box.innerHTML = '<p style="color:#999;">Loading reviews…</p>';
    try {
        const res = await fetch(`${API_URL}/api/products/${productId}/reviews`);
        const data = await res.json();
        const header = data.count > 0
            ? `<div class="rev-summary"><span class="rev-stars">${starsHTML(data.avg)}</span> <strong>${data.avg}</strong> <span class="rev-count">(${data.count} review${data.count > 1 ? 's' : ''})</span></div>`
            : `<div class="rev-summary">No reviews yet — be the first!</div>`;

        const list = data.reviews.map(r => `
            <div class="rev-item">
                <div class="rev-head">
                    <span class="rev-stars">${starsHTML(r.rating)}</span>
                    <strong>${esc(r.name)}</strong>
                    <small style="color:#999;">${r.date || ''}</small>
                </div>
                <p>${esc(r.comment)}</p>
            </div>
        `).join('');

        box.innerHTML = header + list + `
            <button type="button" class="btn-outline" id="rev-toggle" onclick="document.getElementById('rev-form-wrap').style.display='block'; this.style.display='none';">✍ Write a review</button>
            <div id="rev-form-wrap" style="display:none; margin-top:12px;">
                <div class="rev-stars-input" id="rev-stars">
                    ${[1, 2, 3, 4, 5].map(n => `<span onclick="setRevStars(${n})" data-star="${n}">☆</span>`).join('')}
                </div>
                <input type="text" id="rev-name" placeholder="Your name" maxlength="60">
                <textarea id="rev-comment" placeholder="How was the item?" maxlength="500" rows="3"></textarea>
                <button type="button" class="checkout-btn" style="padding:10px;" onclick="submitReview(${productId})">Submit Review</button>
            </div>
        `;
    } catch (e) {
        box.innerHTML = '';
    }
}

let revRating = 0;
function setRevStars(n) {
    revRating = n;
    document.querySelectorAll('#rev-stars span').forEach(s => {
        s.textContent = Number(s.dataset.star) <= n ? '★' : '☆';
    });
}

async function submitReview(productId) {
    const name = document.getElementById('rev-name').value.trim();
    const comment = document.getElementById('rev-comment').value.trim();
    if (!name || !comment || !revRating) {
        alert('Please add your name, tap the stars, and write a short comment.');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/api/products/${productId}/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, rating: revRating, comment })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        document.getElementById('pd-reviews').innerHTML = '<p style="color:#28a745; font-weight:bold;">✅ Thank you! Your review will appear once approved.</p>';
    } catch (e) {
        alert('Could not submit review. Please try again.');
    }
}

function selectSize(btn, size) {
    document.querySelectorAll('#pd-sizes .size-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    pdSelectedSize = size;
}

function selectColor(btn, color) {
    document.querySelectorAll('#pd-colors .color-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    pdSelectedColor = color;
    if (!pdProduct) return;
    const wanted = String(color || '').trim().toLowerCase();
    const ci = pdProduct.colorImages || {};
    // Keys are saved lowercase, so look up directly. Fallback to scanning keys for safety.
    let colorPhoto = ci[wanted];
    if (!colorPhoto) {
        for (const k of Object.keys(ci)) {
            if (String(k).trim().toLowerCase() === wanted) { colorPhoto = ci[k]; break; }
        }
    }
    if (!colorPhoto) {
        console.warn('[Empire] No color photo for', color, '— available keys:', Object.keys(ci));
        return;
    }
    document.getElementById('pd-image').src = colorPhoto;
    document.querySelectorAll('#pd-thumbs .pd-thumb').forEach(t => t.classList.remove('active'));
    const gallery = [colorPhoto, pdProduct.image, ...(pdProduct.images || []).filter(s => s !== colorPhoto)];
    const thumbsEl = document.getElementById('pd-thumbs');
    if (gallery.length > 1) {
        thumbsEl.style.display = 'flex';
        thumbsEl.innerHTML = gallery.map((src, i) =>
            `<img src="${esc(src)}" class="pd-thumb ${i === 0 ? 'active' : ''}" onclick="swapPdImage(this, '${esc(src).replace(/'/g, '%27')}')" alt="Photo ${i + 1}" onerror="this.onerror=null;this.src='${IMG_FALLBACK}';">`
        ).join('');
    }
}

function hideProductModal() {
    document.getElementById('product-modal').style.display = 'none';
    document.getElementById('pd-overlay').style.display = 'none';
    document.body.style.overflow = '';
}

function closeProduct() {
    history.replaceState(null, '', location.pathname + location.search);
    hideProductModal();
}

function pdAddToCart() {
    if (!pdProduct) return;
    if ((pdProduct.sizes || []).length > 0 && !pdSelectedSize) {
        alert('Please select a size first.');
        return;
    }
    if ((pdProduct.colors || []).length > 0 && !pdSelectedColor) {
        alert('Please select a color first.');
        return;
    }
    if (addProductToCart(pdProduct, pdSelectedSize, pdSelectedColor)) {
        closeProduct();
        toggleCart();
    }
}

function askViaWhatsApp() {
    if (!pdProduct) return;
    const chosen = [pdSelectedSize ? `size ${pdSelectedSize}` : '', pdSelectedColor ? `color ${pdSelectedColor}` : ''].filter(Boolean).join(', ');
    const note = chosen ? ` (${chosen})` : '';
    const msg = `Hello Empire Fashion House! I'm interested in the ${pdProduct.name}${note} (NLE ${pdProduct.price}). Is it available?`;
    window.open(`https://wa.me/${STORE_WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Wire up all category links (desktop nav + mobile nav + footer)
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-category]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            filterByCategory(this.dataset.category);
        });
    });
});

// 6. Place order
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('checkout-form').addEventListener('submit', async function(e) {
        e.preventDefault();

        const customer = document.getElementById('cust-name').value.trim();
        const email = document.getElementById('cust-email').value.trim();
        const phone = document.getElementById('cust-phone').value.trim();
        const address = document.getElementById('cust-address').value.trim();
        const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;

        if (!customer || !email || !phone || !address) {
            alert("Please fill in all fields.");
            return;
        }

        try {
            // --- Monime: redirect to Monime's hosted checkout page ---
            if (paymentMethod === 'monime') {
                const res = await fetch(`${API_URL}/api/checkout/monime`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customer,
                        email,
                        phone,
                        address,
                        items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, size: i.size || '', color: i.color || '' })),
                        promoCode: appliedPromo ? appliedPromo.code : ''
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.redirectUrl) {
                    throw new Error(data.error || 'Failed to create Monime checkout');
                }
                // Order is saved, redirect to Monime's payment page
                cart = [];
                updateCartUI();
                window.location.href = data.redirectUrl;
                return;
            }

            // --- COD: place order directly ---
            const res = await fetch(`${API_URL}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customer,
                    email,
                    phone,
                    address,
                    items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, size: i.size || '', color: i.color || '' })),
                    paymentMethod: 'cod',
                    promoCode: appliedPromo ? appliedPromo.code : ''
                })
            });
            if (!res.ok) throw new Error('Server rejected the order');
            const order = await res.json();

            // Show success screen with the real order number from the server
            document.getElementById('success-order-id').innerText = `#EMP${order.id}`;
            document.getElementById('checkout-form').style.display = 'none';
            summaryVisible(false);
            document.getElementById('checkout-success').style.display = 'block';

            cart = [];
            updateCartUI();
            document.getElementById('checkout-form').reset();
        } catch (error) {
            console.error("Checkout failed:", error);
            alert("Error: " + error.message);
        }
    });

    loadCart();
    loadWishlist();
    saveWishlist();
    updateCartUI();
    loadStorefront();

    // Storefront search + sort
    const searchInput = document.getElementById('store-search');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            searchTerm = this.value.trim();
            currentCategory = 'all';
            document.getElementById('collection-title').textContent = 'Featured Collection';
            applyFilters();
        });
    }
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', function () {
            currentSort = this.value;
            applyFilters();
        });
    }
});
