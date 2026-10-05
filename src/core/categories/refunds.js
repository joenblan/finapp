// Refunds linked to an expense (e.g. a friend pays back part of a dinner):
//   data.annotations[refundId].refundOf = expenseId
// The refund always gets the category of the expense (allocation source
// 'regel', rule 'systeem:terugbetaling'), so it lowers that expense in the
// overview and the budget. Linking is a manual act: it wins over rules and
// over an earlier manual choice of the refund.
export const RULE_REFUND = 'systeem:terugbetaling';

export const refundOf = (data, txId) => data.annotations?.[txId]?.refundOf ?? null;

/** Refunds linked to an expense: [{ tx }] sorted by date, and their total. */
export function refundsFor(data, expenseId) {
  const list = data.transactions.filter((t) => refundOf(data, t.id) === expenseId).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return { list, total: list.reduce((s, t) => s + t.amount, 0) };
}

export function validateRefundLink(data, refundId, expenseId) {
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const r = byId.get(refundId);
  const e = byId.get(expenseId);
  if (!r || !e) throw new Error('Onbekende transactie.');
  if (r.amount <= 0) throw new Error('Enkel een ontvangst kan een terugbetaling zijn.');
  if (e.amount >= 0) throw new Error('Kies een uitgave (een betaling).');
  if (refundOf(data, expenseId)) throw new Error('Die uitgave is zelf een gekoppelde terugbetaling.');
}

/** Give every linked refund the current category of its expense. */
export function syncRefunds(data) {
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  let allocations = data.allocations ?? {};
  let changed = 0;
  for (const [txId, ann] of Object.entries(data.annotations ?? {})) {
    if (!ann?.refundOf) continue;
    const tx = byId.get(txId);
    const expense = byId.get(ann.refundOf);
    if (!tx || !expense) continue;
    const categoryId = allocations[expense.id]?.[0]?.categoryId ?? null;
    const cur = allocations[txId]?.[0];
    if (cur && cur.categoryId === categoryId && cur.ruleId === RULE_REFUND && cur.amount === tx.amount) continue;
    if (!changed) allocations = { ...allocations };
    allocations[txId] = [{ categoryId, amount: tx.amount, source: 'regel', ruleId: RULE_REFUND }];
    changed++;
  }
  return { data: changed ? { ...data, allocations } : data, changed };
}

/**
 * Expenses a refund probably belongs to: before the refund (up to 180 days,
 * or 7 days after), not internal transfers, closest in time first; expenses at
 * least as large as the refund before smaller ones.
 */
export function refundCandidates(data, refund, { isInternal = () => false } = {}) {
  const day = (iso) => Date.parse(iso) / 86400000;
  const r = day(refund.entryDate);
  return data.transactions
    .filter((t) => t.amount < 0 && !refundOf(data, t.id) && !isInternal(t))
    .map((t) => ({ t, days: r - day(t.entryDate) }))
    .filter((x) => x.days <= 180 && x.days >= -7)
    .sort((a, b) => Number(-a.t.amount < refund.amount) - Number(-b.t.amount < refund.amount) || Math.abs(a.days) - Math.abs(b.days))
    .map((x) => x.t);
}
