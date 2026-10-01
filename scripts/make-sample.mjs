// Generates SYNTHETIC sample files (fictitious IBANs and names) in voorbeelden/.
// Usage: npm run sample            -> voorbeelden/synthetisch-2-rekeningen.cod
//        npm run sample -- --groot -> also voorbeelden/synthetisch-groot.cod (≈20.000 transacties)
import { writeFile, mkdir } from 'node:fs/promises';
import { buildStatement, toFileText, encodeWindows1252, structuredDigits, IBAN_A, IBAN_B, IBAN_C, belgianIban } from '../tools/coda-builder.js';

await mkdir('voorbeelden', { recursive: true });

const a = buildStatement({
  iban: IBAN_A,
  statementNumber: 1,
  oldBalance: 1_250_000,
  oldDate: '2026-09-01',
  newDate: '2026-09-02',
  holder: 'JAN VOORBEELD',
  description: 'ZICHTREKENING',
  movements: [
    { seq: 1, amount: -45_990, communication: 'Betaling Bancontact Fictieve Supermarkt Testdorp', counterparty: { iban: IBAN_C, name: 'FICTIEVE SUPERMARKT', bic: 'FICTBEBB' } },
    { seq: 2, amount: 2_650_000, structured: structuredDigits('0909202601'), counterparty: { iban: belgianIban('9990000009'), name: 'WERKGEVER FICTIEF NV' }, info: { text: 'WERKGEVER FICTIEF NV TESTLAAN 1 9999 TESTDORP' } },
    { seq: 3, amount: -850_000, communication: 'Huur september – appartement Teststraat 1', counterparty: { iban: belgianIban('9990000010'), name: 'VERHUURDER FICTIEF' } },
    { seq: 4, amount: -500_000, communication: 'Naar spaarrekening', counterparty: { iban: IBAN_B, name: 'JAN VOORBEELD' } },
  ],
  last: false,
});
const b = buildStatement({
  iban: IBAN_B,
  statementNumber: 1,
  oldBalance: 10_000_000,
  oldDate: '2026-09-01',
  newDate: '2026-09-02',
  holder: 'JAN VOORBEELD',
  description: 'SPAARREKENING',
  movements: [{ seq: 1, amount: 500_000, communication: 'Naar spaarrekening', counterparty: { iban: IBAN_A, name: 'JAN VOORBEELD' } }],
});
await writeFile('voorbeelden/synthetisch-2-rekeningen.cod', encodeWindows1252(toFileText([...a.lines, ...b.lines])));
console.log('voorbeelden/synthetisch-2-rekeningen.cod');

if (process.argv.includes('--groot')) {
  const lines = [];
  let balance = 0;
  const statements = 400;
  for (let s = 1; s <= statements; s++) {
    const day = new Date(Date.UTC(2020, 0, 1) + s * 86400000 * 4).toISOString().slice(0, 10);
    const movements = Array.from({ length: 50 }, (_, i) => ({
      seq: i + 1,
      amount: ((s * 7919 + i * 104729) % 200_000) - 100_000,
      communication: `Fictieve betaling ${s}-${i + 1}`,
      counterparty: { iban: IBAN_C, name: `TEGENPARTIJ ${(s + i) % 97}` },
    }));
    const st = buildStatement({ iban: belgianIban('9990000042'), statementNumber: ((s - 1) % 999) + 1, oldBalance: balance, oldDate: day, newDate: day, movements, description: 'GROTE TESTREKENING', last: s === statements });
    balance = st.newBalance;
    lines.push(...st.lines);
  }
  await writeFile('voorbeelden/synthetisch-groot.cod', toFileText(lines));
  console.log('voorbeelden/synthetisch-groot.cod');
}
