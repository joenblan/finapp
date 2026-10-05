import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../src/core/model/schema.js';
import { categorize, assignManual } from '../src/core/categories/categorize.js';
import { syncRefunds } from '../src/core/categories/refunds.js';
import { buildCategoryReport, monthRange, defaultPeriod } from '../src/core/report-categories.js';

const A = 'BE00000000000001';
const J = 'BE00000000000003';
const tx = (id, accountId, amount, entryDate, cp = '') => ({ id, accountId, amount, entryDate, bookingOrder: 1, counterparty: { account: cp, name: '' }, communication: { text: '' } });

function setup() {
  let d = {
    ...createEmptyData(),
    accounts: {
      [A]: { id: A, ownership: { type: 'individueel', owners: [] } },
      [J]: { id: J, ownership: { type: 'gemeenschappelijk', owners: ['Jan', 'An'] }, coOwnerIbans: ['BE00000000000011'] },
    },
    externalOwnAccounts: [{ iban: 'BE00000000000099', name: 'Spaarboekje' }],
    transactions: [
      tx('loon', A, 2_500_000, '2026-09-30', 'BE00000000000004'),
      tx('energie', A, -82_150, '2026-09-25', 'BE00000000000006'),
      tx('naar-j', A, -1_500_000, '2026-10-01', J), // contribution: expense on the individual account
      tx('van-a', J, 1_500_000, '2026-10-01', A), // contribution: income on the joint account
      tx('bijdrage', J, 1_000_000, '2026-10-02', 'BE00000000000011'), // contribution co-owner: income
      tx('a-naar-a', A, -30_000, '2026-10-06', 'BE00000000000099'), // internal (external own account)
      tx('super', J, -65_400, '2026-10-02'),
      tx('terug', J, 12_000, '2026-10-03'), // refund in an expense category
      tx('raar', A, -5_000, '2026-10-04'), // uncategorised
      tx('raar-in', A, 7_000, '2026-10-04'), // uncategorised income
      tx('spaar', A, -100_000, '2026-10-05', 'BE00000000000077'), // neutral category (savings)
    ],
  };
  d = categorize(d).data;
  d = assignManual(d, ['loon'], 'inkomen--loon');
  d = assignManual(d, ['energie'], 'wonen--energie');
  d = assignManual(d, ['super', 'terug'], 'boodschappen--supermarkt');
  d = assignManual(d, ['spaar'], 'sparen-beleggen--sparen');
  return d;
}

test('months, sections, totals; contributions to the joint account count, internal transfers and neutral categories excluded', () => {
  const d = setup();
  const r = buildCategoryReport(d, { from: '2026-09', to: '2026-10' });
  assert.deepEqual(r.months, ['2026-09', '2026-10']);
  const inc = r.sections.find((s) => s.id === 'inkomst');
  const exp = r.sections.find((s) => s.id === 'uitgave');
  assert.deepEqual(inc.totals.cells, { '2026-09': 2_500_000, '2026-10': 7_000 + 1_500_000 + 1_000_000 });
  assert.deepEqual(exp.totals.cells, { '2026-09': -82_150, '2026-10': -65_400 + 12_000 - 5_000 - 1_500_000 });
  assert.equal(r.saldo.total, 2_500_000 + 7_000 - 82_150 - 65_400 + 12_000 - 5_000 + 1_000_000);
  // excluded: 1 internal transfer (own account without CODA), savings is neutral
  assert.deepEqual(r.excluded, { internal: 1, neutral: 1, foreign: 0 });
  const labels = exp.rows.map((x) => [x.level, x.label]);
  assert.deepEqual(labels, [[0, 'Wonen'], [1, 'Energie'], [0, 'Boodschappen'], [1, 'Supermarkt'], [0, 'Bijdrage gemeenschappelijke rekening'], [0, 'Niet gecategoriseerd']]);
  assert.deepEqual(inc.rows.map((x) => x.label).filter((l) => /Bijdrage/.test(l)).sort(), ['Bijdrage mede-eigenaar', 'Bijdrage van eigen rekening']);
  assert.deepEqual(inc.rows.find((x) => x.label === 'Niet gecategoriseerd').txIds, { '2026-10': ['raar-in'] });
  assert.deepEqual(exp.rows.find((x) => x.label === 'Supermarkt').txIds['2026-10'].sort(), ['super', 'terug']);
});

test('account filter: individual / joint / one account', () => {
  const d = setup();
  const only = (accounts) => buildCategoryReport(d, { from: '2026-09', to: '2026-10', accounts });
  // the joint account balances: contributions in, expenses out
  assert.equal(only('gemeenschappelijk').saldo.total, 1_500_000 + 1_000_000 - 65_400 + 12_000);
  assert.equal(only('individueel').saldo.total, 2_500_000 + 7_000 - 82_150 - 5_000 - 1_500_000);
  assert.equal(only(J).saldo.total, 2_446_600);
  assert.equal(only('alle').saldo.total, only('individueel').saldo.total + only('gemeenschappelijk').saldo.total);
});

test('period helpers', () => {
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(defaultPeriod(setup()), { from: '2026-09', to: '2026-10' });
  const old = setup();
  old.transactions.push({ ...old.transactions[0], id: 'oud', entryDate: '2024-01-15' });
  assert.deepEqual(defaultPeriod(old), { from: '2025-11', to: '2026-10' });
});

test('a refund linked to an expense gets its category and lowers that expense', async () => {
  let d = setup();
  // 'raar-in' (+7,00) is a refund of the supermarket purchase 'super'
  d = syncRefunds({ ...d, annotations: { ...d.annotations, 'raar-in': { refundOf: 'super' } } }).data;
  const r = buildCategoryReport(d, { from: '2026-09', to: '2026-10' });
  const exp = r.sections.find((s) => s.id === 'uitgave');
  assert.deepEqual(exp.rows.find((x) => x.label === 'Supermarkt').txIds['2026-10'].sort(), ['raar-in', 'super', 'terug']);
  assert.equal(exp.rows.find((x) => x.label === 'Supermarkt').cells['2026-10'], -65_400 + 12_000 + 7_000);
  // the expense changes category: the refund follows
  d = assignManual(d, ['super'], 'vrije-tijd--restaurant-en-cafe');
  assert.equal(d.allocations['raar-in'][0].categoryId, 'vrije-tijd--restaurant-en-cafe');
});
