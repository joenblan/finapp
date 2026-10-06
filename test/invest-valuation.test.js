import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valuePositions, totals, priceOn, priceUpdateList } from '../src/core/invest/valuation.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { parseQuantity, parsePrice } from '../src/core/invest/units.js';

function data(prices) {
  return {
    ...createEmptyData(),
    investAccounts: [{ id: 'r', name: 'R', owners: [{ name: 'Jan', share: 10000 }], cash: { mode: 'niet-gevolgd' } }],
    securities: [{ id: 's', name: 'ETF', type: 'etf', distribution: 'kapitaliserend', regime: 'meerwaarde', taxRateId: 'tob-012' }, { id: 't', name: 'Oud', type: 'etf', distribution: 'kapitaliserend', regime: 'meerwaarde', taxRateId: null }],
    operations: [{ id: 'o1', createdAt: '1', investAccountId: 'r', securityId: 's', kind: 'aankoop', date: '2026-02-01', quantity: parseQuantity('10'), gross: 1_000_000, costs: 2_000, stockTax: 1_200 }],
    prices,
  };
}

test('value = quantity × last known price; average price and unrealized result', () => {
  const d = data({ s: [{ date: '2026-03-01', price: parsePrice('110') }, { date: '2026-04-01', price: parsePrice('120,5') }] });
  const [p] = valuePositions(d, '2026-04-15');
  assert.deepEqual([p.value, p.price, p.unrealized, p.unrealizedPct, p.avgPrice, p.stale], [1_205_000, 120_500_000, 205_000, 2050, 100_000_000, false]);
  assert.equal(valuePositions(d, '2026-03-15')[0].value, 1_100_000);
  assert.deepEqual([p.costs, p.taxes], [2_000, 1_200]);
});

test('unknown price counts as unknown, not 0; old price is marked stale', () => {
  const none = valuePositions(data({}), '2026-04-15');
  assert.equal(none[0].value, null);
  const t = totals(none);
  assert.deepEqual([t.value, t.incomplete, t.unrealizedPct], [0, true, null]);
  const old = valuePositions(data({ s: [{ date: '2026-03-01', price: parsePrice('110') }] }), '2026-04-15')[0];
  assert.deepEqual([old.value, old.stale], [1_100_000, true]); // 45 days > 35
  assert.equal(priceOn(data({ s: [{ date: '2026-03-01', price: 1 }] }), 's', '2026-04-05').stale, false); // 35 days
  assert.deepEqual(priceUpdateList(data({}), '2026-04-15').map((x) => x.security.id), ['s']);
});
