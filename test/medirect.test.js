import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePdf, parseCMap } from '../src/core/pdf/pdf.js';
import { isMedirectStatement, parseMedirectStatement } from '../src/core/pdf/medirect.js';
import { importFile, detectFormat } from '../src/core/import/importer.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { categorize, allocationOf } from '../src/core/categories/categorize.js';
import { buildMedirectPdf, MEDIRECT_EXAMPLE } from '../tools/medirect-pdf-builder.js';
import { sha256Hex } from '../src/core/hash.js';

const file = async (bytes, fileName = 'afschrift.pdf') => ({ fileName, bytes, fileHash: await sha256Hex(bytes), now: '2026-10-02T10:00:00.000Z' });

test('PDF reader: text pieces with positions, Type0 (ToUnicode) and Helvetica (WinAnsi)', () => {
  const pdf = parsePdf(buildMedirectPdf(MEDIRECT_EXAMPLE));
  assert.equal(pdf.pages.length, 2);
  const texts = pdf.pages[0].items.map((i) => i.text);
  assert.ok(texts.includes('IBAN-NUMMER') && texts.includes('BE00000000000055'));
  assert.ok(texts.includes('Pagina 1 van 2'));
  assert.ok(texts.includes('Marge: € 0,08'));
  const iban = pdf.pages[0].items.find((i) => i.text === 'IBAN-NUMMER');
  assert.ok(Math.abs(iban.x - 39.7) < 0.01 && Math.abs(iban.y - 271.7) < 0.01);
  // multi-line block (T*): lines 9.2 apart
  const a = pdf.pages[0].items.find((i) => i.text === 'Betaling met de kaart');
  const b = pdf.pages[0].items.find((i) => i.text === 'Naar: Online Winkel 24-sep.');
  assert.ok(Math.abs(b.y - a.y - 9.2) < 0.01 && a.x === b.x);
});

test('CMap: bfchar and bfrange (also array form)', () => {
  const m = parseCMap('2 beginbfchar\n<0001><0041>\n<0002><20AC>\nendbfchar\n2 beginbfrange\n<0010><0012><0061>\n<0020><0021>[<0078><00E9>]\nendbfrange');
  assert.deepEqual([m.get(1), m.get(2), m.get(0x11), m.get(0x12), m.get(0x20), m.get(0x21)], ['A', '€', 'b', 'c', 'x', 'é']);
});

test('MeDirect statement: account, totals, rows oldest first with all details', () => {
  const pdf = parsePdf(buildMedirectPdf(MEDIRECT_EXAMPLE));
  assert.ok(isMedirectStatement(pdf));
  const r = parseMedirectStatement(pdf);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.account, { number: 'BE00000000000055', holderName: 'JAN VOORBEELD', accountLabel: 'MeDirect zichtrekening' });
  assert.equal(r.detectedOrder, 'newest-first');
  assert.equal(r.rows.length, 6);
  assert.deepEqual(r.rows.map((x) => x.amount), MEDIRECT_EXAMPLE.movements.map((m) => m.amount));
  const [first, second, third, energy, book, usd] = r.rows;
  assert.deepEqual([first.bankType, first.counterparty.account, first.counterparty.name, first.communication.text, first.bankRef], ['Overschrijving tussen mijn MeDirect-rekeningen', 'BE00000000000056', 'JAN VOORBEELD', 'Gestuurd vanuit MeDirect App', 'BE855']);
  assert.equal(second.bankRef, null); // no reference on this row
  assert.equal(third.communication.text, '');
  assert.equal(energy.communication.structured, '+++090/9337/55493+++');
  assert.deepEqual([book.card.merchant, book.card.paidAt, book.card.maskedCard, book.counterparty.name], ['Boekhandel Voorbeeld', '2026-09-16', '000000******0000', 'Boekhandel Voorbeeld']);
  assert.deepEqual([usd.card.paidAt, usd.exchangeRate, usd.costs], ['2026-09-24', 'USD 6,05 · koers 0,89', { text: 'Marge: € 0,08', amount: 80 }]);
  assert.equal(usd.foreignCurrency, undefined); // booked in euro
  assert.equal(usd.balanceAfter, 1_250_000 - 82_150 - 24_990 - 5_400);
});

test('MeDirect: a card purchase in December booked in January gets the previous year', () => {
  const pdf = parsePdf(buildMedirectPdf({ iban: 'BE00000000000055', movements: [{ date: '2027-01-02', type: 'Betaling met de kaart', details: ['Naar: Winkel 31-dec.', 'Kaart: 000000******0000'], amount: -1_000 }], begin: 5_000 }));
  assert.equal(parseMedirectStatement(pdf).rows[0].card.paidAt, '2026-12-31');
});

