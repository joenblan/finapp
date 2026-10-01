import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followUp, checkpointDiffs, outstandingOn, drawdownDate } from '../src/core/loans/payments.js';
import { simulateExtra, feeFor } from '../src/core/loans/simulate.js';
import { validateLoan } from '../src/core/loans/loans.js';
import { dataset, tx, JOINT } from '../tools/budget-fixtures.js';

const BANK = 'BE00000000000077';
const tranche = { id: 'a', name: 'Hoofdkrediet', principal: 200_000_000, annualRate: '3', months: 300, firstPaymentDate: '2026-01-05', paymentDay: 5, type: 'annuiteit', rateMethod: 'gelijkwaardig' };
const loan = { id: 'l1', name: 'Woonkrediet', status: 'bevestigd', accountId: JOINT, counterparty: { iban: BANK, name: 'Fictibank' }, borrowers: [{ name: 'Jan', share: 5000 }, { name: 'An', share: 5000 }], tranches: [tranche], checkpoints: [], extraPayments: [], paymentLinks: {} };

function data() {
  return dataset([
    tx(JOINT, '2026-01-05', -944_220, { id: 'p1', cp: BANK }),
    tx(JOINT, '2026-02-06', -944_220, { id: 'p2', cp: BANK }),
    tx(JOINT, '2026-03-05', -950_000, { id: 'p3', cp: BANK }),
    tx(JOINT, '2026-03-05', -944_220, { id: 'other', cp: 'BE00000000000088' }),
    tx(JOINT, '2026-04-15', -12_000, { id: 'later', cp: 'BE00000000000089' }), // data up to 15/04
  ]);
}

test('follow-up: paid, deviating, open and expected terms', () => {
  const d = data();
  const f = followUp(d, loan, { today: '2026-04-20' });
  const [t1, t2, t3, t4, t5] = f.terms;
  assert.deepEqual([t1.status, t1.txIds], ['betaald', ['p1']]);
  assert.deepEqual([t2.status, t2.txIds], ['betaald', ['p2']]);
  assert.deepEqual([t3.status, t3.txIds, t3.diff], ['afwijkend', ['p3'], 5_780]);
  assert.equal(t4.status, 'openstaand');
  assert.equal(t5.status, 'verwacht');
  assert.ok(!f.linkedTxIds.has('other'));
});

test('follow-up: manual link and "not paid" override the automatic match', () => {
  const d = data();
  const f = followUp(d, { ...loan, paymentLinks: { '2026-03-05': { txIds: ['other'] }, '2026-01-05': { none: true } } }, { today: '2026-04-20' });
  assert.deepEqual([f.terms[0].status, f.terms[0].txIds], ['openstaand', []]);
  assert.deepEqual([f.terms[2].status, f.terms[2].txIds], ['betaald', ['other']]);
});

test('follow-up: two tranches paid with separate transactions', () => {
  const b = { ...tranche, id: 'b', name: 'B', principal: 50_000_000, months: 120, type: 'lineair' };
  const l = { ...loan, tranches: [{ ...tranche, principal: 150_000_000 }, b] };
  const f0 = followUp(dataset([]), l, { today: '2026-01-01' });
  const [pa, pb] = f0.terms[0].parts.map((p) => p.payment);
  const d = dataset([tx(JOINT, '2026-01-05', -pa, { id: 'x1', cp: BANK }), tx(JOINT, '2026-01-05', -pb, { id: 'x2', cp: BANK })]);
  const f = followUp(d, l, { today: '2026-01-20' });
  assert.equal(f.terms[0].status, 'betaald');
  assert.deepEqual([...f.terms[0].txIds].sort(), ['x1', 'x2']);
});

test('checkpoints, outstanding capital and drawdown date', () => {
  const l = { ...loan, checkpoints: [{ date: '2026-01-31', trancheId: null, balance: 199_549_000 }] };
  const [c] = checkpointDiffs(l);
  assert.equal(c.computed, 199_549_030);
  assert.equal(c.diff, -30);
  assert.equal(drawdownDate(loan), '2025-12-05');
  assert.equal(outstandingOn(loan, '2025-12-01'), 0);
  assert.equal(outstandingOn(loan, '2025-12-20'), 200_000_000);
  assert.equal(outstandingOn(loan, '2026-01-05'), 199_549_030);
});

test('simulation: fee 3 months of interest, interest saved, shorter or lower', () => {
  assert.equal(feeFor(tranche, 20_000_000), 147_980);
  assert.equal(feeFor(tranche, 20_000_000, { type: 'bedrag', value: 500_000 }), 500_000);
  const k = simulateExtra(loan, { date: '2030-01-20', trancheId: 'a', amount: 20_000_000, mode: 'korter' });
  assert.ok(k.monthsShorter > 0);
  assert.ok(k.interestSaved > 0);
  assert.equal(k.netGain, k.interestSaved - k.fee);
  assert.equal(k.paymentAfter, 944_220);
  const lo = simulateExtra(loan, { date: '2030-01-20', trancheId: 'a', amount: 20_000_000, mode: 'lager' });
  assert.equal(lo.monthsShorter, 0);
  assert.ok(lo.paymentAfter < lo.paymentBefore);
  assert.ok(k.interestSaved > lo.interestSaved);
  assert.throws(() => simulateExtra(loan, { date: '2030-01-20', trancheId: 'zz', amount: 1000, mode: 'korter' }), /deelkrediet/);
});

test('loan validation', () => {
  const d = data();
  assert.deepEqual(validateLoan(d, loan), []);
  const errs = validateLoan(d, { ...loan, name: '', accountId: 'x', borrowers: [{ name: 'Jan', share: 6000 }], tranches: [{ ...tranche, annualRate: 'abc' }] });
  assert.equal(errs.length, 4);
});

test('follow-up: no "open" before the first data of the account or after its latest data', () => {
  const d = dataset([tx(JOINT, '2026-03-05', -944_220, { id: 'p3', cp: BANK })]);
  const f = followUp(d, loan, { today: '2026-06-20' });
  assert.deepEqual(f.terms.slice(0, 5).map((t) => t.status), ['geen-gegevens', 'geen-gegevens', 'betaald', 'verwacht', 'verwacht']);
});

test('follow-up: two tranches, one paid with a deviating amount', () => {
  const b = { ...tranche, id: 'b', name: 'B', principal: 50_000_000, months: 120, type: 'lineair' };
  const l = { ...loan, tranches: [{ ...tranche, principal: 150_000_000 }, b] };
  const [pa, pb] = followUp(dataset([]), l, { today: '2026-01-01' }).terms[0].parts.map((p) => p.payment);
  const d = dataset([tx(JOINT, '2026-01-05', -(pa + 5_000), { id: 'x1', cp: BANK }), tx(JOINT, '2026-01-05', -pb, { id: 'x2', cp: BANK })]);
  const t1 = followUp(d, l, { today: '2026-01-20' }).terms[0];
  assert.deepEqual([t1.status, t1.diff, [...t1.txIds].sort()], ['afwijkend', 5_000, ['x1', 'x2']]);
});
