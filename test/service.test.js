import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../src/app/service.js';
import { FolderStore, DATA_FILE } from '../src/platform/folder-store.js';
import { FakeDir } from '../tools/fake-fs.js';
import { buildStatement, toFileText, IBAN_A, IBAN_B, IBAN_C } from '../tools/coda-builder.js';

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 1, 10, 0, 0) + 1000 * clock++).toISOString();

function twoAccountFile() {
  const a = buildStatement({ iban: IBAN_A, statementNumber: 1, oldBalance: 100_000, oldDate: '2026-09-01', newDate: '2026-09-02', movements: [{ seq: 1, amount: -2_500, communication: 'x', counterparty: { iban: IBAN_C, name: 'C' } }], last: false });
  const b = buildStatement({ iban: IBAN_B, statementNumber: 1, oldBalance: 0, oldDate: '2026-09-01', newDate: '2026-09-02', movements: [{ seq: 1, amount: 7_000, communication: 'y' }] });
  return toFileText([...a.lines, ...b.lines]);
}

async function setup() {
  const root = new FakeDir('Financien');
  const svc = new AppService(new FolderStore(root), { now });
  await svc.load();
  return { root, svc };
}

test('first use creates the folder structure and data file', async () => {
  const { root } = await setup();
  assert.deepEqual([...root.dirs.keys()].sort(), ['archief', 'backups', 'fout', 'inbox']);
  assert.ok(root.files.has(DATA_FILE));
  assert.equal(JSON.parse(root.text(DATA_FILE)).schemaVersion, 4);
});

test('inbox scan imports, moves to archief, writes data and a backup', async () => {
  const { root, svc } = await setup();
  const inbox = root.dirs.get('inbox');
  inbox.put('uittreksel.cod', twoAccountFile());
  const reports = await svc.scanInbox();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, 'ok');
  assert.deepEqual(inbox.names(), []);
  assert.deepEqual(root.dirs.get('archief').names(), ['uittreksel.cod']);
  assert.equal(root.dirs.get('backups').names().length, 1);
  const saved = JSON.parse(root.text(DATA_FILE));
  assert.equal(Object.keys(saved.accounts).length, 2);
  assert.equal(saved.transactions.length, 2);

  // the same file dropped again: skipped, archived, still 2 transactions
  inbox.put('uittreksel.cod', twoAccountFile());
  const again = await svc.scanInbox();
  assert.equal(again[0].status, 'overgeslagen');
  assert.deepEqual(root.dirs.get('archief').names(), ['uittreksel (2).cod', 'uittreksel.cod']);
  assert.equal(JSON.parse(root.text(DATA_FILE)).transactions.length, 2);
});

test('a failing file goes to fout/ with a readable report', async () => {
  const { root, svc } = await setup();
  root.dirs.get('inbox').put('kapot.cod', '0000001102699905        X\n');
  const [r] = await svc.scanInbox();
  assert.equal(r.status, 'fout');
  assert.deepEqual(root.dirs.get('fout').names(), ['kapot.cod', 'kapot.cod.fout.txt']);
  assert.match(root.dirs.get('fout').text('kapot.cod.fout.txt'), /Resultaat: Mislukt/);
});

test('backups rotate and can be restored', async () => {
  const { root, svc } = await setup();
  svc.data.settings.backupRetention = 3;
  for (let i = 0; i < 5; i++) await svc.importUploads([{ name: `leeg${i}.txt`, bytes: new TextEncoder().encode(`x${i}`) }]);
  const backups = await svc.listBackups();
  assert.equal(backups.length, 3);
  // restore the oldest remaining backup
  const before = svc.data.imports.length;
  await svc.restoreBackup(backups[2].name);
  assert.ok(svc.data.imports.length < before);
  assert.equal(JSON.parse(root.text(DATA_FILE)).imports.length, svc.data.imports.length);
});

test('account settings are validated and saved', async () => {
  const { root, svc } = await setup();
  root.dirs.get('inbox').put('u.cod', twoAccountFile());
  await svc.scanInbox();
  await svc.updateAccount(IBAN_A, { displayName: 'Gezamenlijk', kind: 'zicht', ownership: { type: 'gemeenschappelijk', owners: ['Jan', 'An'] } });
  const saved = JSON.parse(root.text(DATA_FILE)).accounts[IBAN_A];
  assert.equal(saved.displayName, 'Gezamenlijk');
  assert.deepEqual(saved.ownership, { type: 'gemeenschappelijk', owners: ['Jan', 'An'] });
  await assert.rejects(svc.updateAccount(IBAN_A, { kind: 'raar' }));
  await assert.rejects(svc.updateAccount(IBAN_A, { ownership: { type: 'gemeenschappelijk', owners: ['Jan'] } }));
});

