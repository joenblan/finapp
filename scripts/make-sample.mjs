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

// Synthetic VDK CSV export (same structure as the real export)
{
  const { buildVdkCsv } = await import('../tools/vdk-builder.js');
  const f = buildVdkCsv({
    iban: 'BE00000000000001',
    name: 'Jan Voorbeeld',
    kind: 'You Count zichtrekening',
    balanceAt: '1/10/2026 9:52',
    openingBalance: 100_000,
    movements: [
      { ref: '10000000001', date: '2026-09-30', year: 2026, number: 3, type: 'Overschrijving', cpIban: 'BE00000000000004', cpBic: 'BBRUBEBBXXX', cpName: 'WERKGEVER NV', cpStreet: 'VOORBEELDSTRAAT 1', cpPostcode: '1000', cpCity: 'BRUSSEL', comm: '/A/X000000 - 000000-000000 BETALING-09/2026---\nRef.opdrachtgever: 260901-000000-/A/X000000', amount: 2_500_000 },
      { ref: '10000000002', date: '2026-10-01', valueDate: '2026-09-29', type: 'Visa Debit betaling', comm: 'BAKKERIJ VOORBEELD 00000 GENT BE\n29/09/2026 12:46\nCARD: 0000 **** **** 0000', amount: -7_800 },
      { ref: '10000000003', date: '2026-10-01', type: 'Bestendige opdracht', cpIban: 'BE00000000000003', cpBic: 'NICABEBBXXX', cpName: 'gemeenschappelijke rekening', cpCountry: 'België', comm: 'gemeenschappelijk', amount: -1_500_000 },
      { ref: '10000000004', date: '2026-10-01', type: 'Uw overschrijving', cpIban: 'BE00000000000002', cpBic: 'VDSPBE91', cpName: 'Jan Voorbeeld', amount: -90_000 },
    ],
  });
  await writeFile(`voorbeelden/${f.fileName}`, f.bytes);
  console.log(`voorbeelden/${f.fileName}`);
}

// Synthetic Crelan CSV export (joint account), newest movement at the bottom
{
  const { buildCrelanCsv } = await import('../tools/crelan-builder.js');
  const f = buildCrelanCsv({
    own: 'BE00000000000003',
    movements: [
      { date: '2025-01-27', amount: 1_000, cp: 'JAN VOORBEELD', cpIban: 'BE00000000000005', type: 'Instantoverschr. in uw voordeel' },
      { date: '2025-01-27', amount: -50, cp: 'CAFE VOORBEELD       Gent', type: 'eCommerce Mobile', comm: 'CAFE VOORBEELD 27-01-2025 16:38 Gent 000000******0000' },
      { date: '2025-01-28', amount: 1_500_000, cp: 'JAN VOORBEELD', cpIban: 'BE00000000000001', type: 'Overschrijving in uw voordeel', comm: 'gemeenschappelijk' },
      { date: '2025-01-28', amount: -3_500, cp: 'BAKKER VOORBEELD    Gent', type: 'Betaling Bancontact contactless', comm: 'BAKKER VOORBEELD 28-01-2025 08:12 Gent 000000******0000' },
      { date: '2025-01-30', amount: -82_150, cp: 'ENERGIE NV', cpIban: 'BE00000000000006', type: 'Domiciliëring', comm: 'Voorschot februari' },
    ],
  });
  await writeFile('voorbeelden/searchMovement.csv', f.bytes);
  console.log('voorbeelden/searchMovement.csv');
}

