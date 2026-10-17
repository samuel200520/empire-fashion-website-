'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { translateCategory, safeEqual, LEGACY_CATEGORY_MAP } = require('../lib/catalogue');

test('translateCategory maps every legacy token into the new taxonomy', () => {
    assert.equal(translateCategory('men,shoes'), 'clothing,shoes');
    assert.equal(translateCategory('women,accessories'), 'clothing,other');
    assert.equal(translateCategory('uncategorized'), 'other');
    assert.equal(translateCategory('men,women,shoes,accessories,uncategorized'), 'clothing,clothing,shoes,other,other');
});

test('translateCategory is case and whitespace tolerant', () => {
    assert.equal(translateCategory(' Men , SHOES , Ladies-Accessories '), 'clothing,shoes,ladies-accessories');
    assert.equal(translateCategory('MEN'), 'clothing');
    assert.equal(translateCategory('School-Supplies'), 'school-supplies');
});

test('translateCategory is idempotent and leaves new tokens untouched', () => {
    const cats = 'clothing,school-supplies,ladies-accessories,other';
    assert.equal(translateCategory(cats), cats);
    assert.equal(translateCategory(translateCategory('men,other')), 'clothing,other');
});

test('translateCategory handles empty and undefined input', () => {
    assert.equal(translateCategory(''), '');
    assert.equal(translateCategory(undefined), '');
    assert.equal(translateCategory(null), '');
});

test('LEGACY_CATEGORY_MAP contains exactly the documented fallbacks', () => {
    assert.deepEqual(LEGACY_CATEGORY_MAP, {
        men: 'clothing',
        women: 'clothing',
        accessories: 'other',
        uncategorized: 'other'
    });
});

test('safeEqual accepts matching secrets and rejects everything else', () => {
    assert.equal(safeEqual('secret-abc', 'secret-abc'), true);
    assert.equal(safeEqual('secret-abc', 'secret-abd'), false);
    assert.equal(safeEqual('secret-abc', 'secret-abc1'), false); // length mismatch
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual(null, 'x'), false);
    assert.equal(safeEqual('x', undefined), false);
    assert.equal(safeEqual(123, '123'), false); // non-strings never match
});
