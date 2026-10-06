import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netWorthOn, netWorthSeries } from '../src/core/wealth/wealth.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { parseQuantity, parsePrice } from '../src/core/invest/units.js';

const BANK = 'BE00000000000061';
function data({ withPrice = true } = {}) {
  return {
    ...createEmptyData(),
    accounts: { [BANK]: { id: BANK, number: BANK, displayName: 'Zicht', kind: 'zicht', currency: 'EUR', sourceFormat: 'csv', ownership: { type: 'individueel', owners: [] } } },
    transactions: [
      { id: 'b1', accountId: BANK, entryDate: '2026-09-01', amount: 1_000_000, balanceAfter: 1_000_000, bookingOrder: 1, counterparty: { account: '' }, communication: { text: '' } },
      { id: 'b2', accountId: BANK, entryDate: '2026-10-03', amount: -500_600, balanceAfter: 499_400, bookingOrder: 2, counterparty: { account: '' }, communication: { text: '' } },
    ],
    investAccounts: [{ id: 'r', name: 'Effecten', owners: [{ name: 'Jan', share: 10000 }], cash: { mode: 'afrekenrekening', accountId: BANK } }],
    securities: [{ id: 's', name: 'World ETF', type: 'etf', distribution: 'kapitaliserend', regime: 'meerwaarde', taxRateId: 'tob-012' }],
    operations: [{ id: 'o1', createdAt: '1', investAccountId: 'r', securityId: 's', kind: 'aankoop', date: '2026-10-01', quantity: parseQuantity('5'), gross: 500_000, costs: 0, stockTax: 600, withholding: 0, bankTxId: 'b2' }],
    prices: withPrice ? { s: [{ date: '2026-10-03', price: parsePrice('100') }] } : {},
    pension: [{ id: 'pp', person: 'Jan', type: 'fonds', provider: 'Fonds', values: [{ date: '2026-06-30', value: 2_000_000 }] }],
  };
}

test('net worth: bank € 1.000 before, purchase € 500,60, position € 500 -> € 999,40 (no double count)', () => {
  const before = netWorthOn(data(), '2026-09-30', 'huishouden');
  assert.equal(before.groups.find((g) => g.id === 'rekeningen').total, 1_000_000);
  const after = netWorthOn(data(), '2026-10-05', 'huishouden');
  const g = (id) => after.groups.find((x) => x.id === id).total;
  assert.deepEqual([g('rekeningen'), g('beleggingen')], [499_400, 500_000]);
  assert.equal(g('rekeningen') + g('beleggingen'), 999_400);
  assert.equal(g('pensioensparen'), 2_000_000);
});

test('unknown price is not counted as 0 but marked; stale price marked', () => {
  const w = netWorthOn(data({ withPrice: false }), '2026-10-05', 'huishouden');
  const item = w.groups.find((x) => x.id === 'beleggingen').items[0];
  assert.deepEqual([item.value, item.counted, item.missing], [null, null, true]);
  assert.ok(w.incomplete.some((i) => /geen koers/.test(i.note)));
  const later = netWorthOn(data(), '2026-12-31', 'huishouden').groups.find((x) => x.id === 'beleggingen').items[0];
  assert.deepEqual([later.value, later.missing, /verouderd/.test(later.note)], [500_000, true, true]);
  const series = netWorthSeries(data(), 'persoonlijk', { today: '2026-10-05' });
  assert.equal(series.at(-1).groups.find((x) => x.id === 'beleggingen').total, 500_000);
});
