import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netWorthOn, netWorthSeries, netWorthSummary, applyShare } from '../src/core/wealth/wealth.js';
import { SOURCES } from '../src/core/wealth/sources.js';
import { tx, dataset, ZICHT, SPAAR, JOINT } from '../tools/budget-fixtures.js';

const BANK = 'BE00000000000077';

function data() {
  // balances: the last movement of each account carries the balance after it (CSV-like)
  const ts = [
    tx(ZICHT, '2026-07-10', 1_000_000, { id: 'z1', balanceAfter: 1_000_000 }),
    tx(ZICHT, '2026-08-10', -200_000, { id: 'z2', balanceAfter: 800_000 }),
    tx(ZICHT, '2026-09-10', 300_000, { id: 'z3', balanceAfter: 1_100_000 }),
    tx(JOINT, '2026-08-05', 4_000_000, { id: 'j1', balanceAfter: 4_000_000 }),
    tx(JOINT, '2026-09-05', -944_220, { id: 'j2', cp: BANK, balanceAfter: 3_055_780 }),
  ];
  const d = dataset(ts);
  for (const a of Object.values(d.accounts)) a.sourceFormat = 'csv';
  return {
    ...d,
    properties: [{ id: 'w1', name: 'Woning', owners: [{ name: 'Jan', share: 5000 }, { name: 'An', share: 5000 }], valuations: [{ date: '2026-08-01', value: 300_000_000 }] }],
    loans: [{ id: 'l1', name: 'Woonkrediet', status: 'bevestigd', accountId: JOINT, counterparty: { iban: BANK }, borrowers: [{ name: 'Jan', share: 5000 }, { name: 'An', share: 5000 }], checkpoints: [], extraPayments: [], paymentLinks: {},
      tranches: [{ id: 'a', name: 'A', principal: 200_000_000, annualRate: '3', months: 300, firstPaymentDate: '2026-09-05', paymentDay: 5, type: 'annuiteit', rateMethod: 'gelijkwaardig' }] }],
    otherLiabilities: [{ id: 's1', name: 'Autolening', owners: [], values: [{ date: '2026-07-01', value: 5_000_000 }] }],
    wealth: { myName: 'Jan', jointShares: {} },
  };
}

test('applyShare: exact half-up integer arithmetic', () => {
  assert.equal(applyShare(1_001, 5000), 501);
  assert.equal(applyShare(-1_001, 5000), -501);
  assert.equal(applyShare(999_999_999_999_999, 5000), 500_000_000_000_000);
  assert.equal(applyShare(1_000, 3333), 333);
});

test('household: everything 100 %, home not counted before its first valuation', () => {
  const d = data();
  const jul = netWorthOn(d, '2026-07-31', 'huishouden');
  // zicht 1000, joint: no data yet (incomplete, not 0), savings no data, home not valued yet, loan not drawn yet (drawdown 05/08), other debt -5000
  assert.equal(jul.total, 1_000_000 - 5_000_000);
  assert.ok(jul.incomplete.some((i) => i.label === 'Gemeenschappelijk'));
  assert.ok(jul.incomplete.some((i) => i.label === 'Woning'));
  const sep = netWorthOn(d, '2026-09-30', 'huishouden');
  assert.equal(sep.total, 1_100_000 + 3_055_780 + 300_000_000 - 199_549_030 - 5_000_000);
});

test('personal: joint account and home/loan by share', () => {
  const d = data();
  const sep = netWorthOn(d, '2026-09-30', 'persoonlijk');
  assert.equal(sep.total, 1_100_000 + 1_527_890 + 150_000_000 - 99_774_515 - 5_000_000);
  const d2 = { ...data(), wealth: { myName: 'Jan', jointShares: { [JOINT]: 6000 } } };
  assert.equal(netWorthOn(d2, '2026-09-30', 'persoonlijk').groups[0].items.find((i) => i.id === JOINT).counted, 1_833_468);
});

test('series per month end and summary with difference to the previous month', () => {
  const d = data();
  const s = netWorthSeries(d, 'huishouden', { today: '2026-10-01' });
  assert.deepEqual(s.map((m) => m.month), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(s.at(-1).current, true);
  const sum = netWorthSummary(d, 'huishouden', { today: '2026-10-01' });
  assert.equal(sum.diff, sum.now.total - sum.prev.total);
});

test('investments source: no investment accounts -> no items', () => {
  assert.deepEqual(SOURCES.find((s) => s.id === 'beleggingen').items(data(), '2026-09-30', {}), []);
});
