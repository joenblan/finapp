import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFile } from '../src/core/import/importer.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { sha256Hex } from '../src/core/hash.js';
import { sortForList } from '../src/core/filter.js';
import { accountSummaries } from '../src/core/status.js';
import { checkControlBalances } from '../src/core/checks/chain.js';
import { mergeOrder } from '../src/core/import/csv-import.js';
import { encodeWindows1252, buildStatement, toFileText, IBAN_A } from '../tools/coda-builder.js';
import { buildVdkCsv } from '../tools/vdk-builder.js';
import { EXAMPLE, EXAMPLE_BYTES, EXAMPLE_NAME } from '../tools/vdk-example.js';

const ACC = 'BE00000000000001';
let tick = 0;
const nextNow = () => new Date(Date.UTC(2026, 9, 1, 12, 0, tick++)).toISOString();

async function imp(data, bytes, fileName) {
  return importFile(data, { fileName, bytes, fileHash: await sha256Hex(bytes), source: 'upload', now: nextNow() });
}
const errs = (r) => r.report.messages.filter((m) => m.level === 'error');

// A fictitious account history, OLDEST first. Several movements per day; the
// booking order is NOT the date order (value dates differ, same execution dates).
const HISTORY = [
  { ref: '20000000001', date: '2026-09-01', amount: 1_000_000, cpIban: 'BE00000000000004', cpName: 'WERKGEVER NV', comm: 'Loon augustus', year: 2026, number: 1 },
  { ref: '20000000002', date: '2026-09-01', valueDate: '2026-08-30', amount: -12_340, type: 'Visa Debit betaling', comm: 'BAKKERIJ VOORBEELD 00000 GENT BE\n30/08/2026 08:10\nCARD: 0000 **** **** 0000', year: 2026, number: 1 },
  { ref: '20000000003', date: '2026-09-01', amount: -500_000, cpIban: 'BE00000000000003', cpName: 'gemeenschappelijke rekening', comm: 'gemeenschappelijk', type: 'Bestendige opdracht', year: 2026, number: 1 },
  { ref: '20000000004', date: '2026-09-03', amount: -45_000, cpIban: 'BE00000000000005', cpName: 'ENERGIE NV', comm: '+++123/4567/89002+++', year: 2026, number: 2 },
  { ref: '20000000005', date: '2026-09-05', amount: -9_990, cpIban: 'BE00000000000006', cpName: 'STREAMING BV', comm: 'Abonnement' },
  { ref: '20000000006', date: '2026-09-05', amount: 250_000, cpIban: 'BE00000000000002', cpName: 'Jan Voorbeeld', comm: 'Terugbetaling' },
  { ref: '20000000007', date: '2026-09-08', amount: -1_500, comm: 'Kosten', type: 'Kosten' },
];
const OPENING = 200_000;
const balanceBefore = (idx) => OPENING + HISTORY.slice(0, idx).reduce((s, m) => s + m.amount, 0);
/** Export of HISTORY[from..to) as the bank would deliver it; `overrides` per ref. */
function exportOf(from, to, overrides = {}, extra = {}) {
  const movements = HISTORY.slice(from, to).map((m) => ({ ...m, ...(overrides[m.ref] ?? {}) }));
  return buildVdkCsv({ iban: ACC, openingBalance: balanceBefore(from), movements, ...extra });
}

