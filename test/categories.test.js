import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../src/core/model/schema.js';
import { addCategory, updateCategory, deleteCategory, mergeCategory, categoryLabel } from '../src/core/categories/categories.js';
import { categorize, assignManual, resetToAutomatic, rulePreview, allocationOf } from '../src/core/categories/categorize.js';
import { ruleMatches, suggestConditions, validateRule } from '../src/core/categories/rules.js';
import { importFile } from '../src/core/import/importer.js';
import { sha256Hex } from '../src/core/hash.js';
import { buildVdkCsv } from '../tools/vdk-builder.js';

const ACC = 'BE00000000000001';
const tx = (id, amount, extra = {}) => ({
  id, accountId: ACC, amount, entryDate: '2026-03-01', bookingOrder: 1,
  counterparty: { account: '', name: '' }, communication: { text: '', structured: null }, ...extra,
});
function dataWith(transactions, rules = []) {
  const d = createEmptyData();
  return { ...d, accounts: { [ACC]: { id: ACC, ownership: { type: 'individueel', owners: [] } } }, transactions, rules };
}
const rule = (id, categoryId, conditions) => ({ id, name: id, categoryId, enabled: true, conditions });

test('rule conditions: all must match, text case-insensitive', () => {
  const t = tx('a', -45_000, { counterparty: { account: 'BE00000000000006', name: 'Energie NV' }, communication: { text: 'Voorschot MAART' } });
  assert.ok(ruleMatches(rule('r', 'x', { nameContains: 'energie' }), t));
  assert.ok(ruleMatches(rule('r', 'x', { communicationContains: 'voorschot maart', direction: 'uit', minAbs: 40_000, maxAbs: 50_000, accountId: ACC }), t));
  assert.ok(ruleMatches(rule('r', 'x', { counterpartyIban: 'be00 0000 0000 0006' }), t));
  assert.ok(!ruleMatches(rule('r', 'x', { nameContains: 'energie', direction: 'in' }), t));
  assert.ok(!ruleMatches(rule('r', 'x', { maxAbs: 10_000 }), t));
  assert.ok(!ruleMatches(rule('r', 'x', {}), t)); // no conditions: never matches
  assert.ok(!ruleMatches({ ...rule('r', 'x', { nameContains: 'energie' }), enabled: false }, t));
});

test('rule order: the first matching rule wins', () => {
  const t = tx('a', -45_000, { counterparty: { account: '', name: 'Energie NV' } });
  const d1 = categorize(dataWith([t], [rule('r1', 'wonen--energie', { nameContains: 'energie' }), rule('r2', 'overig--diversen', { direction: 'uit' })])).data;
  assert.deepEqual(allocationOf(d1, 'a'), { categoryId: 'wonen--energie', source: 'regel', ruleId: 'r1', amount: -45_000 });
  const d2 = categorize(dataWith([t], [rule('r2', 'overig--diversen', { direction: 'uit' }), rule('r1', 'wonen--energie', { nameContains: 'energie' })])).data;
  assert.equal(allocationOf(d2, 'a').ruleId, 'r2');
});

test('a manual choice is never overwritten when rules are re-applied', () => {
  const t = tx('a', -45_000, { counterparty: { account: '', name: 'Energie NV' } });
  let d = dataWith([t, tx('b', -10_000, { counterparty: { account: '', name: 'Energie NV' } })], [rule('r1', 'wonen--energie', { nameContains: 'energie' })]);
  d = assignManual(d, ['a'], 'vrije-tijd--hobby');
  d = categorize(d, { mode: 'all' }).data;
  assert.deepEqual(allocationOf(d, 'a'), { categoryId: 'vrije-tijd--hobby', amount: -45_000, source: 'manueel', ruleId: null });
  assert.equal(allocationOf(d, 'b').categoryId, 'wonen--energie');
  // back to automatic
  d = resetToAutomatic(d, ['a']);
  assert.equal(allocationOf(d, 'a').ruleId, 'r1');
});

