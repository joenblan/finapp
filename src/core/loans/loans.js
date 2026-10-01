// Loan validation and helpers (data model: see core/model/schema.js).
import { validateTranche } from './schedule.js';
import { normalizeIban } from '../coda/parser.js';

export const LOAN_CATEGORY = 'wonen--woonkrediet';

export function validateLoan(data, loan) {
  const errors = [];
  if (!String(loan.name ?? '').trim()) errors.push('Geef de lening een naam.');
  if (!loan.accountId || !data.accounts[loan.accountId]) errors.push('Kies de rekening waarvan afbetaald wordt.');
  if (!loan.tranches?.length) errors.push('Voeg minstens één deelkrediet toe.');
  (loan.tranches ?? []).forEach((t, i) => {
    for (const e of validateTranche(t)) errors.push(`Deelkrediet ${i + 1}: ${e}`);
  });
  const shares = (loan.borrowers ?? []).map((b) => b.share);
  if (shares.length && shares.reduce((a, b) => a + b, 0) !== 10000) errors.push('De aandelen van de kredietnemers moeten samen 100 % zijn.');
  if (loan.counterparty?.iban && !normalizeIban(loan.counterparty.iban)) errors.push('Ongeldig IBAN van de kredietgever.');
  if (loan.drawdownDate && !/^\d{4}-\d{2}-\d{2}$/.test(loan.drawdownDate)) errors.push('Ongeldige datum opname.');
  return errors;
}

/** Share (basis points) of a person in a list of owners/borrowers; equal shares when none given. */
export function shareOf(owners, name) {
  if (!owners?.length) return 10000;
  if (!name) return null;
  const o = owners.find((x) => x.name === name);
  return o ? o.share : 0;
}

export const loanLabel = (loan) => loan.name || 'Woonkrediet';
