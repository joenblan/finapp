import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFile, detectFormat } from '../src/core/import/importer.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { sha256Hex } from '../src/core/hash.js';
import { parseCsvExport } from '../src/core/csv/adapter.js';
import { CRELAN_PROFILE } from '../src/core/csv/profiles.js';
import { communicationForDisplay } from '../src/core/csv/card.js';
import { accountSummaries } from '../src/core/status.js';
import { sortForList } from '../src/core/filter.js';
import { buildCrelanCsv, CRELAN_EXAMPLE } from '../tools/crelan-builder.js';
import { EXAMPLE_BYTES as VDK_BYTES, EXAMPLE_NAME as VDK_NAME } from '../tools/vdk-example.js';
import { buildStatement, toFileText, IBAN_A, encodeWindows1252 } from '../tools/coda-builder.js';

const OWN = 'BE00000000000003';
const enc = (s) => new TextEncoder().encode(s);
let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 2, 8, 0, tick++)).toISOString();
async function imp(data, bytes, fileName = 'searchMovement.csv') {
  return importFile(data, { fileName, bytes, fileHash: await sha256Hex(bytes), source: 'inbox', now: now() });
}
const errs = (r) => r.report.messages.filter((m) => m.level === 'error').map((m) => m.message);
const byOrder = (data) => [...data.transactions].sort((a, b) => a.bookingOrder - b.bookingOrder);

// Fictitious history of the joint account, OLDEST first.
const HISTORY = [
  { date: '2025-01-27', amount: 1_000, cp: 'JAN VOORBEELD', cpIban: 'BE00000000000005', type: 'Instantoverschr. in uw voordeel' },
  { date: '2025-01-27', amount: -50, cp: 'CAFE VOORBEELD       Gent', type: 'eCommerce Mobile', comm: 'CAFE VOORBEELD 27-01-2025 16:38 Gent 000000******0000' },
  { date: '2025-01-28', amount: 1_500_000, cp: 'JAN VOORBEELD', cpIban: 'BE00000000000002', type: 'Overschrijving in uw voordeel', comm: 'gemeenschappelijk' },
  { date: '2025-01-28', amount: -3_500, cp: 'BAKKER VOORBEELD    Gent', type: 'Betaling Bancontact contactless', comm: 'BAKKER VOORBEELD 28-01-2025 08:12 Gent 000000******0000' },
  { date: '2025-01-28', amount: -3_500, cp: 'BAKKER VOORBEELD    Gent', type: 'Betaling Bancontact contactless', comm: 'BAKKER VOORBEELD 28-01-2025 08:12 Gent 000000******0000' },
  { date: '2025-01-30', amount: -82_150, cp: 'ENERGIE NV', cpIban: 'BE00000000000006', type: 'DomiciliÃ«ring', comm: 'Voorschot februari' },
  { date: '2025-02-01', amount: -2_000, cp: '', type: 'Beheren vd rek Eco Plus Pack (coop)', comm: '' },
];
const before = (i) => HISTORY.slice(0, i).reduce((s, m) => s + m.amount, 0);
const exportOf = (from, to, extra = {}) => buildCrelanCsv({ own: OWN, openingBalance: before(from), movements: HISTORY.slice(from, to), ...extra });

test('example: header on line 1, ".95"/"-.05"/"1.00", trailing ";;;;;;;;" ignored', () => {
  const r = parseCsvExport(enc(CRELAN_EXAMPLE), 'searchMovement.csv', CRELAN_PROFILE);
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  assert.equal(r.encoding, 'ascii');
  assert.deepEqual(r.header.slice(0, 3), ['Datum', 'Bedrag', 'Saldo na verrichting']);
  assert.equal(r.rows.length, 2);
  assert.equal(r.detectedOrder, 'oldest-first');
  assert.deepEqual(r.rows.map((x) => x.amount), [1_000, -50]);
  assert.deepEqual(r.rows.map((x) => x.balanceAfter), [1_000, 950]);
  assert.deepEqual(r.rows.map((x) => x.line), [2, 3]);
  assert.equal(r.account.number, OWN);
  assert.equal(r.rows[0].counterparty.account, 'BE00000000000005');
  assert.equal(r.rows[0].bankType, 'Instantoverschr. in uw voordeel');
  assert.equal(r.rows[0].entryDate, '2025-01-27');
  assert.equal(r.rows[0].valueDate, null);
});