test('MeDirect: a row split over two pages, many pages, large amounts', () => {
  const movements = Array.from({ length: 13 }, (_, i) => ({ date: `2026-0${1 + Math.floor(i / 2)}-1${i % 2}`, type: 'Instantoverschrijving', details: [`Mededeling: betaling ${i}`, 'Naar: Iemand', 'BE00000000000077', `Referentie: PH${i}`], amount: i % 3 ? -1_234_560 : 12_345_670 }));
  const pdf = parsePdf(buildMedirectPdf({ iban: 'BE00000000000055', movements, rowsPerPage: 3, splitRowAt: 5 }));
  assert.ok(pdf.pages.length >= 5);
  const r = parseMedirectStatement(pdf);
  assert.deepEqual(r.issues, []);
  assert.equal(r.rows.length, 13);
  const split = r.rows[13 - 1 - 5];
  assert.equal(split.bankRef, `PH${13 - 1 - 5}`);
  assert.equal(split.counterparty.account, 'BE00000000000077');
});

test('MeDirect: statement checks catch a missing movement or wrong totals', () => {
  const missing = parseMedirectStatement(parsePdf(buildMedirectPdf({ ...MEDIRECT_EXAMPLE, dropRow: 0 })));
  assert.ok(missing.issues.some((i) => i.level === 'error' && /Saldocontrole afschrift/.test(i.message)));
  const mid = parseMedirectStatement(parsePdf(buildMedirectPdf({ ...MEDIRECT_EXAMPLE, dropRow: 2 })));
  assert.ok(mid.issues.some((i) => i.level === 'error' && /saldoketen|Saldocontrole/.test(i.message)));
  const totals = parseMedirectStatement(parsePdf(buildMedirectPdf({ ...MEDIRECT_EXAMPLE, totals: { in: 1 } })));
  assert.ok(totals.issues.some((i) => /beginsaldo .* \+ inkomend/.test(i.message)));
});

test('import: PDF detected, account created, re-import adds nothing, internal transfers recognised', async () => {
  const bytes = buildMedirectPdf(MEDIRECT_EXAMPLE);
  assert.equal(detectFormat(bytes, 'x.pdf').format, 'pdf');
  let d = { ...createEmptyData('2026-10-01T00:00:00.000Z'), externalOwnAccounts: [{ iban: 'BE00000000000056', name: 'MeDirect spaar' }] };
  const r1 = importFile(d, await file(bytes));
  assert.equal(r1.report.status, 'ok', JSON.stringify(r1.report.messages));
  assert.equal(r1.report.format, 'pdf');
  assert.equal(r1.report.newTransactions, 6);
  d = r1.data;
  const acc = d.accounts.BE00000000000055;
  assert.deepEqual([acc.sourceFormat, acc.profileId, acc.kind, acc.displayName], ['pdf', 'medirect', 'zicht', 'MeDirect zichtrekening']);
  const internal = d.transactions.find((t) => t.counterparty.account === 'BE00000000000056');
  assert.equal(allocationOf(d, internal.id).categoryId, 'intern');
  // the same history again with one new movement: only that one is added
  const more = buildMedirectPdf({ ...MEDIRECT_EXAMPLE, movements: [...MEDIRECT_EXAMPLE.movements, { date: '2026-09-30', type: 'Rente', details: ['Mededeling: rente'], amount: 10 }] });
  const r2 = importFile(d, await file(more, 'nieuw.pdf'));
  assert.equal(r2.report.status, 'ok', JSON.stringify(r2.report.messages));
  assert.deepEqual([r2.report.newTransactions, r2.report.duplicateTransactions], [1, 6]);
  assert.equal(r2.data.transactions.length, 7);
});

test('import: unknown or damaged PDF gives a clear error and changes nothing', async () => {
  const d = createEmptyData('2026-10-01T00:00:00.000Z');
  const other = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF');
  const r = importFile(d, await file(other));
  assert.equal(r.report.status, 'fout');
  assert.match(r.report.messages[0].message, /enkel rekeningafschriften van MeDirect/);
  assert.equal(r.data.transactions.length, 0);
  const broken = buildMedirectPdf(MEDIRECT_EXAMPLE).slice(0, 2000);
  const r2 = importFile(d, await file(broken));
  assert.equal(r2.report.status, 'fout');
});

// The bank words an internal transfer differently in a later export
// ("OVERSCHRIJVING VAN x NAAR y" -> "Overschrijving tussen mijn MeDirect-rekeningen").
const OLD_TYPE = 'OVERSCHRIJVING VAN 000000000056 NAAR 000000000057';
const NEW_TYPE = 'Overschrijving tussen mijn MeDirect-rekeningen';
const history = (type, until) =>
  [
    { date: '2026-02-12', t: 'transfer', amount: 300_000 },
    { date: '2026-02-24', t: 'transfer', amount: -27_740 },
    { date: '2026-03-02', t: 'transfer', amount: -50_000 },
    { date: '2026-06-29', t: 'transfer', amount: -10_000 },
    { date: '2026-07-01', t: 'Instantoverschrijving', amount: -12_000 },
    { date: '2026-08-05', t: 'transfer', amount: 40_000 },
    { date: '2026-10-24', t: 'Instantoverschrijving', amount: -5_000 },
  ]
    .filter((m) => m.date <= until)
    .map((m) => ({ date: m.date, type: m.t === 'transfer' ? type : m.t, details: ['Mededeling: test', 'BE00000000000057'], amount: m.amount }));
