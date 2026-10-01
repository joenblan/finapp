import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoda, parseCodaDate } from '../src/core/coda/parser.js';
import {
  buildStatement,
  toFileText,
  encodeWindows1252,
  structuredDigits,
  freeCommunicationRecord,
  IBAN_A,
  IBAN_B,
  IBAN_C,
} from '../tools/coda-builder.js';

const errorsOf = (r) => r.issues.filter((i) => i.level === 'error');

function sampleStatement(extra = {}) {
  return buildStatement({
    iban: IBAN_A,
    statementNumber: 12,
    oldBalance: 1_500_000, // € 1.500,00
    oldDate: '2026-03-01',
    newDate: '2026-03-02',
    holder: 'JAN TESTPERSOON',
    description: 'ZICHTREKENING',
    movements: [
      {
        seq: 1,
        amount: -45_990,
        communication: 'Aankoop winkel Testdorp kaart 1234',
        counterparty: { iban: IBAN_C, name: 'FICTIEVE WINKEL BV', bic: 'FICTBEBB' },
        info: { text: 'FICTIEVE WINKEL BV TESTSTRAAT 1 9999 TESTDORP' },
      },
      { seq: 2, amount: 2_100_000, structured: structuredDigits('1234567890'), counterparty: { iban: IBAN_B, name: 'WERKGEVER FICTIEF NV' } },
      { seq: 3, amount: -1_000, communication: 'Kosten' },
    ],
    free: [{ seq: 1, text: 'Vrije mededeling van de fictieve bank' }],
    ...extra,
  });
}

test('parses header (0), old balance (1), new balance (8) and trailer (9)', () => {
  const { lines } = sampleStatement();
  const r = parseCoda(toFileText(lines));
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.statements.length, 1);
  const st = r.statements[0];
  assert.equal(st.header.version, '2');
  assert.equal(st.header.creationDate, '2026-03-02');
  assert.equal(st.header.applicationCode, '05');
  assert.equal(st.header.duplicate, false);
  assert.equal(st.account.number, IBAN_A);
  assert.equal(st.account.currency, 'EUR');
  assert.equal(st.account.isIban, true);
  assert.equal(st.paperStatementNumber, 12);
  assert.equal(st.oldBalance, 1_500_000);
  assert.equal(st.oldBalanceDate, '2026-03-01');
  assert.equal(st.holderName, 'JAN TESTPERSOON');
  assert.equal(st.description, 'ZICHTREKENING');
  assert.equal(st.newBalance, 1_500_000 - 45_990 + 2_100_000 - 1_000);
  assert.equal(st.newBalanceDate, '2026-03-02');
  assert.equal(st.trailer.debitTotal, 46_990);
  assert.equal(st.trailer.creditTotal, 2_100_000);
  assert.equal(st.trailer.recordCount, lines.length - 2);
  assert.equal(st.trailer.multipleFileCode, '1');
});

test('merges 21 + 22 + 23 + 31 into one movement', () => {
  const r = parseCoda(toFileText(sampleStatement().lines));
  const m = r.statements[0].movements[0];
  assert.equal(r.statements[0].movements.length, 3);
  assert.equal(m.sequence, 1);
  assert.equal(m.detail, 0);
  assert.equal(m.amount, -45_990);
  assert.equal(m.communication.text, 'Aankoop winkel Testdorp kaart 1234');
  assert.equal(m.counterparty.account, IBAN_C);
  assert.equal(m.counterparty.isIban, true);
  assert.equal(m.counterparty.name, 'FICTIEVE WINKEL BV');
  assert.equal(m.counterparty.bic, 'FICTBEBB');
  assert.equal(m.counterparty.currency, 'EUR');
  assert.equal(m.information.length, 1);
  assert.equal(m.information[0].text, 'FICTIEVE WINKEL BV TESTSTRAAT 1 9999 TESTDORP');
  assert.equal(m.lines.length, 3); // 21, 22, 23
  assert.equal(m.entryDate, '2026-03-02');
});

test('communication spanning 21, 22 and 23 is joined without breaking words', () => {
  const long =
    'Dit is een fictieve lange mededeling die over meerdere records verspreid wordt en woorden midden in kan splitsen tot op het einde van record drie';
  const { lines } = buildStatement({
    iban: IBAN_A,
    statementNumber: 1,
    oldBalance: 0,
    oldDate: '2026-01-01',
    newDate: '2026-01-02',
    movements: [{ seq: 1, amount: 5_000, communication: long }],
  });
  const r = parseCoda(toFileText(lines));
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.statements[0].movements[0].communication.text, long);
});

