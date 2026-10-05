import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncRefunds, refundsFor, validateRefundLink, refundCandidates, RULE_REFUND } from '../src/core/categories/refunds.js';
import { categorize, assignManual, resetToAutomatic } from '../src/core/categories/categorize.js';
import { deleteCategory } from '../src/core/categories/categories.js';
import { periodSummary } from '../src/core/budget/freespace.js';
import { buildPeriods } from '../src/core/budget/periods.js';
import { parseDataFile } from '../src/core/model/migrations.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { tx, dataset, ZICHT } from '../tools/budget-fixtures.js';

function data() {
  let d = dataset([
    tx(ZICHT, '2026-10-02', -60_000, { id: 'etentje', name: 'RESTAURANT' }),
    tx(ZICHT, '2026-10-04', 20_000, { id: 'piet', name: 'PIET', cp: 'BE00000000000044' }),
    tx(ZICHT, '2026-10-05', 20_000, { id: 'an', name: 'AN', cp: 'BE00000000000045' }),
    tx(ZICHT, '2026-09-01', -5_000, { id: 'oud', name: 'BAKKER' }),
  ]);
  d = assignManual(d, ['etentje'], 'vrije-tijd--restaurant-en-cafe');
  return syncRefunds({ ...d, annotations: { piet: { refundOf: 'etentje' }, an: { refundOf: 'etentje' } } }).data;
}

test('linked refunds take the category of the expense and keep it on every recategorisation', () => {
  let d = data();
  for (const id of ['piet', 'an']) assert.deepEqual(d.allocations[id][0], { categoryId: 'vrije-tijd--restaurant-en-cafe', amount: 20_000, source: 'regel', ruleId: RULE_REFUND });
  d = categorize(d, { mode: 'all' }).data;
  assert.equal(d.allocations.piet[0].categoryId, 'vrije-tijd--restaurant-en-cafe');
  d = resetToAutomatic(d, ['piet']);
  assert.equal(d.allocations.piet[0].ruleId, RULE_REFUND);
  assert.deepEqual(refundsFor(d, 'etentje').list.map((t) => t.id), ['piet', 'an']);
  assert.equal(refundsFor(d, 'etentje').total, 40_000);
  // the category of the expense is deleted: the refunds become uncategorised too
  d = deleteCategory(d, 'vrije-tijd', null).data;
  assert.equal(d.allocations.piet[0].categoryId, null);
});

test('budget: a linked refund lowers the spending of the category', () => {
  const d = data();
  const period = buildPeriods({ ...d, budget: { ...d.budget, perspectives: { ...d.budget.perspectives, persoonlijk: { periodMode: 'kalender', budgets: {} } } } }, 'persoonlijk', { today: '2026-10-10' }).pop();
  const s = periodSummary({ ...d, budget: { ...d.budget, perspectives: { ...d.budget.perspectives, persoonlijk: { periodMode: 'kalender', budgets: {} } } } }, 'persoonlijk', period, { today: '2026-10-10' });
  assert.equal(s.spent, 60_000 - 40_000);
  assert.equal(s.income.actual, 0);
});

test('validation and candidates', () => {
  const d = data();
  assert.throws(() => validateRefundLink(d, 'etentje', 'oud'), /ontvangst/);
  assert.throws(() => validateRefundLink(d, 'piet', 'an'), /uitgave/);
  validateRefundLink(d, 'piet', 'oud');
  const refund = d.transactions.find((t) => t.id === 'piet');
  // larger-or-equal expenses first, then by date distance
  assert.deepEqual(refundCandidates(d, refund).map((t) => t.id), ['etentje', 'oud']);
});

test('migration 7→8: Voorschotten removed, refunds category added, Terugbetalingen renamed', () => {
  const v7 = { ...createEmptyData(), schemaVersion: 7 };
  // as an older version created it
  v7.categories = [
    ...v7.categories.filter((c) => c.id !== 'inkomen--terugbetaling-vrienden-en-familie').map((c) => (c.id === 'inkomen--terugbetalingen' ? { ...c, name: 'Terugbetalingen' } : c)),
    { id: 'voorschotten', name: 'Voorschotten', parentId: null, kind: 'neutraal', system: false, budgetType: 'variabel' },
    { id: 'voorschotten--voorschot', name: 'Voorschot', parentId: 'voorschotten', kind: 'neutraal', system: false, budgetType: 'variabel' },
  ];
  v7.transactions = [{ id: 't1', accountId: 'X', entryDate: '2026-10-01', amount: 5_000, counterparty: { account: '' }, communication: { text: '' } }];
  v7.allocations = { t1: [{ categoryId: 'voorschotten--voorschot', amount: 5_000, source: 'manueel', ruleId: null }] };
  v7.rules = [{ id: 'r1', name: 'x', categoryId: 'voorschotten--voorschot', conditions: { nameContains: 'x' } }];
  const { data, applied } = parseDataFile(JSON.stringify(v7));
  assert.deepEqual(applied, ['7→8']);
  assert.ok(!data.categories.some((c) => c.id.startsWith('voorschotten')));
  assert.equal(data.categories.find((c) => c.id === 'inkomen--terugbetalingen').name, 'Terugbetalingen (mutualiteit, belastingen…)');
  assert.equal(data.categories.find((c) => c.id === 'inkomen--terugbetaling-vrienden-en-familie').kind, 'inkomst');
  assert.equal(data.allocations.t1[0].categoryId, null);
  assert.deepEqual(data.rules, []);
});
