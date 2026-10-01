import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, sum, formatMilli, parseEuroInput, parseDigitsToMilli, MoneyError } from '../src/core/money.js';

test('integer arithmetic only, unsafe values rejected', () => {
  assert.equal(add(100, 200), 300);
  assert.equal(sum([1_000, -250, 10]), 760);
  assert.throws(() => add(0.1, 0.2), MoneyError);
  assert.throws(() => add(Number.MAX_SAFE_INTEGER, 1), MoneyError);
  assert.equal(parseDigitsToMilli('000000000012345'), 12_345);
  assert.equal(parseDigitsToMilli('999999999999999'), 999_999_999_999_999);
  assert.throws(() => parseDigitsToMilli('12 45'), MoneyError);
});

test('formatting in Belgian notation', () => {
  assert.equal(formatMilli(1_234_560), '1.234,56');
  assert.equal(formatMilli(-45_990), '-45,99');
  assert.equal(formatMilli(5), '0,01'); // 0,005 rounds half away from zero
  assert.equal(formatMilli(-4), '0,00');
  assert.equal(formatMilli(999_995), '1.000,00');
  assert.equal(formatMilli(1_234_567, { decimals: 3 }), '1.234,567');
  assert.equal(formatMilli(100_000, { currency: 'EUR' }), '€ 100,00');
});

test('parsing user input', () => {
  assert.equal(parseEuroInput('1.234,56'), 1_234_560);
  assert.equal(parseEuroInput('-12,5'), -12_500);
  assert.equal(parseEuroInput('12.50'), 12_500);
  assert.equal(parseEuroInput('1.234'), 1_234_000);
  assert.equal(parseEuroInput('€ 7'), 7_000);
  assert.equal(parseEuroInput(''), null);
  assert.throws(() => parseEuroInput('abc'), MoneyError);
  assert.throws(() => parseEuroInput('1,2345'), MoneyError);
});
