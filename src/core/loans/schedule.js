// Amortisation schedule per tranche ("deelkrediet") and for the whole loan.
// Rounding: payment to the cent (half-up), monthly interest to the cent
// (half-up) on the outstanding balance, capital = payment - interest; the LAST
// payment repays the full remaining balance.
//
// Extra repayments are applied right after the last term on or before their
// date (before the first term if earlier); from the next term on interest runs
// on the reduced balance. Mode 'korter': same payment (or same capital part),
// shorter term. Mode 'lager': same remaining number of terms, lower payment.
import { monthlyRate, interestMilli, annuityMilli, linearCapitalMilli } from './decimal.js';
import { addMonths } from '../budget/dates.js';

export function termDate(tranche, k) {
  return k === 1 ? tranche.firstPaymentDate : addMonths(tranche.firstPaymentDate, k - 1, tranche.paymentDay ?? Number(tranche.firstPaymentDate.slice(8, 10)));
}

export function validateTranche(t) {
  const errors = [];
  if (!String(t.name ?? '').trim()) errors.push('Geef het deelkrediet een naam.');
  if (!Number.isSafeInteger(t.principal) || t.principal <= 0 || t.principal % 10 !== 0) errors.push('Ontleend bedrag ontbreekt of is ongeldig.');
  try {
    monthlyRate(t.annualRate, t.rateMethod ?? 'gelijkwaardig');
  } catch (e) {
    errors.push(e.message);
  }
  if (!Number.isInteger(t.months) || t.months < 1 || t.months > 600) errors.push('Looptijd in maanden ontbreekt of is ongeldig (1-600).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.firstPaymentDate ?? '')) errors.push('Datum eerste afbetaling ontbreekt.');
  if (t.paymentDay !== undefined && t.paymentDay !== null && !(Number.isInteger(t.paymentDay) && t.paymentDay >= 1 && t.paymentDay <= 31)) errors.push('Afbetalingsdag moet tussen 1 en 31 liggen.');
  if (!['annuiteit', 'lineair'].includes(t.type)) errors.push('Kies het aflossingstype.');
  if (!['gelijkwaardig', 'nominaal', 'periodiek'].includes(t.rateMethod)) errors.push('Kies de rentemethode.');
  return errors;
}

/**
 * @param tranche { principal, annualRate, months, firstPaymentDate, paymentDay, type, rateMethod }
 * @param extraPayments [{ date, amount, mode }] for this tranche
 * @returns { rows: [{ n, date, payment, interest, capital, balance, extraBefore }], totalInterest, totalPaid, endDate, firstPayment, rate }
 */
export function trancheSchedule(tranche, extraPayments = []) {
  const errors = validateTranche(tranche);
  if (errors.length) throw new Error(errors.join(' '));
  const rate = monthlyRate(tranche.annualRate, tranche.rateMethod);
  let balance = tranche.principal;
  let plannedTerms = tranche.months;
  let payment = tranche.type === 'annuiteit' ? annuityMilli(balance, rate, plannedTerms) : null;
  let capitalPart = tranche.type === 'lineair' ? linearCapitalMilli(balance, plannedTerms) : null;
  const extras = [...extraPayments].sort((a, b) => a.date.localeCompare(b.date));
  let ei = 0;
  const rows = [];
  let totalInterest = 0;
  let totalPaid = 0;
  const firstPayment = payment ?? null;

  const applyExtras = (k) => {
    // extra repayments dated before term k (and after term k-1) are applied now
    const due = termDate(tranche, k);
    let applied = 0;
    while (ei < extras.length && extras[ei].date < due && balance > 0) {
      const x = extras[ei++];
      const amount = Math.min(x.amount, balance);
      balance -= amount;
      applied += amount;
      if (balance === 0) break;
      const remaining = Number.isFinite(plannedTerms) ? plannedTerms - (k - 1) : termsLeft(balance, rate, payment, capitalPart);
      if (x.mode === 'lager') {
        if (tranche.type === 'annuiteit') payment = annuityMilli(balance, rate, remaining);
        else capitalPart = linearCapitalMilli(balance, remaining);
      } else {
        plannedTerms = Infinity; // 'korter': run until the balance is repaid
      }
    }
    return applied;
  };

  for (let k = 1; balance > 0; k++) {
    const extraBefore = applyExtras(k);
    if (balance === 0) {
      if (extraBefore) rows.push({ n: k, date: termDate(tranche, k), payment: 0, interest: 0, capital: 0, balance: 0, extraBefore });
      break;
    }
    const interest = interestMilli(balance, rate);
    let capital = tranche.type === 'annuiteit' ? payment - interest : capitalPart;
    const last = k >= plannedTerms || capital >= balance;
    if (last) capital = balance;
    if (capital < 0) throw new Error('De maandlast dekt de interest niet.');
    const pay = capital + interest;
    balance -= capital;
    totalInterest += interest;
    totalPaid += pay;
    rows.push({ n: k, date: termDate(tranche, k), payment: pay, interest, capital, balance, extraBefore });
    if (k > 1200) throw new Error('Aflossingstabel te lang.');
  }
  return { rows, totalInterest, totalPaid, endDate: rows[rows.length - 1]?.date ?? null, firstPayment: firstPayment ?? rows[0]?.payment ?? 0, rate };
}

// Number of terms still needed to repay `balance` with the current payment (annuity) or capital part (linear).
function termsLeft(balance, rate, payment, capitalPart) {
  let n = 0;
  while (balance > 0 && n < 1200) {
    const capital = payment !== null ? payment - interestMilli(balance, rate) : capitalPart;
    balance -= Math.min(balance, Math.max(capital, 1));
    n++;
  }
  return n;
}

/** Schedule of the whole loan: per tranche and summed per due date. */
export function loanSchedule(loan) {
  const perTranche = loan.tranches.map((t) => {
    const extras = (loan.extraPayments ?? []).filter((x) => x.trancheId === t.id);
    return { tranche: t, ...trancheSchedule(t, extras) };
  });
  const byDate = new Map();
  for (const s of perTranche) {
    for (const r of s.rows) {
      const cur = byDate.get(r.date) ?? { date: r.date, payment: 0, interest: 0, capital: 0, balance: 0, extraBefore: 0, parts: [] };
      cur.payment += r.payment;
      cur.interest += r.interest;
      cur.capital += r.capital;
      cur.extraBefore += r.extraBefore;
      cur.parts.push({ trancheId: s.tranche.id, ...r });
      byDate.set(r.date, cur);
    }
  }
  const dates = [...byDate.keys()].sort();
  // total outstanding balance after each due date (tranches that are not yet due count fully)
  const total = dates.map((date, i) => {
    const row = byDate.get(date);
    row.n = i + 1;
    row.balance = perTranche.reduce((sum, s) => sum + balanceAfter(s, date), 0);
    return row;
  });
  return {
    perTranche,
    total,
    totalInterest: perTranche.reduce((s, x) => s + x.totalInterest, 0),
    totalPaid: perTranche.reduce((s, x) => s + x.totalPaid, 0),
    endDate: dates[dates.length - 1] ?? null,
    firstPayment: total[0]?.payment ?? 0,
  };
}

/** Outstanding capital of a tranche schedule after all events on or before `date`. */
export function balanceAfter(s, date) {
  let bal = s.tranche.principal;
  for (const r of s.rows) {
    if (r.date > date) break;
    bal = r.balance;
  }
  return bal;
}
