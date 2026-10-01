import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPeriods, salaryDates } from '../src/core/budget/periods.js';
import { makeClassifier, perspectiveAccounts } from '../src/core/budget/perspectives.js';
import { addMonths, dayOfMonth } from '../src/core/budget/dates.js';
import { tx, dataset, ZICHT, SPAAR, JOINT, EXTERNAL_SAVINGS, CO_OWNER } from '../tools/budget-fixtures.js';

const salaries = (dates) => dates.map((d, i) => tx(ZICHT, d, 2_500_000, { id: `loon${i}`, cp: 'BE00000000000004', name: 'WERKGEVER' }));
const withSalary = (dates, more = []) => {
  const s = salaries(dates);
  return dataset([...s, ...more], { categories: { 'inkomen--loon': s.map((t) => t.id) } });
};
const spans = (ps) => ps.map((p) => [p.start, p.end, p.label]);

test('dates: month arithmetic clamps to the end of the month', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-11-30', 2, 31), '2027-01-31');
  assert.equal(dayOfMonth('2026-02-10', 'laatste'), '2026-02-28');
});

for (const day of [28, 30, 31]) {
  test(`salary period with salary on day ${day} of the month`, () => {
    const dates = ['2026-06', '2026-07', '2026-08', '2026-09'].map((m) => dayOfMonth(`${m}-01`, day));
    const d = withSalary(dates);
    const ps = buildPeriods(d, 'persoonlijk', { today: '2026-10-05', mode: 'loon' });
    assert.deepEqual(ps[0].start, dates[0]);
    for (let i = 0; i < dates.length - 1; i++) {
      assert.equal(ps[i].start, dates[i]);
      assert.equal(ps[i].nextStart, dates[i + 1]);
    }
    const cur = ps[ps.length - 1];
    assert.equal(cur.current, true);
    assert.equal(cur.start, dates[3]);
    // no salary yet for October and no recurring series: last day of the month (fallback)
    assert.equal(cur.nextStart, '2026-10-31');
    assert.equal(cur.end, '2026-10-30');
  });
}

test('salary a few days earlier or later moves the period boundaries', () => {
  const d = withSalary(['2026-06-30', '2026-07-28', '2026-09-01', '2026-09-30']);
  const ps = buildPeriods(d, 'persoonlijk', { today: '2026-10-01', mode: 'loon' });
  assert.deepEqual(spans(ps), [
    ['2026-06-30', '2026-07-27', 'loon jun → jul 2026'],
    ['2026-07-28', '2026-08-31', 'loon jul → sep 2026'],
    ['2026-09-01', '2026-09-29', 'loon sep → sep 2026'],
    ['2026-09-30', '2026-10-30', 'loon sep → okt 2026'],
  ]);
  // two payments within 10 days (salary + bonus) are one salary moment
  assert.deepEqual(salaryDates(withSalary(['2026-06-30', '2026-07-03']), [ZICHT]), ['2026-06-30']);
});

test('running period uses the expected salary date of a confirmed salary series', () => {
  const d0 = withSalary(['2026-07-30', '2026-08-31', '2026-09-30']);
  const d = { ...d0, recurring: [{ id: 's', status: 'bevestigd', categoryId: 'inkomen--loon', accountId: ZICHT, interval: 'maand', day: 30, lastDate: '2026-09-30', txIds: [] }] };
  const ps = buildPeriods(d, 'persoonlijk', { today: '2026-10-29', mode: 'loon' });
  assert.equal(ps[ps.length - 1].end, '2026-10-29');
  // past the expected date without salary: a new period starts on the expected date
  const later = buildPeriods(d, 'persoonlijk', { today: '2026-11-02', mode: 'loon' });
  const cur = later[later.length - 1];
  assert.deepEqual([cur.start, cur.expectedStart, cur.end], ['2026-10-30', true, '2026-11-29']);
});

test('calendar month as alternative', () => {
  const d = withSalary(['2026-08-31', '2026-09-30']);
  const ps = buildPeriods(d, 'persoonlijk', { today: '2026-10-05', mode: 'kalender' });
  assert.deepEqual(spans(ps), [
    ['2026-08-01', '2026-08-31', 'augustus 2026'],
    ['2026-09-01', '2026-09-30', 'september 2026'],
    ['2026-10-01', '2026-10-31', 'oktober 2026'],
  ]);
  // the joint perspective defaults to calendar months
  const j = dataset([tx(JOINT, '2026-09-15', -1000)]);
  assert.equal(buildPeriods(j, 'gemeenschappelijk', { today: '2026-10-02' }).pop().label, 'oktober 2026');
});