test('card payment: merchant and city split, payment time kept, card number hidden', () => {
  const r = parseCsvExport(enc(CRELAN_EXAMPLE), 'searchMovement.csv', CRELAN_PROFILE);
  const card = r.rows[1];
  assert.equal(card.counterparty.name, 'CAFE VOORBEELD');
  assert.equal(card.counterparty.city, 'Gent');
  assert.equal(card.card.merchant, 'CAFE VOORBEELD');
  assert.equal(card.card.city, 'Gent');
  assert.equal(card.card.paidAt, '2025-01-27T16:38');
  const shown = communicationForDisplay(card);
  assert.equal(shown, 'CAFE VOORBEELD 27-01-2025 16:38 Gent');
  assert.ok(!shown.includes('*'));
  assert.equal(r.rows[0].card, null);
});

test('detection: Crelan, VDK and CODA each get the right format/profile', () => {
  assert.equal(detectFormat(enc(CRELAN_EXAMPLE), 'searchMovement.csv').profile.id, 'crelan');
  assert.equal(detectFormat(enc(CRELAN_EXAMPLE), 'verwerkte_bewegingen_x.csv').profile.id, 'crelan');
  assert.equal(detectFormat(VDK_BYTES, VDK_NAME).profile.id, 'vdk');
  assert.equal(detectFormat(VDK_BYTES, 'searchMovement.csv').profile.id, 'vdk');
  const coda = buildStatement({ iban: IBAN_A, statementNumber: 1, oldBalance: 0, oldDate: '2026-01-01', newDate: '2026-01-02', movements: [{ seq: 1, amount: 1, communication: 'x' }] });
  assert.equal(detectFormat(enc(toFileText(coda.lines)), 'searchMovement.csv').format, 'coda');
});

test('automatic direction: reversed row order gives identical transactions and order', async () => {
  const asc = exportOf(0, HISTORY.length, { order: 'oldest-first' });
  const desc = exportOf(0, HISTORY.length, { order: 'newest-first' });
  const a = await imp(createEmptyData(), asc.bytes);
  const d = await imp(createEmptyData(), desc.bytes);
  assert.equal(a.report.status, 'ok', JSON.stringify(a.report.messages));
  assert.equal(d.report.status, 'ok', JSON.stringify(d.report.messages));
  assert.equal(a.report.detectedOrder, 'oldest-first');
  assert.equal(d.report.detectedOrder, 'newest-first');
  const strip = (t) => ({ ...t, importId: null });
  assert.deepEqual(byOrder(a.data).map(strip), byOrder(d.data).map(strip));
  assert.deepEqual(byOrder(a.data).map((t) => t.amount), HISTORY.map((m) => m.amount));
});

test('a chain that closes in neither direction is reported', async () => {
  const f = buildCrelanCsv({ own: OWN, movements: [HISTORY[0], { ...HISTORY[2], balanceAfter: 999_000 }, HISTORY[3]] });
  const r = await imp(createEmptyData(), f.bytes);
  assert.equal(r.report.status, 'fout');
  assert.ok(errs(r).some((m) => /in geen enkele richting/.test(m)), JSON.stringify(r.report.messages));
});

test('one row: oldest-first assumed and recorded', async () => {
  const f = exportOf(0, 1);
  const r = await imp(createEmptyData(), f.bytes);
  assert.equal(r.report.detectedOrder, 'oldest-first');
  assert.ok(r.report.messages.some((m) => /bij één rij/.test(m.message)));
});

