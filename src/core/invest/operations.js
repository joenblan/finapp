// Manual investment operations. Fields (amounts in milli, quantity in millionths):
//   { id, investAccountId, securityId, kind, date, quantity, gross, costs,
//     stockTax, withholding, rvPart, split: { from, to }, bankTxId, prevAllocation, note }
// kind: aankoop | verkoop | dividend | kosten | taks | splitsing
//   aankoop/verkoop: quantity + gross (leading); price = gross / quantity (shown only)
//   dividend: gross, withholding (net = gross - withholding)
//   kosten / taks: a loose cost or tax (costs resp. stockTax)
//   splitsing: split.from -> split.to (e.g. 1 -> 2), cost unchanged
import { derivedPrice } from './units.js';

export const KINDS = {
  aankoop: 'Aankoop',
  verkoop: 'Verkoop',
  dividend: 'Dividend',
  kosten: 'Losse kosten',
  taks: 'Losse taks',
  splitsing: 'Splitsing',
};
export const SECURITY_TYPES = { etf: 'ETF', aandeel: 'Aandeel', fonds: 'Fonds', obligatie: 'Obligatie', overig: 'Overig' };
export const REGIMES = { meerwaarde: 'Meerwaardebelasting', reynders: 'Reynderstaks (obligatiefonds)', vrijgesteld: 'Vrijgesteld' };

const n = (v) => v ?? 0;

/**
 * Expected bank amount of an operation (signed like a bank transaction):
 * aankoop -(gross + costs + tax); verkoop gross - costs - tax - withholding;
 * dividend gross - withholding; kosten -costs; taks -tax; splitsing 0.
 */
export function netAmount(op) {
  switch (op.kind) {
    case 'aankoop':
      return -(n(op.gross) + n(op.costs) + n(op.stockTax));
    case 'verkoop':
      return n(op.gross) - n(op.costs) - n(op.stockTax) - n(op.withholding);
    case 'dividend':
      return n(op.gross) - n(op.withholding);
    case 'kosten':
      return -n(op.costs);
    case 'taks':
      return -n(op.stockTax);
    default:
      return 0;
  }
}

export const priceOf = (op) => (op.kind === 'aankoop' || op.kind === 'verkoop' ? derivedPrice(op.gross, op.quantity) : null);

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');
const money = (v) => v === null || v === undefined || (Number.isSafeInteger(v) && v >= 0 && v % 10 === 0);

export function validateOperation(data, op) {
  const errors = [];
  if (!KINDS[op.kind]) errors.push('Kies de soort verrichting.');
  if (!data.investAccounts.some((a) => a.id === op.investAccountId)) errors.push('Kies de beleggingsrekening.');
  if (!isDate(op.date)) errors.push('Geef een datum op.');
  const needsSecurity = ['aankoop', 'verkoop', 'dividend', 'splitsing'].includes(op.kind);
  if (needsSecurity && !data.securities.some((s) => s.id === op.securityId)) errors.push('Kies het effect.');
  for (const [k, label] of [['gross', 'brutobedrag'], ['costs', 'kosten'], ['stockTax', 'beurstaks'], ['withholding', 'roerende voorheffing'], ['rvPart', 'RV-deel']]) {
    if (!money(op[k])) errors.push(`Ongeldig bedrag voor ${label} (op de cent, niet negatief).`);
  }
  if (op.kind === 'aankoop' || op.kind === 'verkoop') {
    if (!Number.isSafeInteger(op.quantity) || op.quantity <= 0) errors.push('Geef het aantal op.');
    if (!op.gross) errors.push('Geef het brutobedrag op.');
  }
  if (op.kind === 'dividend' && !op.gross) errors.push('Geef het brutobedrag van het dividend op.');
  if (op.kind === 'dividend' && n(op.withholding) > n(op.gross)) errors.push('De roerende voorheffing is groter dan het brutobedrag.');
  if (op.kind === 'kosten' && !op.costs) errors.push('Geef het bedrag van de kosten op.');
  if (op.kind === 'taks' && !op.stockTax) errors.push('Geef het bedrag van de taks op.');
  if (op.kind === 'splitsing' && !(Number.isInteger(op.split?.from) && Number.isInteger(op.split?.to) && op.split.from > 0 && op.split.to > 0)) errors.push('Geef de splitsing op, bv. 1 wordt 2.');
  return errors;
}

export function validateSecurity(data, s) {
  const errors = [];
  if (!String(s.name ?? '').trim()) errors.push('Geef het effect een naam.');
  if (s.isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s.isin)) errors.push('Ongeldige ISIN (bv. IE00B4L5Y983).');
  if (!SECURITY_TYPES[s.type]) errors.push('Kies het type.');
  if (!['kapitaliserend', 'distribuerend'].includes(s.distribution)) errors.push('Kies kapitaliserend of distribuerend.');
  if (!REGIMES[s.regime]) errors.push('Kies het fiscaal regime.');
  if (s.referencePrice !== null && s.referencePrice !== undefined && !(Number.isSafeInteger(s.referencePrice) && s.referencePrice > 0)) errors.push('Ongeldige referentiekoers.');
  return errors;
}

export function validateInvestAccount(data, a) {
  const errors = [];
  if (!String(a.name ?? '').trim()) errors.push('Geef de beleggingsrekening een naam.');
  if (!a.owners?.length || a.owners.some((o) => !String(o.name ?? '').trim())) errors.push('Geef de eigenaar op.');
  else if (a.owners.reduce((s, o) => s + o.share, 0) !== 10000) errors.push('De aandelen van de eigenaars moeten samen 100 % zijn.');
  if (!['afrekenrekening', 'niet-gevolgd'].includes(a.cash?.mode)) errors.push('Kies hoe de cash gevolgd wordt.');
  if (a.cash?.mode === 'afrekenrekening' && !data.accounts[a.cash.accountId]) errors.push('Kies de afrekenrekening (een bankrekening uit de app).');
  return errors;
}

/** Operations in calculation order: date, then the order of entry. */
export function sortedOperations(ops) {
  return [...ops].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt ?? a.id).localeCompare(String(b.createdAt ?? b.id)));
}
