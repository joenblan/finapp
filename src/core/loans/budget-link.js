// Coupling of confirmed loans with phase 3 (free space, forecast, recurring).
//  - the expected terms of a confirmed loan are fixed costs of the perspective
//    of the account the loan is paid from
//  - a recurring series for the same payments gets loanId and is not counted
//    separately (otherwise the term would be counted twice)
//  - linked loan transactions without category count as fixed costs
import { followUp, isLenderTx } from './payments.js';
import { LOAN_CATEGORY, loanLabel } from './loans.js';

const confirmed = (data) => (data.loans ?? []).filter((l) => l.status === 'bevestigd' && l.tranches?.length);

export function loanTxIds(data) {
  const ids = new Set();
  for (const loan of confirmed(data)) {
    try {
      for (const id of followUp(data, loan, { today: '9999-12-31' }).linkedTxIds) ids.add(id);
    } catch {
      /* invalid loan: ignored */
    }
  }
  return ids;
}

/** Unpaid terms (negative amounts) of confirmed loans paid from one of `accountIds`, dated in [from, to]. */
export function expectedLoanTerms(data, { accountIds, from, to, today }) {
  const out = [];
  for (const loan of confirmed(data)) {
    if (!accountIds.has(loan.accountId)) continue;
    let f;
    try {
      f = followUp(data, loan, { today, graceDays: data.budget?.missedGraceDays ?? 5 });
    } catch {
      continue;
    }
    for (const t of f.terms) {
      if (t.txIds.length || t.date < from || t.date > to) continue;
      out.push({ date: t.date, amount: -t.expected, loan, accountId: loan.accountId, label: loanLabel(loan), group: LOAN_CATEGORY });
    }
  }
  return out;
}

/** Set / clear loanId on recurring series that are the payments of a confirmed loan. */
export function linkSeriesToLoans(data) {
  const loans = confirmed(data);
  let changed = false;
  const recurring = (data.recurring ?? []).map((s) => {
    const loan = loans.find((l) => s.direction === 'uit' && isLenderTx(l, { accountId: s.accountId, amount: -1, counterparty: { account: s.counterparty?.iban ?? '', name: s.counterparty?.name ?? '' } }) && (l.counterparty?.iban || l.counterparty?.name));
    const loanId = loan?.id ?? null;
    if ((s.loanId ?? null) === loanId) return s;
    changed = true;
    const { loanId: _drop, ...rest } = s;
    return loanId ? { ...s, loanId } : rest;
  });
  return changed ? { ...data, recurring } : data;
}
