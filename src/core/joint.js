// Joint accounts: advances ("voorschot") and repayments ("terugbetaling").
// Model: per joint account, every co-owner has a running balance with the
// joint "pot". Positive = the pot owes that person; negative = that person
// owes the pot. A mark is independent of the transaction's category.
//
// Effect on the person's balance:
//   transaction on the joint account:      + amount  (pot pays for/to P => P owes more / is owed less;
//                                                     P pays into the pot => the other way round)
//   transaction on P's individual account: - amount  (P pays a joint cost => the pot owes P;
//                                                     P receives money from the pot => owed less)
// If both sides of one internal transfer are marked, only the joint side counts.
import { linkTransfers } from './transfers.js';
import { add, negate } from './money.js';

export const MARK_TYPES = ['voorschot', 'terugbetaling'];

export function jointAccounts(data) {
  return Object.values(data.accounts).filter((a) => a.ownership?.type === 'gemeenschappelijk');
}

export function validateJointMark(data, txId, mark) {
  const tx = data.transactions.find((t) => t.id === txId);
  if (!tx) throw new Error('Onbekende transactie.');
  if (!MARK_TYPES.includes(mark.type)) throw new Error('Kies voorschot of terugbetaling.');
  const joint = data.accounts[mark.jointAccountId];
  if (!joint || joint.ownership?.type !== 'gemeenschappelijk') throw new Error('Kies een gemeenschappelijke rekening.');
  const txAccount = data.accounts[tx.accountId];
  let person = String(mark.person ?? '').trim();
  if (tx.accountId !== joint.id) {
    if (txAccount?.ownership?.type === 'gemeenschappelijk') throw new Error('Een transactie op een andere gemeenschappelijke rekening kan hier niet gemarkeerd worden.');
    // individual account = mine
    const me = data.settings?.myName;
    if (!me) throw new Error('Stel eerst in wie jij bent (Instellingen › Mijn naam).');
    person = person || me;
    if (person !== me) throw new Error('Een transactie op je individuele rekening is altijd van jezelf.');
  }
  if (!joint.ownership.owners.includes(person)) throw new Error(`Kies een mede-eigenaar van ${joint.displayName} (${joint.ownership.owners.join(', ')}).`);
  const linkedTo = [...new Set(mark.linkedTo ?? [])];
  if (linkedTo.length && mark.type !== 'terugbetaling') throw new Error('Enkel een terugbetaling kan aan voorschotten gekoppeld worden.');
  for (const id of linkedTo) {
    const m = data.jointMarks?.[id];
    if (!m || m.type !== 'voorschot' || m.jointAccountId !== joint.id) throw new Error('Een terugbetaling kan enkel aan voorschotten van dezelfde gemeenschappelijke rekening gekoppeld worden.');
  }
  return { type: mark.type, jointAccountId: joint.id, person, linkedTo };
}

/**
 * @returns { account, persons: [{ name, balance }], items: [{ tx, mark, delta, counted, open }] }
 *   items newest first; `open` = remaining amount of an advance (or of an unlinked repayment).
 */
export function jointSummary(data, jointAccountId, links = linkTransfers(data)) {
  const account = data.accounts[jointAccountId];
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const items = [];
  for (const [txId, mark] of Object.entries(data.jointMarks ?? {})) {
    if (mark.jointAccountId !== jointAccountId) continue;
    const tx = byId.get(txId);
    if (!tx) continue;
    const delta = tx.accountId === jointAccountId ? tx.amount : negate(tx.amount);
    // both sides of one transfer marked: count only the joint side
    const other = links.get(txId);
    const otherMark = other ? data.jointMarks?.[other] : null;
    const counted = !(otherMark && otherMark.jointAccountId === jointAccountId && tx.accountId !== jointAccountId);
    items.push({ tx, mark, delta, counted, open: null });
  }
  const balances = new Map((account?.ownership?.owners ?? []).map((o) => [o, 0]));
  for (const it of items) if (it.counted) balances.set(it.mark.person, add(balances.get(it.mark.person) ?? 0, it.delta));

  // open items: repayments linked to advances cover them (oldest advance first)
  const abs = (v) => (v < 0 ? -v : v);
  const remaining = new Map(items.filter((i) => i.counted && i.mark.type === 'voorschot').map((i) => [i.tx.id, abs(i.delta)]));
  for (const it of items.filter((i) => i.counted && i.mark.type === 'terugbetaling')) {
    let left = abs(it.delta);
    const targets = (it.mark.linkedTo ?? []).map((id) => items.find((x) => x.tx.id === id)).filter(Boolean).sort((a, b) => a.tx.entryDate.localeCompare(b.tx.entryDate));
    for (const t of targets) {
      const r = remaining.get(t.tx.id) ?? 0;
      const used = Math.min(r, left);
      remaining.set(t.tx.id, r - used);
      left -= used;
    }
    it.open = targets.length ? left : abs(it.delta);
  }
  for (const it of items) if (it.mark.type === 'voorschot') it.open = it.counted ? remaining.get(it.tx.id) : 0;
  items.sort((a, b) => b.tx.entryDate.localeCompare(a.tx.entryDate) || b.tx.id.localeCompare(a.tx.id));
  return { account, persons: [...balances].map(([name, balance]) => ({ name, balance })), items };
}

/** Human-readable sentence for a person's balance. */
export function balanceSentence(name, balance, fmt) {
  if (balance === 0) return `${name}: niets verschuldigd`;
  return balance > 0 ? `De gemeenschappelijke pot is ${name} ${fmt(balance)} verschuldigd` : `${name} is de gemeenschappelijke pot ${fmt(-balance)} verschuldigd`;
}
