import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/core/csv/csv.js';
import { parseAmount, parseDateTime, NotationError } from '../src/core/csv/notation.js';

test('CSV: delimiter, CRLF, quoted fields with line breaks and escaped quotes', () => {
  const text = '﻿a;b;c\r\n1;"x\ny\nz";3\r\n"he said ""hi""";"a;b";\r\n;;\r\n';
  const r = parseCsv(text);
  assert.deepEqual(r.map((x) => x.fields), [['a', 'b', 'c'], ['1', 'x\ny\nz', '3'], ['he said "hi"', 'a;b', ''], ['', '', '']]);
  assert.deepEqual(r.map((x) => x.line), [1, 2, 5, 6]);
});

test('CSV: unterminated quote is an error', () => {
  assert.throws(() => parseCsv('a;"open\r\nb'), /Aanhalingsteken/);
});

test('amounts: decimal comma, variable decimals, defensive thousands separator', () => {
  assert.equal(parseAmount('-87,5'), -87_500);
  assert.equal(parseAmount('-1600'), -1_600_000);
  assert.equal(parseAmount('2552,42'), 2_552_420);
  assert.equal(parseAmount('-7,8'), -7_800);
  assert.equal(parseAmount('2500'), 2_500_000);
  assert.equal(parseAmount('1.234,56'), 1_234_560);
  assert.equal(parseAmount('1.234.567,8'), 1_234_567_800);
  assert.equal(parseAmount('0,001'), 1);
  assert.equal(parseAmount(''), null);
  assert.throws(() => parseAmount('12.34,5'), NotationError);
  assert.throws(() => parseAmount('1,2345'), NotationError);
  assert.throws(() => parseAmount('abc'), NotationError);
  assert.throws(() => parseAmount('1,2,3'), NotationError);
  assert.equal(parseAmount('1234.5', { decimal: '.', thousands: ',' }), 1_234_500);
});

test('dates: D/M/YYYY without leading zeros, optional time', () => {
  assert.deepEqual(parseDateTime('1/10/2026'), { date: '2026-10-01', time: null });
  assert.deepEqual(parseDateTime('29/09/2026 12:46'), { date: '2026-09-29', time: '12:46' });
  assert.deepEqual(parseDateTime('1/10/2026 9:52'), { date: '2026-10-01', time: '09:52' });
  assert.equal(parseDateTime(''), null);
  assert.throws(() => parseDateTime('31/9/2026'), NotationError);
  assert.throws(() => parseDateTime('2026-10-01'), NotationError);
  assert.deepEqual(parseDateTime('2026-10-01', 'YYYY-MM-DD'), { date: '2026-10-01', time: null });
});