test('the example imports: 4 movements, balance chain ok, snapshot stored, account created', async () => {
  const r = await imp(createEmptyData(), EXAMPLE_BYTES, EXAMPLE_NAME);
  assert.equal(r.report.status, 'ok', JSON.stringify(r.report.messages));
  assert.equal(r.report.format, 'csv');
  assert.equal(r.report.profileId, 'vdk');
  assert.equal(r.report.newTransactions, 4);
  const acc = r.data.accounts[ACC];
  assert.equal(acc.displayName, 'You Count zichtrekening');
  assert.equal(acc.holderName, 'Jan Voorbeeld');
  assert.equal(acc.sourceFormat, 'csv');
  assert.equal(acc.kind, 'zicht');
  assert.deepEqual(r.data.balanceSnapshots[ACC].map((s) => [s.at, s.balance]), [['2026-10-01T09:52', 1_002_200]]);
  const card = r.data.transactions.find((t) => t.bankReference === '10000000002');
  assert.equal(card.id, `${ACC}|ref|10000000002`);
  assert.equal(card.counterparty.name, 'BAKKERIJ VOORBEELD');
  assert.equal(card.bankType, 'Visa Debit betaling');
  assert.equal(card.amount, -7_800);
  const [summary] = accountSummaries(r.data);
  assert.equal(summary.balance, 1_002_200);
  assert.equal(summary.ok, true, JSON.stringify(summary.issues));
});

test('booking order follows the file, not the dates', async () => {
  const r = await imp(createEmptyData(), EXAMPLE_BYTES, EXAMPLE_NAME);
  const byOrder = [...r.data.transactions].sort((a, b) => a.bookingOrder - b.bookingOrder).map((t) => t.bankReference);
  assert.deepEqual(byOrder, ['10000000001', '10000000002', '10000000003', '10000000004']);
  // the card payment (value date 29/09) was booked after the salary (30/09)
  const list = sortForList(r.data.transactions).map((t) => t.bankReference);
  assert.deepEqual(list, ['10000000004', '10000000003', '10000000002', '10000000001']);
  // three movements on 1/10 keep their file order
  const h = buildVdkCsv({ iban: ACC, movements: HISTORY.slice(0, 3) });
  const r2 = await imp(createEmptyData(), h.bytes, h.fileName);
  assert.deepEqual([...r2.data.transactions].sort((a, b) => a.bookingOrder - b.bookingOrder).map((t) => t.bankReference), ['20000000001', '20000000002', '20000000003']);
});

test('balance chain: a row with a changed amount is reported', async () => {
  const bad = EXAMPLE.replace('-1500;1092,2', '-1400;1092,2');
  const r = await imp(createEmptyData(), encodeWindows1252(bad), EXAMPLE_NAME);
  assert.equal(r.report.status, 'fout');
  assert.ok(errs(r).some((m) => /Regel 10: Saldoketen klopt niet/.test(m.message)), JSON.stringify(r.report.messages));
  assert.equal(r.data.transactions.length, 0);
});

test('metadata balance that does not match the newest row is reported', async () => {
  const bad = EXAMPLE.replace('Saldo;1002,2;', 'Saldo;1002,3;');
  const r = await imp(createEmptyData(), encodeWindows1252(bad), EXAMPLE_NAME);
  assert.equal(r.report.status, 'fout');
  assert.ok(errs(r).some((m) => /saldo in de kop/.test(m.message)));
});

test('same file twice: skipped; same content in another file: 0 new', async () => {
  const first = await imp(createEmptyData(), EXAMPLE_BYTES, EXAMPLE_NAME);
  const again = await imp(first.data, EXAMPLE_BYTES, EXAMPLE_NAME);
  assert.equal(again.report.status, 'overgeslagen');
  const other = encodeWindows1252(EXAMPLE + ';;;;;;;;;;;;;;;;;\r\n');
  const third = await imp(first.data, other, EXAMPLE_NAME);
  assert.equal(third.report.status, 'ok', JSON.stringify(third.report.messages));
  assert.equal(third.report.newTransactions, 0);
  assert.equal(third.report.duplicateTransactions, 4);
  assert.equal(third.data.transactions.length, 4);
});