test('new account: proposed as current account, ownership to be confirmed', async () => {
  const r = await imp(createEmptyData(), exportOf(0, 3).bytes);
  const acc = r.data.accounts[OWN];
  assert.equal(acc.kind, 'zicht');
  assert.equal(acc.profileId, 'crelan');
  assert.equal(acc.ownershipConfirmed, false);
  assert.equal(accountSummaries(r.data)[0].balance, before(3)); // from the last balance after
});

test('two identical payments on one day (different balance after) are both kept; overlap gives no duplicates', async () => {
  const r1 = await imp(createEmptyData(), exportOf(0, 5).bytes);
  assert.equal(r1.report.newTransactions, 5);
  const bakery = r1.data.transactions.filter((t) => t.counterparty.name === 'BAKKER VOORBEELD');
  assert.equal(bakery.length, 2);
  assert.notEqual(bakery[0].id, bakery[1].id);
  // overlapping export in the other row order
  const r2 = await imp(r1.data, exportOf(2, 7, { order: 'newest-first' }).bytes);
  assert.equal(r2.report.status, 'ok', JSON.stringify(r2.report.messages));
  assert.equal(r2.report.newTransactions, 2);
  assert.equal(r2.report.duplicateTransactions, 3);
  assert.equal(r2.data.transactions.length, 7);
  assert.deepEqual(byOrder(r2.data).map((t) => t.amount), HISTORY.map((m) => m.amount));
  assert.equal(r2.data.possibleDuplicates.length, 0);
  assert.equal(accountSummaries(r2.data)[0].ok, true, JSON.stringify(accountSummaries(r2.data)[0].issues));
  // the same export again (other bytes): nothing new
  const r3 = await imp(r2.data, exportOf(0, 7, { trailingEmpty: 2 }).bytes);
  assert.equal(r3.report.newTransactions, 0);
  // list order: newest first by booking order, not by date
  assert.deepEqual(sortForList(r3.data.transactions).map((t) => t.amount), [...HISTORY].reverse().map((m) => m.amount));
});

test('a gap between two exports is reported with its period', async () => {
  const r1 = await imp(createEmptyData(), exportOf(0, 3).bytes);
  const r2 = await imp(r1.data, exportOf(4, 7).bytes); // one bakery payment of 28/01 missing
  assert.equal(r2.report.status, 'waarschuwing');
  assert.ok(r2.report.messages.some((m) => /Saldoketen onderbroken tussen 28\/01\/2025 en 28\/01\/2025/.test(m.message)), JSON.stringify(r2.report.messages));
});

test('possible duplicate: same date, amount and balance, other text', async () => {
  const r1 = await imp(createEmptyData(), exportOf(0, 3).bytes);
  const changed = HISTORY.slice(0, 3).map((m, i) => (i === 2 ? { ...m, comm: 'gemeenschappelijk februari' } : m));
  const f = buildCrelanCsv({ own: OWN, movements: changed });
  const r2 = await imp(r1.data, f.bytes);
  assert.equal(r2.report.newTransactions, 1);
  assert.equal(r2.report.possibleDuplicates, 1);
  assert.match(r2.report.messages.find((m) => /mogelijke dubbel/.test(m.message)).message, /andere tekst/);
});