test('personal perspective: transfer to joint account = fixed cost, to own savings = savings', () => {
  const ts = [
    tx(ZICHT, '2026-09-01', -1_500_000, { id: 'naar-joint', cp: JOINT }),
    tx(JOINT, '2026-09-01', 1_500_000, { id: 'van-zicht', cp: ZICHT }),
    tx(ZICHT, '2026-09-02', -200_000, { id: 'naar-spaar', cp: SPAAR }),
    tx(SPAAR, '2026-09-02', 200_000, { id: 'op-spaar', cp: ZICHT }),
    tx(ZICHT, '2026-09-03', -100_000, { id: 'naar-boekje', cp: EXTERNAL_SAVINGS }),
    tx(JOINT, '2026-09-04', 1_000_000, { id: 'van-an', cp: CO_OWNER }),
    tx(ZICHT, '2026-09-05', -45_000, { id: 'energie', cp: 'BE00000000000006' }),
    tx(ZICHT, '2026-09-06', -12_000, { id: 'onbekend' }),
    tx(ZICHT, '2026-09-07', -500_000, { id: 'pensioen', cp: 'BE00000000000077' }),
  ];
  const d = dataset(ts, { categories: { 'wonen--energie': ['energie'], 'sparen-beleggen--pensioensparen': ['pensioen'] } });
  assert.deepEqual(perspectiveAccounts(d, 'persoonlijk'), { all: [ZICHT, SPAAR], flow: [ZICHT] });
  const p = makeClassifier(d, 'persoonlijk');
  const flow = (id) => p(d.transactions.find((t) => t.id === id))?.flow ?? null;
  assert.equal(flow('naar-joint'), 'vast');
  assert.equal(p(d.transactions.find((t) => t.id === 'naar-joint')).group, 'bijdrage-gemeenschappelijk');
  assert.equal(flow('naar-spaar'), 'sparen');
  assert.equal(flow('naar-boekje'), 'sparen');
  assert.equal(flow('op-spaar'), null); // the savings account itself is not a flow account
  assert.equal(flow('energie'), 'vast');
  assert.equal(flow('onbekend'), 'variabel');
  assert.equal(flow('pensioen'), 'sparen');
  assert.equal(flow('van-zicht'), null); // joint account: not in the personal perspective
  // joint perspective: my transfer and the co-owner's contribution are income
  const g = makeClassifier(d, 'gemeenschappelijk');
  const gflow = (id) => g(d.transactions.find((t) => t.id === id))?.flow ?? null;
  assert.equal(gflow('van-zicht'), 'inkomen');
  assert.equal(gflow('van-an'), 'inkomen');
  assert.equal(gflow('naar-joint'), null);
});

test('transfers between two current accounts of the same perspective stay neutral', () => {
  const Z2 = 'BE00000000000008';
  const accounts = {
    [ZICHT]: { id: ZICHT, kind: 'zicht', ownership: { type: 'individueel', owners: [] } },
    [Z2]: { id: Z2, kind: 'zicht', ownership: { type: 'individueel', owners: [] } },
  };
  const d = dataset([tx(ZICHT, '2026-09-01', -10_000, { id: 'a', cp: Z2 }), tx(Z2, '2026-09-01', 10_000, { id: 'b', cp: ZICHT })], { accounts });
  const p = makeClassifier(d, 'persoonlijk');
  assert.deepEqual(d.transactions.map((t) => p(t).flow), ['neutraal', 'neutraal']);
});

test('a transaction without category takes the category of its confirmed series for the budget', () => {
  const d0 = dataset([tx(ZICHT, '2026-09-05', -9_990, { id: 's1', cp: 'BE00000000000020' })]);
  const d = { ...d0, recurring: [{ id: 'r', status: 'bevestigd', categoryId: 'abonnementen--streaming', txIds: ['s1'] }] };
  assert.equal(makeClassifier(d, 'persoonlijk')(d.transactions[0]).flow, 'vast');
  assert.equal(makeClassifier(d0, 'persoonlijk')(d0.transactions[0]).flow, 'variabel');
});
