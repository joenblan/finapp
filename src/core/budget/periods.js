// Budget periods: calendar month, or salary period ("loonperiode") that starts
// on the day the salary (category Inkomen › Loon) arrives and ends the day
// before the next salary. For the running period without a new salary yet,
// the expected salary date from a confirmed recurring series is used, else a
// configurable fixed start day ('laatste' = last day of the month).
import { addDays, addMonths, dayOfMonth, diffDays, monthShort, monthLong } from './dates.js';
import { perspectiveAccounts } from './perspectives.js';
import { nextOccurrence } from './recurring.js';

export const SALARY_CATEGORY = 'inkomen--loon';

/** Salary dates of the given accounts; payments within 10 days count as one salary moment. */
export function salaryDates(data, accountIds) {
  const set = new Set(accountIds);
  const dates = data.transactions
    .filter((t) => set.has(t.accountId) && t.amount > 0 && data.allocations?.[t.id]?.[0]?.categoryId === SALARY_CATEGORY)
    .map((t) => t.entryDate)
    .sort();
  const out = [];
  for (const d of dates) if (!out.length || diffDays(out[out.length - 1], d) > 10) out.push(d);
  return out;
}

function salarySeries(data, accountIds) {
  const set = new Set(accountIds);
  return (data.recurring ?? []).find((r) => r.status === 'bevestigd' && r.categoryId === SALARY_CATEGORY && set.has(r.accountId)) ?? null;
}

export function labelFor(mode, start, nextStart) {
  if (mode === 'kalender') return `${monthLong(start)} ${start.slice(0, 4)}`;
  return `loon ${monthShort(start)} → ${monthShort(nextStart)} ${nextStart.slice(0, 4)}`;
}

/**
 * @returns periods oldest first: [{ start, end (inclusive), label, mode, expectedStart, current }]
 *   The last period contains `today` (if the data reaches that far).
 */
export function buildPeriods(data, perspective, { today, mode = null } = {}) {
  const cfg = data.budget?.perspectives?.[perspective] ?? {};
  const m = mode ?? cfg.periodMode ?? 'kalender';
  const { flow } = perspectiveAccounts(data, perspective);
  const flowSet = new Set(flow);
  const txDates = data.transactions.filter((t) => flowSet.has(t.accountId)).map((t) => t.entryDate).sort();
  if (!txDates.length) return [];
  const first = txDates[0];
  const starts = [];
  if (m === 'kalender') {
    for (let s = `${first.slice(0, 7)}-01`; s <= today; s = addMonths(s, 1, 1)) starts.push({ date: s, expected: false });
    starts.push({ date: addMonths(starts[starts.length - 1]?.date ?? `${first.slice(0, 7)}-01`, 1, 1), expected: true });
  } else {
    const fallback = data.budget?.fallbackStartDay ?? 'laatste';
    const series = salarySeries(data, flow);
    const salaries = salaryDates(data, flow);
    if (salaries.length) {
      for (const d of salaries) starts.push({ date: d, expected: false });
    } else {
      // no salary known: fixed start day in every month
      let s = dayOfMonth(first, fallback);
      if (s > first) s = dayOfMonth(addMonths(`${first.slice(0, 7)}-01`, -1, 1), fallback);
      starts.push({ date: s, expected: true });
    }
    // extend with expected salary dates up to (and one beyond) today
    for (;;) {
      const last = starts[starts.length - 1].date;
      let next = series ? nextOccurrence(series, last) : null;
      if (!next || diffDays(last, next) < 15) next = dayOfMonth(addMonths(`${last.slice(0, 7)}-01`, 1, 1), fallback);
      starts.push({ date: next, expected: true });
      if (next > today) break;
    }
  }
  const periods = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const start = starts[i].date;
    const next = starts[i + 1].date;
    if (start > today) break;
    periods.push({ start, end: addDays(next, -1), nextStart: next, label: labelFor(m, start, next), mode: m, expectedStart: starts[i].expected, current: start <= today && today < next });
  }
  return periods;
}

export function periodContaining(periods, date) {
  return periods.find((p) => p.start <= date && date <= p.end) ?? null;
}
