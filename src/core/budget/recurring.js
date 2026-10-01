// Recurring payments: detection, series maintenance and expected dates.
//
// Detection, per group (account + direction + counterparty):
//  - counterparty = IBAN, else the normalised name / card merchant
//  - try the intervals month, week, quarter, year; build a chain backwards from
//    the most recent transaction: the previous one must be one interval earlier
//    (± tolerance in days) with an amount within ± tolerancePct of the chain's
//    reference amount
//  - at least 3 occurrences (2 for yearly)
//  - rejected when the group has many other transactions with a comparable
//    amount in the same time span (> 50 % of the chain length): random
//    purchases at the same shop
//  - after a chain is found, the group is searched again for a second series
import { addDays, addMonths, diffDays } from './dates.js';

export const INTERVALS = {
  week: { label: 'wekelijks', tol: 2, perYear: 52, min: 3 },
  maand: { label: 'maandelijks', tol: 5, perYear: 12, min: 3 },
  kwartaal: { label: 'per kwartaal', tol: 7, perYear: 4, min: 3 },
  jaar: { label: 'jaarlijks', tol: 10, perYear: 1, min: 2 },
};
const ORDER = ['maand', 'week', 'kwartaal', 'jaar'];

export function step(date, interval, n, day = null) {
  if (interval === 'week') return addDays(date, 7 * n);
  const months = interval === 'maand' ? 1 : interval === 'kwartaal' ? 3 : 12;
  return addMonths(date, months * n, day);
}

const abs = (v) => (v < 0 ? -v : v);
const within = (amount, ref, pct) => abs(amount - ref) * 100 <= abs(ref) * pct;
const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

export function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Counterparty key: IBAN, or the normalised name / merchant. null when unknown. */
export function counterpartyKey(tx) {
  if (tx.counterparty?.account) return `iban:${tx.counterparty.account}`;
  const name = normalizeName(tx.card?.merchant || tx.counterparty?.name || (tx.communication?.text ?? '').split('\n')[0]);
  return name ? `naam:${name}` : null;
}

export function groupKey(tx) {
  const cp = counterpartyKey(tx);
  return cp ? `${tx.accountId}|${tx.amount < 0 ? 'uit' : 'in'}|${cp}` : null;
}

export const seriesKey = (group, interval) => `${group}|${interval}`;

/** First expected date strictly after `after` (anchored on the last known date of the series). */
export function nextOccurrence(series, after) {
  const anchor = series.lastDate ?? series.startDate;
  if (!anchor) return null;
  if (!series.lastDate && series.startDate > after) return series.startDate;
  for (let k = 1; k < 2000; k++) {
    const d = step(anchor, series.interval, k, series.interval === 'week' ? null : series.day);
    if (d > after) return d;
  }
  return null;
}

/** Expected dates in [from, to] that come after the last known payment. */
export function occurrencesBetween(series, from, to) {
  const out = [];
  let d = series.lastDate ? nextOccurrence(series, series.lastDate) : series.startDate;
  while (d && d <= to) {
    if (d >= from) out.push(d);
    d = nextOccurrence(series, d);
  }
  return out;
}

function chainFrom(start, pool, interval, pct) {
  const { tol } = INTERVALS[interval];
  const chain = [start];
  const inChain = new Set([start.id]);
  for (;;) {
    const cur = chain[chain.length - 1];
    const expected = step(cur.entryDate, interval, -1);
    const ref = median(chain.map((t) => t.amount));
    let best = null;
    for (const t of pool) {
      if (inChain.has(t.id) || t.entryDate >= cur.entryDate) continue;
      const dev = abs(diffDays(expected, t.entryDate));
      if (dev > tol || !within(t.amount, ref, pct)) continue;
      if (!best || dev < best.dev) best = { t, dev };
    }
    if (!best) break;
    chain.push(best.t);
    inChain.add(best.t.id);
  }
  return chain.reverse(); // oldest first
}

function confidence(chain, interval, pct) {
  const { tol } = INTERVALS[interval];
  let devSum = 0;
  for (let i = 1; i < chain.length; i++) devSum += abs(diffDays(step(chain[i - 1].entryDate, interval, 1), chain[i].entryDate));
  const regular = chain.length > 1 ? 1 - devSum / (chain.length - 1) / (tol + 1) : 0.5;
  const ref = median(chain.map((t) => t.amount));
  const stable = chain.every((t) => t.amount === ref) ? 1 : chain.every((t) => within(t.amount, ref, pct / 2)) ? 0.7 : 0.4;
  const standing = chain.some((t) => /bestendige|domicili/i.test(t.bankType ?? '')) ? 1 : 0;
  const score = 0.45 * Math.min(1, chain.length / 6) + 0.25 * Math.max(0, regular) + 0.15 * stable + 0.15 * standing;
  return Math.round(score * 100) / 100;
}

/**
 * Detect recurring series in the transactions.
 * @returns candidates [{ key, group, accountId, direction, counterparty, interval, day, txIds, firstDate, lastDate, expectedAmount, confidence }]
 */
