// `bookingOrder`: integer per account that records the real booking order
// (1 = oldest). Lists and checks sort on it, never on dates alone.
//  - CODA: statement year, statement number, sequence number, detail number
//  - CSV: order of the rows in the export + the balance chain (see csv merge)

export function compareCodaBooking(a, b) {
  return (
    a.statementYear - b.statementYear ||
    a.statementNumber - b.statementNumber ||
    a.sequence - b.sequence ||
    a.detail - b.detail
  );
}

/** Recompute bookingOrder for the given CODA accounts. Returns a new array. */
export function assignBookingOrder(transactions, accountIds) {
  const groups = new Map();
  for (const t of transactions) {
    if (!accountIds.has(t.accountId)) continue;
    if (!groups.has(t.accountId)) groups.set(t.accountId, []);
    groups.get(t.accountId).push(t);
  }
  const order = new Map();
  for (const list of groups.values()) {
    list.sort(compareCodaBooking);
    list.forEach((t, i) => order.set(t.id, i + 1));
  }
  return applyOrder(transactions, order);
}

/** Apply a Map(txId -> bookingOrder), copying only transactions that change. */
export function applyOrder(transactions, order) {
  return transactions.map((t) => {
    const o = order.get(t.id);
    return o === undefined || o === t.bookingOrder ? t : { ...t, bookingOrder: o };
  });
}
