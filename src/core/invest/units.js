// Exact integer arithmetic for investments (never floats):
//   quantities in millionths of a unit, money in milli-euro (rounded to the cent
//   where specified), prices in micro-euro per unit, rates in millionths.
import { parseEuroInput } from '../money.js';

export const QTY = 1_000_000;

/** round(a * b / c) half-up (away from zero), BigInt-safe; returns Number. */
export function mulDiv(a, b, c) {
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return Number(neg ? -q : q);
}

/** Milli rounded half-up to the cent. */
export const roundCent = (milli) => mulDiv(milli, 1, 10) * 10;

/** "12", "0,5", "1.234,567891" -> millionths; null when empty. */
export function parseQuantity(text) {
  let s = String(text ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`Ongeldig aantal "${text}" (maximaal 6 decimalen).`);
  const [i, f = ''] = s.split('.');
  const v = Number(i) * QTY + Number(f.padEnd(6, '0'));
  if (!Number.isSafeInteger(v)) throw new Error('Aantal te groot.');
  return v;
}

export function formatQuantity(q) {
  const neg = q < 0;
  const a = Math.abs(q);
  const i = Math.floor(a / QTY).toLocaleString('nl-BE');
  const f = String(a % QTY).padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${i}${f ? `,${f}` : ''}`;
}

/** Price text (euro, up to 6 decimals) -> micro-euro. */
export function parsePrice(text) {
  let s = String(text ?? '').trim().replace(/\s|€/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`Ongeldige koers "${text}" (maximaal 6 decimalen).`);
  const [i, f = ''] = s.split('.');
  return Number(i) * 1_000_000 + Number(f.padEnd(6, '0'));
}

/** micro-euro -> "25,125" (at least 2 decimals, at most 6, no trailing zeros beyond 2). */
export function formatPrice(p) {
  if (p === null || p === undefined) return '—';
  const i = Math.floor(p / 1_000_000).toLocaleString('nl-BE');
  let f = String(p % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  if (f.length < 2) f = f.padEnd(2, '0');
  return `${i},${f}`;
}

/** Derived price = gross / quantity, in micro-euro per unit (rounded half-up). */
export function derivedPrice(gross, quantity) {
  if (!quantity) return null;
  return mulDiv(gross * 1000, QTY, quantity);
}

/** Value of a quantity at a price, in milli rounded to the cent. */
export function valueAt(quantity, price) {
  return mulDiv(quantity, price, 10_000_000_000) * 10; // qty(µ) × price(µ€) / 1e12 = €, in cents: / 1e10
}

/** Amount × rate (millionths), rounded to the cent. */
export function applyRate(amount, rate) {
  return mulDiv(amount, rate, 10_000_000) * 10;
}

export const parseMoney = (text) => {
  const v = parseEuroInput(text);
  if (v !== null && v % 10 !== 0) throw new Error(`Bedrag "${text}" heeft meer dan 2 decimalen.`);
  return v;
};
