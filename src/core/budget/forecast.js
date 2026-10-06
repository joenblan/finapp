// Cash-flow forecast per account and per perspective: expected balance per day.
// Start: the current balance of the account (as in the account overview).
// Items: confirmed recurring series on their expected dates, one-off planned
// items, and expected variable spending and variable income per period
// (average or median of the last 3 complete periods; spending also by budget)
// spread evenly over the days; the remaining
// milli-euros of the spread go to the last day, so totals are exact.
import { add, sum } from '../money.js';
import { addDays, addMonths, diffDays } from './dates.js';
import { buildPeriods } from './periods.js';
import { makeClassifier, perspectiveAccounts, isJoint, isSavings, txParts } from './perspectives.js';
import { occurrencesBetween, INTERVALS } from './recurring.js';
import { seriesStatus, seriesName } from './alerts.js';
import { referenceDates } from './recurring.js';
import { accountSummaries } from '../status.js';
import { expectedLoanTerms } from '../loans/budget-link.js';

const neg = (v) => (v === 0 ? 0 : -v);

export function perspectiveOf(account) {
  return isJoint(account) ? 'gemeenschappelijk' : 'persoonlijk';
}

/**
 * Income that is not foreseen elsewhere: no transaction of a confirmed
 * recurring series (nor from the counterparty of a confirmed incoming series
 * on the same account), and no transfer from an own account (contributions).
 */
function variableIncomeTest(data, accountId) {
  const inSeries = new Set();
  const seriesIbans = new Set();
  for (const s of data.recurring ?? []) {
    if (s.status !== 'bevestigd') continue;
    for (const id of s.txIds ?? []) inSeries.add(id);
    if (s.accountId === accountId && s.expectedAmount > 0 && s.counterparty?.iban) seriesIbans.add(s.counterparty.iban);
  }
  return (t, cls) => cls?.flow === 'inkomen' && !inSeries.has(t.id) && !seriesIbans.has(t.counterparty?.account) && !data.accounts[t.counterparty?.account];
}

/** Variable spending (positive = spent) and variable income (positive = received) of one account between two dates. */
function variableBetween(data, accountId, from, to, classify, isIncome) {
  let spent = 0;
  let income = 0;
  for (const t of data.transactions) {
    if (t.accountId !== accountId || t.entryDate < from || t.entryDate > to) continue;
    for (const part of txParts(data, t)) {
      const cls = classify(part);
      if (cls?.flow === 'variabel') spent = add(spent, neg(part.amount));
      else if (isIncome(part, cls)) income = add(income, part.amount);
    }
  }
  return { spent, income };
}

/** Variable spending and income of one account per complete period (the last 3). */
function variableHistory(data, accountId, periods, classify, today) {
  const isIncome = variableIncomeTest(data, accountId);
  return periods.filter((p) => p.end < today).slice(-3).map((p) => variableBetween(data, accountId, p.start, p.end, classify, isIncome));
}

const average = (xs) => (xs.length ? Math.floor(sum(xs) / xs.length) : 0);
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : Math.floor((s[n / 2 - 1] + s[n / 2]) / 2);
}

/**
 * Expected variable spending and income per period of an account.
 * mode: 'gemiddelde' (average of the last 3 complete periods), 'mediaan'
 * (median of them: one exceptional period weighs less) or 'budget' (spending:
 * the budgets of variable categories, shared by historic proportion; income: average).
 */
function variablePerPeriod(data, account, { today, mode }) {
  const perspective = perspectiveOf(account);
  if (isSavings(account)) return { amount: 0, income: 0, perspective };
  const periods = buildPeriods(data, perspective, { today });
  const classify = makeClassifier(data, perspective);
  const hist = variableHistory(data, account.id, periods, classify, today);
  const pick = mode === 'mediaan' ? median : average;
  const income = Math.max(0, pick(hist.map((x) => x.income)));
  if (mode !== 'budget') return { amount: pick(hist.map((x) => x.spent)), income, perspective };
  const cfg = data.budget?.perspectives?.[perspective] ?? {};
  const budgetTotal = sum(Object.entries(cfg.budgets ?? {}).filter(([id]) => data.categories.find((c) => c.id === id)?.budgetType === 'variabel').map(([, v]) => v));
  const { flow } = perspectiveAccounts(data, perspective);
  const totals = flow.map((id) => sum(variableHistory(data, id, periods, classify, today).map((x) => x.spent)));
  const all = sum(totals);
  const mine = totals[flow.indexOf(account.id)] ?? 0;
  const share = all > 0 ? Math.floor((budgetTotal * mine) / all) : Math.floor(budgetTotal / Math.max(1, flow.length));
  return { amount: share, income, perspective };
}

/**
 * @param opts { months: 3|6|12, today, start?: { date, balance } (default: current balance), variableMode? }
 * @returns { accountId, start, end, days: [{ date, balance, items: [{ label, amount, kind }] }], min: { date, balance } }
 */
