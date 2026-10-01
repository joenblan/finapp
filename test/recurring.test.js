import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSeries, syncRecurring, nextOccurrence, yearlyCost, makeManualSeries } from '../src/core/budget/recurring.js';
import { syncAlerts, openAlerts } from '../src/core/budget/alerts.js';
import { tx, dataset, ZICHT } from '../tools/budget-fixtures.js';

const NETFLIX = 'BE00000000000020';
const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const monthly = (shift = [0, 2, -3, 1, 3, -2, 0], amounts = [9_990, 10_250, 9_800, 9_990, 10_400, 9_990, 9_990]) =>
  months.map((m, i) => {
    const day = 15 + shift[i];
    return tx(ZICHT, `${m}-${String(day).padStart(2, '0')}`, -amounts[i], { cp: NETFLIX, name: 'STREAMING BV', bankType: 'Domiciliëring', id: `nf${i}` });
  });

test('detection: monthly series with varying day (±3) and slightly varying amount', () => {
  const found = detectSeries(monthly());
  assert.equal(found.length, 1);
  const s = found[0];
  assert.equal(s.interval, 'maand');
  assert.equal(s.txIds.length, 7);
  assert.equal(s.day, 15);
  assert.equal(s.expectedAmount, -9_990);
  assert.equal(s.direction, 'uit');
  assert.ok(s.confidence >= 0.8, String(s.confidence));
  assert.equal(nextOccurrence(s, s.lastDate), '2026-10-15');
  assert.deepEqual(yearlyCost(s), { yearly: -119_880, monthly: -9_990 });
});

test('detection: yearly series with 2 occurrences; quarterly; weekly', () => {
  const yearly = [tx(ZICHT, '2025-03-12', -320_000, { cp: 'BE00000000000030', name: 'VERZEKERING NV' }), tx(ZICHT, '2026-03-10', -335_000, { cp: 'BE00000000000030', name: 'VERZEKERING NV' })];
  const [y] = detectSeries(yearly);
  assert.equal(y.interval, 'jaar');
  assert.equal(nextOccurrence(y, y.lastDate), '2027-03-10'); // median day of 12 and 10
  const quarterly = ['2025-12-05', '2026-03-04', '2026-06-06', '2026-09-05'].map((dt) => tx(ZICHT, dt, -55_000, { cp: 'BE00000000000031', name: 'WATER' }));
  assert.equal(detectSeries(quarterly)[0].interval, 'kwartaal');
  const weekly = ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22', '2026-08-29', '2026-09-05'].map((dt) => tx(ZICHT, dt, -20_000, { name: 'KRANTENWINKEL' }));
  const [w] = detectSeries(weekly);
  assert.equal(w.interval, 'week');
  assert.equal(w.txIds.length, 6);
});

test('detection: no false series for random purchases at the same shop', () => {
  // 3 to 6 purchases per month, random days and amounts
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ts = [];
  for (const m of months) {
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const day = 1 + Math.floor(rnd() * 28);
      ts.push(tx(ZICHT, `${m}-${String(day).padStart(2, '0')}`, -(15_000 + Math.floor(rnd() * 80) * 1_000), { name: 'SUPERMARKT VOORBEELD' }));
    }
  }
  assert.deepEqual(detectSeries(ts), []);
  // even with a real subscription mixed in for another counterparty
  assert.equal(detectSeries([...ts, ...monthly()]).length, 1);
});

test('two different series at the same counterparty are both found', () => {
  const a = months.map((m, i) => tx(ZICHT, `${m}-05`, -9_990, { cp: NETFLIX, id: `a${i}` }));
  const b = months.map((m, i) => tx(ZICHT, `${m}-20`, -4_990, { cp: NETFLIX, id: `b${i}` }));
  const found = detectSeries([...a, ...b]).map((s) => [s.day, s.expectedAmount]).sort();
  assert.deepEqual(found, [[20, -4_990], [5, -9_990]].sort());
});

function confirmAll(d) {
  return { ...d, recurring: d.recurring.map((s) => (s.status === 'voorstel' ? { ...s, status: 'bevestigd' } : s)) };
}

