// Following up a loan: link the due terms to bank transactions.
//
// Automatic match per due date (in date order, every transaction used once):
//  - candidates: outgoing transactions on the loan account within ± 5 days of
//    the due date, to the lender (IBAN, else name); without lender details only
//    exact amounts are matched
//  - one transaction with exactly the expected total; else one transaction per
//    tranche with exactly its amount; else the closest candidate (deviating)
// A manual link (loan.paymentLinks[dueDate] = { txIds } or { none: true }) wins.
// Status: betaald (paid = expected), afwijkend (paid differs), openstaand (no
// payment and more than graceDays late), verwacht (not yet due or within grace).
import { sum } from '../money.js';
import { diffDays, addDays } from '../budget/dates.js';
import { normalizeName } from '../budget/recurring.js';
import { loanSchedule, balanceAfter } from './schedule.js';

const WINDOW = 5;
const abs = (v) => (v < 0 ? -v : v);

export function isLenderTx(loan, tx) {
  if (tx.accountId !== loan.accountId || tx.amount >= 0) return false;
  const iban = loan.counterparty?.iban;
  if (iban) return tx.counterparty?.account === iban;
  const name = normalizeName(loan.counterparty?.name);
  if (name) return normalizeName(`${tx.counterparty?.name ?? ''} ${tx.communication?.text ?? ''}`).includes(name);
  return true;
}

/**
 * @returns { schedule, terms: [{ date, expected, parts, txIds, paid, diff, status, manual }], linkedTxIds: Set }
 */
export function followUp(data, loan, { today, graceDays = 5, schedule = loanSchedule(loan) } = {}) {
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const hasLender = Boolean(loan.counterparty?.iban || normalizeName(loan.counterparty?.name));
  const candidates = data.transactions.filter((t) => isLenderTx(loan, t));
  const used = new Set();
  const links = loan.paymentLinks ?? {};
  for (const l of Object.values(links)) for (const id of l.txIds ?? []) used.add(id);
  const terms = [];
  for (const row of schedule.total) {
    if (row.payment === 0) continue; // only an extra repayment on that date
    const expected = row.payment;
    let txIds = [];
    const manual = links[row.date];
    if (manual) {
      txIds = (manual.txIds ?? []).filter((id) => byId.has(id));
    } else {
      const near = candidates
        .filter((t) => !used.has(t.id) && abs(diffDays(row.date, t.entryDate)) <= WINDOW)
        .sort((a, b) => abs(diffDays(row.date, a.entryDate)) - abs(diffDays(row.date, b.entryDate)));
      const exact = near.find((t) => -t.amount === expected);
      if (exact) txIds = [exact.id];
      else if (row.parts.length > 1) {
        const picked = [];
        for (const p of row.parts) {
          const t = near.find((x) => -x.amount === p.payment && !picked.includes(x.id));
          if (t) picked.push(t.id);
        }
        if (picked.length === row.parts.length) txIds = picked;
      }
      if (!txIds.length && hasLender && near.length) txIds = [near[0].id];
      txIds.forEach((id) => used.add(id));
    }
    const paid = sum(txIds.map((id) => -byId.get(id).amount));
    let status;
    if (txIds.length) status = paid === expected ? 'betaald' : 'afwijkend';
    else if (manual?.none) status = 'openstaand';
    else status = addDays(row.date, graceDays) < today ? 'openstaand' : 'verwacht';
    terms.push({ date: row.date, n: row.n, expected, interest: row.interest, capital: row.capital, balance: row.balance, parts: row.parts, txIds, paid, diff: paid - expected, status, manual: Boolean(manual) });
  }
  const linkedTxIds = new Set(terms.flatMap((t) => t.txIds));
  return { schedule, terms, linkedTxIds, candidates };
}

/** Checkpoints from the bank statement compared with the computed table. */
export function checkpointDiffs(loan, schedule = loanSchedule(loan)) {
  return (loan.checkpoints ?? []).map((c) => {
    const parts = c.trancheId ? schedule.perTranche.filter((s) => s.tranche.id === c.trancheId) : schedule.perTranche;
    const computed = sum(parts.map((s) => balanceAfter(s, c.date)));
    return { ...c, computed, diff: c.balance - computed };
  });
}

/** Outstanding capital of the whole loan on a date (0 before the drawdown). */
export function outstandingOn(loan, date, schedule = loanSchedule(loan)) {
  const start = drawdownDate(loan);
  if (date < start) return 0;
  return sum(schedule.perTranche.map((s) => balanceAfter(s, date)));
}

/** Drawdown date: given, else one month before the first payment. */
export function drawdownDate(loan) {
  if (loan.drawdownDate) return loan.drawdownDate;
  const first = loan.tranches.map((t) => t.firstPaymentDate).sort()[0];
  const [y, m, d] = first.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const dim = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
}

/** Status line for the start page. */
export function loanStatus(data, loan, { today }) {
  const f = followUp(data, loan, { today, graceDays: data.budget?.missedGraceDays ?? 5 });
  const remaining = outstandingOn(loan, today, f.schedule);
  const next = f.terms.find((t) => t.date > today || t.status === 'verwacht');
  return { remaining, endDate: f.schedule.endDate, next, open: f.terms.filter((t) => t.status === 'openstaand'), deviating: f.terms.filter((t) => t.status === 'afwijkend') };
}
