// Free space ("vrije ruimte") per period and perspective:
//   total free = income (received + still expected)
//              - fixed costs (paid: actual amount; not yet paid: expected amount of the recurring series)
//              - savings (max of planned and actual)
//   available  = total free - variable spending already done
// A recurring payment is expected only for dates after its last payment, so
// a fixed cost that was already paid this period is never counted twice.
import { add, sum } from '../money.js';
import { diffDays } from './dates.js';
import { makeClassifier, perspectiveAccounts, groupLabel } from './perspectives.js';
import { buildPeriods } from './periods.js';
import { occurrencesBetween } from './recurring.js';
import { seriesName } from './alerts.js';
import { categoryById } from '../categories/categories.js';

const neg = (v) => (v === 0 ? 0 : -v);

/** Classify the expected payment of a series like a transaction of its account. */
export function seriesFlow(classify, series) {
  return classify({ id: '__series__', accountId: series.accountId, amount: series.expectedAmount, counterparty: { account: series.counterparty?.iban ?? '' }, __categoryId: series.categoryId ?? null });
}

export function periodSummary(data, perspective, period, { today, classify = makeClassifier(data, perspective) } = {}) {
  const cfg = data.budget?.perspectives?.[perspective] ?? {};
  const { flow } = perspectiveAccounts(data, perspective);
  const flowSet = new Set(flow);
  const txs = data.transactions.filter((t) => flowSet.has(t.accountId) && t.entryDate >= period.start && t.entryDate <= period.end);
  const actual = { inkomen: [], vast: [], sparen: [], variabel: [] };
  for (const t of txs) {
    const c = classify(t);
    if (c && actual[c.flow]) actual[c.flow].push({ tx: t, ...c });
  }
  // expected payments of confirmed series, only in the running/future part of the period
  const expected = { inkomen: [], vast: [], sparen: [] };
  if (period.end >= today) {
    for (const s of data.recurring ?? []) {
      if (s.status !== 'bevestigd' || !flowSet.has(s.accountId)) continue;
      const c = seriesFlow(classify, s);
      if (!c || !expected[c.flow]) continue;
      for (const date of occurrencesBetween(s, period.start, period.end)) {
        expected[c.flow].push({ date, amount: s.expectedAmount, series: s, label: seriesName(s), group: c.group });
      }
    }
  }
  const income = { actual: sum(actual.inkomen.map((x) => x.tx.amount)), expected: sum(expected.inkomen.map((x) => x.amount)) };
  income.total = add(income.actual, income.expected);
  const fixed = { actual: sum(actual.vast.map((x) => neg(x.tx.amount))), expected: sum(expected.vast.map((x) => neg(x.amount))) };
  fixed.total = add(fixed.actual, fixed.expected);
  const savingsActual = add(sum(actual.sparen.map((x) => neg(x.tx.amount))), sum(expected.sparen.map((x) => neg(x.amount))));
  const savings = { planned: cfg.plannedSavings ?? 0, actual: sum(actual.sparen.map((x) => neg(x.tx.amount))), expected: sum(expected.sparen.map((x) => neg(x.amount))) };
  savings.counted = Math.max(savings.planned, savingsActual);
  const spent = sum(actual.variabel.map((x) => neg(x.tx.amount)));
  const totalFree = add(add(income.total, neg(fixed.total)), neg(savings.counted));
  const available = add(totalFree, neg(spent));
  const isCurrent = period.start <= today && today <= period.end;
  const remainingDays = isCurrent ? diffDays(today, period.end) + 1 : 0;
  // per remaining day, rounded down to a cent
  const perDay = remainingDays && available > 0 ? Math.floor(available / remainingDays / 10) * 10 : 0;

  // budgets per category (a main category includes its subcategories)
  const budgets = Object.entries(cfg.budgets ?? {}).map(([categoryId, budget]) => {
    let used = 0;
    for (const x of [...actual.vast, ...actual.variabel]) {
      const c = x.categoryId ? categoryById(data, x.categoryId) : null;
      if (c && (c.id === categoryId || c.parentId === categoryId)) used = add(used, neg(x.tx.amount));
    }
    const pct = Math.floor((used * 100) / budget);
    return { categoryId, label: groupLabel(data, categoryId), budget, used, pct, status: pct >= 100 ? 'over' : pct >= 80 ? 'bijna' : 'ok' };
  });

  const byGroup = (list, amountOf) => {
    const m = new Map();
    for (const x of list) m.set(x.group, add(m.get(x.group) ?? 0, amountOf(x)));
    return [...m].map(([group, amount]) => ({ group, label: groupLabel(data, group), amount })).sort((a, b) => b.amount - a.amount);
  };
  return {
    period,
    current: isCurrent,
    income,
    fixed,
    savings,
    spent,
    totalFree,
    available,
    remainingDays,
    perDay,
    budgets,
    details: {
      income: byGroup(actual.inkomen, (x) => x.tx.amount),
      fixed: byGroup(actual.vast, (x) => neg(x.tx.amount)),
      variable: byGroup(actual.variabel, (x) => neg(x.tx.amount)),
      expected: [...expected.inkomen, ...expected.vast, ...expected.sparen].sort((a, b) => a.date.localeCompare(b.date)),
    },
  };
}

/** The running period and the previous ones (newest first). */
export function perspectiveOverview(data, perspective, { today, previous = 5 } = {}) {
  const periods = buildPeriods(data, perspective, { today });
  const classify = makeClassifier(data, perspective);
  return periods
    .slice(-(previous + 1))
    .reverse()
    .map((p) => periodSummary(data, perspective, p, { today, classify }));
}
