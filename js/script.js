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
        cart = JSON.parse(localStorage.getItem('empire_cart') || '[]');
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

        storeProducts.forEach((product, index) => {
            const card = document.createElement('div');
            card.classList.add('product-card');
            card.innerHTML = `
                <div class="product-image">
                    <img src="${esc(product.image)}" alt="${esc(product.name)}">
                </div>
                <h3>${esc(product.name)}</h3>
                <p class="price">NLE ${esc(product.price)}</p>
                <button class="add-to-cart" onclick="addToCart(${index})">Add to Cart</button>
            `;
            grid.appendChild(card);
        });
    } catch (error) {
        console.error("Error fetching products:", error);
    }
}

// 2. Cart Functions
function addToCart(index) {
    cart.push(storeProducts[index]);
    updateCartUI();
    toggleCart();
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
                        <h4>${esc(item.name)}</h4>
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
    cart.forEach(item => { msg += `• ${item.name} - NLE ${item.price}\n`; });
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
        const index = storeProducts.indexOf(product);
        const card = document.createElement('div');
        card.classList.add('product-card');
        card.innerHTML = `
            <div class="product-image">
                <img src="${esc(product.image)}" alt="${esc(product.name)}">
            </div>
            <h3>${esc(product.name)}</h3>
            <p class="price">NLE ${esc(product.price)}</p>
            <button class="add-to-cart" onclick="addToCart(${index})">Add to Cart</button>
        `;
        grid.appendChild(card);
    });

    // Close mobile nav after click
    document.getElementById('mobile-nav').style.display = 'none';
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
                        items: cart.map(i => ({ name: i.name, price: i.price })),
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
                    items: cart.map(i => ({ name: i.name, price: i.price })),
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
            alert("There was an error processing your order. Please try again.");
        }
    });

    loadCart();
    updateCartUI();
    loadStorefront();
});