test('overlapping exports: no duplicates, statement number completed, category kept', async () => {
  // export 1: movements 0..4; the two newest are not yet on a statement
  const e1 = exportOf(0, 5, { 20000000004: { year: '', number: '' } });
  const r1 = await imp(createEmptyData(), e1.bytes, e1.fileName);
  assert.equal(r1.report.status, 'ok', JSON.stringify(r1.report.messages));
  const id4 = `${ACC}|ref|20000000004`;
  assert.equal(r1.data.transactions.find((t) => t.id === id4).statementNumber, null);
  // the user assigns a category (phase 2 data lives in annotations)
  const withCategory = { ...r1.data, annotations: { [id4]: { categoryId: 'energie', note: 'voorschot' } } };
  // export 2: movements 2..6, now with statement number for movement 4
  const e2 = exportOf(2, 7);
  const r2 = await imp(withCategory, e2.bytes, e2.fileName);
  assert.equal(r2.report.status, 'ok', JSON.stringify(r2.report.messages));
  assert.equal(r2.report.newTransactions, 2);
  assert.equal(r2.report.duplicateTransactions, 3);
  assert.equal(r2.report.enrichedTransactions, 1);
  assert.equal(r2.data.transactions.length, 7);
  const t4 = r2.data.transactions.find((t) => t.id === id4);
  assert.equal(t4.statementYear, 2026);
  assert.equal(t4.statementNumber, 2);
  assert.deepEqual(t4.enrichedBy[0].fields, ['statementYear', 'statementNumber']);
  assert.deepEqual(r2.data.annotations[id4], { categoryId: 'energie', note: 'voorschot' });
  const order = [...r2.data.transactions].sort((a, b) => a.bookingOrder - b.bookingOrder).map((t) => t.bankReference);
  assert.deepEqual(order, HISTORY.map((m) => m.ref));
  const [summary] = accountSummaries(r2.data);
  assert.equal(summary.ok, true, JSON.stringify(summary.issues));
  // importing export 1 again (other bytes) changes nothing and never clears the filled number
  const e1b = exportOf(0, 5, { 20000000004: { year: '', number: '' } }, { trailingEmpty: 3 });
  const r3 = await imp(r2.data, e1b.bytes, e1b.fileName);
  assert.equal(r3.report.newTransactions, 0);
  assert.equal(r3.data.transactions.find((t) => t.id === id4).statementNumber, 2);
});

test('an older export imported after a newer one is placed before it', async () => {
  const newer = exportOf(4, 7);
  const older = exportOf(0, 4);
  const r1 = await imp(createEmptyData(), newer.bytes, newer.fileName);
  const r2 = await imp(r1.data, older.bytes, older.fileName);
  assert.equal(r2.report.status, 'ok', JSON.stringify(r2.report.messages));
  const order = [...r2.data.transactions].sort((a, b) => a.bookingOrder - b.bookingOrder).map((t) => t.bankReference);
  assert.deepEqual(order, HISTORY.map((m) => m.ref));
  assert.equal(accountSummaries(r2.data)[0].ok, true);
});

test('a movement missing between two exports is reported with its period', async () => {
  const e1 = exportOf(0, 3); // up to 01/09
  const e2 = exportOf(4, 7); // from 05/09; movement of 03/09 (-45,00) is missing
  const r1 = await imp(createEmptyData(), e1.bytes, e1.fileName);
  const r2 = await imp(r1.data, e2.bytes, e2.fileName);
  assert.equal(r2.report.status, 'waarschuwing');
  const msg = r2.report.messages.find((m) => /Saldoketen onderbroken/.test(m.message));
  assert.ok(msg, JSON.stringify(r2.report.messages));
  assert.match(msg.message, /tussen 01\/09\/2026 en 05\/09\/2026/);
  assert.match(msg.message, /-45,00/);
  const [summary] = accountSummaries(r2.data);
  assert.equal(summary.ok, false);
  assert.ok(summary.issues.some((i) => /tussen 01\/09\/2026 en 05\/09\/2026/.test(i.message)));
  // once the missing movement arrives, the chain is complete again
  const e3 = exportOf(2, 5);
  const r3 = await imp(r2.data, e3.bytes, e3.fileName);
  assert.equal(r3.report.status, 'ok', JSON.stringify(r3.report.messages));
  assert.equal(accountSummaries(r3.data)[0].ok, true);
});

