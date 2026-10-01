// Derived, read-only views on the data used by the interface.
import { checkContinuity } from './checks/continuity.js';

/** Real booking order within one account (CODA: statement, sequence, detail). */
export function compareBooking(a, b) {
  return (
    a.statementYear - b.statementYear ||
    a.statementNumber - b.statementNumber ||
    a.sequence - b.sequence ||
    a.detail - b.detail
  );
}

export function accountSummaries(data) {
  const byAccount = new Map();
  for (const id of Object.keys(data.accounts)) byAccount.set(id, { statements: [], txCount: 0 });
  for (const s of Object.values(data.statements)) byAccount.get(s.accountId)?.statements.push(s);
  for (const t of data.transactions) {
    const e = byAccount.get(t.accountId);
    if (e) e.txCount++;
  }
  const out = [];
  for (const [id, e] of byAccount) {
    const account = data.accounts[id];
    const sorted = [...e.statements].sort((a, b) => a.year - b.year || a.number - b.number);
    const last = sorted[sorted.length - 1] ?? null;
    const issues = [];
    for (const s of sorted) {
      if (s.checks?.balance && !s.checks.balance.ok) issues.push({ level: 'error', message: `Uittreksel ${s.year}/${s.number}: saldocontrole mislukt.` });
      if (s.checks?.trailer && !s.checks.trailer.ok) issues.push({ level: 'error', message: `Uittreksel ${s.year}/${s.number}: trailercontrole mislukt.` });
    }
    issues.push(...checkContinuity(sorted).map((i) => ({ level: i.level, message: i.message })));
    out.push({
      account,
      balance: last ? last.newBalance : null,
      balanceDate: last ? last.newBalanceDate : null,
      firstDate: sorted[0]?.oldBalanceDate ?? null,
      statementCount: sorted.length,
      txCount: e.txCount,
      issues,
      ok: issues.every((i) => i.level !== 'error'),
    });
  }
  return out.sort((a, b) => a.account.displayName.localeCompare(b.account.displayName, 'nl'));
}
