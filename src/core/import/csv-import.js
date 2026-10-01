// CSV import strategy (profile driven, e.g. VDK).
//  - key: account + bank reference; fallback for profiles without reference:
//    account + date + amount + counterparty IBAN + normalized communication + occurrence number
//  - an existing movement is never duplicated; its EMPTY fields are completed
//    (e.g. statement year/number). User data lives in `annotations` and is never touched.
//  - same content under a different reference => imported, but flagged as "mogelijke dubbel"
//  - real booking order: order in the file + balance chain, merged with what is already known
// Any error => the whole file is refused and nothing changes.

import { parseCsvExport } from '../csv/adapter.js';
import { parseCardCommunication } from '../csv/card.js';
import { detectStructured } from '../csv/structured.js';
import { checkFileChain, checkAccountChain } from '../checks/chain.js';
import { formatIban } from '../model/ids.js';
import { formatMilli } from '../money.js';

const FINANCIAL_FIELDS = ['entryDate', 'valueDate', 'amount', 'balanceAfter', 'statementYear', 'statementNumber'];
const DESCRIPTIVE_FIELDS = [
  'bankType',
  'counterparty.account',
  'counterparty.bic',
  'counterparty.name',
  'counterparty.street',
  'counterparty.postcode',
  'counterparty.city',
  'counterparty.country',
  'communication.text',
  'exchangeRate',
  'costs',
];
const LABELS = {
  entryDate: 'boekingsdatum',
  valueDate: 'valutadatum',
  amount: 'bedrag',
  balanceAfter: 'saldo na beweging',
  statementYear: 'jaar uittreksel',
  statementNumber: 'nummer uittreksel',
  bankType: 'soort beweging',
  'counterparty.account': 'tegenpartij rekening',
  'counterparty.bic': 'tegenpartij BIC',
  'counterparty.name': 'tegenpartij naam',
  'counterparty.street': 'tegenpartij adres',
  'counterparty.postcode': 'tegenpartij postnummer',
  'counterparty.city': 'tegenpartij woonplaats',
  'counterparty.country': 'tegenpartij land',
  'communication.text': 'mededeling',
  exchangeRate: 'wisselkoers',
  costs: 'kosten',
};

const getPath = (o, path) => path.split('.').reduce((v, k) => (v === null || v === undefined ? v : v[k]), o);
const isEmpty = (v) => v === null || v === undefined || v === '' || (typeof v === 'object' && v.text === undefined && Object.keys(v).length === 0);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const normComm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const d = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?');

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function contentSignature(t) {
  return `${t.entryDate}|${t.amount}|${t.counterparty?.account ?? ''}|${normComm(t.communication?.text)}`;
}

function rowToTransaction(row, id, accountId, profile, importId) {
  return {
    id,
    accountId,
    source: 'csv',
    profileId: profile.id,
    statementId: null,
    statementYear: row.statementYear,
    statementNumber: row.statementNumber,
    sequence: null,
    detail: null,
    amount: row.amount,
    currency: profile.currency ?? 'EUR',
    entryDate: row.entryDate,
    valueDate: row.valueDate,
    counterparty: row.counterparty,
    communication: row.communication,
    txCode: null,
    bankReference: row.bankRef ?? '',
    customerReference: '',
    information: [],
    details: [],
    bankType: row.bankType,
    balanceAfter: row.balanceAfter,
    costs: row.costs,
    exchangeRate: row.exchangeRate,
    card: row.card,
    bookingOrder: 0,
    importId,
    enrichedBy: [],
  };
}

