// Amounts are integers in thousandths of a euro ("milli"), exactly like CODA.
// Never use floating point arithmetic on amounts. Every arithmetic helper here
// asserts that inputs and outputs are safe integers.

export class MoneyError extends Error {}

export function assertMilli(value, label = 'bedrag') {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Ongeldig ${label}: ${value} is geen veilig geheel getal`);
  }
  return value;
}

export function add(a, b) {
  assertMilli(a);
  assertMilli(b);
  return assertMilli(a + b, 'som');
}

export function sum(values) {
  let total = 0;
  for (const v of values) total = add(total, v);
  return total;
}

export function negate(a) {
  assertMilli(a);
  return a === 0 ? 0 : -a;
}

/**
 * Parse an unsigned digit string with an implied number of decimals
 * (CODA: 15 digits, 3 decimals) into an integer number of milli-euro.
 * Only digits allowed; throws otherwise.
 */
export function parseDigitsToMilli(digits) {
  if (!/^\d+$/.test(digits)) {
    throw new MoneyError(`Bedragveld bevat geen geldige cijfers: "${digits}"`);
  }
  const n = Number(digits);
  return assertMilli(n, 'bedrag');
}

/** Format milli-euro as Belgian/Dutch notation, e.g. -1234560 -> "-1.234,56". */
export function formatMilli(milli, { decimals = 2, currency = '' } = {}) {
  assertMilli(milli);
  const negative = milli < 0;
  const abs = negative ? -milli : milli;
  let whole = Math.trunc(abs / 1000);
  let frac = abs % 1000; // 0..999, exact
  let fracStr;
  if (decimals === 3) {
    fracStr = String(frac).padStart(3, '0');
  } else {
    // Round half away from zero to 2 decimals using integer arithmetic only.
    let cents = Math.trunc(frac / 10);
    if (frac % 10 >= 5) cents += 1;
    if (cents === 100) {
      cents = 0;
      whole += 1;
    }
    fracStr = String(cents).padStart(2, '0');
  }
  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const isZero = whole === 0 && /^0+$/.test(fracStr);
  const text = `${negative && !isZero ? '-' : ''}${wholeStr},${fracStr}`;
  return currency ? `${currency === 'EUR' ? '€' : currency} ${text}` : text;
}

/**
 * Parse user input such as "1.234,56", "-12,5", "12.50" or "1234" into milli-euro.
 * Belgian convention: comma is the decimal separator, dot is the thousands
 * separator. A lone dot followed by 1-2 digits is accepted as decimal point.
 * Returns null for empty input, throws MoneyError for invalid input.
 */
export function parseEuroInput(input) {
  let s = String(input ?? '').trim().replace(/\s|€/g, '');
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  let intPart;
  let fracPart = '';
  if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length !== 2) throw new MoneyError(`Ongeldig bedrag: "${input}"`);
    intPart = parts[0].replace(/\./g, '');
    fracPart = parts[1];
  } else {
    const m = /^(.*)\.(\d{1,2})$/.exec(s);
    if (m && !m[1].includes('.')) {
      intPart = m[1];
      fracPart = m[2];
    } else {
      intPart = s.replace(/\./g, '');
    }
  }
  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || !/^\d{0,3}$/.test(fracPart)) {
    throw new MoneyError(`Ongeldig bedrag: "${input}"`);
  }
  const milli = assertMilli(Number(intPart) * 1000 + Number(fracPart.padEnd(3, '0')), 'bedrag');
  return negative ? negate(milli) : milli;
}
