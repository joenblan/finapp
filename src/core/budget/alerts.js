// Alerts, derived from the recurring series. Each alert has a dedupKey: a
// dismissed alert never comes back; an open alert that no longer applies
// (e.g. the payment arrived after all) disappears.
import { addDays, diffDays } from './dates.js';
import { INTERVALS, nextOccurrence, referenceDates } from './recurring.js';
import { formatMilli } from '../money.js';

const abs = (v) => (v < 0 ? -v : v);
const d = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const eur = (m) => `€ ${formatMilli(abs(m))}`;
// Several series on the same day at the same counterparty (key ending in |dagN|rank,
// e.g. a loan debited in two parts): "(deel 1)" = the largest amount.
export const seriesName = (s) => {
  const base = s.counterparty?.name || s.counterparty?.iban || 'onbekende tegenpartij';
  const part = /\|dag\d+\|(\d+)$/.exec(s.key ?? '');
  return part ? `${base} (deel ${part[1]})` : base;
};

/** First expected date that has no payment, and whether the series looks stopped. */
export function seriesStatus(series, refDate, graceDays = 5) {
  const anchor = series.lastDate ?? series.startDate;
  if (!anchor) return { missed: null, stopped: false };
  const next1 = series.lastDate ? nextOccurrence(series, series.lastDate) : series.startDate;
  const next2 = next1 ? nextOccurrence(series, next1) : null;
  const tol = INTERVALS[series.interval].tol;
  const stoppedAfter = series.interval === 'jaar' ? addDays(next1, 30) : next2 ? addDays(next2, tol) : null;
  const stopped = !!(series.lastDate && stoppedAfter && refDate > stoppedAfter);
  const missed = !stopped && next1 && addDays(next1, graceDays) < refDate ? next1 : null;
  return { missed, stopped, next: next1 };
}

/** Compute the alerts that currently apply. */
export function currentAlerts(data) {
  const cfg = data.budget ?? {};
  const pct = cfg.priceIncreasePct ?? 5;
  const minInc = cfg.priceIncreaseMin ?? 1000;
  const grace = cfg.missedGraceDays ?? 5;
  const refDates = referenceDates(data);
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const out = [];
  for (const s of data.recurring ?? []) {
    if (s.status === 'voorstel') {
      out.push({ type: 'nieuwe-reeks', recurringId: s.id, dedupKey: `nieuw|${s.key}`, message: `Nieuwe terugkerende ${s.direction === 'in' ? 'ontvangst' : 'betaling'} gevonden: ${seriesName(s)}, ${INTERVALS[s.interval].label}, ${eur(s.expectedAmount)}. Bevestig of weiger bij "Vaste betalingen".` });
      continue;
    }
    if (s.status !== 'bevestigd') continue;
    const txs = s.txIds.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    if (txs.length >= 2) {
      const prev = txs[txs.length - 2];
      const cur = txs[txs.length - 1];
      const inc = abs(cur.amount) - abs(prev.amount);
      if (inc >= minInc && inc * 100 > abs(prev.amount) * pct) {
        const p = Math.round((inc * 1000) / abs(prev.amount)) / 10;
        out.push({ type: 'prijsstijging', recurringId: s.id, dedupKey: `prijs|${s.id}|${cur.id}`, message: `${seriesName(s)}: bedrag gestegen van ${eur(prev.amount)} naar ${eur(cur.amount)} (+${String(p).replace('.', ',')} %) op ${d(cur.entryDate)}.` });
      }
    }
    const ref = refDates[s.accountId];
    if (!ref) continue;
    const st = seriesStatus(s, ref, grace);
    if (st.stopped) {
      out.push({ type: 'gestopt', recurringId: s.id, dedupKey: `stop|${s.id}|${s.lastDate}`, message: `${seriesName(s)} lijkt gestopt: laatste betaling op ${d(s.lastDate)}.` });
    } else if (st.missed) {
      out.push({ type: 'uitgebleven', recurringId: s.id, dedupKey: `uit|${s.id}|${st.missed}`, message: `${seriesName(s)}: verwachte ${s.direction === 'in' ? 'ontvangst' : 'betaling'} van ${eur(s.expectedAmount)} op ${d(st.missed)} is (nog) niet gezien (gegevens tot ${d(ref)}).` });
    }
  }
  return out;
}

/** Merge into data.alerts: keep dismissed ones, add new ones, drop resolved open ones. */
export function syncAlerts(data, now = new Date().toISOString()) {
  const current = currentAlerts(data);
  const existing = data.alerts ?? [];
  const byKey = new Map(existing.map((a) => [a.dedupKey, a]));
  const keys = new Set(current.map((a) => a.dedupKey));
  const out = existing.filter((a) => a.dismissedAt || keys.has(a.dedupKey));
  for (const a of current) {
    const old = byKey.get(a.dedupKey);
    if (old) {
      if (!old.dismissedAt) Object.assign(out[out.indexOf(old)] ?? {}, { message: a.message });
      continue;
    }
    out.push({ id: `al-${a.dedupKey.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 80)}`, ...a, createdAt: now, dismissedAt: null });
  }
  return { ...data, alerts: out };
}

export const openAlerts = (data) => (data.alerts ?? []).filter((a) => !a.dismissedAt);

export function daysLate(series, refDate) {
  const next = series.lastDate ? nextOccurrence(series, series.lastDate) : series.startDate;
  return next ? diffDays(next, refDate) : 0;
}
