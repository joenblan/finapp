import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStructure, guessHeaderRow, guessDateFormat, guessDecimal, metadataKeys, buildProfile } from '../src/core/csv/wizard-helpers.js';
import { validateProfile } from '../src/core/csv/profile-check.js';
import { parseCsvExport } from '../src/core/csv/adapter.js';
import { EXAMPLE_BYTES } from '../tools/vdk-example.js';

test('wizard guesses the structure of the VDK example', () => {
  const s = readStructure(EXAMPLE_BYTES);
  assert.equal(s.delimiter, ';');
  const header = guessHeaderRow(s.records);
  assert.equal(header, 7);
  assert.deepEqual(metadataKeys(s.records, header), ['Rekeningnummer', 'Naam', 'Soort', 'Saldo', 'Datum saldo', 'Filter actief']);
  assert.equal(guessDateFormat(['1/10/2026', '30/09/2026']), 'D/M/YYYY');
  assert.equal(guessDateFormat(['2026-10-01']), 'YYYY-MM-DD');
  assert.equal(guessDecimal(['-7,8', '2500', '1092,2']), ',');
});

test('a profile built by the wizard parses the example like the built-in one', () => {
  const p = buildProfile({
    name: 'Mijn bank (test)',
    delimiter: ';',
    headerRow: 7,
    decimal: ',',
    dateFormat: 'D/M/YYYY',
    order: 'newest-first',
    columns: { entryDate: 'Uitvoeringsdatum', valueDate: 'Valutadatum', counterpartyAccount: 'Tegenpartij rekeningnummer', counterpartyName: 'Tegenpartij naam', communication: 'Mededeling', balanceAfter: 'Saldo na beweging', bankRef: 'VDK-refertenummer', bankType: 'Soort beweging' },
    amountMode: 'single',
    amountColumn: 'Bedrag',
    ownSource: 'metadata',
    ownMetaKey: 'Rekeningnummer',
    metaBalanceKey: 'Saldo',
    metaBalanceAtKey: 'Datum saldo',
  });
  assert.equal(p.id, 'mijn-bank-test');
  assert.equal(p.key, 'bankRef');
  assert.ok(validateProfile(p));
  const r = parseCsvExport(EXAMPLE_BYTES, 'x.csv', p);
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  assert.equal(r.rows.length, 4);
  assert.equal(r.account.number, 'BE00000000000001');
  assert.equal(r.snapshot.balance, 1_002_200);
  assert.deepEqual(r.rows.map((x) => x.amount), [2_500_000, -7_800, -1_500_000, -90_000]);
});

test('debit/credit columns and fixed own account', () => {
  const csv = new TextEncoder().encode('Datum,Debet,Credit,Omschrijving\n2026-01-02,12.50,,Koffie\n2026-01-03,,100.00,Terugbetaling\n');
  const p = buildProfile({
    name: 'DC', delimiter: ',', decimal: '.', dateFormat: 'YYYY-MM-DD', order: 'oldest-first',
    columns: { entryDate: 'Datum', communication: 'Omschrijving' },
    amountMode: 'debitCredit', debitColumn: 'Debet', creditColumn: 'Credit', ownSource: 'fixed', ownValue: 'BE00 0000 0000 0007',
  });
  assert.equal(p.key, 'fallback');
  const r = parseCsvExport(csv, 'x.csv', p);
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  assert.deepEqual(r.rows.map((x) => x.amount), [-12_500, 100_000]);
  assert.equal(r.account.number, 'BE00000000000007');
  assert.throws(() => validateProfile({ ...p, columns: {} }), /boekingsdatum/);
});
