import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../src/app/service.js';
import { FolderStore } from '../src/platform/folder-store.js';
import { FakeDir } from '../tools/fake-fs.js';
import { linkState, proposalFor, unlinkedOperations } from '../src/core/invest/settlement.js';
import { makeClassifier } from '../src/core/budget/perspectives.js';
import { periodSummary } from '../src/core/budget/freespace.js';
import { buildPeriods } from '../src/core/budget/periods.js';
import { buildCategoryReport } from '../src/core/report-categories.js';
import { parseQuantity } from '../src/core/invest/units.js';

const BANK = 'BE00000000000061';
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 1, 10, 0, 0) + 1000 * clock++).toISOString();
const btx = (id, date, amount, extra = {}) => ({ id, accountId: BANK, entryDate: date, amount, bookingOrder: Number(id.replace(/\D/g, '')) || 1, counterparty: { account: '', name: 'MEDIRECT' }, communication: { text: '' }, ...extra });

async function setup(transactions) {
  const svc = new AppService(new FolderStore(new FakeDir('F')), { now });
  await svc.load();
  await svc.mutate((d) => ({
    ...d,
    accounts: { [BANK]: { id: BANK, number: BANK, displayName: 'Zicht', kind: 'zicht', currency: 'EUR', ownership: { type: 'individueel', owners: [] } } },
    transactions,
  }));
  await svc.saveInvestAccount({ name: 'Effecten', institution: 'Bank', owners: [{ name: 'Jan', share: 10000 }], cash: { mode: 'afrekenrekening', accountId: BANK } });
  await svc.saveSecurity({ name: 'World ETF', isin: 'IE00B4L5Y983', type: 'etf', distribution: 'kapitaliserend', taxRateId: 'tob-012', regime: 'meerwaarde', referencePrice: null });
  const acc = svc.data.investAccounts[0].id;
  const sec = svc.data.securities[0].id;
  return { svc, acc, sec };
}
const buy = (acc, sec) => ({ investAccountId: acc, securityId: sec, kind: 'aankoop', date: '2026-10-01', quantity: parseQuantity('5'), gross: 500_000, costs: 0, stockTax: 600, withholding: 0 });

test('purchase € 500,00 + tax € 0,60 is proposed for a debit of € 500,60 two days later; € 501,60 shows € 1,00 difference', async () => {
  const { svc, acc, sec } = await setup([btx('b1', '2026-10-03', -500_600)]);
  await svc.saveOperation(buy(acc, sec));
  const op = svc.data.operations[0];
  assert.deepEqual([proposalFor(svc.data, op).tx.id, proposalFor(svc.data, op).diff], ['b1', 0]);
  await svc.linkOperation(op.id, 'b1');
  assert.equal(linkState(svc.data, svc.data.operations[0]).status, 'gekoppeld');
  const other = await setup([btx('b2', '2026-10-03', -501_600)]);
  await other.svc.saveOperation(buy(other.acc, other.sec));
  const st = linkState(other.svc.data, other.svc.data.operations[0]);
  assert.deepEqual([st.status, st.tx.id, st.diff], ['voorstel', 'b2', -1_000]);
  // more than 5 days: no proposal
  const far = await setup([btx('b3', '2026-10-09', -500_600)]);
  await far.svc.saveOperation(buy(far.acc, far.sec));
  assert.equal(linkState(far.svc.data, far.svc.data.operations[0]).status, 'niet-gekoppeld');
  assert.equal(unlinkedOperations(far.svc.data).length, 1);
});

test('linked debit is no expense but savings; linked sale proceeds are no income', async () => {
  const { svc, acc, sec } = await setup([btx('b1', '2026-10-03', -500_600), btx('b2', '2026-10-20', 549_340)]);
  await svc.saveOperation(buy(acc, sec));
  await svc.saveOperation({ investAccountId: acc, securityId: sec, kind: 'verkoop', date: '2026-10-18', quantity: parseQuantity('5'), gross: 550_000, costs: 0, stockTax: 660, withholding: 0 });
  const [b, s] = svc.data.operations;
  await svc.linkOperation(b.id, 'b1');
  await svc.linkOperation(s.id, 'b2');
  const d = svc.data;
  assert.equal(d.allocations.b1[0].categoryId, 'beleggingen--aankoop');
  assert.equal(d.allocations.b2[0].categoryId, 'beleggingen--verkoop');
  const classify = makeClassifier(d, 'persoonlijk');
  assert.equal(classify(d.transactions[0]).flow, 'sparen');
  assert.equal(classify(d.transactions[1]).flow, 'neutraal');
  const dd = { ...d, budget: { ...d.budget, perspectives: { ...d.budget.perspectives, persoonlijk: { ...d.budget.perspectives.persoonlijk, periodMode: 'kalender' } } } };
  const sum = periodSummary(dd, 'persoonlijk', buildPeriods(dd, 'persoonlijk', { today: '2026-10-25' }).pop(), { today: '2026-10-25' });
  assert.deepEqual([sum.spent, sum.income.actual, sum.savings.actual], [0, 0, 500_600]); // the sale is neutral
  const r = buildCategoryReport(d, { from: '2026-10', to: '2026-10', accounts: 'individueel' });
  assert.equal(r.saldo.total, 0); // neither income nor expense
});

test('a bank transaction cannot be linked to two operations; unlinking restores the previous category', async () => {
  const { svc, acc, sec } = await setup([btx('b1', '2026-10-03', -500_600)]);
  await svc.assignCategory(['b1'], 'overig--diversen');
  await svc.saveOperation(buy(acc, sec));
  await svc.saveOperation({ ...buy(acc, sec), date: '2026-10-02' });
  const [o1, o2] = svc.data.operations;
  await svc.linkOperation(o1.id, 'b1');
  await assert.rejects(svc.linkOperation(o2.id, 'b1'), /al gekoppeld/);
  assert.equal(proposalFor(svc.data, svc.data.operations[1]), null); // b1 is taken
  await svc.unlinkOperation(o1.id);
  assert.deepEqual([svc.data.allocations.b1[0].categoryId, svc.data.allocations.b1[0].source], ['overig--diversen', 'manueel']);
  // deleting a linked operation also restores the category
  await svc.linkOperation(o2.id, 'b1');
  await svc.deleteOperation(o2.id);
  assert.equal(svc.data.allocations.b1[0].categoryId, 'overig--diversen');
  // rules / recategorisation keep the investment category while linked
  await svc.linkOperation(o1.id, 'b1');
  await svc.reapplyRules();
  assert.equal(svc.data.allocations.b1[0].categoryId, 'beleggingen--aankoop');
});
