// Continuity between consecutive statements of one account:
//  - statement numbers follow each other (gaps => missing statements)
//  - old balance of statement N equals new balance of statement N-1

import { formatMilli } from '../money.js';

const fmt = (m) => `€ ${formatMilli(m)}`;
const label = (s) => `${s.year}/${String(s.number).padStart(3, '0')}`;

export function sortStatements(statements) {
  return [...statements].sort((a, b) => a.year - b.year || a.number - b.number);
}

/**
 * @param statements stored statements of ONE account
 * @returns issues: { level, code, message, statementId, missing? }
 */
export function checkContinuity(statements) {
  const issues = [];
  const sorted = sortStatements(statements);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    let missing = [];
    if (cur.year === prev.year) {
      for (let n = prev.number + 1; n < cur.number; n++) missing.push({ year: cur.year, number: n });
    } else if (cur.number !== 1 && cur.number !== prev.number + 1) {
      // New year: numbering restarts at 1 (or continues; both accepted).
      // TODO verify: banks that wrap numbering at 999 within a year.
      for (let n = 1; n < cur.number; n++) missing.push({ year: cur.year, number: n });
    }
    if (missing.length) {
      const range =
        missing.length === 1 ? label(missing[0]) : `${label(missing[0])} t.e.m. ${label(missing[missing.length - 1])}`;
      issues.push({
        level: 'error',
        code: 'MISSING_STATEMENT',
        statementId: cur.id,
        missing,
        message: `Ontbrekend uittreksel: ${range} (tussen ${label(prev)} en ${label(cur)}).`,
      });
    }
    if (cur.oldBalance !== prev.newBalance) {
      issues.push({
        level: 'error',
        code: 'BALANCE_GAP',
        statementId: cur.id,
        message: `Saldo sluit niet aan: uittreksel ${label(prev)} eindigt op ${fmt(prev.newBalance)}, ${label(cur)} begint op ${fmt(cur.oldBalance)}.`,
      });
    }
  }
  return issues;
}
