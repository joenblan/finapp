import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearSummary, simulateSale, investPersons } from '../src/core/invest/capital-gains.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { parseQuantity } from '../src/core/invest/units.js';

let seq = 0;
const op = (acc, sec, kind, date, qty, gross, extra = {}) => ({ id: `o${++seq}`, createdAt: String(seq).padStart(4, '0'), investAccountId: acc, securityId: sec, kind, date, quantity: parseQuantity(String(qty)), gross, costs: 0, stockTax: 0, withholding: 0, ...extra });
function data({ owners = [{ name: 'Jan', share: 10000 }], regimes = {} } = {}) {
  return {
    ...createEmptyData(),
    investAccounts: [{ id: 'r', name: 'R', owners, cash: { mode: 'niet-gevolgd' } }],
    securities: ['a', 'b', 'c'].map((id) => ({ id, name: id, type: 'etf', distribution: 'kapitaliserend', regime: regimes[id] ?? 'meerwaarde', taxRateId: 'tob-012' })),
    operations: [],
  };
}

test('year calculation: gains € 12.500, losses € 1.000 -> basis € 1.500, tax € 150; net € 8.000 -> € 0', () => {
  const d = data();
  d.operations = [op('r', 'a', 'aankoop', '2026-01-10', 1, 10_000_000), op('r', 'a', 'verkoop', '2026-03-10', 1, 22_500_000), op('r', 'b', 'aankoop', '2026-01-10', 1, 5_000_000), op('r', 'b', 'verkoop', '2026-04-10', 1, 4_000_000)];
  const y = yearSummary(d, 'Jan', 2026);
  assert.deepEqual([y.gainTotal, y.lossTotal, y.net, y.taxable, y.tax, y.remainingExemption], [12_500_000, 1_000_000, 11_500_000, 1_500_000, 150_000, 0]);
  const d2 = data();
  d2.operations = [op('r', 'a', 'aankoop', '2026-01-10', 1, 10_000_000), op('r', 'a', 'verkoop', '2026-03-10', 1, 18_000_000)];
  const y2 = yearSummary(d2, 'Jan', 2026);
  assert.deepEqual([y2.net, y2.tax, y2.remainingExemption], [8_000_000, 0, 2_000_000]);
  // carried-over exemption and already withheld
  d.fiscal.perPersonYear['Jan|2026'] = { carriedExemption: 1_000_000, withheldCgt: 100_000 };
  const y3 = yearSummary(d, 'Jan', 2026);
  assert.deepEqual([y3.taxable, y3.tax, y3.difference], [500_000, 50_000, -50_000]);
  // another year is separate
  assert.equal(yearSummary(d, 'Jan', 2027).net, 0);
});

test('joint investment account 50/50 splits the gains', () => {
  const d = data({ owners: [{ name: 'Jan', share: 5000 }, { name: 'An', share: 5000 }] });
  d.operations = [op('r', 'a', 'aankoop', '2026-01-10', 1, 10_000_000), op('r', 'a', 'verkoop', '2026-03-10', 1, 32_000_010)];
  const jan = yearSummary(d, 'Jan', 2026);
  const an = yearSummary(d, 'An', 2026);
  assert.equal(jan.gainTotal, 11_000_010);
  assert.equal(an.gainTotal, 11_000_010);
  assert.deepEqual([jan.taxable, jan.tax], [1_000_010, 100_000]);
  assert.deepEqual(investPersons(d), ['An', 'Jan']);
});

test('exempt security counts nowhere; Reynders gain stays out of the basis by default', () => {
  const d = data({ regimes: { a: 'vrijgesteld', b: 'reynders' } });
  d.operations = [op('r', 'a', 'aankoop', '2026-01-10', 1, 10_000_000), op('r', 'a', 'verkoop', '2026-03-10', 1, 50_000_000), op('r', 'b', 'aankoop', '2026-01-10', 1, 100_000), op('r', 'b', 'verkoop', '2026-03-10', 1, 104_600)];
  const y = yearSummary(d, 'Jan', 2026);
  assert.deepEqual([y.gainTotal, y.tax], [0, 0]);
  assert.deepEqual([y.reynders.realizedGains, y.reynders.rvPart], [4_600, 4_600]);
  d.operations[3].rvPart = 2_000;
  assert.equal(yearSummary(d, 'Jan', 2026).gainTotal, 2_600);
});

test('simulation: lots, gain, expected stock tax and remaining exemption; nothing changes', () => {
  const d = data();
  d.operations = [op('r', 'a', 'aankoop', '2026-02-10', 10, 1_000_000), op('r', 'a', 'aankoop', '2026-05-10', 10, 1_200_000)];
  const before = JSON.stringify(d);
  const s = simulateSale(d, { investAccountId: 'r', securityId: 'a', quantity: parseQuantity('15'), gross: 1_950_000, date: '2026-09-01' });
  assert.equal(JSON.stringify(d), before);
  assert.deepEqual([s.sale.fiscalGain, s.stockTax, s.regime, s.sale.parts.length], [350_000, 2_340, 'meerwaarde', 2]);
  assert.deepEqual([s.owners[0].remainingBefore, s.owners[0].remainingAfter], [10_000_000, 9_650_000]);
  assert.equal(simulateSale(d, { investAccountId: 'r', securityId: 'a', quantity: parseQuantity('25'), gross: 1_000_000, date: '2026-09-01' }).shortfall, true);
});