export function detectSeries(transactions, { tolerancePct = 10 } = {}) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.foreignCurrency || !t.amount) continue;
    const g = groupKey(t);
    if (!g) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  const out = [];
  for (const [group, txs] of groups) {
    if (txs.length < 2) continue;
    txs.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id.localeCompare(b.id));
    let remaining = [...txs];
    const accepted = [];
    let found = true;
    while (found && remaining.length >= 2) {
      found = false;
      for (const interval of ORDER) {
        const latest = remaining[remaining.length - 1];
        const chain = chainFrom(latest, remaining, interval, tolerancePct);
        if (chain.length < INTERVALS[interval].min) continue;
        // extend forward with later payments on schedule whose amount changed
        // (up to ± 50 %): a price increase must not end the series
        for (const t of txs) {
          const last = chain[chain.length - 1];
          if (t.entryDate <= last.entryDate || accepted.some((c) => c.ids.has(t.id))) continue;
          const expected = step(last.entryDate, interval, 1);
          if (abs(diffDays(expected, t.entryDate)) <= INTERVALS[interval].tol && within(t.amount, last.amount, 50)) chain.push(t);
        }
        const ids = new Set(chain.map((t) => t.id));
        const first = chain[0].entryDate;
        const last = chain[chain.length - 1].entryDate;
        // noise: other transactions in the same span with a comparable amount (± 50 %);
        // a second series with a clearly different amount is not noise
        const ref = median(chain.map((t) => t.amount));
        const noise = txs.filter((t) => !ids.has(t.id) && t.entryDate >= first && t.entryDate <= last && within(t.amount, ref, 50) && !accepted.some((c) => c.ids.has(t.id))).length;
        if (noise * 2 > chain.length) continue;
        accepted.push({ chain, ids, interval });
        remaining = remaining.filter((t) => !ids.has(t.id));
        found = true;
        break;
      }
      if (!found && remaining.length >= 2) {
        // the most recent transaction starts no series: try without it
        remaining = remaining.slice(0, -1);
        found = true;
      }
    }
    for (const { chain, interval } of accepted) {
      const last = chain[chain.length - 1];
      const day = interval === 'week' ? null : median(chain.map((t) => Number(t.entryDate.slice(8, 10))));
      // several series at the same counterparty: distinguish them by day (or weekly amount)
      const suffix = accepted.length > 1 ? (day ? `|dag${day}` : `|${abs(last.amount)}`) : '';
      out.push({
        key: seriesKey(group, interval) + suffix,
        group,
        accountId: last.accountId,
        direction: last.amount < 0 ? 'uit' : 'in',
        counterparty: { iban: last.counterparty?.account || null, name: last.card?.merchant || last.counterparty?.name || '' },
        interval,
        day,
        txIds: chain.map((t) => t.id),
        firstDate: chain[0].entryDate,
        lastDate: last.entryDate,
        expectedAmount: last.amount,
        confidence: confidence(chain, interval, tolerancePct),
      });
    }
  }
  return out;
}

/** Does a payment on `date` match one of the expected dates after the last payment (± tol days)? */
export function fitsSchedule(series, date, tol = INTERVALS[series.interval].tol) {
  let o = series.lastDate ? nextOccurrence(series, series.lastDate) : series.startDate;
  while (o && diffDays(date, o) <= tol) {
    if (abs(diffDays(o, date)) <= tol) return true;
    o = nextOccurrence(series, o);
  }
  return false;
}

/** Is the series still running at `refDate` (last payment not more than one interval + tolerance ago)? */
export function isActive(series, refDate) {
  const next = nextOccurrence(series, series.lastDate ?? series.startDate);
  return !next || addDays(next, INTERVALS[series.interval].tol) >= refDate;
}

