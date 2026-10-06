import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLots } from '../src/core/invest/lots.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { parseQuantity, parsePrice } from '../src/core/invest/units.js';

const Q = (t) => parseQuantity(String(t));
let seq = 0;
const op = (kind, date, extra) => ({ id: `o${++seq}`, createdAt: String(seq).padStart(4, '0'), investAccountId: 'r', securityId: 's', kind, date, costs: 0, stockTax: 0, withholding: 0, ...extra });
const buy = (date, qty, gross, extra = {}) => op('aankoop', date, { quantity: Q(qty), gross, ...extra });
const sell = (date, qty, gross, extra = {}) => op('verkoop', date, { quantity: Q(qty), gross, ...extra });
function data(ops, security = {}) {
  return { ...createEmptyData(), investAccounts: [{ id: 'r', name: 'R', owners: [{ name: 'Jan', share: 10000 }], cash: { mode: 'niet-gevolgd' } }], securities: [{ id: 's', name: 'ETF', type: 'etf', distribution: 'kapitaliserend', regime: 'meerwaarde', taxRateId: 'tob-012', referencePrice: null, ...security }], operations: ops };
}

test('FIFO: 10 for € 1.000 and 10 for € 1.200, sell 15 for € 1.950', () => {
  const r = computeLots(data([buy('2026-02-10', 10, 1_000_000), buy('2026-05-10', 10, 1_200_000), sell('2026-08-10', 15, 1_950_000)]));
  const [s] = r.sales;
  assert.equal(s.acquisition, 1_600_000);
  assert.equal(s.fiscalGain, 350_000);
  assert.deepEqual(s.parts.map((p) => [p.quantity, p.cost]), [[Q(10), 1_000_000], [Q(5), 600_000]]);
  const pos = r.positions.get('r|s');
  assert.deepEqual([pos.quantity, pos.cost], [Q(5), 600_000]);
});

test('rest: lot of 3 for € 10,00 sold in three times -> 3,33 / 3,33 / 3,34', () => {
  const r = computeLots(data([buy('2026-02-01', 3, 10_000), sell('2026-03-01', 1, 5_000), sell('2026-04-01', 1, 5_000), sell('2026-05-01', 1, 5_000)]));
  assert.deepEqual(r.sales.map((s) => s.cost), [3_330, 3_330, 3_340]);
  assert.equal(r.positions.get('r|s').cost, 0);
});

test('transition rule with reference price', () => {
  const ref = { referencePrice: parsePrice('100') };
  const a = computeLots(data([buy('2024-03-01', 10, 800_000), sell('2026-06-01', 10, 1_300_000)], ref)).sales[0];
  assert.deepEqual([a.acquisition, a.fiscalGain, a.incomplete], [1_000_000, 300_000, false]);
  const b = computeLots(data([buy('2024-03-01', 10, 1_100_000), sell('2026-06-01', 10, 1_300_000)], ref)).sales[0];
  assert.equal(b.fiscalGain, 200_000);
  const c = computeLots(data([buy('2024-03-01', 10, 1_100_000), sell('2031-06-01', 10, 1_300_000)], ref)).sales[0];
  assert.equal(c.fiscalGain, 300_000);
  // missing reference price: incomplete
  const d = computeLots(data([buy('2024-03-01', 10, 800_000), sell('2026-06-01', 10, 1_300_000)])).sales[0];
  assert.equal(d.incomplete, true);
});

test('fractional quantities without rounding loss', () => {
  const r = computeLots(data([buy('2026-02-01', '0,333333', 10_000), buy('2026-02-02', '0,666667', 20_000), sell('2026-03-01', '1', 40_000)]));
  assert.equal(r.positions.get('r|s').quantity, 0);
  assert.equal(r.sales[0].acquisition, 30_000);
  assert.equal(r.sales[0].quantity, Q(1));
});

test('split 2-for-1 keeps the total cost', () => {
  const r = computeLots(data([buy('2026-02-01', 10, 1_000_000), op('splitsing', '2026-03-01', { split: { from: 1, to: 2 } }), sell('2026-04-01', 5, 300_000)]));
  const pos = r.positions.get('r|s');
  assert.equal(pos.quantity, Q(15));
  assert.equal(r.sales[0].cost + pos.cost, 1_000_000);
  assert.equal(r.sales[0].cost, 250_000);
});

test('editing or deleting a purchase recalculates later sales', () => {
  const b1 = buy('2026-02-01', 10, 1_000_000);
  const s1 = sell('2026-06-01', 10, 1_500_000);
  assert.equal(computeLots(data([b1, s1])).sales[0].fiscalGain, 500_000);
  assert.equal(computeLots(data([{ ...b1, gross: 1_200_000 }, s1])).sales[0].fiscalGain, 300_000);
  const r = computeLots(data([s1]));
  assert.equal(r.issues.length, 1);
  assert.equal(r.sales[0].quantity, 0);
});

test('economic result includes costs and taxes; fiscal by default not', () => {
  const r = computeLots(data([buy('2026-02-01', 10, 1_000_000, { costs: 5_000, stockTax: 1_200 }), sell('2026-06-01', 10, 1_200_000, { costs: 5_000, stockTax: 1_440 })]));
  const s = r.sales[0];
  assert.equal(s.fiscalGain, 200_000);
  assert.equal(s.economic, 1_200_000 - 5_000 - 1_440 - 1_000_000 - 5_000 - 1_200);
  const d = data([buy('2026-02-01', 10, 1_000_000, { costs: 5_000, stockTax: 1_200 }), sell('2026-06-01', 10, 1_200_000, { costs: 5_000, stockTax: 1_440 })]);
  d.fiscal.params[2026] = { ...d.fiscal.params[2026], cgt: { ...d.fiscal.params[2026].cgt, costsCount: true } };
  assert.equal(computeLots(d).sales[0].fiscalGain, s.economic);
});

test('regimes: Reynders keeps the gain out of the basis by default; exempt counts nowhere', () => {
  const ops = () => [buy('2026-02-01', 1, 100_000), sell('2026-06-01', 1, 104_600)];
  const r = computeLots(data(ops(), { regime: 'reynders' })).sales[0];
  assert.deepEqual([r.fiscalGain, r.rvPart, r.basisAmount], [4_600, 4_600, 0]);
  const o = ops();
  o[1].rvPart = 2_000;
  const r2 = computeLots(data(o, { regime: 'reynders' })).sales[0];
  assert.equal(r2.basisAmount, 2_600);
  const v = computeLots(data(ops(), { regime: 'vrijgesteld' })).sales[0];
  assert.equal(v.basisAmount, 0);
  const loss = computeLots(data([buy('2026-02-01', 1, 100_000), sell('2026-06-01', 1, 90_000)], { regime: 'reynders' })).sales[0];
  assert.deepEqual([loss.basisAmount, loss.indicative], [-10_000, true]);
});
