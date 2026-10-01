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