/** Merge the known order E with the order of this file F (both oldest first). */
export function mergeOrder(E, F, byId) {
  const posE = new Map(E.map((id, i) => [id, i]));
  const anchors = [];
  F.forEach((id, i) => {
    const p = posE.get(id);
    if (p !== undefined) anchors.push([i, p]);
  });
  if (!anchors.length) return placeBlock(E, F, byId);
  for (let k = 1; k < anchors.length; k++) {
    const [i0, p0] = anchors[k - 1];
    const [i1, p1] = anchors[k];
    if (p1 <= p0) {
      return { error: `De volgorde van de bewegingen verschilt van een eerdere import (rond ${d(byId(F[i1]).entryDate)}).` };
    }
    if (p1 - p0 > 1) {
      const missing = E.slice(p0 + 1, p1).map(byId);
      return {
        error: `Deze export bevat ${missing.length} eerder geïmporteerde beweging(en) niet, tussen ${d(byId(F[i0]).entryDate)} en ${d(byId(F[i1]).entryDate)} (bv. ${formatMilli(missing[0].amount)} op ${d(missing[0].entryDate)}, referentie ${missing[0].bankReference || missing[0].id}). Er wordt niets gewijzigd; controleer bij de bank.`,
      };
    }
  }
  const out = E.slice(0, anchors[0][1]);
  out.push(...F.slice(0, anchors[0][0]));
  for (let k = 0; k < anchors.length; k++) {
    const [i, p] = anchors[k];
    out.push(E[p]);
    const nextI = k + 1 < anchors.length ? anchors[k + 1][0] : F.length;
    out.push(...F.slice(i + 1, nextI));
  }
  out.push(...E.slice(anchors[anchors.length - 1][1] + 1));
  return { order: out };
}

/** No common movements: place the file as one block, by date and balance chain. */
function placeBlock(E, F, byId) {
  if (!F.length) return { order: E };
  const first = byId(F[0]);
  const last = byId(F[F.length - 1]);
  const lo = E.filter((id) => byId(id).entryDate < first.entryDate).length;
  const hi = E.filter((id) => byId(id).entryDate <= last.entryDate).length;
  // E must be sorted by date at the boundaries for this to be meaningful; any
  // known movement strictly inside the file's period means the file is incomplete.
  for (let k = lo; k < hi; k++) {
    const t = byId(E[k]);
    if (t.entryDate > first.entryDate && t.entryDate < last.entryDate) {
      return {
        error: `De periode van deze export (${d(first.entryDate)} - ${d(last.entryDate)}) overlapt met eerder geïmporteerde bewegingen, maar ze hebben geen enkele beweging gemeen (bv. ${formatMilli(t.amount)} op ${d(t.entryDate)}). Er wordt niets gewijzigd.`,
      };
    }
  }
  const linked = (a, b) => a && b && a.balanceAfter !== null && b.balanceAfter !== null && a.balanceAfter + b.amount === b.balanceAfter;
  let best = null;
  for (let k = lo; k <= hi; k++) {
    const score = (k > 0 && linked(byId(E[k - 1]), first) ? 1 : 0) + (k < E.length && linked(last, byId(E[k])) ? 1 : 0);
    if (score > 0 && (!best || score > best.score)) best = { k, score };
  }
  let k;
  if (best) k = best.k;
  else if (first.entryDate === last.entryDate) k = hi;
  else k = lo + E.slice(lo, hi).filter((id) => byId(id).entryDate === first.entryDate).length;
  return { order: [...E.slice(0, k), ...F, ...E.slice(k)] };
}

/**
 * @returns {{ data: object|null, errors: object[] }}
 */