/** Most frequent category of the series' transactions. */
function seriesCategory(data, txIds) {
  const counts = new Map();
  for (const id of txIds) {
    const c = data.allocations?.[id]?.[0]?.categoryId;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = null;
  for (const [c, n] of counts) if (!best || n > best[1]) best = [c, n];
  return best?.[0] ?? null;
}

/** Latest data date per account (transactions and bank balance snapshots). */
export function referenceDates(data) {
  const ref = {};
  for (const t of data.transactions) if (!ref[t.accountId] || t.entryDate > ref[t.accountId]) ref[t.accountId] = t.entryDate;
  for (const [acc, list] of Object.entries(data.balanceSnapshots ?? {})) {
    for (const s of list) {
      const d = s.at?.slice(0, 10);
      if (d && (!ref[acc] || d > ref[acc])) ref[acc] = d;
    }
  }
  return ref;
}

/**
 * Update the series after an import (or on demand):
 *  - confirmed/manual series take new matching transactions (date on schedule
 *    ± tolerance, amount within ± 50 % so a price increase is still recognised)
 *  - proposals are refreshed from the detection
 *  - new detected, still running series become proposals, unless the same key
 *    was rejected before (a rejected proposal never comes back)
 */
export function syncRecurring(data, { now = new Date().toISOString() } = {}) {
  const pct = data.budget?.amountTolerancePct ?? 10;
  const refDates = referenceDates(data);
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const candidates = detectSeries(data.transactions, { tolerancePct: pct });
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const assigned = new Set();
  const next = [];

  // 1. confirmed (and manual) series
  for (const s of data.recurring ?? []) {
    if (s.status !== 'bevestigd') continue;
    const txIds = s.txIds.filter((id) => byId.has(id));
    txIds.forEach((id) => assigned.add(id));
    const series = { ...s, txIds };
    const tol = INTERVALS[s.interval].tol;
    const candidatesTx = data.transactions
      .filter((t) => !assigned.has(t.id) && groupKey(t) === s.group && (!series.lastDate || t.entryDate > series.lastDate))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    for (const t of candidatesTx) {
      const ref = series.expectedAmount;
      if (ref && abs(t.amount - ref) * 2 > abs(ref)) continue;
      if (!fitsSchedule(series, t.entryDate, tol)) continue;
      series.txIds = [...series.txIds, t.id];
      series.lastDate = t.entryDate;
      series.firstDate ??= t.entryDate;
      if (!s.locked?.amount) series.expectedAmount = t.amount;
      assigned.add(t.id);
    }
    if (series.txIds.length !== s.txIds.length) series.updatedAt = now;
    next.push(series);
  }

  // 2. proposals and rejected series
  const known = new Set((data.recurring ?? []).map((s) => s.key));
  for (const s of data.recurring ?? []) {
    if (s.status === 'geweigerd') {
      next.push(s);
      continue;
    }
    if (s.status !== 'voorstel') continue;
    const c = byKey.get(s.key);
    if (!c || c.txIds.some((id) => assigned.has(id)) || !isActive(c, refDates[c.accountId] ?? c.lastDate)) continue; // proposal disappears
    next.push({ ...s, ...pick(c), categoryId: s.locked?.category ? s.categoryId : seriesCategory(data, c.txIds), updatedAt: now });
    c.txIds.forEach((id) => assigned.add(id));
  }

  // 3. new proposals
  for (const c of candidates) {
    if (known.has(c.key) || c.txIds.some((id) => assigned.has(id))) continue;
    if (!isActive(c, refDates[c.accountId] ?? c.lastDate)) continue;
    next.push({
      id: `rec-${c.key.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}-${c.firstDate}`,
      status: 'voorstel',
      origin: 'detectie',
      ...pick(c),
      categoryId: seriesCategory(data, c.txIds),
      locked: {},
      createdAt: now,
      updatedAt: now,
    });
    c.txIds.forEach((id) => assigned.add(id));
  }
  return { ...data, recurring: next };
}

function pick(c) {
  const { key, group, accountId, direction, counterparty, interval, day, txIds, firstDate, lastDate, expectedAmount, confidence } = c;
  return { key, group, accountId, direction, counterparty, interval, day, txIds, firstDate, lastDate, expectedAmount, confidence };
}

/** Yearly cost and monthly equivalent (integer milli). */
export function yearlyCost(series) {
  const yearly = series.expectedAmount * INTERVALS[series.interval].perYear;
  const monthly = yearly >= 0 ? Math.floor((yearly + 6) / 12) : -Math.floor((-yearly + 6) / 12);
  return { yearly, monthly };
}

/** A manual series (e.g. a yearly cost without history). */
export function makeManualSeries(data, input, now = new Date().toISOString()) {
  const { accountId, name, iban = null, interval, day = null, expectedAmount, categoryId = null, startDate } = input;
  if (!data.accounts[accountId]) throw new Error('Kies een rekening.');
  if (!INTERVALS[interval]) throw new Error('Kies een interval.');
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount === 0) throw new Error('Geef het verwachte bedrag op (negatief = betaling).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? '')) throw new Error('Geef de eerstvolgende datum op.');
  if (!String(name ?? '').trim() && !iban) throw new Error('Geef een naam of IBAN van de tegenpartij op.');
  const cp = iban ? `iban:${iban}` : `naam:${normalizeName(name)}`;
  const group = `${accountId}|${expectedAmount < 0 ? 'uit' : 'in'}|${cp}`;
  return {
    id: `rec-manueel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'bevestigd',
    origin: 'manueel',
    key: seriesKey(group, interval),
    group,
    accountId,
    direction: expectedAmount < 0 ? 'uit' : 'in',
    counterparty: { iban, name: String(name ?? '').trim() },
    interval,
    day: interval === 'week' ? null : (day ?? Number(startDate.slice(8, 10))),
    txIds: [],
    firstDate: null,
    lastDate: null,
    startDate,
    expectedAmount,
    categoryId,
    confidence: null,
    locked: { amount: false, category: !!categoryId },
    createdAt: now,
    updatedAt: now,
  };
}