test('possible duplicate: new reference, identical content', async () => {
  const e1 = exportOf(0, 5);
  const r1 = await imp(createEmptyData(), e1.bytes, e1.fileName);
  // the bank lists the subscription twice, with another reference
  const dup = { ...HISTORY[4], ref: '20000000099' };
  const e2 = buildVdkCsv({ iban: ACC, openingBalance: balanceBefore(5), movements: [dup] });
  const r2 = await imp(r1.data, e2.bytes, e2.fileName);
  assert.equal(r2.report.newTransactions, 1);
  assert.equal(r2.report.possibleDuplicates, 1);
  assert.deepEqual(r2.data.possibleDuplicates.map((p) => [p.txId, p.matchIds, p.status]), [[`${ACC}|ref|20000000099`, [`${ACC}|ref|20000000005`], 'open']]);
  assert.ok(accountSummaries(r2.data)[0].issues.some((i) => /mogelijke dubbel/.test(i.message)));
});

test('conflict: a known reference with another amount refuses the file', async () => {
  const e1 = exportOf(0, 3);
  const r1 = await imp(createEmptyData(), e1.bytes, e1.fileName);
  const e2 = exportOf(0, 3, { 20000000002: { amount: -12_350 } });
  const r2 = await imp(r1.data, e2.bytes, e2.fileName);
  assert.equal(r2.report.status, 'fout');
  assert.ok(errs(r2).some((m) => /bedrag/.test(m.message)));
  assert.equal(r2.data.transactions.find((t) => t.bankReference === '20000000002').amount, -12_340);
});

test('an export that lacks a known movement in the middle is refused', async () => {
  const r1 = await imp(createEmptyData(), exportOf(0, 4).bytes, 'a.csv');
  // Movement 3 is absent. For the balance chain of the file to be consistent,
  // another movement must then differ, which is a conflict with the known data.
  const movements = [HISTORY[0], HISTORY[1], { ...HISTORY[3], amount: HISTORY[3].amount + HISTORY[2].amount }];
  const f = buildVdkCsv({ iban: ACC, openingBalance: OPENING, movements });
  const r2 = await imp(r1.data, f.bytes, 'b.csv');
  assert.equal(r2.report.status, 'fout');
  assert.ok(errs(r2).some((m) => /heeft bedrag/.test(m.message)), JSON.stringify(r2.report.messages));
  assert.equal(r2.data.transactions.length, 4);
});

test('mergeOrder: known movements missing between two common movements is an error', () => {
  const t = (id, entryDate) => ({ id, entryDate, amount: 0, balanceAfter: null, bankReference: id });
  const all = new Map(['a', 'b', 'c', 'x', 'y'].map((id, i) => [id, t(id, `2026-01-0${i + 1}`)]));
  const byId = (id) => all.get(id);
  assert.deepEqual(mergeOrder(['a', 'b', 'c'], ['b', 'c', 'x', 'y'], byId).order, ['a', 'b', 'c', 'x', 'y']);
  assert.deepEqual(mergeOrder(['b', 'c'], ['x', 'a', 'b'], byId).order, ['x', 'a', 'b', 'c']);
  assert.match(mergeOrder(['a', 'b', 'c'], ['a', 'c'], byId).error, /bevat 1 eerder geïmporteerde/);
  assert.match(mergeOrder(['a', 'b', 'c'], ['c', 'a'], byId).error, /volgorde/);
  assert.match(mergeOrder(['a', 'b', 'c'], ['x', 'y'].map((id) => id), (id) => (id === 'x' ? t('x', '2026-01-01') : id === 'y' ? t('y', '2026-01-03') : byId(id))).error, /overlapt/);
});

