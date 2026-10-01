import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFile } from '../src/core/import/importer.js';
import { createEmptyData } from '../src/core/model/schema.js';
import { sha256Hex } from '../src/core/hash.js';
import { buildStatement, toFileText, IBAN_A, IBAN_B, IBAN_C } from '../tools/coda-builder.js';

const enc = (s) => new TextEncoder().encode(s);

function stmt(iban, number, oldBalance, date, movements, extra = {}) {
  const d = new Date(Date.UTC(2026, 0, 1 + number));
  const newDate = date ?? d.toISOString().slice(0, 10);
  return buildStatement({ iban, statementNumber: number, oldBalance, oldDate: newDate, newDate, movements, ...extra });
}

async function file(lines, fileName = 'test.cod') {
  const bytes = enc(toFileText(lines));
  return { fileName, bytes, fileHash: await sha256Hex(bytes), source: 'upload', now: '2026-10-01T10:00:00.000Z' };
}

const mv = (seq, amount, extra = {}) => ({ seq, amount, communication: `Beweging ${seq}`, counterparty: { iban: IBAN_C, name: 'TEGENPARTIJ' }, ...extra });

test('imports a file with two accounts; accounts are created from the IBAN', async () => {
  const a = stmt(IBAN_A, 1, 100_000, null, [mv(1, -5_000), mv(2, 20_000)], { last: false });
  const b = stmt(IBAN_B, 1, 5_000_000, null, [mv(1, 1_234)]);
  const { data, report } = importFile(createEmptyData(), await file([...a.lines, ...b.lines]));
  assert.equal(report.status, 'ok', JSON.stringify(report.messages));
  assert.equal(report.newTransactions, 3);
  assert.deepEqual(Object.keys(data.accounts).sort(), [IBAN_A, IBAN_B].sort());
  assert.equal(data.accounts[IBAN_A].ownership.type, 'individueel');
  assert.equal(Object.keys(data.statements).length, 2);
  const t = data.transactions.find((x) => x.accountId === IBAN_A && x.sequence === 1);
  assert.equal(t.id, `${IBAN_A}|2026|001|0001|0000`);
  assert.equal(t.amount, -5_000);
  assert.equal(t.counterparty.name, 'TEGENPARTIJ');
  assert.equal(data.imports.length, 1);
});

test('importing the same file twice yields 0 new transactions', async () => {
  const f = await file(stmt(IBAN_A, 1, 0, null, [mv(1, 1_000), mv(2, -500)]).lines);
  const first = importFile(createEmptyData(), f);
  const second = importFile(first.data, { ...f, now: '2026-10-02T10:00:00.000Z' });
  assert.equal(second.report.status, 'overgeslagen');
  assert.equal(second.report.newTransactions, 0);
  assert.equal(second.data.transactions.length, 2);
  assert.equal(second.data.imports.length, 2);
});

test('same statements in a different file (different hash) yield 0 new transactions', async () => {
  const s1 = stmt(IBAN_A, 1, 0, null, [mv(1, 1_000)]);
  const s2 = stmt(IBAN_A, 2, s1.newBalance, null, [mv(1, 2_000)]);
  const first = importFile(createEmptyData(), await file(s1.lines, 'a.cod'));
  // second file contains statement 1 again plus the new statement 2, with LF line endings
  const bytes = enc([...s1.lines, ...s2.lines].join('\n'));
  const f2 = { fileName: 'b.cod', bytes, fileHash: await sha256Hex(bytes), now: '2026-10-02T00:00:00.000Z' };
  const second = importFile(first.data, f2);
  assert.equal(second.report.newTransactions, 1);
  assert.equal(second.report.duplicateTransactions, 1);
  assert.equal(second.data.transactions.length, 2);
  // and once more: nothing new
  const bytes3 = enc([...s2.lines, ...s1.lines].join('\r\n') + '\r\n');
  const third = importFile(second.data, { fileName: 'c.cod', bytes: bytes3, fileHash: await sha256Hex(bytes3) });
  assert.equal(third.report.newTransactions, 0);
  assert.equal(third.data.transactions.length, 2);
});