export function importCsv(data, file, report, now, profile) {
  const parsed = parseCsvExport(file.bytes, file.fileName, profile);
  report.encoding = parsed.encoding;
  const lineMsg = (i) => ({ level: i.level, message: i.line ? `Regel ${i.line}: ${i.message}` : i.message });
  const errors = parsed.issues.filter((i) => i.level === 'error').map(lineMsg);
  report.messages.push(...parsed.issues.filter((i) => i.level !== 'error').map(lineMsg));
  if (errors.length) return { data: null, errors };

  const accountId = parsed.account.number;
  if (!accountId) return { data: null, errors: [{ level: 'error', message: 'Het eigen rekeningnummer kon niet bepaald worden.' }] };
  const rows = parsed.rows;
  const chainErrors = checkFileChain(rows, parsed.snapshot).map(lineMsg);
  if (chainErrors.length) return { data: null, errors: chainErrors };

  // Account
  const existingAccount = data.accounts[accountId];
  const accounts = { ...data.accounts };
  if (existingAccount) {
    if ((existingAccount.sourceFormat ?? 'coda') === 'coda') {
      return { data: null, errors: [{ level: 'error', message: `${formatIban(accountId)} wordt al via CODA ingelezen. CODA en CSV voor dezelfde rekening mengen kan niet betrouwbaar (andere sleutels).` }] };
    }
    if (existingAccount.profileId !== profile.id) {
      report.messages.push({ level: 'warning', message: `${formatIban(accountId)} werd eerder met profiel "${existingAccount.profileId}" ingelezen, nu met "${profile.id}".` });
    }
  } else {
    const label = parsed.account.accountLabel;
    accounts[accountId] = {
      id: accountId,
      number: accountId,
      isIban: /^[A-Z]{2}\d{2}/.test(accountId),
      currency: profile.currency ?? 'EUR',
      holderName: parsed.account.holderName ?? '',
      bankDescription: label ?? '',
      bic: '',
      displayName: label || formatIban(accountId),
      kind: /spaar/i.test(label ?? '') ? 'spaar' : 'zicht',
      ownership: { type: 'individueel', owners: [] },
      sourceFormat: 'csv',
      profileId: profile.id,
      bankAccountType: label ?? null,
      createdAt: now,
    };
    report.newAccounts.push(accountId);
  }

  // Keys
  const ids = [];
  const seen = new Set();
  const occurrences = new Map();
  for (const row of rows) {
    let id;
    if (profile.key === 'bankRef') {
      id = `${accountId}|ref|${row.bankRef}`;
      if (seen.has(id)) return { data: null, errors: [{ level: 'error', message: `Regel ${row.line}: referentie ${row.bankRef} komt meer dan eens voor in dit bestand.` }] };
    } else {
      const base = `${accountId}|fb|${row.entryDate}|${row.amount}|${row.counterparty.account}|${fnv1a(normComm(row.communication.text))}`;
      const n = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, n);
      id = `${base}|${n}`;
    }
    seen.add(id);
    ids.push(id);
  }

  // Classify rows: new, existing (maybe enriched), previously removed
  const accountTx = data.transactions.filter((t) => t.accountId === accountId);
  const existingById = new Map(accountTx.map((t) => [t.id, t]));
  const removed = data.removedTransactions ?? {};
  const signatures = new Map();
  for (const t of accountTx) {
    const s = contentSignature(t);
    if (!signatures.has(s)) signatures.set(s, []);
    signatures.get(s).push(t.id);
  }
  const conflicts = [];
  const updated = new Map(); // id -> enriched transaction
  const fresh = new Map(); // id -> new transaction
  const possibleDuplicates = [];
  rows.forEach((row, i) => {
    const id = ids[i];
    const incoming = rowToTransaction(row, id, accountId, profile, report.id);
    const old = existingById.get(id) ?? removed[id]?.transaction;
    if (!old) {
      fresh.set(id, incoming);
      if (profile.key === 'bankRef') {
        const matches = signatures.get(contentSignature(incoming));
        if (matches?.length) {
          possibleDuplicates.push({
            id: `pd-${id}`,
            txId: id,
            matchIds: [...matches],
            status: 'open',
            createdAt: now,
            importId: report.id,
          });
        }
      }
      return;
    }
    report.duplicateTransactions++;
    if (removed[id]) return; // removed by the user: never re-imported
    const enriched = { ...old, counterparty: { ...old.counterparty }, communication: { ...old.communication } };
    const filled = [];
    for (const path of [...FINANCIAL_FIELDS, ...DESCRIPTIVE_FIELDS]) {
      const a = getPath(old, path);
      const b = getPath(incoming, path);
      if (isEmpty(b) || same(a, b)) continue;
      if (isEmpty(a)) {
        const [head, tail] = path.split('.');
        if (tail) enriched[head][tail] = b;
        else enriched[head] = b;
        filled.push(path);
      } else if (FINANCIAL_FIELDS.includes(path)) {
        conflicts.push(`Regel ${row.line}: beweging ${row.bankRef ?? id} heeft ${LABELS[path]} "${b}", maar eerder werd "${a}" geïmporteerd.`);
      } else {
        report.messages.push({ level: 'warning', message: `Regel ${row.line}: ${LABELS[path]} van beweging ${row.bankRef ?? id} verschilt van de eerdere import; de eerdere waarde blijft behouden.` });
      }
    }
    if (filled.length) {
      if (filled.includes('communication.text')) {
        const s = detectStructured(enriched.communication.text);
        enriched.communication.structured = s?.structured ?? null;
        enriched.communication.structuredValid = s?.structuredValid ?? null;
      }
      if (filled.includes('bankType') || filled.includes('communication.text')) {
        if (incoming.card && !enriched.card) enriched.card = parseCardCommunication(enriched.communication.text);
      }
      enriched.enrichedBy = [...(old.enrichedBy ?? []), { importId: report.id, fields: filled }];
      updated.set(id, enriched);
      report.enrichedTransactions++;
    }
  });
  if (conflicts.length) return { data: null, errors: conflicts.map((message) => ({ level: 'error', message })) };

  // Booking order: merge the known order with the order in this file
  const knownOrdered = [...accountTx, ...Object.values(removed).map((r) => r.transaction).filter((t) => t.accountId === accountId)].sort(
    (a, b) => a.bookingOrder - b.bookingOrder,
  );
  const byIdAll = new Map(knownOrdered.map((t) => [t.id, t]));
  for (const [id, t] of fresh) byIdAll.set(id, t);
  const merged = mergeOrder(
    knownOrdered.map((t) => t.id),
    ids,
    (id) => byIdAll.get(id),
  );
  if (merged.error) return { data: null, errors: [{ level: 'error', message: merged.error }] };
  const order = new Map(merged.order.map((id, i) => [id, i + 1]));

  const transactions = data.transactions.map((t) => {
    const u = updated.get(t.id) ?? t;
    const o = order.get(t.id);
    return o !== undefined && o !== u.bookingOrder ? { ...u, bookingOrder: o } : u;
  });
  for (const [id, t] of fresh) transactions.push({ ...t, bookingOrder: order.get(id) });
  let removedTransactions = data.removedTransactions ?? {};
  for (const [id, r] of Object.entries(removedTransactions)) {
    const o = order.get(id);
    if (o !== undefined && o !== r.transaction.bookingOrder) {
      removedTransactions = { ...removedTransactions, [id]: { ...r, transaction: { ...r.transaction, bookingOrder: o } } };
    }
  }

  report.newTransactions = fresh.size;
  report.possibleDuplicates = possibleDuplicates.length;
  if (possibleDuplicates.length) {
    report.messages.push({
      level: 'warning',
      message: `${possibleDuplicates.length} beweging(en) met een nieuwe referentie maar dezelfde datum, hetzelfde bedrag, dezelfde tegenpartij en mededeling als een bestaande beweging. Ze zijn geïmporteerd en staan bij "Nakijken" als mogelijke dubbel.`,
    });
  }
  const snapshots = { ...(data.balanceSnapshots ?? {}) };
  if (parsed.snapshot) {
    snapshots[accountId] = [...(snapshots[accountId] ?? []), { at: parsed.snapshot.at, balance: parsed.snapshot.balance, importId: report.id }];
  }
  const newData = {
    ...data,
    accounts,
    transactions,
    removedTransactions,
    balanceSnapshots: snapshots,
    possibleDuplicates: [...(data.possibleDuplicates ?? []), ...possibleDuplicates],
  };

  // Continuity over everything known for this account
  const ordered = merged.order.map((id) => {
    const t = byIdAll.get(id);
    return { ...t, balanceAfter: t.balanceAfter };
  });
  for (const i of checkAccountChain(ordered)) report.messages.push({ level: 'warning', message: `${formatIban(accountId)}: ${i.message}` });
  return { data: newData, errors: [] };
}
