import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trancheSchedule, loanSchedule } from '../src/core/loans/schedule.js';
import { monthlyRate, fixedToPercentText, S } from '../src/core/loans/decimal.js';

const base = { name: 'A', principal: 200_000_000, annualRate: '3', months: 300, firstPaymentDate: '2026-01-05', paymentDay: 5, type: 'annuiteit', rateMethod: 'gelijkwaardig' };

test('rates: equivalent monthly rate (1+j)^(1/12)-1 and nominal j/12', () => {
  assert.equal(fixedToPercentText(monthlyRate('3', 'gelijkwaardig'), 8), '0,24662698');
  assert.equal(monthlyRate('3', 'nominaal'), (3n * S) / 1200n);
  assert.equal(monthlyRate('3,00', 'nominaal'), monthlyRate('3.00', 'nominaal'));
  assert.throws(() => monthlyRate('3.2.1'), /Ongeldige rentevoet/);
});

test('control values: equivalent monthly rate, constant payment', () => {
  const s = trancheSchedule(base);
  assert.equal(s.firstPayment, 944_220);
  assert.deepEqual(s.rows[0], { n: 1, date: '2026-01-05', payment: 944_220, interest: 493_250, capital: 450_970, balance: 199_549_030, extraBefore: 0 });
  assert.equal(s.rows.length, 300);
  assert.equal(s.rows[299].payment, 943_060);
  assert.equal(s.rows[299].balance, 0);
  assert.equal(s.totalInterest, 83_264_840);
  assert.equal(s.endDate, '2050-12-05');
});

test('control values: nominal monthly rate j/12', () => {
  const s = trancheSchedule({ ...base, rateMethod: 'nominaal' });
  assert.equal(s.firstPayment, 948_420);
  assert.deepEqual([s.rows[0].interest, s.rows[0].capital, s.rows[0].balance], [500_000, 448_420, 199_551_580]);
  assert.equal(s.rows[299].payment, 949_600);
  assert.equal(s.totalInterest, 84_527_180);
});

test('control values: constant capital repayment ends exactly on 0', () => {
  const s = trancheSchedule({ ...base, type: 'lineair' });
  assert.deepEqual([s.rows[0].capital, s.rows[0].interest, s.rows[0].payment], [666_670, 493_250, 1_159_920]);
  assert.equal(s.rows.length, 300);
  assert.equal(s.rows[299].balance, 0);
  assert.equal(s.rows[299].capital, 665_670);
  assert.ok(s.rows.every((r) => Number.isSafeInteger(r.payment) && r.payment % 10 === 0));
});

test('loan with 2 tranches: totals per due date', () => {
  const loan = {
    tranches: [
      { ...base, id: 'a', principal: 150_000_000 },
      { ...base, id: 'b', name: 'B', principal: 50_000_000, annualRate: '2,5', months: 120, type: 'lineair' },
    ],
  };
  const s = loanSchedule(loan);
  const a = trancheSchedule(loan.tranches[0]);
  const b = trancheSchedule(loan.tranches[1]);
  assert.equal(s.total.length, 300);
  assert.equal(s.total[0].payment, a.rows[0].payment + b.rows[0].payment);
  assert.equal(s.total[0].balance, a.rows[0].balance + b.rows[0].balance);
  assert.equal(s.total[119].balance, a.rows[119].balance); // tranche B fully repaid after 120 terms
  assert.equal(s.total[120].payment, a.rows[120].payment);
  assert.equal(s.totalInterest, a.totalInterest + b.totalInterest);
  assert.equal(s.total[299].balance, 0);
});

test('tranches with different start dates: not yet started tranche counts fully', () => {
  const loan = { tranches: [{ ...base, id: 'a', principal: 100_000_000 }, { ...base, id: 'b', principal: 50_000_000, firstPaymentDate: '2026-03-05' }] };
  const s = loanSchedule(loan);
  assert.equal(s.total[0].date, '2026-01-05');
  assert.equal(s.total[0].balance, s.perTranche[0].rows[0].balance + 50_000_000);
});

test('extra repayment, mode korter: same payment, fewer terms, less interest', () => {
  const plain = trancheSchedule(base);
  const s = trancheSchedule(base, [{ date: '2030-01-20', amount: 20_000_000, mode: 'korter' }]);
  const k = s.rows.findIndex((r) => r.extraBefore > 0);
  assert.equal(s.rows[k].date, '2030-02-05'); // applied after the January 2030 term
  assert.equal(s.rows[k - 1].balance, plain.rows[k - 1].balance);
  assert.equal(s.rows[k].payment, 944_220);
  assert.ok(s.rows[k].interest < plain.rows[k].interest);
  assert.equal(s.rows[k].balance, plain.rows[k - 1].balance - 20_000_000 - s.rows[k].capital);
  assert.ok(s.rows.length < 300);
  assert.ok(s.totalInterest < plain.totalInterest);
  assert.equal(s.rows.at(-1).balance, 0);
});

test('extra repayment, mode lager: same end date, lower payment', () => {
  const plain = trancheSchedule(base);
  const s = trancheSchedule(base, [{ date: '2030-01-20', amount: 20_000_000, mode: 'lager' }]);
  assert.equal(s.rows.length, 300);
  assert.equal(s.endDate, plain.endDate);
  const k = s.rows.findIndex((r) => r.extraBefore > 0);
  assert.ok(s.rows[k].payment < 944_220);
  assert.equal(s.rows.at(-1).balance, 0);
});

test('extra repayment of the full balance ends the schedule; korter then lager works', () => {
  const s = trancheSchedule(base, [{ date: '2026-03-01', amount: 999_000_000, mode: 'korter' }]);
  assert.equal(s.rows.length, 3);
  assert.equal(s.rows[2].extraBefore, s.rows[1].balance);
  assert.equal(s.rows[2].payment, 0);
  assert.equal(s.rows.at(-1).balance, 0);
  const two = trancheSchedule(base, [{ date: '2027-01-10', amount: 10_000_000, mode: 'korter' }, { date: '2028-01-10', amount: 10_000_000, mode: 'lager' }]);
  assert.equal(two.rows.at(-1).balance, 0);
  assert.ok(two.rows.length < 300);
});

test('payment day 31 follows the last day in short months', () => {
  const s = trancheSchedule({ ...base, firstPaymentDate: '2026-01-31', paymentDay: 31, months: 3 });
  assert.deepEqual(s.rows.map((r) => r.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
});
