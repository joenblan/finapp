import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyData } from '../src/core/model/schema.js';
import { linkTransfers, isInternal } from '../src/core/transfers.js';
import { categorize, allocationOf, assignManual } from '../src/core/categories/categorize.js';
import { importFile } from '../src/core/import/importer.js';
import { sha256Hex } from '../src/core/hash.js';
import { buildVdkCsv } from '../tools/vdk-builder.js';
import { buildCrelanCsv } from '../tools/crelan-builder.js';

const A = 'BE00000000000001';
const B = 'BE00000000000002';
const J = 'BE00000000000003';
const acc = (id, type = 'individueel') => ({ id, number: id, ownership: { type, owners: type === 'gemeenschappelijk' ? ['Jan', 'An'] : [] } });
const tx = (id, accountId, amount, entryDate, cp, extra = {}) => ({ id, accountId, amount, entryDate, bookingOrder: 1, counterparty: { account: cp ?? '', name: '' }, communication: { text: '' }, ...extra });
const base = (transactions, extra = {}) => ({ ...createEmptyData(), accounts: { [A]: acc(A), [B]: acc(B), [J]: acc(J, 'gemeenschappelijk') }, transactions, ...extra });

test('both sides of a transfer between imported accounts are linked (opposite amount, within 5 days)', () => {
  const d = base([
    tx('a1', A, -150_000, '2026-10-01', J),
    tx('j1', J, 150_000, '2026-10-03', A),
    tx('a2', A, -150_000, '2026-10-20', J), // no counterpart: allowed
    tx('j2', J, 150_000, '2026-10-29', A), // more than 5 days after a2
    tx('b1', B, -20_000, '2026-10-05', A),
    tx('a3', A, 20_000, '2026-10-05', B),
    tx('a4', A, 20_000, '2026-10-06', B), // second candidate, further away
  ]);
  const links = linkTransfers(d);
  assert.equal(links.get('a1'), 'j1');
  assert.equal(links.get('j1'), 'a1');
  assert.equal(links.get('b1'), 'a3');
  assert.equal(links.has('a2'), false);
  assert.equal(links.has('j2'), false);
  assert.equal(links.has('a4'), false);
  const c = categorize(d).data;
  for (const id of ['a1', 'j1', 'a2', 'j2', 'b1', 'a3', 'a4']) assert.equal(allocationOf(c, id).categoryId, 'intern', id);
});

test('transfer to an "own account without CODA" is internal; can be undone per transaction', () => {
  const ext = 'BE00000000000099';
  let d = base([tx('a1', A, -50_000, '2026-10-01', ext), tx('a2', A, -10_000, '2026-10-02', 'BE00000000000077')]);
  assert.equal(isInternal(d.transactions[0], d), false);
  d = { ...d, externalOwnAccounts: [{ iban: ext, name: 'Spaarboekje andere bank' }] };
  d = categorize(d).data;
  assert.equal(allocationOf(d, 'a1').categoryId, 'intern');
  assert.equal(allocationOf(d, 'a2').categoryId, null);
  assert.equal(linkTransfers(d).has('a1'), false); // no counterpart for an external own account
  // undo
  d = categorize({ ...d, annotations: { a1: { notInternal: true } } }, { mode: 'import', newIds: ['a1'] }).data;
  assert.equal(allocationOf(d, 'a1').categoryId, null);
  // a manual choice stays manual even if the transfer is internal
  d = assignManual(d, ['a2'], 'overig--diversen');
  d = categorize({ ...d, externalOwnAccounts: [...d.externalOwnAccounts, { iban: 'BE00000000000077', name: 'x' }] }).data;
  assert.equal(allocationOf(d, 'a2').source, 'manueel');
});

test('contribution of the co-owner: neutral category via co-owner IBAN', () => {
  let d = base([tx('j1', J, 100_000, '2026-10-02', 'BE00000000000011'), tx('j2', J, -100_000, '2026-10-03', 'BE00000000000011')]);
  d = { ...d, accounts: { ...d.accounts, [J]: { ...d.accounts[J], coOwnerIbans: ['BE00000000000011'] } } };
  d = categorize(d).data;
  assert.equal(allocationOf(d, 'j1').categoryId, 'bijdrage-mede-eigenaar');
  assert.equal(allocationOf(d, 'j2').categoryId, null); // outgoing is no contribution
});

test('VDK → Crelan: a transfer between the two banks is recognised on both sides', async () => {
  const imp = async (data, f) => importFile(data, { fileName: f.fileName, bytes: f.bytes, fileHash: await sha256Hex(f.bytes) });
  const vdk = buildVdkCsv({ iban: A, openingBalance: 2_000_000, movements: [{ ref: '1', date: '2026-10-01', amount: -1_500_000, cpIban: J, cpName: 'gemeenschappelijke rekening', comm: 'gemeenschappelijk', type: 'Bestendige opdracht' }] });
  const crelan = buildCrelanCsv({ own: J, movements: [{ date: '2026-10-02', amount: 1_500_000, cp: 'JAN VOORBEELD', cpIban: A, type: 'Overschrijving in uw voordeel', comm: 'gemeenschappelijk' }] });
  const r1 = await imp(createEmptyData(), vdk);
  // before the joint account is known, the transfer is not internal yet
  const vTx = r1.data.transactions[0];
  assert.equal(allocationOf(r1.data, vTx.id).categoryId, null);
  const r2 = await imp(r1.data, crelan);
  assert.equal(r2.report.status, 'ok', JSON.stringify(r2.report.messages));
  const cTx = r2.data.transactions.find((t) => t.accountId === J);
  assert.equal(allocationOf(r2.data, vTx.id).categoryId, 'intern'); // updated by the import of the other side
  assert.equal(allocationOf(r2.data, cTx.id).categoryId, 'intern');
  const links = linkTransfers(r2.data);
  assert.equal(links.get(vTx.id), cTx.id);
  assert.equal(links.get(cTx.id), vTx.id);
});
