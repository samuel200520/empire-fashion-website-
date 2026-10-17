// Pure catalogue helpers shared by the server and the test suite.
// Kept dependency-free so tests run without a database or HTTP server.

// Legacy fashion-only category tokens → the current multi-goods taxonomy.
const LEGACY_CATEGORY_MAP = {
    men: 'clothing',
    women: 'clothing',
    accessories: 'other',
    uncategorized: 'other'
};

// Translate a comma-separated category string into the current taxonomy.
// New/unknown tokens pass through untouched (normalized to lowercase).
// Idempotent and case/whitespace tolerant — matches how the DB stores categories.
function translateCategory(category) {
    return String(category || '')
        .split(',')
        .map(c => {
            const token = String(c).trim().toLowerCase();
            if (!token) return '';
            return LEGACY_CATEGORY_MAP[token] || token;
        })
        .filter(Boolean)
        .join(',');
}

// Constant-time string comparison for webhook shared secrets.
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

module.exports = { LEGACY_CATEGORY_MAP, translateCategory, safeEqual };
