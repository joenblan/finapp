import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTransactions, sortForList } from '../src/core/filter.js';

const tx = (i, extra) => ({
  id: `t${i}`, accountId: 'A', bookingOrder: i,
  entryDate: '2026-03-01', amount: -1000 * i, counterparty: { name: `Winkel ${i}` }, communication: { text: '' }, ...extra,
});

test('filters by account, period, search terms and absolute amount', () => {
  const list = [tx(1), tx(2, { entryDate: '2026-04-01' }), tx(3, { accountId: 'B' }), tx(4, { communication: { text: 'Huur april' } })];
  assert.deepEqual(filterTransactions(list, { accountId: 'A' }).map((t) => t.id), ['t1', 't2', 't4']);
  assert.deepEqual(filterTransactions(list, { from: '2026-03-15' }).map((t) => t.id), ['t2']);
  assert.deepEqual(filterTransactions(list, { query: 'HUUR apr' }).map((t) => t.id), ['t4']);
  assert.deepEqual(filterTransactions(list, { minAbs: 2000, maxAbs: 3000 }).map((t) => t.id), ['t2', 't3']);
});

test('booking order within an account wins over dates', () => {
  // t2 was booked after t1, although its date is earlier
  const list = [tx(1, { entryDate: '2026-03-02' }), tx(2, { entryDate: '2026-03-01' })];
  assert.deepEqual(sortForList(list).map((t) => t.id), ['t2', 't1']);
});

test('20.000 transactions filter quickly', () => {
  const many = Array.from({ length: 20000 }, (_, i) => tx(i, { communication: { text: `mededeling ${i}` } }));
  const t0 = performance.now();
  sortForList(filterTransactions(many, { query: 'mededeling 1999' }));
  filterTransactions(many, { query: 'winkel' });
  assert.ok(performance.now() - t0 < 1000);
});

// ---- direction filter -------------------------------------------------------
import { isNeutralTx, summarize } from '../src/core/filter.js';

function directionData() {
  const list = [
    tx(1, { id: 'loon', amount: 2_500_000, entryDate: '2026-03-31', counterparty: { name: 'Werkgever' } }),
    tx(2, { id: 'super', amount: -45_500, entryDate: '2026-03-05', counterparty: { name: 'Supermarkt' } }),
    tx(3, { id: 'spaar', amount: -200_000, entryDate: '2026-03-02', counterparty: { name: 'Eigen spaarrekening' } }), // internal
    tx(4, { id: 'terug', amount: 12_000, entryDate: '2026-04-02', counterparty: { name: 'Supermarkt' } }),
    tx(5, { id: 'bijdrage', amount: -1_500_000, entryDate: '2026-03-01', counterparty: { name: 'Gemeenschappelijk' } }), // contribution: not neutral
    tx(6, { id: 'usd', amount: -6_050, entryDate: '2026-03-10', foreignCurrency: true }),
  ];
  const ctx = {
    categoryKinds: (id) => ({ spaar: ['neutraal'], loon: ['inkomst'], super: ['uitgave'], terug: ['uitgave'], bijdrage: ['uitgave'] })[id] ?? [null],
    isInternal: (t) => t.id === 'spaar' || t.id === 'bijdrage',
    isContribution: (t) => t.id === 'bijdrage',
  };
  return { list, isNeutral: (t) => isNeutralTx(t, ctx) };
}
const ids = (l) => l.map((t) => t.id);

test('direction: all, income (> 0) and expenses (< 0)', () => {
  const { list } = directionData();
  assert.deepEqual(ids(filterTransactions(list, { direction: 'alles' })), ['loon', 'super', 'spaar', 'terug', 'bijdrage', 'usd']);
  assert.deepEqual(ids(filterTransactions(list, {})), ids(list)); // default: all
  assert.deepEqual(ids(filterTransactions(list, { direction: 'in' })), ['loon', 'terug']);
  assert.deepEqual(ids(filterTransactions(list, { direction: 'uit' })), ['super', 'spaar', 'bijdrage', 'usd']);
  assert.deepEqual(ids(filterTransactions([tx(9, { amount: 0 })], { direction: 'in' })), []);
  assert.deepEqual(ids(filterTransactions([tx(9, { amount: 0 })], { direction: 'uit' })), []);
});

test('direction combines with period and search term', () => {
  const { list } = directionData();
  assert.deepEqual(ids(filterTransactions(list, { direction: 'uit', from: '2026-03-03', to: '2026-03-31' })), ['super', 'usd']);
  assert.deepEqual(ids(filterTransactions(list, { direction: 'in', query: 'supermarkt' })), ['terug']);
  assert.deepEqual(ids(filterTransactions(list, { direction: 'uit', query: 'supermarkt', to: '2026-03-31' })), ['super']);
});

test('internal transfers and neutral categories: hidden with the switch on, shown with it off', () => {
  const { list, isNeutral } = directionData();
  assert.deepEqual(ids(filterTransactions(list, { direction: 'uit', hideNeutral: true }, { isNeutral })), ['super', 'bijdrage', 'usd']);
  assert.deepEqual(ids(filterTransactions(list, { direction: 'uit', hideNeutral: false }, { isNeutral })), ['super', 'spaar', 'bijdrage', 'usd']);
  assert.deepEqual(ids(filterTransactions(list, { direction: 'alles', hideNeutral: true }, { isNeutral })), ['loon', 'super', 'terug', 'bijdrage', 'usd']);
  // uncategorised internal transfer is neutral, a user-chosen non-neutral category is not
  const ctx = { categoryKinds: () => [null], isInternal: () => true, isContribution: () => false };
  assert.equal(isNeutralTx(tx(1), ctx), true);
  assert.equal(isNeutralTx(tx(1), { ...ctx, categoryKinds: () => ['uitgave'] }), false);
  assert.equal(isNeutralTx(tx(1), { ...ctx, isContribution: () => true }), false);
});

test('count and total of the filtered selection', () => {
  const { list, isNeutral } = directionData();
  assert.deepEqual(summarize(filterTransactions(list, { direction: 'in' })), { count: 2, total: 2_512_000, foreign: 0 });
  assert.deepEqual(summarize(filterTransactions(list, { direction: 'uit', hideNeutral: true }, { isNeutral })), { count: 3, total: -1_545_500, foreign: 1 });
  assert.deepEqual(summarize([]), { count: 0, total: 0, foreign: 0 });
});
