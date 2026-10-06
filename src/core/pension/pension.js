// Pension savings ("pensioensparen"), per person one or more products:
//   { id, person, type: 'fonds'|'verzekering', provider, regimeByYear: { 2026: 'basis'|'verhoogd' },
//     accountIds: [] (bank accounts whose transactions belong to it; empty = all, when it is the only product),
//     excludedTxIds: [], manualDeposits: [{ id, date, amount, note }], values: [{ date, value }] }
// Deposits are taken from bank transactions with the category
// "Sparen & beleggen › Pensioensparen" (a payment is a deposit, a refund lowers it),
// with manual exclusions and manual deposits.
// Expected tax reduction (parameters of the year):
//   deposited <= basis ceiling: deposited × basis rate
//   else: min(deposited, increased ceiling) × increased rate
import { applyRate, mulDiv } from '../invest/units.js';
import { paramsFor } from '../fiscal/params.js';
import { PENSION_CATEGORY } from '../categories/defaults.js';

export const PENSION_TYPES = { fonds: 'Pensioenspaarfonds', verzekering: 'Pensioenspaarverzekering' };

export function regimeOf(product, year) {
  return product.regimeByYear?.[year] ?? 'basis';
}

/** Product a bank transaction belongs to (or null). */
export function productForTx(data, tx) {
  const list = data.pension ?? [];
  const explicit = list.find((p) => (p.accountIds ?? []).includes(tx.accountId));
  if (explicit) return explicit;
  const open = list.filter((p) => !(p.accountIds ?? []).length);
  return open.length === 1 ? open[0] : null;
}

/** Deposits of a product: [{ date, amount, source: 'bank'|'manueel', txId?, id? }] (all years). */
export function depositsOf(data, product) {
  const out = [];
  for (const t of data.transactions) {
    const cat = data.allocations?.[t.id]?.[0]?.categoryId;
    if (cat !== PENSION_CATEGORY || (product.excludedTxIds ?? []).includes(t.id)) continue;
    if (productForTx(data, t)?.id !== product.id) continue;
    out.push({ date: t.entryDate, amount: -t.amount, source: 'bank', txId: t.id });
  }
  for (const m of product.manualDeposits ?? []) out.push({ date: m.date, amount: m.amount, source: 'manueel', id: m.id, note: m.note });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function expectedReduction(params, deposited) {
  const p = params.pension;
  if (deposited <= 0) return 0;
  if (deposited <= p.basisCeiling) return applyRate(deposited, p.basisRate);
  return applyRate(Math.min(deposited, p.increasedCeiling), p.increasedRate);
}

/** Deposit above which the increased regime gives more than the basis ceiling. */
export function breakeven(params) {
  const p = params.pension;
  return mulDiv(p.basisCeiling, p.basisRate, p.increasedRate * 10) * 10;
}

/**
 * Status of a product in a year.
 * @returns { deposited, regime, ceiling, remaining, reduction, warnings: [{ type, message }] }
 */
export function yearStatus(data, product, year, { today = null } = {}) {
  const params = paramsFor(data, year);
  const p = params.pension;
  const deposited = depositsOf(data, product).filter((d) => d.date.startsWith(`${year}-`)).reduce((s, d) => s + d.amount, 0);
  const regime = regimeOf(product, year);
  const ceiling = regime === 'verhoogd' ? p.increasedCeiling : p.basisCeiling;
  const reduction = expectedReduction(params, deposited);
  const eur = (m) => `€ ${(m / 1000).toFixed(2).replace('.', ',')}`;
  const warnings = [];
  const be = breakeven(params);
  if (deposited > p.basisCeiling && deposited < be) {
    warnings.push({ type: 'breakeven', message: `Gestort ${eur(deposited)}: boven het basisplafond (${eur(p.basisCeiling)}) maar onder het breakevenpunt (${eur(be)}). Het voordeel (${eur(reduction)}) is lager dan bij storten tot het basisplafond (${eur(expectedReduction(params, p.basisCeiling))}).` });
  }
  if (deposited > ceiling) warnings.push({ type: 'overschreden', message: `Het plafond van het ${regime === 'verhoogd' ? 'verhoogde' : 'basis'}stelsel (${eur(ceiling)}) is overschreden met ${eur(deposited - ceiling)}.` });
  if (today && today.startsWith(`${year}-`) && today.slice(5) >= p.warnFrom && deposited < ceiling) {
    warnings.push({ type: 'ruimte', message: `Er is nog ${eur(ceiling - deposited)} ruimte tot het plafond van dit jaar.` });
  }
  return { year: Number(year), deposited, regime, ceiling, remaining: Math.max(0, ceiling - deposited), reduction, warnings, params: p };
}

/** Last known value on or before a date (null when none). */
export function valueOn(product, date) {
  let best = null;
  for (const v of product.values ?? []) if (v.date <= date && (!best || v.date > best.date)) best = v;
  return best;
}

/** History per year: deposits and the last known value at the end of the year. */
export function history(data, product) {
  const years = new Set(depositsOf(data, product).map((d) => Number(d.date.slice(0, 4))));
  for (const v of product.values ?? []) years.add(Number(v.date.slice(0, 4)));
  return [...years].sort().map((y) => ({ year: y, deposited: yearStatus(data, product, y).deposited, value: valueOn(product, `${y}-12-31`) }));
}
