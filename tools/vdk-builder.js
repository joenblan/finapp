// Builds SYNTHETIC VDK CSV exports ("verwerkte bewegingen") with the exact
// structure of the real export: metadata block, empty record, header row,
// movements NEWEST FIRST, many empty records at the end; Windows-1252, CRLF,
// LF inside quoted fields. All data is fictitious.
import { encodeWindows1252 } from './coda-builder.js';

export const VDK_HEADER = [
  'Uitvoeringsdatum', 'Valutadatum', 'Jaar uittreksel', 'Nummer uittreksel', 'VDK-refertenummer', 'Soort beweging',
  'Tegenpartij rekeningnummer', 'Tegenpartij BIC/SWIFT', 'Tegenpartij naam', 'Tegenpartij adres', 'Tegenpartij postnummer',
  'Tegenpartij woonplaats', 'Tegenpartij land', 'Mededeling', 'Bedrag', 'Saldo na beweging', 'Wisselkoers', 'Kosten',
];
const N = VDK_HEADER.length;

const quote = (f) => (/[;"\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
const record = (fields) => {
  const all = [...fields, ...Array(Math.max(0, N - fields.length)).fill('')];
  return all.map((f) => quote(String(f ?? ''))).join(';');
};

/** milli -> VDK notation: decimal comma, no thousands separator, no trailing zeros. */
export function vdkAmount(milli) {
  const neg = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.trunc(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `,${frac}` : ''}`;
}

/** 'YYYY-MM-DD' -> 'D/M/YYYY' */
export function vdkDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
}

export function vdkFileName(iban, stamp = '2026_10_01__09_52_00') {
  return `verwerkte_bewegingen_${iban.replace(/\s/g, '')}_${stamp}.csv`;
}

const spacedIban = (iban) => iban.replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ');

/**
 * @param opts {
 *   iban, name, kind, balanceAt ('1/10/2026 9:52'), filter ('Neen'),
 *   openingBalance (milli, balance before the oldest movement),
 *   movements: OLDEST FIRST [{ ref, date, valueDate?, year?, number?, type, cpIban?, cpBic?, cpName?, cpStreet?, cpPostcode?, cpCity?, cpCountry?, comm?, amount, balanceAfter? (override), rate?, costs? }],
 *   metaBalance? (override), trailingEmpty = 40, eol = '\r\n'
 * }
 * @returns { text, bytes, fileName, closingBalance }
 */
export function buildVdkCsv(opts) {
  const { iban, name = 'Jan Voorbeeld', kind = 'You Count zichtrekening', balanceAt = '1/10/2026 9:52', filter = 'Neen', openingBalance = 0, movements = [], trailingEmpty = 40, eol = '\r\n' } = opts;
  let balance = openingBalance;
  const rows = movements.map((m) => {
    balance += m.amount;
    const after = m.balanceAfter ?? balance;
    return record([
      vdkDate(m.date), vdkDate(m.valueDate ?? m.date), m.year ?? '', m.number ?? '', m.ref, m.type ?? 'Overschrijving',
      m.cpIban ? spacedIban(m.cpIban) : '', m.cpBic ?? '', m.cpName ?? '', m.cpStreet ?? '', m.cpPostcode ?? '', m.cpCity ?? '', m.cpCountry ?? '',
      m.comm ?? '', vdkAmount(m.amount), vdkAmount(after), m.rate ?? '', m.costs ?? '',
    ]);
  });
  const closing = movements.length ? movements[movements.length - 1].balanceAfter ?? balance : openingBalance;
  const lines = [
    record(['Rekeningnummer', spacedIban(iban)]),
    record(['Naam', name]),
    record(['Soort', kind]),
    record(['Saldo', vdkAmount(opts.metaBalance ?? closing)]),
    record(['Datum saldo', balanceAt]),
    record(['Filter actief', filter]),
    record([]),
    record(VDK_HEADER),
    ...rows.reverse(), // newest first
    ...Array(trailingEmpty).fill(record([])),
  ];
  const text = lines.join(eol) + eol;
  return { text, bytes: encodeWindows1252(text), fileName: vdkFileName(iban), closingBalance: closing };
}