test('alerts: new series, price increase, missed payment, stopped series; dismissed stays dismissed', () => {
  const base = monthly().slice(0, 5); // March .. July
  let d = syncAlerts(syncRecurring(dataset(base), { now: 'n1' }));
  assert.equal(d.recurring.length, 1);
  assert.deepEqual(openAlerts(d).map((a) => a.type), ['nieuwe-reeks']);
  d = confirmAll(d);
  d = syncAlerts(d);
  assert.deepEqual(openAlerts(d).map((a) => a.type), []); // proposal confirmed: alert resolved
  // August: price increase to 11,99 (+20 %, ≥ € 1)
  d = { ...d, transactions: [...d.transactions, tx(ZICHT, '2026-08-14', -11_990, { cp: NETFLIX, name: 'STREAMING BV', id: 'aug' })] };
  d = syncAlerts(syncRecurring(d));
  assert.deepEqual(d.recurring[0].txIds.slice(-1), ['aug']);
  assert.equal(d.recurring[0].expectedAmount, -11_990);
  const price = openAlerts(d).find((a) => a.type === 'prijsstijging');
  assert.match(price.message, /€ 10,40 naar € 11,99/);
  // dismiss it: it never comes back
  d = { ...d, alerts: d.alerts.map((a) => (a.id === price.id ? { ...a, dismissedAt: 'x' } : a)) };
  d = syncAlerts(syncRecurring(d));
  assert.equal(openAlerts(d).filter((a) => a.type === 'prijsstijging').length, 0);
  // a small increase (+0,20, < € 1) gives no alert
  d = { ...d, transactions: [...d.transactions, tx(ZICHT, '2026-09-15', -12_190, { cp: NETFLIX, name: 'STREAMING BV', id: 'sep' })] };
  d = syncAlerts(syncRecurring(d));
  assert.equal(openAlerts(d).filter((a) => a.type === 'prijsstijging').length, 0);
  // October payment (due 15/10) missing; data reaches 25/10 (other transaction)
  d = { ...d, transactions: [...d.transactions, tx(ZICHT, '2026-10-25', -1_000, { name: 'BAKKER' })] };
  d = syncAlerts(syncRecurring(d));
  assert.deepEqual(openAlerts(d).map((a) => a.type), ['uitgebleven']);
  assert.match(openAlerts(d)[0].message, /16\/10\/2026/); // the series' median day is 16
  // it arrives late after all: alert resolved
  const late = { ...d, transactions: [...d.transactions, tx(ZICHT, '2026-10-19', -12_190, { cp: NETFLIX, name: 'STREAMING BV', id: 'okt' })] };
  assert.deepEqual(openAlerts(syncAlerts(syncRecurring(late))).map((a) => a.type), []);
  // ... or not: data reaches 2026-12-25 => series looks stopped (2 intervals missed)
  d = { ...d, transactions: [...d.transactions, tx(ZICHT, '2026-12-25', -1_000, { name: 'BAKKER' })] };
  d = syncAlerts(syncRecurring(d));
  assert.deepEqual(openAlerts(d).map((a) => a.type), ['gestopt']);
});

test('a rejected proposal does not come back', () => {
  let d = syncRecurring(dataset(monthly()));
  d = { ...d, recurring: d.recurring.map((s) => ({ ...s, status: 'geweigerd' })) };
  d = { ...d, transactions: [...d.transactions, tx(ZICHT, '2026-10-15', -9_990, { cp: NETFLIX, name: 'STREAMING BV' })] };
  d = syncAlerts(syncRecurring(d));
  assert.deepEqual(d.recurring.map((s) => s.status), ['geweigerd']);
  assert.deepEqual(openAlerts(d), []);
});

test('manual series: yearly cost without history, matched when it arrives', () => {
  let d = dataset([tx(ZICHT, '2026-09-01', -1_000, { name: 'X' })]);
  const s = makeManualSeries(d, { accountId: ZICHT, name: 'Kadaster', interval: 'jaar', expectedAmount: -95_000, startDate: '2026-11-20', categoryId: 'belastingen--andere-belastingen' }, 'now');
  d = { ...d, recurring: [s] };
  assert.equal(nextOccurrence(s, '2026-10-01'), '2026-11-20');
  d = { ...d, transactions: [...d.transactions, tx(ZICHT, '2026-11-22', -97_000, { name: 'KADASTER', id: 'kad' })] };
  d = syncRecurring(d);
  assert.deepEqual(d.recurring[0].txIds, ['kad']);
  assert.equal(nextOccurrence(d.recurring[0], d.recurring[0].lastDate), '2027-11-20');
});

test('detection: a price increase in the latest payment does not end the series', () => {
  const ts = months.map((m, i) => tx(ZICHT, `${m}-05`, i === months.length - 1 ? -11_990 : -9_990, { cp: NETFLIX, name: 'STREAMING BV' }));
  const [s] = detectSeries(ts);
  assert.equal(s.txIds.length, 7);
  assert.equal(s.expectedAmount, -11_990);
  assert.equal(s.lastDate, '2026-09-05');
});
