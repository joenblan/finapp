// Simulation of an extra (partial) repayment. Nothing is stored: the result
// compares the current table with the table including the extra repayment.
// Reinvestment fee ("wederbeleggingsvergoeding"): by default 3 months of
// interest of the tranche on the repaid amount; configurable as a number of
// months or as a fixed amount.
import { loanSchedule } from './schedule.js';
import { monthlyRate, toCentMilli, S } from './decimal.js';

export function feeFor(tranche, amount, fee = { type: 'maanden', value: 3 }) {
  if (fee.type === 'bedrag') {
    if (!Number.isSafeInteger(fee.value) || fee.value < 0) throw new Error('Ongeldige vergoeding.');
    return fee.value;
  }
  const months = Number(fee.value);
  if (!Number.isInteger(months) || months < 0 || months > 12) throw new Error('Aantal maanden vergoeding moet tussen 0 en 12 liggen.');
  const rate = monthlyRate(tranche.annualRate, tranche.rateMethod);
  return toCentMilli(BigInt(amount) * rate * BigInt(months), S);
}

/**
 * @param extra { date, trancheId, amount (milli), mode: 'korter'|'lager', fee }
 */
export function simulateExtra(loan, extra) {
  const tranche = loan.tranches.find((t) => t.id === extra.trancheId);
  if (!tranche) throw new Error('Kies een deelkrediet.');
  if (!Number.isSafeInteger(extra.amount) || extra.amount <= 0 || extra.amount % 10 !== 0) throw new Error('Geef een geldig bedrag op.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(extra.date ?? '')) throw new Error('Geef een datum op.');
  if (!['korter', 'lager'].includes(extra.mode)) throw new Error('Kies kortere looptijd of lagere maandlast.');
  const before = loanSchedule(loan);
  const after = loanSchedule({ ...loan, extraPayments: [...(loan.extraPayments ?? []), { id: '__sim__', ...extra }] });
  const tb = before.perTranche.find((s) => s.tranche.id === tranche.id);
  const ta = after.perTranche.find((s) => s.tranche.id === tranche.id);
  const fee = feeFor(tranche, extra.amount, extra.fee);
  const interestSaved = before.totalInterest - after.totalInterest;
  const firstAfter = ta.rows.find((r) => r.extraBefore > 0 || r.date > extra.date);
  const idx = firstAfter ? ta.rows.indexOf(firstAfter) : -1;
  return {
    fee,
    interestSaved,
    netGain: interestSaved - fee,
    endBefore: tb.endDate,
    endAfter: ta.endDate,
    monthsShorter: tb.rows.length - ta.rows.length,
    paymentBefore: idx >= 0 ? tb.rows[idx]?.payment ?? 0 : 0,
    paymentAfter: idx >= 0 ? ta.rows[idx]?.payment ?? 0 : 0,
    before,
    after,
  };
}
