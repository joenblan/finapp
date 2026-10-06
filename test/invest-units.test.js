import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, formatQuantity, derivedPrice, formatPrice, valueAt, parsePrice, mulDiv, parseMoney } from '../src/core/invest/units.js';
import { expectedStockTax } from '../src/core/invest/stocktax.js';
import { netAmount } from '../src/core/invest/operations.js';
import { defaultFiscalParams } from '../src/core/fiscal/params.js';

const rate = (id) => defaultFiscalParams().stockTaxRates.find((r) => r.id === id);

test('stock tax: control values, rounded to the cent and capped', () => {
  assert.equal(expectedStockTax(5_000_000, rate('tob-012')), 6_000);
  assert.equal(expectedStockTax(5_000_000, rate('tob-035')), 17_500);
  assert.equal(expectedStockTax(5_000_000, rate('tob-132')), 66_000);
  assert.equal(expectedStockTax(2_000_000_000, rate('tob-012')), 1_300_000);
  assert.equal(expectedStockTax(500_000, rate('tob-012')), 600); // € 500 -> € 0,60
  assert.equal(expectedStockTax(1_234_560, rate('tob-012')), 1_480); // 1,48147 -> 1,48
  assert.equal(expectedStockTax(5_000_000, null), 0);
});

test('derived price: 12 for € 301,50 -> € 25,125', () => {
  const p = derivedPrice(301_500, parseQuantity('12'));
  assert.equal(p, 25_125_000);
  assert.equal(formatPrice(p), '25,125');
  assert.equal(formatPrice(parsePrice('100')), '100,00');
});

test('fractional quantities without rounding loss', () => {
  const q = parseQuantity('0,123456');
  assert.equal(q, 123_456);
  assert.equal(formatQuantity(q), '0,123456');
  assert.equal(formatQuantity(parseQuantity('1.234,5')), '1.234,5');
  assert.throws(() => parseQuantity('1,1234567'), /6 decimalen/);
  assert.equal(parseQuantity('1') - parseQuantity('0,333333') - parseQuantity('0,666667'), 0);
  assert.equal(valueAt(parseQuantity('0,5'), parsePrice('25,125')), 12_560); // 12,5625 -> 12,56
  assert.equal(mulDiv(-5, 1, 10), -1); // half-up away from zero
  assert.throws(() => parseMoney('1,005'), /2 decimalen/);
});

test('net amounts (signed like the bank transaction)', () => {
  assert.equal(netAmount({ kind: 'aankoop', gross: 500_000, costs: 0, stockTax: 600 }), -500_600);
  assert.equal(netAmount({ kind: 'verkoop', gross: 1_950_000, costs: 5_000, stockTax: 2_340, withholding: 0 }), 1_942_660);
  assert.equal(netAmount({ kind: 'dividend', gross: 100_000, withholding: 30_000 }), 70_000);
  assert.equal(netAmount({ kind: 'kosten', costs: 7_500 }), -7_500);
  assert.equal(netAmount({ kind: 'splitsing', split: { from: 1, to: 2 } }), 0);
});
