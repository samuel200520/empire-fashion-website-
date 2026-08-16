const API_URL = "";

// The store's own WhatsApp number (with country code, digits only).
const STORE_WHATSAPP = "23233600560";

let cart = [];
let storeProducts = [];

// Cart survives page refreshes via localStorage
function saveCart() {
    localStorage.setItem('empire_cart', JSON.stringify(cart));
}
function loadCart() {
    try {
        cart = (JSON.parse(localStorage.getItem('empire_cart') || '[]') || [])
            .map(i => ({ id: i.id, name: i.name, price: i.price, image: i.image, size: i.size || '' }));
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

// 1. Load Storefront Products
function productCardHTML(product) {
    const index = storeProducts.indexOf(product);
    const soldOut = product.stock !== null && product.stock <= 0;
    return `
        <div class="product-card">
            <div class="product-image" onclick="openProduct(${product.id})">
                <img src="${esc(product.image)}" alt="${esc(product.name)}">
                ${soldOut ? '<span class="soldout-badge">SOLD OUT</span>' : ''}
            </div>
            <h3 class="product-title" onclick="openProduct(${product.id})">${esc(product.name)}</h3>
            <p class="price">NLE ${esc(product.price)}</p>
            <button class="add-to-cart" onclick="quickAdd(${index})" ${soldOut ? 'disabled' : ''}>
                ${soldOut ? 'Sold Out' : 'Add to Cart'}
            </button>
        </div>
    `;
}

async function loadStorefront() {
    try {
        const response = await fetch(`${API_URL}/api/products`);
        storeProducts = await response.json();
        const grid = document.getElementById('product-grid');
        grid.innerHTML = '';

        if (storeProducts.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <h3>New Collection Coming Soon</h3>
                    <p>We are currently stocking our shelves. Please check back shortly.</p>
                </div>
            `;
            return;
        }

        storeProducts.forEach((product) => {
            grid.innerHTML += productCardHTML(product);
        });

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

function addProductToCart(product, size) {
    if (product.stock !== null && product.stock !== undefined && countInCart(product.id) >= product.stock) {
        alert(`Sorry, only ${product.stock} left in stock for this item.`);
        return false;
    }
    cart.push({ id: product.id, name: product.name, price: product.price, image: product.image, size: size || '' });
    updateCartUI();
    return true;
}

// "Add to Cart" on the grid card: items with sizes open the detail page first
function quickAdd(index) {
    const p = storeProducts[index];
    if (!p) return;
    if ((p.sizes || []).length > 0) {
        openProduct(p.id);
        return;
    }
    if (p.stock !== null && p.stock !== undefined && p.stock <= 0) {
        alert('Sorry, this item is sold out.');
        return;
    }
    if (addProductToCart(p, '')) toggleCart();
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
                    <img src="${esc(item.image)}" alt="${esc(item.name)}">
                    <div class="cart-item-details">
                        <h4>${esc(item.name)}${item.size ? `<span class="cart-size">${esc(item.size)}</span>` : ''}</h4>
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
function showCheckoutForm() {
    if (cart.length === 0) {
        alert("Your cart is empty!");
        return;
    }
    const summary = document.getElementById('checkout-summary');
    let total = cart.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
    summary.innerHTML = `
        <div style="background:#f5f5f5; padding:15px; border-radius:6px; margin-bottom:20px;">
            <strong>${cart.length} item(s):</strong> ${cart.map(i => esc(i.name)).join(', ')}
            <br><strong style="font-size:18px; margin-top:8px; display:inline-block;">Total: NLE ${total.toFixed(2)}</strong>
        </div>
    `;
    // Reset to form state (in case a previous order showed the success screen)
    document.getElementById('checkout-success').style.display = 'none';
    document.getElementById('checkout-form').style.display = 'block';
    summary.style.display = 'block';

    document.getElementById('checkout-modal').style.display = 'flex';
    document.getElementById('checkout-overlay').style.display = 'block';
}

function hideCheckoutForm() {
    document.getElementById('checkout-modal').style.display = 'none';
    document.getElementById('checkout-overlay').style.display = 'none';
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
        msg += `• ${item.name}${item.size ? ` (Size ${item.size})` : ''} - NLE ${item.price}\n`;
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
    const grid = document.getElementById('product-grid');
    const title = document.getElementById('collection-title');
    title.textContent = category === 'all' ? 'Featured Collection' : `${category.charAt(0).toUpperCase() + category.slice(1)} Collection`;

    grid.innerHTML = '';
    const filtered = category === 'all'
        ? storeProducts
        : storeProducts.filter(p => (p.category || '').toLowerCase() === category.toLowerCase());

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <h3>No ${category} products yet</h3>
                <p>Check back soon for new arrivals.</p>
            </div>
        `;
        return;
    }

    filtered.forEach((product) => {
        grid.innerHTML += productCardHTML(product);
    });

    // Close mobile nav after click
    document.getElementById('mobile-nav').style.display = 'none';
}

// 7. Product Detail Modal (shareable link: #product=ID)
let pdProduct = null;
let pdSelectedSize = '';

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

    document.getElementById('pd-image').src = p.image;
    document.getElementById('pd-image').alt = p.name;
    document.getElementById('pd-name').innerText = p.name;
    document.getElementById('pd-price').innerText = 'NLE ' + p.price;
    document.getElementById('pd-link').innerText = location.origin + '/#product=' + p.id;

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
    let rel = storeProducts.filter(x => x.id !== p.id && (x.category || '') === (p.category || '')).slice(0, 4);
    if (rel.length === 0) rel = storeProducts.filter(x => x.id !== p.id).slice(0, 4);
    relEl.innerHTML = rel.map(x => `
        <div class="rel-card" onclick="openProduct(${x.id})">
            <img src="${esc(x.image)}" alt="${esc(x.name)}">
            <p>${esc(x.name)}</p>
            <span>NLE ${esc(x.price)}</span>
        </div>
    `).join('');

    document.getElementById('product-modal').style.display = 'block';
    document.getElementById('pd-overlay').style.display = 'block';
    document.body.style.overflow = 'hidden';
    window.scrollTo(0, 0);
}

function selectSize(btn, size) {
    document.querySelectorAll('#pd-sizes .size-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    pdSelectedSize = size;
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
    if (addProductToCart(pdProduct, pdSelectedSize)) {
        closeProduct();
        toggleCart();
    }
}

function askViaWhatsApp() {
    if (!pdProduct) return;
    const sizeNote = pdSelectedSize ? ` (size ${pdSelectedSize})` : '';
    const msg = `Hello Empire Fashion House! I'm interested in the ${pdProduct.name}${sizeNote} (NLE ${pdProduct.price}). Is it available?`;
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

        const amount = cart.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);

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
                        items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, size: i.size || '' })),
                        amount
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
                    items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, size: i.size || '' })),
                    amount,
                    paymentMethod: 'cod'
                })
            });
            if (!res.ok) throw new Error('Server rejected the order');
            const order = await res.json();

            // Show success screen with the real order number from the server
            document.getElementById('success-order-id').innerText = `#EMP${order.id}`;
            document.getElementById('checkout-form').style.display = 'none';
            document.getElementById('checkout-summary').style.display = 'none';
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
    updateCartUI();
    loadStorefront();
});
