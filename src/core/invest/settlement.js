// Settlement account ("afrekenrekening"): investment operations are settled on
// an ordinary bank account. A purchase belongs to a debit, a sale or dividend
// to a credit. Proposals (computed, not stored): same sign, date within 5 days,
// closest amount (exact first). A confirmed link is stored on the operation
// (op.bankTxId, op.prevAllocation = the category before linking). One bank
// transaction belongs to at most one operation. A linked bank transaction gets
// the category Beleggingen › Aankoop / Verkoop / Dividend (system link).
import { netAmount } from './operations.js';
import { investCategories, INVEST_BUY, INVEST_SELL, INVEST_DIVIDEND } from '../categories/defaults.js';

export const RULE_INVEST = 'systeem:belegging';
const WINDOW = 5;
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

export const CATEGORY_FOR = { aankoop: INVEST_BUY, kosten: 'beleggingen', taks: 'beleggingen', verkoop: INVEST_SELL, dividend: INVEST_DIVIDEND };

export function settlementAccountOf(data, op) {
  const acc = data.investAccounts.find((a) => a.id === op.investAccountId);
  return acc?.cash?.mode === 'afrekenrekening' ? acc.cash.accountId : null;
}

/** Bank transaction ids linked to an operation -> operation. */
export function linkedTxMap(data) {
  const m = new Map();
  for (const op of data.operations ?? []) if (op.bankTxId) m.set(op.bankTxId, op);
  return m;
}

const linkable = (op) => op.kind !== 'splitsing' && netAmount(op) !== 0;

/** Candidate bank transactions for an operation, best first (not yet linked elsewhere). */
export function candidatesFor(data, op, linked = linkedTxMap(data)) {
  const accountId = settlementAccountOf(data, op);
  if (!accountId || !linkable(op)) return [];
  const net = netAmount(op);
  const tolerance = Math.max(10_000, Math.abs(net) / 20); // € 10 or 5 %
  return data.transactions
    .filter((t) => t.accountId === accountId && Math.sign(t.amount) === Math.sign(net) && days(t.entryDate, op.date) <= WINDOW)
    .filter((t) => !linked.has(t.id) || linked.get(t.id).id === op.id)
    .map((t) => ({ tx: t, diff: t.amount - net, days: days(t.entryDate, op.date) }))
    .filter((c) => Math.abs(c.diff) <= tolerance)
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff) || a.days - b.days);
}

/** Proposal for an unlinked operation: the best candidate, or null. */
export function proposalFor(data, op, linked = linkedTxMap(data)) {
  if (op.bankTxId) return null;
  return candidatesFor(data, op, linked)[0] ?? null;
}

/** Link state of an operation: { status: 'gekoppeld'|'voorstel'|'niet-gekoppeld'|'niet-gevolgd', tx, diff } */
export function linkState(data, op, linked = linkedTxMap(data)) {
  if (!settlementAccountOf(data, op) || !linkable(op)) return { status: 'niet-gevolgd', tx: null, diff: 0 };
  if (op.bankTxId) {
    const tx = data.transactions.find((t) => t.id === op.bankTxId) ?? null;
    return { status: 'gekoppeld', tx, diff: tx ? tx.amount - netAmount(op) : 0 };
  }
  const p = proposalFor(data, op, linked);
  return p ? { status: 'voorstel', tx: p.tx, diff: p.diff } : { status: 'niet-gekoppeld', tx: null, diff: 0 };
}

export function validateLink(data, op, txId) {
  const tx = data.transactions.find((t) => t.id === txId);
  if (!tx) throw new Error('Onbekende banktransactie.');
  const accountId = settlementAccountOf(data, op);
  if (!accountId) throw new Error('Deze beleggingsrekening heeft geen afrekenrekening.');
  if (tx.accountId !== accountId) throw new Error('De banktransactie staat niet op de afrekenrekening.');
  if (Math.sign(tx.amount) !== Math.sign(netAmount(op))) throw new Error(netAmount(op) < 0 ? 'Een aankoop hoort bij een afschrijving.' : 'Een verkoop of dividend hoort bij een bijschrijving.');
  const other = linkedTxMap(data).get(txId);
  if (other && other.id !== op.id) throw new Error('Deze banktransactie is al gekoppeld aan een andere verrichting.');
}

/** Unlinked operations of accounts with a settlement account. */
export function unlinkedOperations(data, investAccountId = null) {
  return data.operations.filter((op) => (!investAccountId || op.investAccountId === investAccountId) && settlementAccountOf(data, op) && linkable(op) && !op.bankTxId);
}

/** Give every linked bank transaction its investment category (creating the categories when missing). */
export function syncInvestLinks(data) {
  const ops = (data.operations ?? []).filter((o) => o.bankTxId);
  if (!ops.length) return { data, changed: 0 };
  let categories = data.categories;
  const missing = investCategories().filter((c) => !categories.some((x) => x.id === c.id));
  if (missing.length) categories = [...categories, ...missing];
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  let allocations = data.allocations ?? {};
  let changed = 0;
  for (const op of ops) {
    const tx = byId.get(op.bankTxId);
    if (!tx) continue;
    const next = [{ categoryId: CATEGORY_FOR[op.kind] ?? 'beleggingen', amount: tx.amount, source: 'regel', ruleId: RULE_INVEST }];
    if (JSON.stringify(allocations[tx.id]) === JSON.stringify(next)) continue;
    if (!changed) allocations = { ...allocations };
    allocations[tx.id] = next;
    changed++;
  }
  const out = changed || missing.length ? { ...data, categories, allocations } : data;
  return { data: out, changed };
}
