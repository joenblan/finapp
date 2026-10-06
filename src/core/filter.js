// Transaction filtering and ordering for the list view (pure, testable).
import { compareBooking } from './status.js';
import { formatMilli } from './money.js';
import { communicationForDisplay } from './csv/card.js';

const haystacks = new WeakMap();

export function haystack(t) {
  let s = haystacks.get(t);
  if (s === undefined) {
    s = [
      t.counterparty?.name,
      t.counterparty?.account,
      communicationForDisplay(t), // never the card number
      t.communication?.structured,
      t.bankType,
      t.counterparty?.city,
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

export const DIRECTIONS = [
  { id: 'alles', label: 'Alles' },
  { id: 'in', label: 'Inkomsten' },
  { id: 'uit', label: 'Uitgaven' },
];

/**
 * Neutral for the direction filter: an internal transfer between own accounts
 * (contributions between a personal and a joint account count as income /
 * expense, so they are not neutral), or a transaction whose categories are all
 * of kind "neutraal" (e.g. savings). A category chosen by the user decides.
 * @param ctx { categoryKinds: (txId) => [kind|null], isInternal: (tx) => bool, isContribution: (tx) => bool }
 */
export function isNeutralTx(t, ctx) {
  const kinds = ctx.categoryKinds(t.id).filter(Boolean);
  if (kinds.length) return kinds.every((k) => k === 'neutraal');
  return ctx.isInternal(t) && !ctx.isContribution(t);
}

/**
 * @param f { accountId?, from?, to? (ISO dates, inclusive), query?, minAbs?, maxAbs? (milli),
 *            direction?: 'alles'|'in'|'uit', hideNeutral?: boolean }
 * @param opts { isNeutral?: (tx) => bool } (needed when hideNeutral is set)
 */
export function filterTransactions(txs, f, { isNeutral = () => false } = {}) {
  const terms = (f.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of txs) {
    if (f.accountId && t.accountId !== f.accountId) continue;
    if (f.from && t.entryDate < f.from) continue;
    if (f.to && t.entryDate > f.to) continue;
    if (f.direction === 'in' && !(t.amount > 0)) continue;
    if (f.direction === 'uit' && !(t.amount < 0)) continue;
    const abs = t.amount < 0 ? -t.amount : t.amount;
    if (f.minAbs !== null && f.minAbs !== undefined && abs < f.minAbs) continue;
    if (f.maxAbs !== null && f.maxAbs !== undefined && abs > f.maxAbs) continue;
    if (terms.length) {
      const hs = haystack(t);
      if (!terms.every((term) => hs.includes(term))) continue;
    }
    if (f.hideNeutral && isNeutral(t)) continue;
    out.push(t);
  }
  return out;
}

/** Count and total of a selection; amounts in another currency are not added up. */
export function summarize(txs) {
  let total = 0;
  let foreign = 0;
  for (const t of txs) {
    if (t.foreignCurrency) foreign++;
    else total += t.amount;
  }
  return { count: txs.length, total, foreign };
}