test('a statement with the same key but different content is a conflict, nothing changes', async () => {
  const first = importFile(createEmptyData(), await file(stmt(IBAN_A, 1, 0, null, [mv(1, 1_000)]).lines));
  const second = importFile(first.data, await file(stmt(IBAN_A, 1, 0, null, [mv(1, 9_999)]).lines, 'x.cod'));
  assert.equal(second.report.status, 'fout');
  assert.match(second.report.messages[0].message, /andere inhoud/);
  assert.equal(second.data.transactions.length, 1);
  assert.equal(second.data.transactions[0].amount, 1_000);
});

test('a file with a wrong balance is reported and not imported', async () => {
  const bad = stmt(IBAN_A, 1, 100_000, null, [mv(1, -5_000)], { override: { newBalance: 99_000 } });
  const { data, report } = importFile(createEmptyData(), await file(bad.lines));
  assert.equal(report.status, 'fout');
  assert.ok(report.messages.some((m) => /Saldocontrole mislukt/.test(m.message)));
  assert.equal(data.transactions.length, 0);
  assert.equal(Object.keys(data.accounts).length, 0);
  assert.equal(data.imports.length, 1); // but the attempt is logged
  assert.equal(Object.keys(data.fileHashes).length, 0); // and can be retried
});

test('wrong trailer totals and record count are reported', async () => {
  const t1 = stmt(IBAN_A, 1, 0, null, [mv(1, -5_000)], { override: { debitTotal: 4_000 } });
  const r1 = importFile(createEmptyData(), await file(t1.lines));
  assert.equal(r1.report.status, 'fout');
  assert.ok(r1.report.messages.some((m) => /Trailercontrole/.test(m.message)));
  const t2 = stmt(IBAN_A, 1, 0, null, [mv(1, -5_000)], { override: { recordCount: 99 } });
  const r2 = importFile(createEmptyData(), await file(t2.lines));
  assert.ok(r2.report.messages.some((m) => /records/.test(m.message)));
});

test('a missing statement is reported', async () => {
  const s1 = stmt(IBAN_A, 1, 0, null, [mv(1, 1_000)]);
  const s2 = stmt(IBAN_A, 2, s1.newBalance, null, [mv(1, 2_000)]);
  const s3 = stmt(IBAN_A, 3, s2.newBalance, null, [mv(1, 3_000)]);
  const first = importFile(createEmptyData(), await file(s1.lines, '1.cod'));
  const third = importFile(first.data, await file(s3.lines, '3.cod'));
  assert.equal(third.report.status, 'waarschuwing');
  assert.ok(third.report.messages.some((m) => /Ontbrekend uittreksel: 2026\/002/.test(m.message)));
  // after importing the missing one, the warning disappears
  const second = importFile(third.data, await file(s2.lines, '2.cod'));
  assert.equal(second.report.status, 'ok', JSON.stringify(second.report.messages));
});

test('non-CODA content is rejected', async () => {
  const bytes = enc('dit is geen coda\n');
  const { report, data } = importFile(createEmptyData(), { fileName: 'x.txt', bytes, fileHash: await sha256Hex(bytes) });
  assert.equal(report.status, 'fout');
  assert.equal(data.transactions.length, 0);
});

test('globalisation details are stored inside the parent transaction', async () => {
  const s = stmt(IBAN_A, 1, 0, null, [
    { seq: 1, detail: 0, amount: -3_000, txType: '1', globalisation: '1', communication: 'Totaal' },
    { seq: 1, detail: 1, amount: -1_000, txType: '5', communication: 'Detail 1' },
    { seq: 1, detail: 2, amount: -2_000, txType: '5', communication: 'Detail 2' },
  ]);
  const { data, report } = importFile(createEmptyData(), await file(s.lines));
  assert.equal(report.status, 'ok', JSON.stringify(report.messages));
  assert.equal(data.transactions.length, 1);
  assert.equal(data.transactions[0].details.length, 2);
});
