import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodSummary } from '../src/core/budget/freespace.js';
import { buildPeriods } from '../src/core/budget/periods.js';
import { forecastAccount } from '../src/core/budget/forecast.js';
import { makeClassifier } from '../src/core/budget/perspectives.js';
import { syncRecurring } from '../src/core/budget/recurring.js';
import { linkSeriesToLoans, loanTxIds } from '../src/core/loans/budget-link.js';
import { tx, dataset, JOINT } from '../tools/budget-fixtures.js';

const BANK = 'BE00000000000077';
const loan = (status) => ({
  id: 'l1', name: 'Woonkrediet Fictibank', status, accountId: JOINT, counterparty: { iban: BANK, name: 'Fictibank' }, borrowers: [], checkpoints: [], extraPayments: [], paymentLinks: {},
  tranches: [{ id: 'a', name: 'A', principal: 200_000_000, annualRate: '3', months: 300, firstPaymentDate: '2026-06-05', paymentDay: 5, type: 'annuiteit', rateMethod: 'gelijkwaardig' }],
});

function data(status = 'bevestigd') {
  const ts = ['06', '07', '08', '09'].map((m) => tx(JOINT, `2026-${m}-05`, -944_220, { id: `lp${m}`, cp: BANK, name: 'FICTIBANK' }));
  ts.push(tx(JOINT, '2026-09-01', 3_000_000, { id: 'in', cp: 'BE00000000000001' }));
  const d = dataset(ts);
  return syncRecurring({ ...d, loans: [loan(status)], budget: { ...d.budget, perspectives: { ...d.budget.perspectives, gemeenschappelijk: { periodMode: 'kalender', budgets: {} } } } }, { now: '2026-10-01T00:00:00Z' });
}

test('detected series of the loan payments gets loanId; only for confirmed loans', () => {
  const d = data();
  const s = d.recurring.find((r) => r.counterparty.iban === BANK);
  assert.ok(s);
  assert.equal(linkSeriesToLoans(d).recurring.find((r) => r.id === s.id).loanId, 'l1');
  assert.equal(linkSeriesToLoans(data('concept')).recurring.find((r) => r.id === s.id).loanId, undefined);
});

test('linked loan payments count as fixed costs; expected terms are not double counted', () => {
  let d = data();
  d = linkSeriesToLoans({ ...d, recurring: d.recurring.map((r) => ({ ...r, status: 'bevestigd' })) });
  assert.equal(loanTxIds(d).size, 4);
  const classify = makeClassifier(d, 'gemeenschappelijk');
  assert.deepEqual(classify(d.transactions[0]), { flow: 'vast', group: 'wonen--woonkrediet', categoryId: 'wonen--woonkrediet' });
  const period = buildPeriods(d, 'gemeenschappelijk', { today: '2026-10-02' }).pop();
  assert.deepEqual([period.start, period.end], ['2026-10-01', '2026-10-31']);
  const s = periodSummary(d, 'gemeenschappelijk', period, { today: '2026-10-02' });
  const loanItems = s.details.expected.filter((x) => x.loan);
  assert.equal(loanItems.length, 1);
  assert.equal(loanItems[0].amount, -944_220);
  assert.equal(s.details.expected.filter((x) => x.series).length, 0); // the series itself is not counted
  assert.equal(s.fixed.expected, 944_220);
});

test('forecast contains the loan terms once', () => {
  let d = data();
  d = linkSeriesToLoans({ ...d, recurring: d.recurring.map((r) => ({ ...r, status: 'bevestigd' })) });
  const f = forecastAccount(d, JOINT, { months: 3, today: '2026-10-02', start: { date: '2026-10-01', balance: 0 } });
  const items = f.days.flatMap((x) => x.items).filter((i) => i.amount === -944_220);
  assert.deepEqual(f.days.filter((x) => x.items.some((i) => i.amount === -944_220)).map((x) => x.date), ['2026-10-05', '2026-11-05', '2026-12-05']);
  assert.equal(items.length, 3);
});
