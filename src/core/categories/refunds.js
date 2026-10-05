// Refunds linked to one or more expenses (e.g. a friend pays back his share of
// a dinner and a concert ticket in one transfer):
//   data.annotations[refundId].refundOf = [{ expenseId, amount }]   (amounts sum to the refund)
//   (older data: refundOf = expenseId, meaning the full amount)
// Every part gets the category of its expense (allocation source 'regel', rule
// 'systeem:terugbetaling'), so it lowers that expense in the overview and the
// budget. Linking is a manual act: it wins over rules and earlier choices.
export const RULE_REFUND = 'systeem:terugbetaling';

/** Links of a refund: [{ expenseId, amount }] (empty when not linked). */
export function refundLinks(data, txId) {
  const v = data.annotations?.[txId]?.refundOf;
  if (!v) return [];
  if (typeof v === 'string') {
    const tx = data.transactions.find((t) => t.id === txId);
    return tx ? [{ expenseId: v, amount: tx.amount }] : [];
  }
  return v;
}

export const refundOf = (data, txId) => refundLinks(data, txId)[0]?.expenseId ?? null;

/** Refunds of an expense: [{ tx, amount (the part for this expense) }] by date, and their total. */
export function refundsFor(data, expenseId) {
  const list = [];
  for (const t of data.transactions) {
    for (const l of refundLinks(data, t.id)) if (l.expenseId === expenseId) list.push({ tx: t, amount: l.amount });
  }
  list.sort((a, b) => a.tx.entryDate.localeCompare(b.tx.entryDate));
  return { list, total: list.reduce((s, x) => s + x.amount, 0) };
}

/** Part of an expense that has not been refunded yet (positive milli). */
export function openAmount(data, expense, exceptRefundId = null) {
  const done = refundsFor(data, expense.id).list.filter((x) => x.tx.id !== exceptRefundId).reduce((s, x) => s + x.amount, 0);
  return Math.max(0, -expense.amount - done);
}

/**
 * Proposed split of a refund over expenses (in the given order): each gets at
 * most its open amount, the last one the rest.
 */
export function proposeSplit(data, refund, expenseIds) {
  let rest = refund.amount;
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  return expenseIds.map((id, i) => {
    const e = byId.get(id);
    const amount = i === expenseIds.length - 1 ? rest : Math.min(rest, openAmount(data, e, refund.id));
    rest -= amount;
    return { expenseId: id, amount };
  });
}

/** Normalise and check links; returns the links to store. */
export function validateRefundLinks(data, refundId, links) {
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const r = byId.get(refundId);
  if (!r) throw new Error('Onbekende transactie.');
  if (r.amount <= 0) throw new Error('Enkel een ontvangst kan een terugbetaling zijn.');
  if (!links.length) throw new Error('Kies minstens één uitgave.');
  const seen = new Set();
  for (const l of links) {
    const e = byId.get(l.expenseId);
    if (!e) throw new Error('Onbekende transactie.');
    if (e.amount >= 0) throw new Error('Kies een uitgave (een betaling).');
    if (refundOf(data, e.id)) throw new Error('Die uitgave is zelf een gekoppelde terugbetaling.');
    if (seen.has(e.id)) throw new Error('Dezelfde uitgave staat er twee keer bij.');
    seen.add(e.id);
    if (!Number.isSafeInteger(l.amount) || l.amount <= 0) throw new Error('Elk deel moet een bedrag groter dan 0 hebben.');
  }
  const total = links.reduce((s, l) => s + l.amount, 0);
  if (total !== r.amount) throw new Error(`De delen samen (${(total / 1000).toFixed(2).replace('.', ',')}) moeten gelijk zijn aan de terugbetaling (${(r.amount / 1000).toFixed(2).replace('.', ',')}).`);
  return links.map((l) => ({ expenseId: l.expenseId, amount: l.amount }));
}

/** Kept for a single expense (full amount). */
export function validateRefundLink(data, refundId, expenseId) {
  const r = data.transactions.find((t) => t.id === refundId);
  validateRefundLinks(data, refundId, [{ expenseId, amount: r?.amount ?? 0 }]);
}

/** Give every linked refund (part) the current category of its expense. */
export function syncRefunds(data) {
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  let allocations = data.allocations ?? {};
  let changed = 0;
  for (const [txId, ann] of Object.entries(data.annotations ?? {})) {
    if (!ann?.refundOf) continue;
    const tx = byId.get(txId);
    const links = refundLinks(data, txId).filter((l) => byId.has(l.expenseId));
    if (!tx || !links.length) continue;
    const next = links.map((l) => ({ categoryId: allocations[l.expenseId]?.[0]?.categoryId ?? null, amount: l.amount, source: 'regel', ruleId: RULE_REFUND }));
    if (JSON.stringify(allocations[txId]) === JSON.stringify(next)) continue;
    if (!changed) allocations = { ...allocations };
    allocations[txId] = next;
    changed++;
  }
  return { data: changed ? { ...data, allocations } : data, changed };
}

/**
 * Expenses a refund probably belongs to: up to 180 days before the refund or
 * 90 days after it (sometimes the money comes back first), not internal
 * transfers, closest in time first; expenses at least as large as the refund
 * before smaller ones.
 */
export function refundCandidates(data, refund, { isInternal = () => false } = {}) {
  const day = (iso) => Date.parse(iso) / 86400000;
  const r = day(refund.entryDate);
  return data.transactions
    .filter((t) => t.amount < 0 && !refundOf(data, t.id) && !isInternal(t))
    .map((t) => ({ t, days: r - day(t.entryDate) }))
    .filter((x) => x.days <= 180 && x.days >= -90)
    .sort((a, b) => Number(-a.t.amount < refund.amount) - Number(-b.t.amount < refund.amount) || Math.abs(a.days) - Math.abs(b.days))
    .map((x) => x.t);
}

/**
 * Incoming payments that may be a refund of this expense (to link from the
 * expense side): 90 days before up to 180 days after, closest in time first;
 * refunds not larger than the expense first.
 */
export function refundSourceCandidates(data, expense, { isInternal = () => false } = {}) {
  const day = (iso) => Date.parse(iso) / 86400000;
  const e = day(expense.entryDate);
  return data.transactions
    .filter((t) => t.amount > 0 && !isInternal(t) && !refundLinks(data, t.id).some((l) => l.expenseId === expense.id))
    .map((t) => ({ t, days: day(t.entryDate) - e }))
    .filter((x) => x.days <= 180 && x.days >= -90)
    .sort((a, b) => Number(a.t.amount > -expense.amount) - Number(b.t.amount > -expense.amount) || Math.abs(a.days) - Math.abs(b.days))
    .map((x) => x.t);
}
