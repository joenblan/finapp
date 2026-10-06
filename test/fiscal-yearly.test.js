import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearlyOverview, overviewCsv } from '../src/core/fiscal/yearly.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { parseQuantity } from '../src/core/invest/units.js';
import { assignManual } from '../src/core/categories/categorize.js';
import { trancheSchedule } from '../src/core/loans/schedule.js';

const J = 'BE00000000000003';
const BANK = 'BE00000000000077';
function data() {
  const tranche = { id: 'a', name: 'A', principal: 200_000_000, annualRate: '3', months: 300, firstPaymentDate: '2026-01-05', paymentDay: 5, type: 'annuiteit', rateMethod: 'gelijkwaardig' };
  const rows = trancheSchedule(tranche).rows;
  let d = {
    ...createEmptyData(),
    accounts: { [J]: { id: J, ownership: { type: 'gemeenschappelijk', owners: ['Jan', 'An'] } } },
    transactions: [
      ...rows.slice(0, 3).map((r, i) => ({ id: `l${i}`, accountId: J, entryDate: r.date, amount: -r.payment, counterparty: { account: BANK, name: 'BANK' }, communication: { text: '' } })),
      { id: 'pp1', accountId: J, entryDate: '2026-03-10', amount: -600_000, counterparty: { account: 'BE00000000000090', name: 'PENSIOEN' }, communication: { text: '' } },
    ],
    loans: [{ id: 'l', name: 'Woonkrediet', status: 'bevestigd', accountId: J, counterparty: { iban: BANK }, borrowers: [{ name: 'Jan', share: 5000 }, { name: 'An', share: 5000 }], tranches: [tranche], checkpoints: [], extraPayments: [], paymentLinks: {} }],
    pension: [{ id: 'pp', person: 'Jan', type: 'fonds', provider: 'Fonds', regimeByYear: {}, accountIds: [], excludedTxIds: [], manualDeposits: [], values: [] }],
    investAccounts: [{ id: 'r', name: 'R', owners: [{ name: 'Jan', share: 10000 }], cash: { mode: 'niet-gevolgd' } }],
    securities: [{ id: 's', name: 'ETF', type: 'etf', distribution: 'distribuerend', regime: 'meerwaarde', taxRateId: 'tob-012' }],
    operations: [
      { id: 'o1', createdAt: '1', investAccountId: 'r', securityId: 's', kind: 'aankoop', date: '2026-02-01', quantity: parseQuantity('10'), gross: 1_000_000, costs: 2_500, stockTax: 1_200, withholding: 0 },
      { id: 'o2', createdAt: '2', investAccountId: 'r', securityId: 's', kind: 'dividend', date: '2026-06-01', gross: 10_000, withholding: 3_000 },
      { id: 'o3', createdAt: '3', investAccountId: 'r', securityId: 's', kind: 'verkoop', date: '2026-09-01', quantity: parseQuantity('10'), gross: 1_300_000, costs: 2_500, stockTax: 1_560, withholding: 0 },
    ],
  };
  d = assignManual(d, ['pp1'], 'sparen-beleggen--pensioensparen');
  return { d, rows };
}

test('yearly overview per person: pension, loan by share (paid terms), capital gains, costs, dividends', () => {
  const { d, rows } = data();
  const o = yearlyOverview(d, 'Jan', 2026);
  assert.deepEqual([o.pension[0].status.deposited, o.pension[0].status.reduction], [600_000, 180_000]);
  const interest = rows.slice(0, 3).reduce((s, r) => s + r.interest, 0);
  assert.equal(o.loans[0].interest, interest);
  assert.equal(o.loans[0].terms.length, 3); // only the effectively paid (linked) terms
  assert.equal(o.loans[0].myInterest, Math.round(interest / 2 / 10) * 10);
  assert.deepEqual([o.cgt.gainTotal, o.cgt.tax], [300_000, 0]);
  assert.deepEqual([o.costs.stockTax.amount, o.costs.brokerCosts.amount], [2_760, 5_000]);
  assert.deepEqual([o.costs.dividends.gross, o.costs.dividends.withholding, o.costs.dividends.net], [10_000, 3_000, 7_000]);
  // An: half the loan, no investments, no pension
  const an = yearlyOverview(d, 'An', 2026);
  assert.deepEqual([an.pension.length, an.cgt.gainTotal, an.loans[0].share], [0, 0, 5000]);
  const csv = overviewCsv(o);
  assert.ok(csv.includes('Meerwaardebelasting;Meerwaarden;300,00'));
  assert.ok(csv.includes('Dividenden;Netto;7,00'));
  assert.ok(csv.includes('Indicatief'));
});