// Phase 2 dataset (voorbeelden/fase2/): 2 individual accounts (VDK CSV + CODA)
// and 1 joint account (Crelan CSV) with transfers between them.
{
  const { buildVdkCsv } = await import('../tools/vdk-builder.js');
  const { buildCrelanCsv } = await import('../tools/crelan-builder.js');
  await mkdir('voorbeelden/fase2', { recursive: true });
  const VDK = 'BE00000000000001';
  const JOINT = 'BE00000000000003';
  const vdk = buildVdkCsv({
    iban: VDK,
    name: 'Jan Voorbeeld',
    kind: 'You Count zichtrekening',
    balanceAt: '6/10/2026 9:00',
    openingBalance: 1_000_000,
    movements: [
      { ref: '30000000001', date: '2026-09-25', type: 'Domiciliëring', cpIban: 'BE00000000000006', cpName: 'ENERGIE NV', comm: 'Voorschot oktober', amount: -82_150 },
      { ref: '30000000002', date: '2026-09-30', year: 2026, number: 3, type: 'Overschrijving', cpIban: 'BE00000000000004', cpName: 'WERKGEVER NV', comm: 'Loon september', amount: 2_500_000 },
      { ref: '30000000003', date: '2026-10-01', valueDate: '2026-09-29', type: 'Visa Debit betaling', comm: 'BAKKERIJ VOORBEELD 00000 GENT BE\n29/09/2026 12:46\nCARD: 0000 **** **** 0000', amount: -7_800 },
      { ref: '30000000004', date: '2026-10-01', type: 'Bestendige opdracht', cpIban: JOINT, cpName: 'gemeenschappelijke rekening', comm: 'gemeenschappelijk', amount: -1_500_000 },
      { ref: '30000000005', date: '2026-10-02', type: 'Uw overschrijving', cpIban: 'BE00000000000002', cpName: 'Jan Voorbeeld', comm: 'naar spaarboekje', amount: -200_000 },
      { ref: '30000000006', date: '2026-10-03', type: 'Overschrijving', cpIban: JOINT, cpName: 'gemeenschappelijke rekening', comm: 'terugbetaling energie', amount: 82_150 },
      { ref: '30000000007', date: '2026-10-04', type: 'Overschrijving', cpIban: 'BE00000000000008', cpName: 'STREAMING BV', comm: 'Abonnement oktober', amount: -9_990 },
    ],
  });
  await writeFile(`voorbeelden/fase2/${vdk.fileName}`, vdk.bytes);
  const a = buildStatement({
    iban: IBAN_A, statementNumber: 40, oldBalance: 500_000, oldDate: '2026-09-30', newDate: '2026-10-01', holder: 'JAN VOORBEELD', description: 'ZICHTREKENING',
    movements: [
      { seq: 1, amount: -45_990, communication: 'Betaling Bancontact Fictieve Supermarkt', counterparty: { iban: IBAN_C, name: 'FICTIEVE SUPERMARKT' } },
      { seq: 2, amount: -100_000, communication: 'Naar spaarrekening', counterparty: { iban: IBAN_B, name: 'JAN VOORBEELD' } },
      { seq: 3, amount: -250_000, communication: 'Bijdrage gemeenschappelijk', counterparty: { iban: JOINT, name: 'GEMEENSCHAPPELIJKE REKENING' } },
    ],
    last: false,
  });
  const b = buildStatement({
    iban: IBAN_B, statementNumber: 12, oldBalance: 5_000_000, oldDate: '2026-09-30', newDate: '2026-10-01', holder: 'JAN VOORBEELD', description: 'SPAARREKENING',
    movements: [{ seq: 1, amount: 100_000, communication: 'Naar spaarrekening', counterparty: { iban: IBAN_A, name: 'JAN VOORBEELD' } }],
  });
  await writeFile('voorbeelden/fase2/jan-coda.cod', encodeWindows1252(toFileText([...a.lines, ...b.lines])));
  const joint = buildCrelanCsv({
    own: JOINT,
    order: 'newest-first',
    movements: [
      { date: '2026-10-01', amount: 1_500_000, cp: 'JAN VOORBEELD', cpIban: VDK, type: 'Overschrijving in uw voordeel', comm: 'gemeenschappelijk' },
      { date: '2026-10-01', amount: 250_000, cp: 'JAN VOORBEELD', cpIban: IBAN_A, type: 'Instantoverschr. in uw voordeel', comm: 'Bijdrage gemeenschappelijk' },
      { date: '2026-10-02', amount: 1_000_000, cp: 'AN VOORBEELD', cpIban: 'BE00000000000011', type: 'Instantoverschr. in uw voordeel', comm: 'bijdrage' },
      { date: '2026-10-02', amount: -65_400, cp: 'SUPERMARKT VOORBEELD    Gent', type: 'Betaling Bancontact contactless', comm: 'SUPERMARKT VOORBEELD 02-10-2026 17:05 Gent 000000******0000' },
      { date: '2026-10-03', amount: -82_150, cp: 'JAN VOORBEELD', cpIban: VDK, type: 'Overschrijving via Crelan Mobile', comm: 'terugbetaling energie' },
      { date: '2026-10-04', amount: -30_000, cp: 'KAPPER VOORBEELD    Gent', type: 'Betaling Bancontact contactless', comm: 'KAPPER VOORBEELD 04-10-2026 10:30 Gent 000000******0000' },
      { date: '2026-10-05', amount: -18_250, cp: 'WATER NV', cpIban: 'BE00000000000012', type: 'Domiciliëring', comm: 'Water oktober' },
    ],
  });
  await writeFile('voorbeelden/fase2/searchMovement.csv', joint.bytes);
  console.log('voorbeelden/fase2/ (3 bestanden)');
}

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
