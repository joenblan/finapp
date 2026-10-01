// Balance chain checks for exports with a "balance after movement" column,
// and control balances entered by the user.
import { add, sum, formatMilli } from '../money.js';

const fmt = (m) => `€ ${formatMilli(m)}`;
const d = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?');

/**
 * Within one export (rows OLDEST first): previous balance + amount = balance after,
 * and the reported account balance equals the balance after the newest row.
 */
export function checkFileChain(rows, snapshot) {
  const issues = [];
  if (!rows.length || rows[0].balanceAfter === null) return issues;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (cur.foreignCurrency) continue; // other currency: not converted, not linked (see "Nakijken")
    const expected = add(prev.balanceAfter, cur.amount);
    if (expected !== cur.balanceAfter) {
      issues.push({
        level: 'error',
        line: cur.line,
        message: `Saldoketen klopt niet: ${fmt(prev.balanceAfter)} (regel ${prev.line}) + ${fmt(cur.amount)} = ${fmt(expected)}, maar "saldo na beweging" is ${fmt(cur.balanceAfter)}.`,
      });
    }
  }
  if (snapshot && snapshot.balance !== null) {
    const newest = rows[rows.length - 1];
    if (newest.balanceAfter !== snapshot.balance) {
      issues.push({
        level: 'error',
        line: newest.line,
        message: `Het saldo in de kop van het bestand (${fmt(snapshot.balance)}) verschilt van het saldo na de recentste beweging (${fmt(newest.balanceAfter)}).`,
      });
    }
  }
  return issues;
}

/**
 * Over all imported movements of one account, in booking order (oldest first).
 * A break means movements are missing between two known movements.
 */
export function checkAccountChain(ordered) {
  const issues = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (prev.balanceAfter === null || prev.balanceAfter === undefined || cur.balanceAfter === null || cur.balanceAfter === undefined) continue;
    if (cur.foreignCurrency) continue; // other currency: not converted, not linked
    const before = cur.balanceAfter - cur.amount;
    if (before !== prev.balanceAfter) {
      const difference = before - prev.balanceAfter;
      issues.push({
        level: 'error',
        code: 'CHAIN_GAP',
        from: prev.entryDate,
        to: cur.entryDate,
        afterId: prev.id,
        beforeId: cur.id,
        difference,
        message: `Saldoketen onderbroken tussen ${d(prev.entryDate)} en ${d(cur.entryDate)}: er ontbreken bewegingen voor in totaal ${fmt(difference)} (saldo ${fmt(prev.balanceAfter)} na de beweging van ${d(prev.entryDate)}, maar ${fmt(before)} vóór de beweging van ${d(cur.entryDate)}).`,
      });
    }
  }
  return issues;
}

/**
 * Control balances ("balance on date X according to the bank", end of day).
 * With a balance chain: compare with the balance after the last movement on or
 * before X. Without: the difference between two control balances must equal
 * the sum of the movements in between.
 * @returns { results: [{ control, ok, expected, actual, difference, reason }], computedBalance }
 */
export function checkControlBalances(ordered, controls = []) {
  const sorted = [...controls].sort((a, b) => a.date.localeCompare(b.date));
  const hasChain = ordered.length > 0 && ordered.every((t) => t.balanceAfter !== null && t.balanceAfter !== undefined);
  const results = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (hasChain) {
      let last = null;
      for (const t of ordered) if (t.entryDate <= c.date) last = t;
      if (!last) {
        results.push({ control: c, ok: null, reason: 'geen bewegingen vóór deze datum' });
        continue;
      }
      results.push({ control: c, ok: last.balanceAfter === c.balance, expected: c.balance, actual: last.balanceAfter, difference: last.balanceAfter - c.balance });
    } else if (i === 0) {
      results.push({ control: c, ok: null, reason: 'startpunt' });
    } else {
      const p = sorted[i - 1];
      const moved = sum(ordered.filter((t) => t.entryDate > p.date && t.entryDate <= c.date).map((t) => t.amount));
      const actual = add(p.balance, moved);
      results.push({ control: c, ok: actual === c.balance, expected: c.balance, actual, difference: actual - c.balance });
    }
  }
  let computedBalance = null;
  if (!hasChain && sorted.length) {
    const last = sorted[sorted.length - 1];
    computedBalance = { balance: add(last.balance, sum(ordered.filter((t) => t.entryDate > last.date).map((t) => t.amount))), from: last.date };
  }
  return { results, computedBalance };
}
