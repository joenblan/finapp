// Exact fixed-point arithmetic with BigInt for interest rates (never floats).
// A "fixed" value is a BigInt scaled by S = 10^40. Money stays in integer
// milli-euro; results are rounded half-up to the cent only where specified.

export const S = 10n ** 40n;

/** "3", "3.00", "3,25" (percent per year) -> fixed rate (0.03 * S). */
export function parsePercent(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,8})?$/.test(s)) throw new Error(`Ongeldige rentevoet "${text}" (bv. 3,25)`);
  const [i, f = ''] = s.split('.');
  const digits = BigInt(i + f);
  return (digits * S) / (100n * 10n ** BigInt(f.length));
}

export const mulF = (a, b) => (a * b) / S;
export const divF = (a, b) => (a * S) / b;

export function powF(base, exp) {
  let result = S;
  let b = base;
  let e = BigInt(exp);
  while (e > 0n) {
    if (e & 1n) result = mulF(result, b);
    b = mulF(b, b);
    e >>= 1n;
  }
  return result;
}

/** n-th root of a fixed value x (x > 0) by Newton's method. */
export function rootF(x, n) {
  const N = BigInt(n);
  let y = S + (x - S) / N; // good start for x close to 1
  for (let i = 0; i < 200; i++) {
    const next = ((N - 1n) * y + divF(x, powF(y, n - 1))) / N;
    const diff = next > y ? next - y : y - next;
    y = next;
    if (diff <= 1n) break;
  }
  return y;
}

/**
 * Monthly rate (fixed) from the rate text of a tranche:
 *  - gelijkwaardig: annual rate j, monthly (1 + j)^(1/12) - 1
 *  - nominaal:      annual rate j, monthly j / 12
 *  - periodiek:     the text IS the monthly (periodic) rate, e.g. "0,21"
 */
export function monthlyRate(annualPercent, method = 'gelijkwaardig') {
  const j = parsePercent(annualPercent);
  if (method === 'periodiek') return j;
  if (method === 'nominaal') return j / 12n;
  if (method !== 'gelijkwaardig') throw new Error(`Onbekende rentemethode ${method}`);
  return rootF(S + j, 12) - S;
}

/** num/den (both BigInt, den > 0), rounded half-up (away from zero) to an integer. */
export function roundHalfUp(num, den) {
  if (num < 0n) return -roundHalfUp(-num, den);
  return (2n * num + den) / (2n * den);
}

/** Exact milli amount num/den rounded half-up to the cent; returns integer milli (Number). */
export function toCentMilli(num, den) {
  return Number(roundHalfUp(num, den * 10n) * 10n);
}

/** Interest on a balance (milli) at a monthly fixed rate, rounded half-up to the cent. */
export function interestMilli(balance, rate) {
  return toCentMilli(BigInt(balance) * rate, S);
}

/** Annuity payment for principal (milli), monthly fixed rate, n months; rounded half-up to the cent. */
export function annuityMilli(principal, rate, n) {
  if (n <= 0) throw new Error('Looptijd moet minstens 1 maand zijn.');
  const P = BigInt(principal);
  if (rate === 0n) return toCentMilli(P, BigInt(n));
  const q = powF(S + rate, n);
  return toCentMilli(P * rate * q, S * (q - S));
}

/** principal / n rounded half-up to the cent (constant capital repayment). */
export function linearCapitalMilli(principal, n) {
  return toCentMilli(BigInt(principal), BigInt(n));
}

/** Rate as readable percentage with 4 decimals, e.g. 0.2466 (for display only). */
export function fixedToPercentText(rate, decimals = 4) {
  const scaled = roundHalfUp(rate * 100n * 10n ** BigInt(decimals), S);
  const s = scaled.toString().padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)},${s.slice(-decimals)}`;
}

/**
 * Monthly (periodic) rate that gives exactly `payment` (milli) as annuity for
 * `principal` over `months` months, as percentage text with 8 decimals
 * (e.g. "0,20649516"). Used when the deed shows a rounded rate. The middle of
 * the range of matching rates is returned. Throws when no rate gives that payment.
 */
export function solveMonthlyRate(principal, months, payment) {
  const UNIT = 10n ** 10n; // rate per unit: 1e-8 % = 1e-10
  const rateOf = (u) => (u * S) / UNIT;
  const pay = (u) => annuityMilli(principal, rateOf(u), months);
  let lo = 0n;
  let hi = 10n ** 9n; // 10 % per month
  if (payment < pay(lo) || payment > pay(hi)) throw new Error('Met deze maandlast, dit bedrag en deze looptijd is geen rente te vinden.');
  // first unit with pay >= payment
  const first = (target) => {
    let a = lo;
    let b = hi;
    while (a < b) {
      const m = (a + b) / 2n;
      if (pay(m) >= target) b = m;
      else a = m + 1n;
    }
    return a;
  };
  const from = first(payment);
  const to = first(payment + 10) - 1n; // payments are whole cents
  if (from > to || pay(from) !== payment) throw new Error('Geen rente gevonden die exact deze maandlast geeft.');
  const u = (from + to) / 2n;
  const s = u.toString().padStart(9, '0');
  return `${s.slice(0, -8)},${s.slice(-8)}`;
}
