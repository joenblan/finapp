// Pure helpers for the CSV mapping wizard: guess settings, build a profile.
import { decodeCodaBytes } from '../coda/decode.js';
import { parseCsv, isEmptyRecord } from './csv.js';
import { parseDateTime, parseAmount, DATE_FORMATS } from './notation.js';

export function decodePreview(bytes) {
  return decodeCodaBytes(bytes);
}

export function guessDelimiter(text) {
  const sample = text.split(/\r\n|\n|\r/).slice(0, 30).join('\n');
  const counts = [';', ',', '\t', '|'].map((d) => [d, sample.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

/** Header guess: the first record followed by a record with the same number of non-empty-ish fields and a date in it. */
export function guessHeaderRow(records) {
  const filled = (r) => r.fields.filter((f) => f.trim() !== '').length;
  for (let i = 0; i < Math.min(records.length - 1, 60); i++) {
    const r = records[i];
    if (filled(r) < 3) continue;
    if (r.fields.some((f) => /\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(f))) continue; // a header has no dates
    const next = records.slice(i + 1).find((x) => !isEmptyRecord(x));
    if (next && next.fields.some((f) => /\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(f))) return i;
  }
  return 0;
}

export function guessDateFormat(values) {
  for (const f of DATE_FORMATS) {
    if (values.length && values.every((v) => {
      try {
        return parseDateTime(v, f) !== null;
      } catch {
        return false;
      }
    })) return f;
  }
  return 'D/M/YYYY';
}

export function guessDecimal(values) {
  for (const decimal of [',', '.']) {
    const thousands = decimal === ',' ? '.' : ',';
    if (values.length && values.every((v) => {
      try {
        parseAmount(v, { decimal, thousands });
        return true;
      } catch {
        return false;
      }
    })) return decimal;
  }
  return ',';
}

export function readStructure(bytes, delimiter) {
  const { text, encoding } = decodePreview(bytes);
  const d = delimiter ?? guessDelimiter(text);
  const records = parseCsv(text, { delimiter: d });
  return { text, encoding, delimiter: d, records };
}

/** Metadata keys = first field of the non-empty records above the header. */
export function metadataKeys(records, headerRow) {
  return records.slice(0, headerRow).filter((r) => !isEmptyRecord(r)).map((r) => r.fields[0].trim()).filter(Boolean);
}

export function slug(name) {
  return (
    String(name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'profiel'
  );
}

/**
 * @param s wizard state: { name, delimiter, headerRow, decimal, dateFormat, order, columns: {field: columnName},
 *   amountMode, amountColumn, debitColumn, creditColumn, ownSource, ownColumn, ownValue, ownMetaKey, metaBalanceKey, metaBalanceAtKey }
 */
export function buildProfile(s) {
  const columns = {};
  for (const [k, v] of Object.entries(s.columns ?? {})) if (v) columns[k] = v;
  const amount = s.amountMode === 'debitCredit' ? { mode: 'debitCredit', debit: s.debitColumn, credit: s.creditColumn } : { mode: 'single', column: s.amountColumn };
  const ownAccount =
    s.ownSource === 'column' ? { source: 'column', column: s.ownColumn } : s.ownSource === 'fixed' ? { source: 'fixed', value: s.ownValue } : { source: 'metadata' };
  const metadata = {};
  if (s.ownSource === 'metadata') metadata.accountNumber = s.ownMetaKey;
  if (s.metaBalanceKey) metadata.balance = s.metaBalanceKey;
  if (s.metaBalanceAtKey) metadata.balanceAt = s.metaBalanceAtKey;
  const headerColumns = [...new Set([columns.entryDate, amount.column, amount.debit, amount.credit, ownAccount.column, ...Object.values(columns)].filter(Boolean))];
  return {
    id: slug(s.name),
    name: String(s.name ?? '').trim(),
    format: 'csv',
    encoding: 'auto',
    delimiter: s.delimiter,
    quote: '"',
    decimal: s.decimal,
    thousands: s.decimal === ',' ? '.' : ',',
    dateFormat: s.dateFormat,
    order: s.order,
    detect: { headerColumns },
    metadata,
    ownAccount,
    amount,
    key: columns.bankRef ? 'bankRef' : 'fallback',
    columns,
  };
}