export function forecastAccount(data, accountId, { months = 3, today, start = null, variableMode = null, endDate = null } = {}) {
  const account = data.accounts[accountId];
  let startPoint = start;
  if (!startPoint) {
    const s = accountSummaries(data).find((x) => x.account.id === accountId);
    startPoint = { date: s?.balanceDate ?? today, balance: s?.balance ?? 0 };
  }
  const first = addDays(startPoint.date, 1);
  const end = endDate ?? addMonths(startPoint.date, months);
  const items = new Map(); // date -> items
  const put = (date, item) => {
    if (date < first || date > end) return;
    if (!items.has(date)) items.set(date, []);
    items.get(date).push(item);
  };
  const ref = referenceDates(data)[accountId] ?? startPoint.date;
  for (const s of data.recurring ?? []) {
    if (s.status !== 'bevestigd' || s.loanId || s.accountId !== accountId) continue;
    const st = seriesStatus(s, ref, data.budget?.missedGraceDays ?? 5);
    if (st.stopped) continue;
    for (const date of occurrencesBetween(s, addDays(first, -INTERVALS[s.interval].tol - 31), end)) {
      // a payment that is late (expected before the start) is still expected: on the first day
      put(date < first ? first : date, { label: seriesName(s), amount: s.expectedAmount, kind: 'vast' });
    }
  }
  // terms of confirmed loans; an unpaid term of the last month is still expected (first day)
  for (const t of expectedLoanTerms(data, { accountIds: new Set([accountId]), from: addDays(first, -31), to: end, today: today ?? startPoint.date })) {
    put(t.date < first ? first : t.date, { label: t.label, amount: t.amount, kind: 'vast' });
  }
  for (const p of data.plannedItems ?? []) {
    if (p.accountId === accountId && p.date >= first) put(p.date, { label: p.description, amount: p.amount, kind: 'gepland' });
  }
  // variable spending and income per period, spread evenly over the days
  const { amount: perPeriod, income: incomePerPeriod, perspective } = variablePerPeriod(data, account, { today: today ?? startPoint.date, mode: variableMode ?? data.budget?.forecastVariable });
  if (perPeriod > 0 || incomePerPeriod > 0) {
    const periods = buildPeriods(data, perspective, { today: end });
    const classify = makeClassifier(data, perspective);
    const isIncome = variableIncomeTest(data, accountId);
    const spread = (from, to, amount, label, sign) => {
      const n = diffDays(from, to) + 1;
      if (amount <= 0 || n <= 0) return;
      const daily = Math.floor(amount / n);
      const rest = amount - daily * n;
      for (let i = 0; i < n; i++) {
        const a = daily + (i === n - 1 ? rest : 0);
        if (a) put(addDays(from, i), { label, amount: sign < 0 ? neg(a) : a, kind: 'variabel' });
      }
    };
    for (const p of periods) {
      if (p.end < first || p.start > end) continue;
      const from = p.start > first ? p.start : first;
      // running period: only what is still expected on top of the actual amounts so far
      const sofar = p.start < first ? variableBetween(data, accountId, p.start, startPoint.date, classify, isIncome) : { spent: 0, income: 0 };
      spread(from, p.end, Math.max(0, perPeriod - sofar.spent), 'Variabele uitgaven (verwacht)', -1);
      spread(from, p.end, Math.max(0, incomePerPeriod - sofar.income), 'Variabele inkomsten (verwacht)', 1);
    }
  }
  const days = [];
  let balance = startPoint.balance;
  let min = null;
  for (let d = first; d <= end; d = addDays(d, 1)) {
    const list = items.get(d) ?? [];
    balance = add(balance, sum(list.map((x) => x.amount)));
    days.push({ date: d, balance, items: list });
    if (!min || balance < min.balance) min = { date: d, balance };
  }
  return { accountId, start: startPoint, end, days, min, variablePerPeriod: perPeriod, variableIncomePerPeriod: incomePerPeriod };
}

/**
 * Forecast of a perspective: sum of its accounts (transfers between them cancel out).
 * Starts on the latest balance date of the accounts.
 */
export function forecastPerspective(data, perspective, { months = 3, today, variableMode = null } = {}) {
  const { all } = perspectiveAccounts(data, perspective);
  const summaries = accountSummaries(data).filter((s) => all.includes(s.account.id));
  if (!summaries.length) return null;
  // latest known balance date; accounts without a known balance start at 0 on that date
  const startDate = summaries.reduce((m, s) => (s.balanceDate && s.balanceDate > m ? s.balanceDate : m), '') || today;
  const end = addMonths(startDate, months);
  const perAccount = summaries.map((s) => forecastAccount(data, s.account.id, { months, today, variableMode, endDate: end, start: { date: s.balanceDate ?? startDate, balance: s.balance ?? 0 } }));
  const days = [];
  let min = null;
  for (let d = addDays(startDate, 1); d <= end; d = addDays(d, 1)) {
    let balance = 0;
    const its = [];
    for (const f of perAccount) {
      const day = f.days.find((x) => x.date === d);
      // before the first forecast day of an account: its start balance
      balance = add(balance, day ? day.balance : f.start.balance);
      if (day) its.push(...day.items.map((i) => ({ ...i, accountId: f.accountId })));
    }
    days.push({ date: d, balance, items: its });
    if (!min || balance < min.balance) min = { date: d, balance };
  }
  const start = { date: startDate, balance: sum(perAccount.map((f) => f.start.balance)) };
  return { perspective, start, end, days, min, accounts: perAccount };
}

/** Accounts whose lowest expected balance drops below their minimum (default € 0). */
export function forecastWarnings(data, forecasts) {
  const out = [];
  for (const f of forecasts) {
    const minimum = data.budget?.minBalance?.[f.accountId] ?? 0;
    if (f.min && f.min.balance < minimum) out.push({ accountId: f.accountId, date: f.min.date, balance: f.min.balance, minimum });
  }
  return out;
}
