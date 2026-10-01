import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodSummary, perspectiveOverview } from '../src/core/budget/freespace.js';
import { buildPeriods } from '../src/core/budget/periods.js';
import { forecastAccount, forecastPerspective, forecastWarnings } from '../src/core/budget/forecast.js';
import { tx, dataset, ZICHT, JOINT, EXTERNAL_SAVINGS } from '../tools/budget-fixtures.js';

const series = (id, extra) => ({ id, status: 'bevestigd', origin: 'detectie', accountId: ZICHT, interval: 'maand', txIds: [], counterparty: { iban: null, name: id }, locked: {}, ...extra });

function personal() {
  const ts = [
    tx(ZICHT, '2026-08-31', 2_500_000, { id: 'loon-aug', cp: 'BE00000000000004' }),
    tx(ZICHT, '2026-09-30', 2_500_000, { id: 'loon-sep', cp: 'BE00000000000004' }),
    tx(ZICHT, '2026-10-01', -1_500_000, { id: 'joint-okt', cp: JOINT }), // fixed: contribution joint account
    tx(ZICHT, '2026-10-03', -9_990, { id: 'stream-okt', cp: 'BE00000000000020' }), // fixed, already paid
    tx(ZICHT, '2026-10-04', -200_000, { id: 'spaar-okt', cp: EXTERNAL_SAVINGS }), // savings
    tx(ZICHT, '2026-10-05', -45_500, { id: 'super1' }),
    tx(ZICHT, '2026-10-08', -30_000, { id: 'super2' }),
  ];
  const d = dataset(ts, { categories: { 'inkomen--loon': ['loon-aug', 'loon-sep'], 'abonnementen--streaming': ['stream-okt'], 'boodschappen--supermarkt': ['super1', 'super2'] } });
  return {
    ...d,
    recurring: [
      series('loon', { categoryId: 'inkomen--loon', counterparty: { iban: 'BE00000000000004', name: 'WERKGEVER' }, day: 30, lastDate: '2026-09-30', expectedAmount: 2_500_000, txIds: ['loon-aug', 'loon-sep'] }),
      series('joint', { categoryId: 'intern', counterparty: { iban: JOINT, name: 'Gemeenschappelijk' }, day: 1, lastDate: '2026-10-01', expectedAmount: -1_500_000, txIds: ['joint-okt'] }),
      series('stream', { categoryId: 'abonnementen--streaming', counterparty: { iban: 'BE00000000000020', name: 'STREAMING' }, day: 3, lastDate: '2026-10-03', expectedAmount: -9_990, txIds: ['stream-okt'] }),
      series('internet', { categoryId: 'wonen--internet-en-telecom', counterparty: { iban: 'BE00000000000022', name: 'INTERNET' }, day: 20, lastDate: '2026-09-20', expectedAmount: -55_000, txIds: [] }),
    ],
    budget: { ...d.budget, perspectives: { ...d.budget.perspectives, persoonlijk: { periodMode: 'loon', plannedSavings: 150_000, budgets: { boodschappen: 100_000 } } } },
  };
}

test('free space: a fixed cost already paid this period is not counted twice', () => {
  const d = personal();
  const [cur] = buildPeriods(d, 'persoonlijk', { today: '2026-10-10' }).slice(-1);
  assert.deepEqual([cur.start, cur.end], ['2026-09-30', '2026-10-29']);
  const s = periodSummary(d, 'persoonlijk', cur, { today: '2026-10-10' });
  // income: salary of 30/09 received; the next expected salary (30/10) falls in the next period
  assert.deepEqual(s.income, { actual: 2_500_000, expected: 0, total: 2_500_000 });
  // fixed: paid joint contribution + paid streaming (actual) + internet expected on 20/10;
  // streaming and joint are NOT expected again in this period
  assert.deepEqual(s.fixed, { actual: 1_509_990, expected: 55_000, total: 1_564_990 });
  assert.deepEqual(s.details.expected.map((e) => [e.date, e.label]), [['2026-10-20', 'INTERNET']]);
  // savings: max(planned 150, actual 200)
  assert.equal(s.savings.counted, 200_000);
  assert.equal(s.spent, 75_500);
  assert.equal(s.totalFree, 2_500_000 - 1_564_990 - 200_000);
  assert.equal(s.available, 2_500_000 - 1_564_990 - 200_000 - 75_500);
  assert.equal(s.remainingDays, 20);
  assert.equal(s.perDay, Math.floor(s.available / 20 / 10) * 10);
  // budget progress
  assert.deepEqual(s.budgets.map((b) => [b.categoryId, b.used, b.pct, b.status]), [['boodschappen', 75_500, 75, 'ok']]);
  // when the internet bill is paid, the expected amount disappears and the actual one counts
  const paid = { ...d, transactions: [...d.transactions, tx(ZICHT, '2026-10-19', -56_000, { id: 'inet', cp: 'BE00000000000022' })] };
  const paidD = { ...paid, allocations: { ...paid.allocations, inet: [{ categoryId: 'wonen--internet-en-telecom', amount: -56_000, source: 'manueel', ruleId: null }] }, recurring: paid.recurring.map((r) => (r.id === 'internet' ? { ...r, lastDate: '2026-10-19', txIds: ['inet'] } : r)) };
  const s2 = periodSummary(paidD, 'persoonlijk', cur, { today: '2026-10-20' });
  assert.deepEqual(s2.fixed, { actual: 1_565_990, expected: 0, total: 1_565_990 });
});

