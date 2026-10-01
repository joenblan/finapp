// Balance of an account at the end of a day, reconstructed backwards from the
// current balance (account overview). Returns null when the date lies before
// the first known data of the account. `partial` = the data stop before that
// date (the latest known balance is used).
import { accountSummaries } from '../status.js';
import { addDays } from '../budget/dates.js';

export function balanceIndex(data) {
  const out = {};
  for (const s of accountSummaries(data)) {
    const id = s.account.id;
    const txs = data.transactions.filter((t) => t.accountId === id && !t.foreignCurrency).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    let coverageStart = null;
    if ((s.account.sourceFormat ?? 'coda') === 'coda') {
      const first = Object.values(data.statements).filter((st) => st.accountId === id).map((st) => st.oldBalanceDate).filter(Boolean).sort()[0];
      coverageStart = first ?? null;
    }
    if (!coverageStart && txs.length) coverageStart = addDays(txs[0].entryDate, -1);
    if (!coverageStart) coverageStart = s.balanceDate;
    out[id] = { account: s.account, balance: s.balance, balanceDate: s.balanceDate, coverageStart, txs };
  }
  return out;
}

export function balanceOn(entry, date) {
  if (!entry || entry.balance === null || !entry.balanceDate || !entry.coverageStart || date < entry.coverageStart) return null;
  if (date >= entry.balanceDate) return { balance: entry.balance, partial: date > entry.balanceDate, asOf: entry.balanceDate };
  let b = entry.balance;
  for (const t of entry.txs) if (t.entryDate > date && t.entryDate <= entry.balanceDate) b -= t.amount;
  return { balance: b, partial: false, asOf: date };
}
