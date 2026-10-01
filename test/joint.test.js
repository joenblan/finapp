import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../src/core/model/schema.js';
import { jointSummary, validateJointMark } from '../src/core/joint.js';
import { categorize, allocationOf, assignManual } from '../src/core/categories/categorize.js';

const ME = 'BE00000000000001';
const J = 'BE00000000000003';
const tx = (id, accountId, amount, entryDate, cp = '') => ({ id, accountId, amount, entryDate, bookingOrder: 1, counterparty: { account: cp, name: '' }, communication: { text: '' } });
function data(transactions, jointMarks = {}) {
  return {
    ...createEmptyData(),
    settings: { backupRetention: 30, myName: 'Jan' },
    accounts: {
      [ME]: { id: ME, displayName: 'Jan zicht', ownership: { type: 'individueel', owners: [] } },
      [J]: { id: J, displayName: 'Gemeenschappelijk', ownership: { type: 'gemeenschappelijk', owners: ['Jan', 'An'] } },
    },
    transactions,
    jointMarks,
  };
}
const bal = (s) => Object.fromEntries(s.persons.map((p) => [p.name, p.balance]));

test('running balance with advances and repayments in both directions', () => {
  const txs = [
    tx('energie', ME, -100_000, '2026-10-01', 'BE00000000000006'), // Jan pays a joint cost from his own account
    tx('kapper', J, -30_000, '2026-10-02', ''), // joint account pays a personal cost of An
    tx('terug-jan', J, -60_000, '2026-10-05', ME), // joint account repays Jan (part)
    tx('terug-jan-ontv', ME, 60_000, '2026-10-05', J), // the other side, also marked: counted once
    tx('an-stort', J, 30_000, '2026-10-06', 'BE00000000000011'), // An repays the joint account
  ];
  let d = data(txs);
  const marks = {
    energie: validateJointMark(d, 'energie', { type: 'voorschot', jointAccountId: J }),
    kapper: validateJointMark(d, 'kapper', { type: 'voorschot', jointAccountId: J, person: 'An' }),
  };
  d = { ...d, jointMarks: marks };
  assert.deepEqual(bal(jointSummary(d, J)), { Jan: 100_000, An: -30_000 });
  marks['terug-jan'] = validateJointMark(d, 'terug-jan', { type: 'terugbetaling', jointAccountId: J, person: 'Jan', linkedTo: ['energie'] });
  marks['terug-jan-ontv'] = validateJointMark(d, 'terug-jan-ontv', { type: 'terugbetaling', jointAccountId: J });
  d = { ...d, jointMarks: { ...marks } };
  let s = jointSummary(d, J);
  assert.deepEqual(bal(s), { Jan: 40_000, An: -30_000 });
  assert.equal(s.items.find((i) => i.tx.id === 'energie').open, 40_000);
  assert.equal(s.items.find((i) => i.tx.id === 'terug-jan-ontv').counted, false);
  marks['an-stort'] = validateJointMark(d, 'an-stort', { type: 'terugbetaling', jointAccountId: J, person: 'An', linkedTo: ['kapper'] });
  d = { ...d, jointMarks: { ...marks } };
  s = jointSummary(d, J);
  assert.deepEqual(bal(s), { Jan: 40_000, An: 0 });
  assert.equal(s.items.find((i) => i.tx.id === 'kapper').open, 0);
  assert.equal(s.items.find((i) => i.tx.id === 'an-stort').open, 0);
});

test('a marked transaction keeps its category', () => {
  let d = data([tx('energie', ME, -100_000, '2026-10-01', 'BE00000000000006')]);
  d = assignManual(categorize(d).data, ['energie'], 'wonen--energie');
  d = { ...d, jointMarks: { energie: validateJointMark(d, 'energie', { type: 'voorschot', jointAccountId: J }) } };
  assert.equal(allocationOf(d, 'energie').categoryId, 'wonen--energie');
});

test('mark validation', () => {
  const d = data([tx('a', ME, -1, '2026-10-01'), tx('j', J, -1, '2026-10-01')]);
  assert.throws(() => validateJointMark(d, 'j', { type: 'voorschot', jointAccountId: J, person: 'Piet' }), /mede-eigenaar/);
  assert.throws(() => validateJointMark(d, 'a', { type: 'voorschot', jointAccountId: ME }), /gemeenschappelijke rekening/);
  assert.throws(() => validateJointMark({ ...d, settings: { myName: null } }, 'a', { type: 'voorschot', jointAccountId: J }), /wie jij bent/);
  assert.throws(() => validateJointMark(d, 'j', { type: 'voorschot', jointAccountId: J, person: 'An', linkedTo: ['a'] }), /Enkel een terugbetaling/);
  assert.equal(validateJointMark(d, 'a', { type: 'voorschot', jointAccountId: J }).person, 'Jan');
});
