import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvExport } from '../src/core/csv/adapter.js';
import { VDK_PROFILE, detectProfile } from '../src/core/csv/profiles.js';
import { parseCardCommunication, communicationForDisplay } from '../src/core/csv/card.js';
import { encodeWindows1252 } from '../tools/coda-builder.js';
import { buildVdkCsv } from '../tools/vdk-builder.js';
import { EXAMPLE, EXAMPLE_BYTES, EXAMPLE_NAME } from '../tools/vdk-example.js';


test('example: detected as VDK by its header row', () => {
  assert.equal(detectProfile(EXAMPLE_BYTES, EXAMPLE_NAME).profile.id, 'vdk');
  assert.equal(detectProfile(EXAMPLE_BYTES, 'hernoemd.csv').profile.id, 'vdk'); // file name is not required
  assert.equal(detectProfile(encodeWindows1252('a;b;c\r\n1;2;3\r\n'), 'x.csv').profile, null);
});

test('example: metadata, header found by content, rows, encoding', () => {
  const r = parseCsvExport(EXAMPLE_BYTES, EXAMPLE_NAME, VDK_PROFILE);
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  assert.equal(r.encoding, 'windows-1252');
  assert.equal(r.account.number, 'BE00000000000001');
  assert.equal(r.account.holderName, 'Jan Voorbeeld');
  assert.equal(r.account.accountLabel, 'You Count zichtrekening');
  assert.deepEqual(r.snapshot, { balance: 1_002_200, at: '2026-10-01T09:52' });
  assert.equal(r.rows.length, 4); // trailing empty records skipped
  // rows are returned OLDEST first; filePosition keeps the order in the file
  assert.deepEqual(r.rows.map((x) => x.bankRef), ['10000000001', '10000000002', '10000000003', '10000000004']);
  assert.deepEqual(r.rows.map((x) => x.filePosition), [3, 2, 1, 0]);
  assert.deepEqual(r.rows.map((x) => x.amount), [2_500_000, -7_800, -1_500_000, -90_000]);
  assert.deepEqual(r.rows.map((x) => x.balanceAfter), [2_600_000, 2_592_200, 1_092_200, 1_002_200]);
  const [salary, card, standing, transfer] = r.rows;
  assert.equal(standing.counterparty.country, 'België'); // Windows-1252 "ë"
  assert.equal(standing.counterparty.account, 'BE00000000000003'); // spaces removed
  assert.equal(standing.bankType, 'Bestendige opdracht');
  assert.equal(transfer.counterparty.bic, 'VDSPBE91');
  assert.equal(salary.statementYear, 2026);
  assert.equal(salary.statementNumber, 3);
  assert.equal(card.statementYear, null);
  assert.equal(salary.communication.text, '/A/X000000 - 000000-000000 BETALING-09/2026---\nRef.opdrachtgever: 260901-000000-/A/X000000');
  assert.equal(salary.counterparty.street, 'VOORBEELDSTRAAT 1');
  assert.equal(salary.counterparty.postcode, '1000');
  assert.equal(card.entryDate, '2026-10-01');
  assert.equal(card.valueDate, '2026-09-29');
  assert.equal(card.line, 11); // physical line in the file
});

test('example: card payment merchant, city and payment time', () => {
  const r = parseCsvExport(EXAMPLE_BYTES, EXAMPLE_NAME, VDK_PROFILE);
  const card = r.rows.find((x) => x.bankRef === '10000000002');
  assert.equal(card.card.merchant, 'BAKKERIJ VOORBEELD');
  assert.equal(card.card.city, 'GENT');
  assert.equal(card.card.postcode, '00000');
  assert.equal(card.card.country, 'BE');
  assert.equal(card.card.paidAt, '2026-09-29T12:46');
  assert.equal(card.counterparty.name, 'BAKKERIJ VOORBEELD'); // merchant used as counterparty
  assert.equal(card.counterparty.city, 'GENT');
  assert.ok(!communicationForDisplay(card).includes('CARD'));
  assert.ok(!communicationForDisplay(card).includes('****'));
});

test('card communication variants', () => {
  assert.deepEqual(parseCardCommunication('ALDI 1234 2000 ANTWERPEN BE\n1/2/2026 8:05\nCARD: x'), {
    merchantLine: 'ALDI 1234 2000 ANTWERPEN BE', merchant: 'ALDI 1234', postcode: '2000', city: 'ANTWERPEN', country: 'BE', paidAt: '2026-02-01T08:05', maskedCard: 'x',
  });
  const odd = parseCardCommunication('ONLINE WINKEL');
  assert.equal(odd.merchant, 'ONLINE WINKEL');
  assert.equal(odd.city, null);
});

test('IBAN in file name must match the account in the file', () => {
  const r = parseCsvExport(EXAMPLE_BYTES, 'verwerkte_bewegingen_BE00000000000009_2026_10_01__09_52_00.csv', VDK_PROFILE);
  assert.ok(r.issues.some((i) => i.level === 'error' && /bestandsnaam/.test(i.message)));
});

test('an export with an active filter is refused', () => {
  const f = buildVdkCsv({ iban: 'BE00000000000001', filter: 'Ja', movements: [{ ref: '1', date: '2026-01-02', amount: 1000 }] });
  const r = parseCsvExport(f.bytes, f.fileName, VDK_PROFILE);
  assert.ok(r.issues.some((i) => i.level === 'error' && /filter/.test(i.message)));
});

test('builder output has the same structure as the example', () => {
  const f = buildVdkCsv({
    iban: 'BE00000000000001',
    openingBalance: 100_000,
    movements: [
      { ref: '10000000001', date: '2026-09-30', year: 2026, number: 3, amount: 2_500_000, comm: 'regel 1\nregel 2' },
      { ref: '10000000002', date: '2026-10-01', valueDate: '2026-09-29', type: 'Visa Debit betaling', amount: -7_800, comm: 'BAKKERIJ VOORBEELD 00000 GENT BE\n29/09/2026 12:46\nCARD: 0000 **** **** 0000' },
    ],
  });
  const r = parseCsvExport(f.bytes, f.fileName, VDK_PROFILE);
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  assert.deepEqual(r.rows.map((x) => x.balanceAfter), [2_600_000, 2_592_200]);
  assert.equal(r.snapshot.balance, 2_592_200);
  assert.ok(f.text.includes('\r\n'));
  assert.ok(f.text.includes('regel 1\nregel 2'));
});

test('bad values are reported with their line number', () => {
  const bad = EXAMPLE.replace('-7,8;2592,2', '-7,8x;2592,2');
  const r = parseCsvExport(encodeWindows1252(bad), EXAMPLE_NAME, VDK_PROFILE);
  assert.ok(r.issues.some((i) => i.level === 'error' && i.line === 11 && /Ongeldig bedrag/.test(i.message)));
});
