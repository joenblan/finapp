// Per-statement checks on a parsed CODA statement:
//  - old balance + sum of booked movements = new balance
//  - trailer (record 9) debit/credit totals and record count
//  - globalisation: details add up to their parent (warning only)

import { add, sum, negate, formatMilli } from '../money.js';

const fmt = (m) => `€ ${formatMilli(m)}`;

export function checkStatement(st) {
  const issues = [];
  const booked = st.movements.filter((m) => !m.isDetail);
  const movementSum = sum(booked.map((m) => m.amount));
  const expected = add(st.oldBalance ?? 0, movementSum);
  const balance = {
    ok: st.newBalance !== null && expected === st.newBalance,
    oldBalance: st.oldBalance,
    movementSum,
    expected,
    actual: st.newBalance,
  };
  if (!balance.ok) {
    issues.push({
      level: 'error',
      code: 'BALANCE',
      message: `Saldocontrole mislukt: oud saldo ${fmt(st.oldBalance)} + bewegingen ${fmt(movementSum)} = ${fmt(expected)}, maar het nieuwe saldo is ${st.newBalance === null ? 'onbekend' : fmt(st.newBalance)}.`,
    });
  }

  const totals = (list) => {
    let debit = 0;
    let credit = 0;
    for (const m of list) {
      if (m.amount < 0) debit = add(debit, negate(m.amount));
      else credit = add(credit, m.amount);
    }
    return { debit, credit };
  };
  const bookedTotals = totals(booked);
  const allTotals = totals(st.movements);
  const t = st.trailer;
  let trailer = { ok: false, reason: 'geen trailer' };
  if (t) {
    // TODO verify spec: whether trailer totals include globalisation detail lines.
    // Both interpretations are accepted; anything else is an error.
    const totalsOk =
      (t.debitTotal === bookedTotals.debit && t.creditTotal === bookedTotals.credit) ||
      (t.debitTotal === allTotals.debit && t.creditTotal === allTotals.credit);
    // TODO verify spec: whether the trailer record count includes record 4.
    const countOk =
      t.recordCount === st.counts.records || t.recordCount === st.counts.records - st.counts.freeCommunicationRecords;
    trailer = {
      ok: totalsOk && countOk,
      debitTotal: t.debitTotal,
      creditTotal: t.creditTotal,
      computedDebit: bookedTotals.debit,
      computedCredit: bookedTotals.credit,
      recordCount: t.recordCount,
      computedRecordCount: st.counts.records,
    };
    if (!totalsOk) {
      issues.push({
        level: 'error',
        code: 'TRAILER_TOTALS',
        message: `Trailercontrole mislukt: trailer vermeldt debet ${fmt(t.debitTotal)} / credit ${fmt(t.creditTotal)}, berekend debet ${fmt(bookedTotals.debit)} / credit ${fmt(bookedTotals.credit)}.`,
      });
    }
    if (!countOk) {
      issues.push({
        level: 'error',
        code: 'TRAILER_COUNT',
        message: `Trailercontrole mislukt: trailer vermeldt ${t.recordCount} records, bestand bevat er ${st.counts.records}.`,
      });
    }
  } else {
    issues.push({ level: 'error', code: 'TRAILER_MISSING', message: 'Trailerrecord 9 ontbreekt.' });
  }

  // Globalisation: details should add up to the parent amount.
  const bySeq = new Map();
  for (const m of st.movements) {
    if (!bySeq.has(m.sequence)) bySeq.set(m.sequence, []);
    bySeq.get(m.sequence).push(m);
  }
  for (const [seq, list] of bySeq) {
    const parent = list.find((m) => !m.isDetail);
    const details = list.filter((m) => m.isDetail);
    if (!details.length) continue;
    if (!parent) {
      issues.push({ level: 'error', code: 'GLOBALISATION_PARENT', message: `Detailbewegingen van volgnr ${seq} zonder hoofdbeweging.` });
      continue;
    }
    const detailSum = sum(details.map((d) => d.amount));
    if (detailSum !== parent.amount) {
      issues.push({
        level: 'warning',
        code: 'GLOBALISATION_SUM',
        message: `Volgnr ${seq}: som van de details (${fmt(detailSum)}) verschilt van het totaalbedrag (${fmt(parent.amount)}).`,
      });
    }
  }

  return { balance, trailer, issues };
}