const pdfOf = (movements) => buildMedirectPdf({ iban: 'BE00000000000055', begin: 0, movements });

test('import: a movement worded differently by the bank is recognised by date, amount and balance after', async () => {
  let d = createEmptyData('2026-10-01T00:00:00.000Z');
  d = importFile(d, await file(pdfOf(history(OLD_TYPE, '2026-07-01')), 'oud.pdf')).data;
  const before = d.transactions.map((t) => t.id).sort();
  const r = importFile(d, await file(pdfOf(history(NEW_TYPE, '2026-12-31')), 'nieuw.pdf'));
  assert.equal(r.report.status, 'ok', JSON.stringify(r.report.messages));
  assert.deepEqual([r.report.newTransactions, r.report.duplicateTransactions], [2, 5]);
  assert.ok(r.report.messages.some((m) => /4 beweging\(en\) herkend aan datum, bedrag en saldo/.test(m.message)));
  assert.ok(!r.report.messages.some((m) => m.level === 'warning'), JSON.stringify(r.report.messages));
  // the known movements keep their id (and so their categories and notes)
  assert.ok(before.every((id) => r.data.transactions.some((t) => t.id === id)));
  assert.equal(r.data.transactions.find((t) => t.entryDate === '2026-02-24').bankType, OLD_TYPE);
});

test('import: duplicates made by an earlier version are reported, put in order, and cleaned up through "Nakijken"', async () => {
  const { importCsv } = await import('../src/core/import/csv-import.js');
  const { MEDIRECT_PROFILE } = await import('../src/core/csv/profiles.js');
  const { checkAccountChain } = await import('../src/core/checks/chain.js');
  const chainOf = (data) => checkAccountChain(data.transactions.filter((t) => t.accountId === 'BE00000000000055').sort((a, b) => a.bookingOrder - b.bookingOrder));
  // damage as before this fix: an old export (old wording) + a new export
  // imported without recognising the reworded movements
  let d = createEmptyData('2026-10-01T00:00:00.000Z');
  d = importFile(d, await file(pdfOf(history(OLD_TYPE, '2026-07-01')), 'oud.pdf')).data;
  const report = { id: 'imp-oud', messages: [], newAccounts: [] };
  const oldProfile = { ...MEDIRECT_PROFILE, matchFields: undefined };
  const damaged = importCsv(d, { fileName: 'nieuw.pdf' }, report, '2026-11-01T00:00:00.000Z', oldProfile, parseMedirectStatement(parsePdf(pdfOf(history(NEW_TYPE, '2026-12-31')))));
  assert.deepEqual(damaged.errors, []);
  d = damaged.data;
  assert.equal(d.possibleDuplicates.length, 4);
  assert.ok(chainOf(d)[0].message.startsWith('Saldoketen onderbroken tussen 29/06/2026 en 12/02/2026'));

  // importing the new export again: the duplicates are reported and the order is restored
  const r = importFile(d, await file(pdfOf(history(NEW_TYPE, '2026-12-31')), 'nieuw2.pdf'));
  assert.equal(r.report.status, 'waarschuwing', JSON.stringify(r.report.messages));
  assert.deepEqual(r.report.messages.filter((m) => m.level === 'warning').length, 1, JSON.stringify(r.report.messages));
  assert.equal(r.report.newTransactions, 0);
  assert.ok(r.report.messages.some((m) => /4 bekende beweging\(en\) staan dubbel/.test(m.message)), JSON.stringify(r.report.messages));
  d = r.data;
  assert.ok(chainOf(d).every((i) => i.from === i.to)); // only breaks within the day of a twin

  // the user removes the newer copies ("Nakijken" -> verwijderen)
  const removedTransactions = {};
  for (const p of d.possibleDuplicates) removedTransactions[p.txId] = { transaction: d.transactions.find((t) => t.id === p.txId), removedAt: 'x', reason: 'mogelijke dubbel' };
  d = { ...d, transactions: d.transactions.filter((t) => !removedTransactions[t.id]), removedTransactions, possibleDuplicates: d.possibleDuplicates.map((p) => ({ ...p, status: 'verwijderd' })) };
  assert.deepEqual(chainOf(d), []);
  // a later export: recognised against the remaining (old) copies, nothing re-added, no warnings
  const later = [...history(NEW_TYPE, '2026-12-31'), { date: '2026-11-03', type: NEW_TYPE, details: ['Mededeling: test', 'BE00000000000057'], amount: 1_000 }];
  const r2 = importFile(d, await file(pdfOf(later), 'nieuw3.pdf'));
  assert.equal(r2.report.status, 'ok', JSON.stringify(r2.report.messages));
  assert.equal(r2.report.newTransactions, 1);
  assert.ok(!r2.report.messages.some((m) => m.level === 'warning'), JSON.stringify(r2.report.messages));
  assert.deepEqual(chainOf(r2.data), []);
  assert.equal(r2.data.transactions.filter((t) => t.accountId === 'BE00000000000055').length, 8);
});
