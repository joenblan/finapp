import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearStatus, expectedReduction, breakeven, depositsOf, valueOn, history } from '../src/core/pension/pension.js';
import { paramsFor } from '../src/core/fiscal/params.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { assignManual } from '../src/core/categories/categorize.js';

const P = paramsFor(createEmptyData(), 2026);

test('expected reduction: control values', () => {
  assert.equal(expectedReduction(P, 1_050_000), 315_000);
  assert.equal(expectedReduction(P, 1_200_000), 300_000);
  assert.equal(expectedReduction(P, 1_260_000), 315_000);
  assert.equal(expectedReduction(P, 1_350_000), 337_500);
  assert.equal(expectedReduction(P, 1_400_000), 337_500);
  assert.equal(breakeven(P), 1_260_000);
});

function data(amounts, regime = 'basis') {
  let d = { ...createEmptyData(), accounts: { Z: { id: 'Z', ownership: { type: 'individueel', owners: [] } } } };
  d.transactions = amounts.map((a, i) => ({ id: `p${i}`, accountId: 'Z', entryDate: `2026-0${i + 3}-15`, amount: -a, counterparty: { account: 'BE00000000000090', name: 'PENSIOENFONDS' }, communication: { text: '' } }));
  d = assignManual(d, d.transactions.map((t) => t.id), 'sparen-beleggen--pensioensparen');
  d.pension = [{ id: 'pp', person: 'Jan', type: 'fonds', provider: 'Fonds', regimeByYear: { 2026: regime }, accountIds: [], excludedTxIds: [], manualDeposits: [], values: [] }];
  return d;
}

test('warnings: € 1.200 below breakeven, € 1.400 above the increased ceiling', () => {
  const s1 = yearStatus(data([600_000, 600_000], 'verhoogd'), data([1], 'verhoogd').pension[0], 2026);
  assert.deepEqual([s1.deposited, s1.reduction], [1_200_000, 300_000]);
  assert.deepEqual(s1.warnings.map((w) => w.type), ['breakeven']);
  const d4 = data([700_000, 700_000], 'verhoogd');
  const s4 = yearStatus(d4, d4.pension[0], 2026);
  assert.deepEqual([s4.reduction, s4.warnings.map((w) => w.type)], [337_500, ['overschreden']]);
  const d5 = data([1_050_000]);
  const s5 = yearStatus(d5, d5.pension[0], 2026, { today: '2026-12-05' });
  assert.deepEqual([s5.reduction, s5.remaining, s5.warnings.map((w) => w.type)], [315_000, 0, []]);
  const d6 = data([500_000]);
  assert.deepEqual(yearStatus(d6, d6.pension[0], 2026, { today: '2026-12-05' }).warnings.map((w) => w.type), ['ruimte']);
  assert.deepEqual(yearStatus(d6, d6.pension[0], 2026, { today: '2026-11-30' }).warnings, []);
});

test('deposits are taken from the category, with exclusion and manual deposits', () => {
  const d = data([600_000, 450_000]);
  const pr = d.pension[0];
  assert.equal(depositsOf(d, pr).length, 2);
  pr.excludedTxIds = ['p1'];
  pr.manualDeposits = [{ id: 'm', date: '2026-11-02', amount: 100_000 }];
  assert.equal(yearStatus(d, pr, 2026).deposited, 700_000);
  pr.values = [{ date: '2025-12-31', value: 9_000_000 }, { date: '2026-12-31', value: 10_200_000 }];
  assert.equal(valueOn(pr, '2026-06-30').value, 9_000_000);
  assert.deepEqual(history(d, pr).map((h) => [h.year, h.deposited, h.value?.value]), [[2025, 0, 9_000_000], [2026, 700_000, 10_200_000]]);
});