test('an older data file is backed up before it is migrated', async () => {
  const { readFile } = await import('node:fs/promises');
  const v1text = await readFile(new URL('./fixtures/data-v1.json', import.meta.url), 'utf8');
  const root = new FakeDir('Financien');
  root.put(DATA_FILE, v1text);
  const svc = new AppService(new FolderStore(root), { now });
  await svc.load();
  assert.deepEqual(svc.lastMigration, ['1→2', '2→3', '3→4']);
  const backups = root.dirs.get('backups');
  assert.equal(backups.names().length, 1);
  assert.equal(backups.text(backups.names()[0]), v1text); // exact pre-migration copy
  const saved = JSON.parse(root.text(DATA_FILE));
  assert.equal(saved.schemaVersion, 4);
  assert.equal(saved.transactions.length, JSON.parse(v1text).transactions.length);
});

test('control balances, possible duplicates and profiles via the service', async () => {
  const { buildVdkCsv } = await import('../tools/vdk-builder.js');
  const { root, svc } = await setup();
  const acc = 'BE00000000000001';
  const m = (ref, date, amount, extra = {}) => ({ ref, date, amount, cpIban: 'BE00000000000005', cpName: 'X', comm: 'Abonnement', ...extra });
  const e1 = buildVdkCsv({ iban: acc, movements: [m('1', '2026-09-01', 1000), m('2', '2026-09-02', -50)] });
  root.dirs.get('inbox').put(e1.fileName, e1.bytes);
  await svc.scanInbox();
  const e2 = buildVdkCsv({ iban: acc, openingBalance: 950, movements: [m('3', '2026-09-02', -50)] });
  const [rep] = await svc.importUploads([{ name: 'tweede.csv', bytes: e2.bytes }]);
  assert.equal(rep.possibleDuplicates, 1, JSON.stringify(rep.messages));
  const item = svc.data.possibleDuplicates[0];
  await svc.resolvePossibleDuplicate(item.id, 'verwijderd');
  assert.equal(svc.data.transactions.length, 2);
  assert.ok(svc.data.removedTransactions[item.txId]);
  await assert.rejects(svc.resolvePossibleDuplicate(item.id, 'behouden'), /al afgehandeld/);
  // re-importing the same export never brings the removed movement back
  const e2b = buildVdkCsv({ iban: acc, openingBalance: 950, movements: [m('3', '2026-09-02', -50)], trailingEmpty: 2 });
  const [rep2] = await svc.importUploads([{ name: 'derde.csv', bytes: e2b.bytes }]);
  assert.equal(rep2.newTransactions, 0);
  assert.equal(svc.data.transactions.length, 2);
  // control balance
  await svc.addControlBalance(acc, { date: '2026-09-02', balance: 900 });
  await assert.rejects(svc.addControlBalance(acc, { date: '2026-09-02', balance: 1 }), /al een controlesaldo/);
  const saved = JSON.parse(root.text(DATA_FILE));
  assert.equal(saved.controlBalances[acc][0].balance, 900);
  // profiles
  await assert.rejects(svc.saveProfile({ id: 'vdk' }), /gereserveerd/);
});

test('Crelan: confirm a new account, mark a movement in another currency as seen', async () => {
  const { buildCrelanCsv } = await import('../tools/crelan-builder.js');
  const { accountSummaries } = await import('../src/core/status.js');
  const { root, svc } = await setup();
  const own = 'BE00000000000003';
  const f = buildCrelanCsv({ own, movements: [{ date: '2025-01-27', amount: 1_000, cp: 'A', cpIban: 'BE00000000000005' }, { date: '2025-01-28', amount: -500, cp: 'SHOP USA', currency: 'USD', comm: 'x', balanceAfter: 400 }] });
  root.dirs.get('inbox').put(f.fileName, f.bytes);
  const [rep] = await svc.scanInbox();
  assert.equal(rep.profileId, 'crelan', JSON.stringify(rep.messages));
  assert.equal(svc.data.accounts[own].ownershipConfirmed, false);
  await assert.rejects(svc.confirmAccount(own, { kind: 'zicht', ownership: { type: 'gemeenschappelijk', owners: ['Jan'] } }), /minstens twee/);
  assert.equal(svc.data.accounts[own].ownershipConfirmed, false); // nothing half-saved
  await svc.confirmAccount(own, { kind: 'zicht', ownership: { type: 'gemeenschappelijk', owners: ['Jan', 'An'] } });
  const saved = JSON.parse(root.text(DATA_FILE)).accounts[own];
  assert.equal(saved.ownershipConfirmed, true);
  assert.deepEqual(saved.ownership.owners, ['Jan', 'An']);
  const usd = svc.data.transactions.find((t) => t.foreignCurrency);
  assert.ok(accountSummaries(svc.data)[0].issues.some((i) => /andere munt/.test(i.message)));
  await svc.markCurrencyChecked(usd.id);
  assert.equal(svc.data.annotations[usd.id].currencyChecked, true);
  assert.ok(!accountSummaries(svc.data)[0].issues.some((i) => /andere munt/.test(i.message)));
});
