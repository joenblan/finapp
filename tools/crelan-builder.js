// Builds SYNTHETIC Crelan CSV exports with the exact structure of the real
// export: header on line 1, ';' separated, CRLF, decimal point without leading
// zero (".95", "-.05"), own IBAN on every row, many ";;;;;;;;" lines at the end.
// All data is fictitious.
export const CRELAN_HEADER = ['Datum', 'Bedrag', 'Saldo na verrichting', 'Munt', 'Tegenpartij', 'Rekening tegenpartij', 'Type verrichting', 'Mededeling', 'Rekening opdrachtgever'];

const quote = (f) => (/[;"\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
const spaced = (iban) => (iban ? iban.replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ') : '');

/** milli -> Crelan notation: decimal point, 2 decimals, no leading zero below 1 ("-.05", ".95", "1.00"). */
export function crelanAmount(milli) {
  if (milli % 10 !== 0) throw new Error('Crelan builder: max. 2 decimals');
  const neg = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.trunc(abs / 1000);
  const cents = String((abs % 1000) / 10).padStart(2, '0');
  return `${neg ? '-' : ''}${whole === 0 ? '' : whole}.${cents}`;
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
export const crelanDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * @param opts { own, openingBalance = 0, order = 'oldest-first' | 'newest-first', trailingEmpty = 30, eol = '\r\n',
 *   movements: OLDEST FIRST [{ date, amount, cp?, cpIban?, type?, comm?, currency?, own?, balanceAfter? (override), amountText? (override) }] }
 */
export function buildCrelanCsv(opts) {
  const { own, openingBalance = 0, order = 'oldest-first', trailingEmpty = 30, eol = '\r\n', movements = [] } = opts;
  let balance = openingBalance;
  const rows = movements.map((m) => {
    balance += m.amount;
    const after = m.balanceAfter ?? balance;
    return [
      crelanDate(m.date),
      m.amountText ?? crelanAmount(m.amount),
      crelanAmount(after),
      m.currency ?? 'EUR',
      m.cp ?? '',
      spaced(m.cpIban),
      m.type ?? 'Overschrijving in uw voordeel',
      m.comm ?? '',
      spaced(m.own ?? own),
    ]
      .map((f) => quote(String(f)))
      .join(';');
  });
  if (order === 'newest-first') rows.reverse();
  const lines = [CRELAN_HEADER.join(';'), ...rows, ...Array(trailingEmpty).fill(';;;;;;;;')];
  const text = lines.join(eol) + eol;
  return { text, bytes: new TextEncoder().encode(text), fileName: 'searchMovement.csv' };
}

// The example from the specification, verbatim (fictitious data).
export const CRELAN_EXAMPLE =
  [
    'Datum;Bedrag;Saldo na verrichting;Munt;Tegenpartij;Rekening tegenpartij;Type verrichting;Mededeling;Rekening opdrachtgever',
    '27/01/2025;1.00;1.00;EUR;JAN VOORBEELD;BE00 0000 0000 0005;Instantoverschr. in uw voordeel;;BE00 0000 0000 0003',
    '27/01/2025;-.05;.95;EUR;CAFE VOORBEELD       Gent;;eCommerce Mobile;CAFE VOORBEELD 27-01-2025 16:38 Gent 000000******0000;BE00 0000 0000 0003',
    ...Array(40).fill(';;;;;;;;'),
  ].join('\r\n') + '\r\n';
