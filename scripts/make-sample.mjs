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

// Phase 3 dataset (voorbeelden/fase3/): 13 months (sep 2025 – sep 2026) of a
// personal VDK account and a joint Crelan account. Fictitious, deterministic.
{
  const { buildVdkCsv } = await import('../tools/vdk-builder.js');
  const { buildCrelanCsv } = await import('../tools/crelan-builder.js');
  await mkdir('voorbeelden/fase3', { recursive: true });
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const VDK = 'BE00000000000001';
  const JOINT = 'BE00000000000003';
  const months = [];
  for (let y = 2025, m = 9; y < 2026 || m <= 9; m++) {
    if (m > 12) { m = 1; y++; }
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  const lastDay = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const salaryDay = { '2026-05': 29, '2026-02': 27, '2025-11': 28 };
  const v = [];
  const j = [];
  let ref = 1;
  const D = (ym, d) => `${ym}-${String(d).padStart(2, '0')}`;
  for (const ym of months) {
    v.push({ date: D(ym, 1), type: 'Bestendige opdracht', cpIban: JOINT, cpName: 'gemeenschappelijke rekening', comm: 'gemeenschappelijk', amount: -1_500_000 });
    v.push({ date: D(ym, 2), type: 'Uw overschrijving', cpIban: 'BE00000000000002', cpName: 'Jan Voorbeeld', comm: 'naar spaarboekje', amount: -200_000 });
    v.push({ date: D(ym, 5 + Math.floor(rnd() * 5) - 2), type: 'Domiciliëring', cpIban: 'BE00000000000020', cpName: 'STREAMING BV', comm: 'abonnement', amount: ym >= '2026-09' ? -11_990 : -9_990 });
    v.push({ date: D(ym, 18), type: 'Domiciliëring', cpIban: 'BE00000000000021', cpName: 'TELECOM NV', comm: 'gsm-abonnement', amount: -25_000 });
    const shops = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < shops; i++) {
      const day = 3 + Math.floor(rnd() * 24);
      v.push({ date: D(ym, day), type: 'Visa Debit betaling', comm: `SUPERMARKT VOORBEELD 9000 GENT BE\n${String(day).padStart(2, '0')}/${ym.slice(5, 7)}/${ym.slice(0, 4)} 17:30\nCARD: 0000 **** **** 0000`, amount: -(15_000 + Math.floor(rnd() * 75) * 1_000) });
    }
    if (rnd() < 0.7) v.push({ date: D(ym, 12 + Math.floor(rnd() * 10)), type: 'Visa Debit betaling', comm: `RESTAURANT VOORBEELD 9000 GENT BE\n${D(ym, 12).slice(8, 10)}/${ym.slice(5, 7)}/${ym.slice(0, 4)} 20:00\nCARD: 0000 **** **** 0000`, amount: -(35_000 + Math.floor(rnd() * 40) * 1_000) });
    if (ym === '2025-09' || ym === '2026-09') v.push({ date: D(ym, ym === '2025-09' ? 15 : 14), type: 'Domiciliëring', cpIban: 'BE00000000000030', cpName: 'VERZEKERING NV', comm: 'autoverzekering jaarpremie', amount: ym === '2025-09' ? -420_000 : -436_000 });
    v.push({ date: D(ym, salaryDay[ym] ?? lastDay(ym)), type: 'Overschrijving', cpIban: 'BE00000000000004', cpName: 'WERKGEVER NV', comm: `Loon ${ym}`, amount: 2_650_000 });
    // joint account
    j.push({ date: D(ym, 1), amount: 1_500_000, cp: 'JAN VOORBEELD', cpIban: VDK, type: 'Overschrijving in uw voordeel', comm: 'gemeenschappelijk' });
    j.push({ date: D(ym, 3), amount: 1_000_000, cp: 'AN VOORBEELD', cpIban: 'BE00000000000011', type: 'Instantoverschr. in uw voordeel', comm: 'bijdrage' });
    j.push({ date: D(ym, 10), amount: -(140_000 + Math.floor(rnd() * 10) * 1_000), cp: 'ENERGIE NV', cpIban: 'BE00000000000006', type: 'Domiciliëring', comm: 'voorschot energie' });
    if (['2025-09', '2025-12', '2026-03', '2026-06', '2026-09'].includes(ym)) j.push({ date: D(ym, 12), amount: -55_000, cp: 'WATER NV', cpIban: 'BE00000000000012', type: 'Domiciliëring', comm: 'water' });
    j.push({ date: D(ym, 25), amount: -60_000, cp: 'INTERNET NV', cpIban: 'BE00000000000022', type: 'Domiciliëring', comm: 'internet' });
    const shopsJ = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < shopsJ; i++) {
      const day = 4 + Math.floor(rnd() * 23);
      j.push({ date: D(ym, day), amount: -(30_000 + Math.floor(rnd() * 90) * 1_000), cp: 'SUPERMARKT VOORBEELD    Gent', type: 'Betaling Bancontact contactless', comm: `SUPERMARKT VOORBEELD ${D(ym, day).split('-').reverse().join('-')} 11:15 Gent 000000******0000` });
    }
  }
  const byDate = (a, b) => a.date.localeCompare(b.date);
  v.sort(byDate);
  j.sort(byDate);
  for (const m of v) m.ref = `4${String(ref++).padStart(10, '0')}`;
  const vdk = buildVdkCsv({ iban: VDK, name: 'Jan Voorbeeld', kind: 'You Count zichtrekening', balanceAt: '30/9/2026 18:00', openingBalance: 3_000_000, movements: v });
  await writeFile(`voorbeelden/fase3/${vdk.fileName}`, vdk.bytes);
  const joint = buildCrelanCsv({ own: JOINT, order: 'newest-first', openingBalance: 500_000, movements: j });
  await writeFile('voorbeelden/fase3/searchMovement.csv', joint.bytes);
  console.log(`voorbeelden/fase3/ (${v.length} + ${j.length} bewegingen)`);

  // Phase 4 (voorbeelden/fase4/): the same data plus the payments of a
  // fictitious mortgage loan with 2 tranches on the joint account, debited
  // separately per tranche; the April 2026 payment of tranche A deviates (+ € 5).
  // Loan details to enter: see voorbeelden/fase4/LENING.txt.
  const { trancheSchedule } = await import('../src/core/loans/schedule.js');
  await mkdir('voorbeelden/fase4', { recursive: true });
  const BANK = 'BE00000000000077';
  const tranches = [
    { name: 'Deelkrediet A', principal: 180_000_000, annualRate: '3,00', months: 300, firstPaymentDate: '2025-12-05', paymentDay: 5, type: 'annuiteit', rateMethod: 'gelijkwaardig' },
    { name: 'Deelkrediet B', principal: 20_000_000, annualRate: '2,50', months: 120, firstPaymentDate: '2025-12-05', paymentDay: 5, type: 'lineair', rateMethod: 'gelijkwaardig' },
  ];
  const j4 = [...j];
  tranches.forEach((t, i) => {
    for (const r of trancheSchedule(t).rows.filter((x) => x.date <= '2026-09-30')) {
      const deviate = i === 0 && r.date === '2026-04-05' ? 5_000 : 0;
      j4.push({ date: r.date, amount: -(r.payment + deviate), cp: 'FICTIBANK HYPOTHEKEN', cpIban: BANK, type: 'Domiciliëring', comm: `woonkrediet ${t.name.slice(-1)} termijn ${r.n}` });
    }
  });
  j4.sort(byDate);
  const joint4 = buildCrelanCsv({ own: JOINT, order: 'newest-first', openingBalance: 2_500_000, movements: j4 });
  await writeFile(`voorbeelden/fase4/${vdk.fileName}`, vdk.bytes);
  await writeFile('voorbeelden/fase4/searchMovement.csv', joint4.bytes);
  await writeFile(
    'voorbeelden/fase4/LENING.txt',
    [
      'Fictieve lening voor de voorbeelddata van fase 4 (in te voeren bij Woonkrediet):',
      '',
      'Naam: Woonkrediet Fictibank',
      'Afbetaald van: gemeenschappelijke rekening BE00 0000 0000 0003',
      'Kredietgever: BE00000000000077 FICTIBANK HYPOTHEKEN',
      'Kredietnemers: Jan 50; An 50',
      '',
      'Deelkrediet A: 180.000,00 - 3,00 % - 300 maanden - eerste afbetaling 05/12/2025 - vaste maandlast - gelijkwaardige maandrente',
      'Deelkrediet B: 20.000,00 - 2,50 % - 120 maanden - eerste afbetaling 05/12/2025 - constante kapitaalaflossing - gelijkwaardige maandrente',
      '',
      'De afbetaling van 05/04/2026 voor deelkrediet A is 5,00 euro te hoog (afwijkend bedrag).',
      'Woning (vermogen): Woning Voorbeeldstraat, eigenaars Jan 50; An 50, waardering 01/11/2025: 320.000,00 en 01/09/2026: 330.000,00',
      '',
    ].join('\r\n'),
  );
  console.log(`voorbeelden/fase4/ (${v.length} + ${j4.length} bewegingen)`);
}

// MeDirect (PDF statement, fictitious): voorbeelden/medirect/
{
  const { buildMedirectPdf, MEDIRECT_EXAMPLE } = await import('../tools/medirect-pdf-builder.js');
  await mkdir('voorbeelden/medirect', { recursive: true });
  await writeFile('voorbeelden/medirect/000000000055_02_10_2026_10_58.pdf', buildMedirectPdf(MEDIRECT_EXAMPLE));
  console.log('voorbeelden/medirect/ (1 PDF-afschrift)');
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
