const API_URL = "";
let cart = [];
let storeProducts = [];

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
    document.getElementById('checkout-modal').style.display = 'flex';
    document.getElementById('checkout-overlay').style.display = 'block';
}

function hideCheckoutForm() {
    document.getElementById('checkout-modal').style.display = 'none';
    document.getElementById('checkout-overlay').style.display = 'none';
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

        if (!customer || !email || !phone || !address) {
            alert("Please fill in all fields.");
            return;
        }

        const amount = cart.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);

        try {
            await fetch(`${API_URL}/api/orders`, {
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

            alert("Order placed successfully! Thank you for shopping with Empire Fashion House.");
            cart = [];
            updateCartUI();
            toggleCart();
            hideCheckoutForm();
            document.getElementById('checkout-form').reset();
        } catch (error) {
            console.error("Checkout failed:", error);
            alert("There was an error processing your order. Please try again.");
        }
    });

    loadStorefront();
});
