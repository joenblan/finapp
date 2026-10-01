// Derived, read-only views on the data used by the interface.
import { checkContinuity } from './checks/continuity.js';
import { checkAccountChain, checkControlBalances } from './checks/chain.js';
import { formatMilli } from './money.js';

/** Real booking order within one account (see model/booking-order.js). */
export function compareBooking(a, b) {
  return a.bookingOrder - b.bookingOrder;
}

const d = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?');

export function accountSummaries(data) {
  const byAccount = new Map();
  for (const id of Object.keys(data.accounts)) byAccount.set(id, { statements: [], txs: [], removed: [] });
  for (const s of Object.values(data.statements)) byAccount.get(s.accountId)?.statements.push(s);
  for (const t of data.transactions) byAccount.get(t.accountId)?.txs.push(t);
  for (const r of Object.values(data.removedTransactions ?? {})) byAccount.get(r.transaction.accountId)?.removed.push(r.transaction);
  const openDuplicates = new Map();
  for (const p of data.possibleDuplicates ?? []) {
    if (p.status !== 'open') continue;
    const acc = p.txId.split('|')[0];
    openDuplicates.set(acc, (openDuplicates.get(acc) ?? 0) + 1);
  }

  const out = [];
  for (const [id, e] of byAccount) {
    const account = data.accounts[id];
    const issues = [];
    let balance = null;
    let balanceDate = null;
    let balanceSource = null;
    const ordered = [...e.txs].sort(compareBooking);
    let controls = { results: [], computedBalance: null };

    if ((account.sourceFormat ?? 'coda') === 'coda') {
      const sorted = [...e.statements].sort((a, b) => a.year - b.year || a.number - b.number);
      const last = sorted[sorted.length - 1] ?? null;
      for (const s of sorted) {
        if (s.checks?.balance && !s.checks.balance.ok) issues.push({ level: 'error', message: `Uittreksel ${s.year}/${s.number}: saldocontrole mislukt.` });
        if (s.checks?.trailer && !s.checks.trailer.ok) issues.push({ level: 'error', message: `Uittreksel ${s.year}/${s.number}: trailercontrole mislukt.` });
      }
      issues.push(...checkContinuity(sorted).map((i) => ({ level: i.level, message: i.message })));
      if (last) {
        balance = last.newBalance;
        balanceDate = last.newBalanceDate;
        balanceSource = `uittreksel ${last.year}/${last.number}`;
      }
    } else {
      // Chain over active and removed movements (removing a movement from the
      // lists does not change what the bank booked).
      const chain = [...e.txs, ...e.removed].sort(compareBooking);
      issues.push(...checkAccountChain(chain).map((i) => ({ level: i.level, message: i.message })));
      const snaps = [...(data.balanceSnapshots?.[id] ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const snap = snaps[snaps.length - 1];
      const lastTx = chain[chain.length - 1];
      if (snap) {
        balance = snap.balance;
        balanceDate = snap.at ? snap.at.slice(0, 10) : null;
        balanceSource = 'saldo volgens de bank (export)';
        if (lastTx && lastTx.balanceAfter !== null && lastTx.balanceAfter !== undefined && lastTx.balanceAfter !== snap.balance && snap.at >= lastTx.entryDate) {
          issues.push({ level: 'warning', message: `Het saldo van de recentste export (€ ${formatMilli(snap.balance)}) verschilt van het saldo na de laatste gekende beweging (€ ${formatMilli(lastTx.balanceAfter)}).` });
        }
      } else if (lastTx && lastTx.balanceAfter !== null && lastTx.balanceAfter !== undefined) {
        balance = lastTx.balanceAfter;
        balanceDate = lastTx.entryDate;
        balanceSource = 'saldo na laatste beweging';
      }
    }

    controls = checkControlBalances([...e.txs, ...e.removed].sort(compareBooking), data.controlBalances?.[id] ?? []);
    for (const r of controls.results) {
      if (r.ok === false) {
        issues.push({ level: 'error', message: `Controlesaldo op ${d(r.control.date)}: bank € ${formatMilli(r.expected)}, berekend € ${formatMilli(r.actual)} (verschil € ${formatMilli(r.difference)}).` });
      }
    }
    if (balance === null && controls.computedBalance) {
      balance = controls.computedBalance.balance;
      balanceDate = ordered.length ? ordered[ordered.length - 1].entryDate : controls.computedBalance.from;
      balanceSource = `berekend vanaf controlesaldo van ${d(controls.computedBalance.from)}`;
    }
    const dup = openDuplicates.get(id);
    if (dup) issues.push({ level: 'warning', message: `${dup} mogelijke dubbel${dup > 1 ? 's' : ''} na te kijken.` });

    out.push({
      account,
      balance,
      balanceDate,
      balanceSource,
      firstDate: ordered[0]?.entryDate ?? null,
      lastDate: ordered[ordered.length - 1]?.entryDate ?? null,
      statementCount: e.statements.length,
      txCount: e.txs.length,
      controls: controls.results,
      issues,
      ok: issues.every((i) => i.level !== 'error'),
    });
  }
  return out.sort((a, b) => a.account.displayName.localeCompare(b.account.displayName, 'nl'));
}
