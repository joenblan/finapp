// Transaction filtering and ordering for the list view (pure, testable).
import { compareBooking } from './status.js';
import { formatMilli } from './money.js';

const haystacks = new WeakMap();

export function haystack(t) {
  let s = haystacks.get(t);
  if (s === undefined) {
    s = [
      t.counterparty?.name,
      t.counterparty?.account,
      t.communication?.text,
      t.communication?.structured,
      ...(t.information ?? []),
      t.bankReference,
      t.customerReference,
      formatMilli(t.amount),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    haystacks.set(t, s);
  }
  return s;
}

/** Newest first. Within one account: real booking order, never date alone. */
export function sortForList(txs) {
  return [...txs].sort((a, b) => {
    if (a.accountId === b.accountId) return compareBooking(b, a);
    return b.entryDate.localeCompare(a.entryDate) || a.accountId.localeCompare(b.accountId);
  });
}

/**
 * @param f { accountId?, from?, to? (ISO dates, inclusive), query?, minAbs?, maxAbs? (milli) }
 */
export function filterTransactions(txs, f) {
  const terms = (f.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of txs) {
    if (f.accountId && t.accountId !== f.accountId) continue;
    if (f.from && t.entryDate < f.from) continue;
    if (f.to && t.entryDate > f.to) continue;
    const abs = t.amount < 0 ? -t.amount : t.amount;
    if (f.minAbs !== null && f.minAbs !== undefined && abs < f.minAbs) continue;
    if (f.maxAbs !== null && f.maxAbs !== undefined && abs > f.maxAbs) continue;
    if (terms.length) {
      const hs = haystack(t);
      if (!terms.every((term) => hs.includes(term))) continue;
    }
    out.push(t);
  }
  return out;
}
