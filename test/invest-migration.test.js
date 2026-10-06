import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataFile } from '../src/core/model/migrations.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { paramsFor, defaultFiscalParams } from '../src/core/fiscal/params.js';

test('migration 8→9 adds the investment collections and categories without losing data', async () => {
  const { readFile } = await import('node:fs/promises');
  const v4 = await readFile(new URL('./fixtures/data-v4.json', import.meta.url), 'utf8');
  const v8 = parseDataFile(v4, { target: 8 }).data;
  const { data, applied } = parseDataFile(JSON.stringify(v8));
  assert.deepEqual(applied, ['8→9']);
  assert.equal(data.schemaVersion, 9);
  for (const key of Object.keys(v8)) if (!['schemaVersion', 'categories'].includes(key)) assert.deepEqual(data[key], v8[key], key);
  for (const c of v8.categories) assert.deepEqual(data.categories.find((x) => x.id === c.id), c);
  const cat = (id) => data.categories.find((c) => c.id === id);
  assert.deepEqual([cat('beleggingen--aankoop').kind, cat('beleggingen--aankoop').budgetType], ['neutraal', 'sparen']);
  assert.equal(cat('beleggingen--verkoop').kind, 'neutraal');
  assert.equal(cat('beleggingen--dividend').kind, 'inkomst');
  for (const key of ['investAccounts', 'securities', 'operations', 'pension']) assert.deepEqual(data[key], []);
  assert.deepEqual(data.prices, {});
  assert.deepEqual(data.fiscal.params[2026], defaultFiscalParams());
});

test('fiscal parameters: per year, falling back to the latest earlier year', () => {
  const d = createEmptyData();
  const p2027 = { ...defaultFiscalParams(), staleDays: 20 };
  d.fiscal.params[2027] = p2027;
  assert.equal(paramsFor(d, 2026).staleDays, 35);
  assert.equal(paramsFor(d, 2027).staleDays, 20);
  assert.equal(paramsFor(d, 2030).staleDays, 20);
  assert.equal(paramsFor(d, 2020).staleDays, 35);
});