test('budget warnings at 80 % and 100 %', () => {
  const d = personal();
  const more = (amount) => ({ ...d, transactions: [...d.transactions, tx(ZICHT, '2026-10-09', -amount, { id: 'extra' })], allocations: { ...d.allocations, extra: [{ categoryId: 'boodschappen--supermarkt', amount: -amount, source: 'manueel', ruleId: null }] } });
  const status = (dd) => periodSummary(dd, 'persoonlijk', buildPeriods(dd, 'persoonlijk', { today: '2026-10-10' }).pop(), { today: '2026-10-10' }).budgets[0].status;
  assert.equal(status(more(5_000)), 'bijna'); // 80,5 %
  assert.equal(status(more(24_500)), 'over'); // 100 %
});

test('overview: running period first, previous periods for comparison', () => {
  const list = perspectiveOverview(personal(), 'persoonlijk', { today: '2026-10-10' });
  assert.deepEqual(list.map((s) => [s.period.label, s.current]), [['loon sep → okt 2026', true], ['loon aug → sep 2026', false]]);
  assert.equal(list[1].details.expected.length, 0); // past periods: only actual amounts
});

test('forecast: deterministic scenario gives the exact lowest balance and its date', () => {
  const d0 = dataset([tx(ZICHT, '2026-01-28', 2_000_000, { id: 'loon' })], { categories: { 'inkomen--loon': ['loon'] } });
  const d = {
    ...d0,
    recurring: [
      series('loon', { categoryId: 'inkomen--loon', day: 28, lastDate: '2026-01-28', expectedAmount: 2_000_000 }),
      series('huur', { categoryId: 'wonen--huur', day: 1, lastDate: '2026-01-01', expectedAmount: -900_000 }),
    ],
    plannedItems: [{ id: 'p1', date: '2026-02-10', amount: -500_000, accountId: ZICHT, description: 'Grote aankoop' }],
  };
  const f = forecastAccount(d, ZICHT, { months: 3, today: '2026-01-31', start: { date: '2026-01-31', balance: 1_000_000 } });
  assert.equal(f.end, '2026-04-30');
  const at = (date) => f.days.find((x) => x.date === date).balance;
  assert.equal(at('2026-02-01'), 100_000);
  assert.equal(at('2026-02-10'), -400_000);
  assert.equal(at('2026-02-28'), 1_600_000);
  assert.equal(at('2026-04-30'), 3_800_000);
  assert.deepEqual(f.min, { date: '2026-02-10', balance: -400_000 });
  assert.deepEqual(f.days.find((x) => x.date === '2026-02-10').items, [{ label: 'Grote aankoop', amount: -500_000, kind: 'gepland' }]);
  assert.deepEqual(forecastWarnings(d, [f]), [{ accountId: ZICHT, date: '2026-02-10', balance: -400_000, minimum: 0 }]);
});

test('forecast: variable spending (average of 3 periods) is spread exactly over the days', () => {
  const ts = [];
  for (const m of ['2025-10', '2025-11', '2025-12']) ts.push(tx(ZICHT, `${m}-15`, -300_000, { id: `v${m}` }));
  const d0 = dataset(ts);
  const d = { ...d0, budget: { ...d0.budget, perspectives: { ...d0.budget.perspectives, persoonlijk: { periodMode: 'kalender', budgets: {}, plannedSavings: 0 } } } };
  const f = forecastAccount(d, ZICHT, { months: 1, today: '2026-01-31', start: { date: '2026-01-31', balance: 1_000_000 } });
  assert.equal(f.variablePerPeriod, 300_000);
  const feb = f.days.filter((x) => x.date.startsWith('2026-02'));
  const total = feb.reduce((s, x) => s + x.items.reduce((a, i) => a + i.amount, 0), 0);
  assert.equal(total, -300_000); // exact, remainder on the last day
  assert.equal(feb[0].items[0].amount, -10_714); // 300000 / 28 = 10714 rest 8
  assert.equal(feb[27].items[0].amount, -10_722);
  assert.equal(f.days.find((x) => x.date === '2026-02-28').balance, 700_000);
});

test('forecast per perspective: sum of the accounts', () => {
  const d0 = dataset([tx(ZICHT, '2026-01-15', -1_000, { id: 'a' })]);
  const d = { ...d0, recurring: [series('huur', { categoryId: 'wonen--huur', day: 1, lastDate: '2026-01-01', expectedAmount: -900_000 })] };
  const f = forecastPerspective(d, 'persoonlijk', { months: 1, today: '2026-01-31' });
  assert.ok(f.days.length >= 28);
  assert.equal(f.accounts.length, 2); // current + savings account
});
