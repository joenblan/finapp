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
  assert.deepEqual(refundsFor(d, 'etentje').list.map((x) => x.tx.id), ['piet', 'an']);
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

test('joint account: a repayment between personal and joint counts in the chosen category', async () => {
  const { makeClassifier } = await import('../src/core/budget/perspectives.js');
  const { JOINT } = await import('../tools/budget-fixtures.js');
  let d = dataset([
    tx(ZICHT, '2026-10-02', -80_000, { id: 'super', name: 'SUPERMARKT' }), // I paid the household groceries
    tx(JOINT, '2026-10-03', -80_000, { id: 'j-out', cp: ZICHT }), // the joint account pays me back
    tx(ZICHT, '2026-10-03', 80_000, { id: 'z-in', cp: JOINT }),
  ]);
  d = assignManual(d, ['super'], 'boodschappen--supermarkt');
  // without own choice: contributions (as before)
  assert.equal(makeClassifier(d, 'persoonlijk')(d.transactions[2]).group, 'bijdrage-gemeenschappelijk');
  // personal side: linked to my expense; joint side: categorised as groceries by hand
  d = syncRefunds({ ...d, annotations: { 'z-in': { refundOf: 'super' } } }).data;
  d = assignManual(d, ['j-out'], 'boodschappen--supermarkt');
  const p = makeClassifier(d, 'persoonlijk')(d.transactions.find((t) => t.id === 'z-in'));
  assert.deepEqual([p.flow, p.categoryId], ['variabel', 'boodschappen--supermarkt']);
  const j = makeClassifier(d, 'gemeenschappelijk')(d.transactions.find((t) => t.id === 'j-out'));
  assert.deepEqual([j.flow, j.categoryId], ['variabel', 'boodschappen--supermarkt']);
});

test('one refund split over several expenses: parts with their own category, in overview and budget', async () => {
  const { proposeSplit, validateRefundLinks, openAmount } = await import('../src/core/categories/refunds.js');
  const { buildCategoryReport } = await import('../src/core/report-categories.js');
  let d = dataset([
    tx(ZICHT, '2026-10-02', -60_000, { id: 'etentje', name: 'RESTAURANT' }),
    tx(ZICHT, '2026-10-03', -40_000, { id: 'concert', name: 'TICKETS' }),
    tx(ZICHT, '2026-10-06', 50_000, { id: 'vriend', name: 'PIET', cp: 'BE00000000000044' }),
  ]);
  d = assignManual(d, ['etentje'], 'vrije-tijd--restaurant-en-cafe');
  d = assignManual(d, ['concert'], 'vrije-tijd--uitstappen');
  const refund = d.transactions.find((t) => t.id === 'vriend');
  // proposal: the first expense up to its open amount, the last gets the rest
  assert.deepEqual(proposeSplit(d, refund, ['etentje', 'concert']), [{ expenseId: 'etentje', amount: 50_000 }, { expenseId: 'concert', amount: 0 }]);
  assert.throws(() => validateRefundLinks(d, 'vriend', [{ expenseId: 'etentje', amount: 30_000 }, { expenseId: 'concert', amount: 10_000 }]), /gelijk zijn/);
  const links = validateRefundLinks(d, 'vriend', [{ expenseId: 'etentje', amount: 30_000 }, { expenseId: 'concert', amount: 20_000 }]);
  d = syncRefunds({ ...d, annotations: { vriend: { refundOf: links } } }).data;
  assert.deepEqual(d.allocations.vriend.map((a) => [a.categoryId, a.amount]), [['vrije-tijd--restaurant-en-cafe', 30_000], ['vrije-tijd--uitstappen', 20_000]]);
  assert.equal(openAmount(d, d.transactions[0]), 30_000);
  assert.equal(refundsFor(d, 'concert').total, 20_000);
  const r = buildCategoryReport(d, { from: '2026-10', to: '2026-10', accounts: 'individueel' });
  const rows = r.sections.find((s) => s.id === 'uitgave').rows;
  assert.equal(rows.find((x) => x.label === 'Restaurant & café').cells['2026-10'], -30_000);
  assert.equal(rows.find((x) => x.label === 'Uitstappen').cells['2026-10'], -20_000);
  const cfg = { ...d.budget, perspectives: { ...d.budget.perspectives, persoonlijk: { periodMode: 'kalender', budgets: { 'vrije-tijd': 100_000 } } } };
  const dd = { ...d, budget: cfg };
  const s = periodSummary(dd, 'persoonlijk', buildPeriods(dd, 'persoonlijk', { today: '2026-10-10' }).pop(), { today: '2026-10-10' });
  assert.equal(s.spent, 100_000 - 50_000);
  assert.equal(s.budgets[0].used, 50_000);
  // an old link (a single expense id) still works
  const old = syncRefunds({ ...d, annotations: { vriend: { refundOf: 'concert' } } }).data;
  assert.deepEqual(old.allocations.vriend.map((a) => [a.categoryId, a.amount]), [['vrije-tijd--uitstappen', 50_000]]);
});

test('refund before the expense: found from both sides', async () => {
  const { refundSourceCandidates } = await import('../src/core/categories/refunds.js');
  const d = dataset([
    tx(ZICHT, '2026-10-01', 30_000, { id: 'voorschot', name: 'PIET', cp: 'BE00000000000044' }), // Piet pays first
    tx(ZICHT, '2026-11-15', -60_000, { id: 'reis', name: 'REISBUREAU' }), // the expense 45 days later
    tx(ZICHT, '2027-04-01', -10_000, { id: 'te-laat', name: 'X' }), // more than 90 days after
  ]);
  const refund = d.transactions[0];
  assert.deepEqual(refundCandidates(d, refund).map((t) => t.id), ['reis']);
  assert.deepEqual(refundSourceCandidates(d, d.transactions[1]).map((t) => t.id), ['voorschot']);
  const linked = syncRefunds({ ...d, annotations: { voorschot: { refundOf: [{ expenseId: 'reis', amount: 30_000 }] } } }).data;
  assert.deepEqual(refundSourceCandidates(linked, linked.transactions[1]), []); // already linked to this expense
});
