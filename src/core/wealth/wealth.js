// Net worth per month end, per perspective:
//  - huishouden: everything at 100 %
//  - persoonlijk: individual accounts 100 %, joint accounts x my share (default
//    50 %), homes / loans / other items x my share (owners, borrowers)
// Amounts in milli; a share is applied with exact integer arithmetic (half-up).
// Items without data on a date are not counted as 0: the month is marked
// incomplete and the item is listed.
import { add, sum } from '../money.js';
import { addDays, addMonths, daysInMonth } from '../budget/dates.js';
import { balanceIndex } from './balances.js';
import { SOURCES } from './sources.js';
import { loanSchedule } from '../loans/schedule.js';

export const WEALTH_PERSPECTIVES = [
  { id: 'persoonlijk', label: 'Persoonlijk' },
  { id: 'huishouden', label: 'Huishouden' },
];

/** value x share (basis points), rounded half-up to the milli. */
export function applyShare(value, bp) {
  if (bp === 10000) return value;
  const n = BigInt(value) * BigInt(bp);
  const r = n < 0n ? -((-n * 2n + 10000n) / 20000n) : (n * 2n + 10000n) / 20000n;
  return Number(r);
}

export function makeContext(data) {
  const schedules = new Map();
  for (const l of data.loans ?? []) {
    try {
      schedules.set(l.id, loanSchedule(l));
    } catch {
      /* invalid loan */
    }
  }
  return { balances: balanceIndex(data), schedules, investValues: new Map() };
}

export function netWorthOn(data, date, perspective, ctx = makeContext(data)) {
  const groups = SOURCES.map((src) => {
    const items = src.items(data, date, ctx).map((it) => {
      const share = perspective === 'huishouden' ? 10000 : it.share;
      return { ...it, share, counted: it.value === null || it.notCounted ? null : applyShare(it.value, share) };
    });
    return { id: src.id, label: src.label, items, total: sum(items.map((i) => i.counted ?? 0)) };
  });
  const all = groups.flatMap((g) => g.items);
  return {
    date,
    perspective,
    groups,
    assets: sum(all.filter((i) => (i.counted ?? 0) > 0).map((i) => i.counted)),
    liabilities: sum(all.filter((i) => (i.counted ?? 0) < 0).map((i) => i.counted)),
    total: sum(all.map((i) => i.counted ?? 0)),
    incomplete: all.filter((i) => i.missing && (perspective === 'huishouden' || i.share > 0)).map((i) => ({ label: i.label, note: i.note })),
  };
}

const monthEnd = (ym) => `${ym}-${String(daysInMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))).padStart(2, '0')}`;

/** First month with any data (account coverage, valuation, loan drawdown). */
export function firstMonth(data, ctx) {
  const dates = [];
  for (const e of Object.values(ctx.balances)) if (e.coverageStart) dates.push(e.coverageStart);
  for (const p of data.properties ?? []) for (const v of p.valuations ?? []) dates.push(v.date);
  for (const l of data.loans ?? []) if (l.status === 'bevestigd' && l.tranches?.length) dates.push(l.drawdownDate ?? addMonths(l.tranches.map((t) => t.firstPaymentDate).sort()[0], -1));
  for (const o of data.operations ?? []) dates.push(o.date);
  for (const p of data.pension ?? []) for (const v of p.values ?? []) dates.push(v.date);
  return dates.length ? dates.sort()[0].slice(0, 7) : null;
}

/**
 * Series of month ends (the running month: today) from the first month with data.
 * @returns [{ month, date, current, ...netWorthOn }]
 */
export function netWorthSeries(data, perspective, { today, maxMonths = 120 } = {}) {
  const ctx = makeContext(data);
  const start = firstMonth(data, ctx);
  if (!start) return [];
  const out = [];
  let ym = start;
  const thisMonth = today.slice(0, 7);
  while (ym <= thisMonth) {
    const current = ym === thisMonth;
    const date = current ? today : monthEnd(ym);
    out.push({ month: ym, current, ...netWorthOn(data, date, perspective, ctx) });
    ym = addMonths(`${ym}-01`, 1).slice(0, 7);
  }
  return out.slice(-maxMonths);
}

/** Current net worth and the difference with the end of the previous month. */
export function netWorthSummary(data, perspective, { today }) {
  const ctx = makeContext(data);
  const now = netWorthOn(data, today, perspective, ctx);
  const prevEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  const prev = netWorthOn(data, prevEnd, perspective, ctx);
  return { now, prev, diff: add(now.total, -prev.total) };
}
