import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContinuity } from '../src/core/checks/continuity.js';
import { checkStatement } from '../src/core/checks/balance.js';
import { parseCoda } from '../src/core/coda/parser.js';
import { buildStatement, toFileText, IBAN_A } from '../tools/coda-builder.js';

const s = (year, number, oldBalance, newBalance) => ({ id: `${year}/${number}`, year, number, oldBalance, newBalance });

test('continuity: consecutive statements are fine', () => {
  assert.deepEqual(checkContinuity([s(2026, 2, 100, 200), s(2026, 1, 0, 100), s(2026, 3, 200, 50)]), []);
});

test('continuity: missing statements are reported with their numbers', () => {
  const issues = checkContinuity([s(2026, 1, 0, 100), s(2026, 4, 300, 400)]);
  const missing = issues.find((i) => i.code === 'MISSING_STATEMENT');
  assert.deepEqual(missing.missing.map((m) => m.number), [2, 3]);
  assert.match(missing.message, /2026\/002 t\.e\.m\. 2026\/003/);
  assert.ok(issues.some((i) => i.code === 'BALANCE_GAP'));
});

test('continuity: year change restarting at 1 is fine; balance gap is reported', () => {
  assert.deepEqual(checkContinuity([s(2025, 250, 0, 100), s(2026, 1, 100, 150)]), []);
  const issues = checkContinuity([s(2025, 250, 0, 100), s(2026, 1, 90, 150)]);
  assert.deepEqual(issues.map((i) => i.code), ['BALANCE_GAP']);
});

test('statement check: balance ok / not ok', () => {
  const ok = buildStatement({ iban: IBAN_A, statementNumber: 1, oldBalance: 10, oldDate: '2026-01-01', newDate: '2026-01-02', movements: [{ seq: 1, amount: 5, communication: 'x' }] });
  const st = parseCoda(toFileText(ok.lines)).statements[0];
  assert.equal(checkStatement(st).balance.ok, true);
  assert.equal(checkStatement(st).trailer.ok, true);
  const bad = buildStatement({ iban: IBAN_A, statementNumber: 1, oldBalance: 10, oldDate: '2026-01-01', newDate: '2026-01-02', movements: [{ seq: 1, amount: 5, communication: 'x' }], override: { newBalance: 16 } });
  const r = checkStatement(parseCoda(toFileText(bad.lines)).statements[0]);
  assert.equal(r.balance.ok, false);
  assert.equal(r.balance.expected, 15);
  assert.equal(r.balance.actual, 16);
});
