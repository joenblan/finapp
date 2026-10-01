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
