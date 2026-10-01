// Internal transfers: the counterparty IBAN is one of my own accounts
// (imported accounts + "eigen rekeningen zonder CODA"). Both sides of a
// transfer between two imported accounts are linked: opposite amount, dates
// at most 5 days apart. The link is derived (never stored), so it is always
// consistent with the imported data.

const DAY = 86400000;
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

export function ownIbans(data) {
  const set = new Set(Object.keys(data.accounts));
  for (const e of data.externalOwnAccounts ?? []) if (e.iban) set.add(e.iban);
  return set;
}

export function isInternal(tx, data, own = ownIbans(data)) {
  const cp = tx.counterparty?.account;
  if (!cp || cp === tx.accountId || !own.has(cp)) return false;
  return !data.annotations?.[tx.id]?.notInternal;
}

const jointAccount = (a) => a?.ownership?.type === 'gemeenschappelijk';

/**
 * Contribution between an individual and a joint imported account (in either
 * direction): 'individueel' for the movement on the individual account,
 * 'gemeenschappelijk' for the movement on the joint account, else null.
 */
export function contributionSide(tx, data, own = ownIbans(data)) {
  if (!isInternal(tx, data, own)) return null;
  const self = data.accounts[tx.accountId];
  const other = data.accounts[tx.counterparty.account];
  if (!self || !other || jointAccount(self) === jointAccount(other)) return null;
  return jointAccount(self) ? 'gemeenschappelijk' : 'individueel';
}

/** Map txId -> counterpart txId for transfers between two imported accounts. */
export function linkTransfers(data, own = ownIbans(data)) {
  const byKey = new Map(); // `${accountId}|${amount}` -> txs
  for (const t of data.transactions) {
    const k = `${t.accountId}|${t.amount}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const links = new Map();
  const candidates = data.transactions
    .filter((t) => isInternal(t, data, own) && data.accounts[t.counterparty.account])
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id));
  for (const a of candidates) {
    if (links.has(a.id)) continue;
    const pool = byKey.get(`${a.counterparty.account}|${-a.amount}`) ?? [];
    let best = null;
    for (const b of pool) {
      if (links.has(b.id) || b.id === a.id) continue;
      if (b.counterparty?.account && b.counterparty.account !== a.accountId) continue;
      if (data.annotations?.[b.id]?.notInternal) continue;
      const d = days(a.entryDate, b.entryDate);
      if (d > 5) continue;
      if (!best || d < best.d || (d === best.d && b.id < best.b.id)) best = { b, d };
    }
    if (best) {
      links.set(a.id, best.b.id);
      links.set(best.b.id, a.id);
    }
  }
  return links;
}