test('amounts: "1,600.00" accepted; "1,6" or several points abort the file', async () => {
  const ok = buildCrelanCsv({ own: OWN, movements: [{ date: '2025-02-03', amount: 1_600_000, amountText: '1,600.00', cp: 'X', cpIban: 'BE00000000000005' }] });
  assert.ok(ok.text.includes(';1,600.00;'));
  // the balance column is written as "1600.00" by the builder; both notations parse to the same value
  const r = await imp(createEmptyData(), ok.bytes);
  assert.equal(r.report.status, 'ok', JSON.stringify(r.report.messages));
  assert.equal(r.data.transactions[0].amount, 1_600_000);
  for (const bad of ['1,6', '1.600.00', '1,60,000.00']) {
    const f = buildCrelanCsv({ own: OWN, movements: [{ date: '2025-02-03', amount: 1_600_000, amountText: bad, cp: 'X' }] });
    const rb = await imp(createEmptyData(), f.bytes);
    assert.equal(rb.report.status, 'fout', bad);
    assert.ok(errs(rb).some((m) => m.includes(`Regel 2: Ongeldig bedrag "${bad}"`)), JSON.stringify(rb.report.messages));
    assert.equal(rb.data.transactions.length, 0);
  }
});

test('different own IBANs in one file are refused', async () => {
  const f = buildCrelanCsv({ own: OWN, movements: [HISTORY[0], { ...HISTORY[2], own: 'BE00000000000009' }] });
  const r = await imp(createEmptyData(), f.bytes);
  assert.equal(r.report.status, 'fout');
  assert.ok(errs(r).some((m) => /meer dan één eigen rekening \(BE00000000000003, BE00000000000009\)/.test(m)), JSON.stringify(r.report.messages));
});

test('another currency: imported, not converted, flagged, chain not broken', async () => {
  const movements = [HISTORY[0], { date: '2025-01-27', amount: -12_000, cp: 'SHOP USA', type: 'eCommerce Mobile', comm: 'x', currency: 'USD', balanceAfter: 500_000 }, { ...HISTORY[2], balanceAfter: 2_000_000 }];
  const f = buildCrelanCsv({ own: OWN, movements });
  const r = await imp(createEmptyData(), f.bytes);
  assert.equal(r.report.status, 'waarschuwing', JSON.stringify(r.report.messages));
  const usd = r.data.transactions.find((t) => t.currency === 'USD');
  assert.equal(usd.amount, -12_000);
  assert.equal(usd.foreignCurrency, true);
  assert.ok(r.report.messages.some((m) => /andere munt \(USD\)/.test(m.message)));
  const [summary] = accountSummaries(r.data);
  assert.ok(summary.issues.some((i) => /andere munt/.test(i.message)));
});

test('UTF-8 with BOM and Windows-1252 are both decoded', () => {
  const text = CRELAN_EXAMPLE.replace('JAN VOORBEELD', 'JOSÉ VOORBEELD');
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(text)]);
  const a = parseCsvExport(utf8, 'x.csv', CRELAN_PROFILE);
  assert.equal(a.encoding, 'utf-8');
  assert.equal(a.rows[0].counterparty.name, 'JOSÉ VOORBEELD');
  const b = parseCsvExport(encodeWindows1252(text), 'x.csv', CRELAN_PROFILE);
  assert.equal(b.encoding, 'windows-1252');
  assert.equal(b.rows[0].counterparty.name, 'JOSÉ VOORBEELD');
});

test('quoted communication with a line break is supported', () => {
  const f = buildCrelanCsv({ own: OWN, movements: [{ ...HISTORY[2], comm: 'regel 1\nregel 2' }] });
  const r = parseCsvExport(f.bytes, 'x.csv', CRELAN_PROFILE);
  assert.deepEqual(r.issues.filter((i) => i.level === 'error'), []);
  assert.equal(r.rows[0].communication.text, 'regel 1\nregel 2');
});

test('the bundled synthetic Crelan sample imports cleanly', async () => {
  const { readFile } = await import('node:fs/promises');
  const bytes = new Uint8Array(await readFile(new URL('../voorbeelden/searchMovement.csv', import.meta.url)));
  const r = await imp(createEmptyData(), bytes);
  assert.equal(r.report.status, 'ok', JSON.stringify(r.report.messages));
  assert.equal(r.report.encoding, 'utf-8');
  assert.equal(r.report.newTransactions, 5);
  assert.ok(r.data.transactions.some((t) => t.bankType === 'Domiciliëring'));
});
