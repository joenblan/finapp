import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, parseDataFile, serializeData, DataFileError } from '../src/core/model/migrations.js';
import { createEmptyData, CURRENT_SCHEMA_VERSION } from '../src/core/model/schema.js';

test('current data needs no migration and round-trips through JSON', () => {
  const d = createEmptyData('2026-01-01T00:00:00.000Z');
  const { data, applied } = parseDataFile(serializeData(d));
  assert.deepEqual(applied, []);
  assert.deepEqual(data, d);
  assert.equal(data.schemaVersion, CURRENT_SCHEMA_VERSION);
});

test('migration chain is applied step by step', () => {
  const d = { ...createEmptyData(), schemaVersion: 1 };
  const migrations = { 1: (x) => ({ ...x, schemaVersion: 2, extra: [] }), 2: (x) => ({ ...x, schemaVersion: 3 }) };
  const { data, applied } = migrate(d, { migrations, target: 3 });
  assert.deepEqual(applied, ['1→2', '2→3']);
  assert.deepEqual(data.extra, []);
});

test('invalid or newer data files are refused', () => {
  assert.throws(() => parseDataFile('{nope'), DataFileError);
  assert.throws(() => parseDataFile('{"app":"iets-anders","schemaVersion":1}'), DataFileError);
  assert.throws(() => migrate({ ...createEmptyData(), schemaVersion: 99 }), /nieuwere versie/);
  assert.throws(() => migrate({ ...createEmptyData(), transactions: [{ id: 'x', amount: 1.5 }] }), /ongeldig bedrag/);
});

test('migration 1→2 of a real v1 data file keeps all data', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('./fixtures/data-v1.json', import.meta.url), 'utf8');
  const v1 = JSON.parse(text);
  assert.equal(v1.schemaVersion, 1);
  const { data, applied } = parseDataFile(text);
  assert.deepEqual(applied, ['1→2']);
  assert.equal(data.schemaVersion, 2);
  // every v1 field of every object is kept unchanged
  for (const [id, acc] of Object.entries(v1.accounts)) {
    for (const [k, v] of Object.entries(acc)) assert.deepEqual(data.accounts[id][k], v, `account ${id}.${k}`);
    assert.equal(data.accounts[id].sourceFormat, 'coda');
  }
  assert.equal(data.accounts[Object.keys(v1.accounts).find((k) => v1.accounts[k].displayName === 'Mijn zichtrekening')].ownership.type, 'gemeenschappelijk');
  assert.deepEqual(data.statements, v1.statements);
  assert.deepEqual(data.fileHashes, v1.fileHashes);
  assert.equal(data.transactions.length, v1.transactions.length);
  for (const t1 of v1.transactions) {
    const t2 = data.transactions.find((t) => t.id === t1.id);
    for (const [k, v] of Object.entries(t1)) assert.deepEqual(t2[k], v, `tx ${t1.id}.${k}`);
    assert.equal(t2.source, 'coda');
    assert.ok(Number.isInteger(t2.bookingOrder) && t2.bookingOrder > 0);
  }
  for (const [i, imp] of v1.imports.entries()) for (const [k, v] of Object.entries(imp)) assert.deepEqual(data.imports[i][k], v);
  assert.equal(data.settings.backupRetention, v1.settings.backupRetention);
  for (const key of ['profiles', 'possibleDuplicates']) assert.deepEqual(data[key], []);
  for (const key of ['balanceSnapshots', 'controlBalances', 'removedTransactions', 'annotations']) assert.deepEqual(data[key], {});
  // booking order follows statement/sequence order
  const zicht = data.transactions.filter((t) => t.accountId === data.transactions[0].accountId).sort((a, b) => a.bookingOrder - b.bookingOrder);
  assert.deepEqual(zicht.map((t) => t.sequence), [...zicht.map((t) => t.sequence)].sort((a, b) => a - b));
});