test('information records 31 + 32 are merged', () => {
  const text = 'X'.repeat(73) + 'Vervolg van de informatie in record 32';
  const { lines } = buildStatement({
    iban: IBAN_A,
    statementNumber: 1,
    oldBalance: 0,
    oldDate: '2026-01-01',
    newDate: '2026-01-02',
    movements: [{ seq: 1, amount: 5_000, communication: 'x', info: { text } }],
  });
  const r = parseCoda(toFileText(lines));
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.statements[0].movements[0].information[0].text, text);
});

test('structured communication is decoded and validated', () => {
  const r = parseCoda(toFileText(sampleStatement().lines));
  const m = r.statements[0].movements[1];
  assert.equal(m.communication.structured, '+++123/4567/89002+++');
  assert.equal(m.communication.structuredType, '101');
  assert.equal(m.communication.structuredValid, true);
  assert.equal(m.counterparty.name, 'WERKGEVER FICTIEF NV');
});

test('debit and credit signs', () => {
  const r = parseCoda(toFileText(sampleStatement().lines));
  const [a, b, c] = r.statements[0].movements;
  assert.ok(a.amount < 0);
  assert.ok(b.amount > 0);
  assert.equal(c.amount, -1_000);
  for (const m of r.statements[0].movements) assert.ok(Number.isSafeInteger(m.amount));
});

test('negative (debit) balances in records 1 and 8', () => {
  const { lines } = buildStatement({
    iban: IBAN_A,
    statementNumber: 5,
    oldBalance: -250_000,
    oldDate: '2026-02-01',
    newDate: '2026-02-02',
    movements: [{ seq: 1, amount: -10_000, communication: 'x' }],
  });
  const st = parseCoda(toFileText(lines)).statements[0];
  assert.equal(st.oldBalance, -250_000);
  assert.equal(st.newBalance, -260_000);
});

test('free communication record 4 is kept', () => {
  const st = parseCoda(toFileText(sampleStatement().lines)).statements[0];
  assert.equal(st.freeCommunications.length, 1);
  assert.equal(st.freeCommunications[0].text, 'Vrije mededeling van de fictieve bank');
  assert.equal(st.counts.freeCommunicationRecords, 1);
});

test('hand-written literal record lines are read at the right positions', () => {
  // Independent of the builder: literal 128-char lines typed from the spec layout.
  const L = [
    '0000002032699905        TESTREF   FICTIEF PERSOON           TESTBEBB                                                           2',
    '12007BE10999000000505                  EUR0000000000010000010326FICTIEF PERSOON           ZICHTREKENING                      007',
    '2100010000LITERALREF000000000010000000000012345020326001010000LITERAL MEDEDELING                                   02032600701 0',
    '2300010000BE65999000000403                  EURFICTIEVE TEGENPARTIJ                                                          0 0',
    '8007BE10999000000505                  EUR0000000000022345020326                                                                0',
    '9               000004000000000000000000000000012345                                                                           1',
  ];
  for (const l of L) assert.equal(l.length, 128, l);
  const r = parseCoda(L.join('\n'));
  assert.deepEqual(errorsOf(r), []);
  const st = r.statements[0];
  assert.equal(st.header.creationDate, '2026-03-02');
  assert.equal(st.header.bankId, '999');
  assert.equal(st.account.number, 'BE10999000000505');
  assert.equal(st.paperStatementNumber, 7);
  assert.equal(st.oldBalance, 10_000);
  assert.equal(st.oldBalanceDate, '2026-03-01');
  assert.equal(st.codaSequenceNumber, '007');
  const m = st.movements[0];
  assert.equal(m.bankReference, 'LITERALREF00000000001');
  assert.equal(m.amount, 12_345);
  assert.equal(m.valueDate, '2026-03-02');
  assert.deepEqual(m.txCode, { type: '0', family: '01', transaction: '01', category: '000' });
  assert.equal(m.communication.text, 'LITERAL MEDEDELING');
  assert.equal(m.entryDate, '2026-03-02');
  assert.equal(m.paperStatementNumber, '007');
  assert.equal(m.counterparty.account, 'BE65999000000403');
  assert.equal(m.counterparty.name, 'FICTIEVE TEGENPARTIJ');
  assert.equal(st.newBalance, 22_345);
  assert.equal(st.trailer.recordCount, 4);
  assert.equal(st.trailer.creditTotal, 12_345);
});

test('Windows-1252 and UTF-8 encodings are both decoded', () => {
  const build = () =>
    buildStatement({
      iban: IBAN_A,
      statementNumber: 1,
      oldBalance: 0,
      oldDate: '2026-01-01',
      newDate: '2026-01-02',
      movements: [{ seq: 1, amount: 1_000, communication: 'Café Élise - crème brûlée €' }],
    });
  const text = toFileText(build().lines);
  const cp = parseCoda(encodeWindows1252(text));
  assert.equal(cp.encoding, 'windows-1252');
  assert.equal(cp.statements[0].movements[0].communication.text, 'Café Élise - crème brûlée €');
  const u8 = parseCoda(new TextEncoder().encode(text));
  assert.equal(u8.encoding, 'utf-8');
  assert.equal(u8.statements[0].movements[0].communication.text, 'Café Élise - crème brûlée €');
});