test('a rule is applied at import; existing rule results stay until re-applied', async () => {
  const movements = [
    { ref: '1', date: '2026-03-01', amount: -45_000, cpIban: 'BE00000000000006', cpName: 'ENERGIE NV', comm: 'voorschot' },
    { ref: '2', date: '2026-03-02', amount: -9_990, cpIban: 'BE00000000000007', cpName: 'STREAMING BV', comm: 'abonnement' },
  ];
  const base = { ...createEmptyData(), rules: [rule('r-energie', 'wonen--energie', { counterpartyIban: 'BE00000000000006' })] };
  const f = buildVdkCsv({ iban: ACC, movements });
  const r = importFile(base, { fileName: f.fileName, bytes: f.bytes, fileHash: await sha256Hex(f.bytes) });
  assert.equal(r.report.status, 'ok', JSON.stringify(r.report.messages));
  const energy = r.data.transactions.find((t) => t.bankReference === '1');
  const stream = r.data.transactions.find((t) => t.bankReference === '2');
  assert.deepEqual(allocationOf(r.data, energy.id), { categoryId: 'wonen--energie', source: 'regel', ruleId: 'r-energie', amount: -45_000 });
  assert.equal(allocationOf(r.data, stream.id).source, 'geen');
  // a new rule does not touch existing transactions at the next import ...
  const withRule = { ...r.data, rules: [...r.data.rules, rule('r-stream', 'abonnementen--streaming', { nameContains: 'streaming' })] };
  const f2 = buildVdkCsv({ iban: ACC, openingBalance: -54_990, movements: [{ ref: '3', date: '2026-03-03', amount: -9_990, cpIban: 'BE00000000000007', cpName: 'STREAMING BV', comm: 'abonnement' }] });
  const r2 = importFile(withRule, { fileName: 'b.csv', bytes: f2.bytes, fileHash: await sha256Hex(f2.bytes) });
  assert.equal(allocationOf(r2.data, stream.id).source, 'geen');
  assert.equal(allocationOf(r2.data, r2.data.transactions.find((t) => t.bankReference === '3').id).ruleId, 'r-stream');
  // ... until "Regels opnieuw toepassen"
  const re = categorize(r2.data, { mode: 'all' });
  assert.equal(allocationOf(re.data, stream.id).ruleId, 'r-stream');
  assert.equal(re.changed, 1);
});

test('rule preview counts matching and actually affected transactions', () => {
  const ts = [tx('a', -1, { counterparty: { name: 'X shop' } }), tx('b', -2, { counterparty: { name: 'X shop' } }), tx('c', -3, { counterparty: { name: 'Y' } })];
  let d = assignManual(dataWith(ts), ['a'], 'overig--diversen');
  const p = rulePreview(d, rule('new', 'boodschappen--supermarkt', { nameContains: 'x shop' }));
  assert.deepEqual(p, { matching: 2, applied: 1 });
  const s = suggestConditions(ts[0]);
  assert.equal(s.nameContains, 'X shop');
  assert.equal(s.direction, 'uit');
  assert.throws(() => validateRule(rule('z', 'boodschappen', {}), d.categories), /minstens één voorwaarde/);
});

test('categories: add, rename, delete with target, merge, system protected', () => {
  let d = dataWith([tx('a', -1), tx('b', -2)], [rule('r1', 'vrije-tijd--hobby', { nameContains: 'x' })]);
  const { data: d1, category } = addCategory(d, { name: 'Huisdieren', parentId: null, kind: 'uitgave' });
  assert.equal(category.id, 'huisdieren');
  const { data: d2, category: sub } = addCategory(d1, { name: 'Dierenarts', parentId: 'huisdieren' });
  assert.equal(sub.kind, 'uitgave');
  assert.throws(() => addCategory(d2, { name: 'Te diep', parentId: sub.id }), /twee niveaus/);
  assert.equal(categoryLabel(updateCategory(d2, sub.id, { name: 'Dierenzorg' }), sub.id), 'Huisdieren › Dierenzorg');
  let d3 = assignManual(d2, ['a'], sub.id);
  d3 = assignManual(d3, ['b'], 'vrije-tijd--hobby');
  // deleting the main category also removes the sub; its transactions move to the target
  const { data: d4, moved } = deleteCategory(d3, 'huisdieren', 'overig--diversen');
  assert.equal(moved, 1);
  assert.equal(allocationOf(d4, 'a').categoryId, 'overig--diversen');
  assert.equal(allocationOf(d4, 'a').source, 'manueel');
  assert.ok(!d4.categories.some((c) => c.id === sub.id));
  // merge moves transactions and rules
  const { data: d5 } = mergeCategory(d4, 'vrije-tijd--hobby', 'vrije-tijd--uitstappen');
  assert.equal(allocationOf(d5, 'b').categoryId, 'vrije-tijd--uitstappen');
  assert.equal(d5.rules[0].categoryId, 'vrije-tijd--uitstappen');
  // delete without target: uncategorised, rules removed
  const { data: d6 } = deleteCategory(d5, 'vrije-tijd--uitstappen', null);
  assert.equal(allocationOf(d6, 'b').source, 'geen');
  assert.equal(d6.rules.length, 0);
  assert.throws(() => deleteCategory(d6, 'intern', 'overig'), /systeemcategorie/);
});