test('fallback key (profile without reference): two identical movements on one day are both kept', async () => {
  const profile = {
    id: 'test-zonder-ref',
    name: 'Testbank zonder referentie',
    format: 'csv',
    encoding: 'utf-8',
    delimiter: ',',
    quote: '"',
    decimal: '.',
    thousands: '',
    dateFormat: 'YYYY-MM-DD',
    order: 'oldest-first',
    detect: { headerColumns: ['Datum', 'Bedrag', 'Omschrijving'] },
    metadata: {},
    ownAccount: { source: 'fixed', value: 'BE00 0000 0000 0007' },
    amount: { mode: 'single', column: 'Bedrag' },
    key: 'fallback',
    columns: { entryDate: 'Datum', counterpartyAccount: 'IBAN', communication: 'Omschrijving' },
  };
  const csv = (rows) => new TextEncoder().encode(['Datum,Bedrag,IBAN,Omschrijving', ...rows].join('\n') + '\n');
  const day = ['2026-09-01,-2.50,,Koffie', '2026-09-01,-2.50,,Koffie', '2026-09-02,-10.00,BE00000000000008,Boek'];
  const base = { ...createEmptyData(), profiles: [profile] };
  const r1 = await imp(base, csv(day), 'bank.csv');
  assert.equal(r1.report.status, 'ok', JSON.stringify(r1.report.messages));
  assert.equal(r1.report.newTransactions, 3);
  const coffee = r1.data.transactions.filter((t) => t.communication.text === 'Koffie');
  assert.equal(coffee.length, 2);
  assert.notEqual(coffee[0].id, coffee[1].id);
  // overlapping export with one more movement: only that one is new
  const r2 = await imp(r1.data, csv([...day, '2026-09-03,-1.00,,Snoep']), 'bank2.csv');
  assert.equal(r2.report.newTransactions, 1);
  assert.equal(r2.data.transactions.length, 4);
  assert.equal(r2.data.possibleDuplicates.length, 0);
});

test('a CODA account cannot also be fed by CSV', async () => {
  const coda = buildStatement({ iban: IBAN_A, statementNumber: 1, oldBalance: 0, oldDate: '2026-01-01', newDate: '2026-01-02', movements: [{ seq: 1, amount: 100, communication: 'x' }] });
  const r1 = await imp(createEmptyData(), new TextEncoder().encode(toFileText(coda.lines)), 'a.cod');
  const f = buildVdkCsv({ iban: IBAN_A, movements: [{ ref: '1', date: '2026-01-03', amount: 5 }] });
  const r2 = await imp(r1.data, f.bytes, f.fileName);
  assert.equal(r2.report.status, 'fout');
  assert.ok(errs(r2).some((m) => /mengen/.test(m.message)));
});

test('control balances: with and without balance chain', () => {
  const tx = (date, amount, balanceAfter = null) => ({ entryDate: date, amount, balanceAfter });
  // without chain
  const noChain = [tx('2026-01-02', -1000), tx('2026-01-05', 5000), tx('2026-01-09', -500)];
  const r = checkControlBalances(noChain, [
    { id: 'a', date: '2026-01-01', balance: 10_000 },
    { id: 'b', date: '2026-01-06', balance: 14_000 },
    { id: 'c', date: '2026-01-10', balance: 13_000 },
  ]);
  assert.deepEqual(r.results.map((x) => x.ok), [null, true, false]);
  assert.equal(r.results[2].difference, 500);
  assert.deepEqual(r.computedBalance, { balance: 13_000, from: '2026-01-10' });
  // with chain
  const chain = [tx('2026-01-02', -1000, 9000), tx('2026-01-05', 5000, 14_000)];
  const r2 = checkControlBalances(chain, [{ id: 'x', date: '2026-01-03', balance: 9000 }, { id: 'y', date: '2026-01-06', balance: 14_001 }]);
  assert.deepEqual(r2.results.map((x) => x.ok), [true, false]);
});

test('the bundled synthetic VDK sample imports cleanly', async () => {
  const { readFile } = await import('node:fs/promises');
  const name = 'verwerkte_bewegingen_BE00000000000001_2026_10_01__09_52_00.csv';
  const bytes = new Uint8Array(await readFile(new URL(`../voorbeelden/${name}`, import.meta.url)));
  const r = await imp(createEmptyData(), bytes, name);
  assert.equal(r.report.status, 'ok', JSON.stringify(r.report.messages));
  assert.equal(r.report.encoding, 'windows-1252');
  assert.equal(r.report.newTransactions, 4);
  assert.equal(accountSummaries(r.data)[0].balance, 1_002_200);
});