test('multiple statements and accounts in one file', () => {
  const a = buildStatement({ iban: IBAN_A, statementNumber: 1, oldBalance: 0, oldDate: '2026-01-01', newDate: '2026-01-02', movements: [{ seq: 1, amount: 100, communication: 'a' }], last: false });
  const b = buildStatement({ iban: IBAN_B, statementNumber: 9, oldBalance: 500, oldDate: '2026-01-01', newDate: '2026-01-02', movements: [{ seq: 1, amount: -100, communication: 'b' }] });
  const r = parseCoda(toFileText([...a.lines, ...b.lines], '\n'));
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.statements.length, 2);
  assert.equal(r.statements[0].account.number, IBAN_A);
  assert.equal(r.statements[1].account.number, IBAN_B);
  assert.equal(r.statements[1].paperStatementNumber, 9);
});

test('file without line breaks (concatenated 128-char records)', () => {
  const r = parseCoda(sampleStatement().lines.join(''));
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.statements[0].movements.length, 3);
});

test('globalisation: detail lines are flagged as details', () => {
  const { lines } = buildStatement({
    iban: IBAN_A,
    statementNumber: 3,
    oldBalance: 0,
    oldDate: '2026-01-01',
    newDate: '2026-01-02',
    movements: [
      { seq: 1, detail: 0, amount: -3_000, txType: '1', globalisation: '1', communication: 'Totaal' },
      { seq: 1, detail: 1, amount: -1_000, txType: '5', communication: 'Detail 1' },
      { seq: 1, detail: 2, amount: -2_000, txType: '5', communication: 'Detail 2' },
    ],
  });
  const st = parseCoda(toFileText(lines)).statements[0];
  assert.deepEqual(
    st.movements.map((m) => [m.sequence, m.detail, m.isDetail]),
    [
      [1, 0, false],
      [1, 1, true],
      [1, 2, true],
    ],
  );
  assert.equal(st.newBalance, -3_000);
});

test('structural errors are reported, not ignored', () => {
  const { lines } = sampleStatement();
  // 1) truncated file (no trailer)
  let r = parseCoda(lines.slice(0, -1).join('\n'));
  assert.ok(errorsOf(r).some((e) => e.code === 'MISSING_TRAILER'));
  // 2) bad amount digits
  const bad = [...lines];
  bad[2] = bad[2].slice(0, 32) + 'ABCDEFGHIJKLMNO' + bad[2].slice(47);
  r = parseCoda(bad.join('\n'));
  assert.ok(errorsOf(r).some((e) => e.code === 'AMOUNT' && e.line === 3));
  // 3) 22 record not belonging to the previous 21
  const orphan = [...lines];
  orphan[3] = '22' + '0099' + orphan[3].slice(6);
  r = parseCoda(orphan.join('\n'));
  assert.ok(errorsOf(r).some((e) => e.code === 'ORPHAN_2X'));
  // 4) unsupported version
  const v1 = [...lines];
  v1[0] = v1[0].slice(0, 127) + '1';
  r = parseCoda(v1.join('\n'));
  assert.ok(errorsOf(r).some((e) => e.code === 'VERSION'));
  // 5) line too long
  const long = [...lines];
  long[4] = long[4] + 'XYZ';
  r = parseCoda(long.join('\n'));
  assert.ok(errorsOf(r).some((e) => e.code === 'LINE_LENGTH'));
  // 6) record 8 for a different account
  const acc = [...lines];
  const i8 = acc.findIndex((l) => l[0] === '8');
  acc[i8] = acc[i8].replace(IBAN_A, IBAN_B);
  r = parseCoda(acc.join('\n'));
  assert.ok(errorsOf(r).some((e) => e.code === 'ACCOUNT_MISMATCH'));
});

test('dates: DDMMYY, invalid dates rejected, 000000 value date allowed', () => {
  assert.equal(parseCodaDate('311226'), '2026-12-31');
  assert.equal(parseCodaDate('290224'), '2024-02-29');
  assert.throws(() => parseCodaDate('290226'));
  assert.throws(() => parseCodaDate('320126'));
  assert.equal(parseCodaDate('000000', { allowZero: true }), null);
  assert.throws(() => parseCodaDate('000000'));
});

test('record 4 helper produces a 128-char line', () => {
  assert.equal(freeCommunicationRecord({ text: 'x' }).length, 128);
});
