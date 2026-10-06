// Capital gains tax per person and income year (indicative). Per sale the
// part in the basis (see lots.js: regime, Reynders part) is split over the
// owners of the investment account by their share. Per person and year:
//   net = max(0, gains in the basis - deductible losses)
//   taxable = max(0, net - exemption - carried-over exemption)
//   tax = taxable × rate        (exemption, rate: fiscal parameters of the year)
// plus the manual "already withheld by the bank" and the difference.
import { computeLots } from './lots.js';
import { mulDiv, applyRate } from './units.js';
import { paramsFor, personYear } from '../fiscal/params.js';
import { suggestStockTax } from './stocktax.js';

/** amount × share (basis points), rounded half-up to the cent */
export const shareOf = (amount, bp) => (bp === 10000 ? amount : mulDiv(amount, bp, 100_000) * 10);

export function ownersOf(data, investAccountId) {
  return data.investAccounts.find((a) => a.id === investAccountId)?.owners ?? [];
}

/** All persons that own investments or pension products. */
export function investPersons(data) {
  const s = new Set();
  for (const a of data.investAccounts ?? []) for (const o of a.owners ?? []) if (o.name) s.add(o.name);
  for (const p of data.pension ?? []) if (p.person) s.add(p.person);
  return [...s].sort((a, b) => a.localeCompare(b, 'nl'));
}

/** Sales of a person in a year, with the person's share of each amount. */
export function personSales(data, person, year, lots = computeLots(data)) {
  const out = [];
  for (const sale of lots.sales) {
    if (sale.year !== Number(year)) continue;
    const owner = ownersOf(data, sale.investAccountId).find((o) => o.name === person);
    if (!owner) continue;
    const bp = owner.share;
    out.push({
      ...sale,
      share: bp,
      my: {
        proceeds: shareOf(sale.proceeds, bp),
        acquisition: shareOf(sale.acquisition, bp),
        fiscalGain: shareOf(sale.fiscalGain, bp),
        rvPart: shareOf(sale.rvPart, bp),
        basisAmount: shareOf(sale.basisAmount, bp),
        economic: shareOf(sale.economic, bp),
      },
    });
  }
  return out;
}

export function yearSummary(data, person, year, lots = computeLots(data)) {
  const params = paramsFor(data, year);
  const sales = personSales(data, person, year, lots);
  const inBasis = sales.filter((s) => s.regime !== 'vrijgesteld');
  const gains = inBasis.filter((s) => s.my.basisAmount > 0);
  const losses = inBasis.filter((s) => s.my.basisAmount < 0);
  const gainTotal = gains.reduce((t, s) => t + s.my.basisAmount, 0);
  const lossTotal = -losses.reduce((t, s) => t + s.my.basisAmount, 0);
  const net = Math.max(0, gainTotal - lossTotal);
  const manual = personYear(data, person, year);
  const carried = manual.carriedExemption ?? 0;
  const exemption = params.cgt.exemption;
  const taxable = Math.max(0, net - exemption - carried);
  const tax = applyRate(taxable, params.cgt.rate);
  const withheld = manual.withheldCgt ?? null;
  const reynders = sales.filter((s) => s.regime === 'reynders');
  return {
    person,
    year: Number(year),
    params: params.cgt,
    sales,
    gains,
    losses,
    gainTotal,
    lossTotal,
    net,
    exemption,
    carried,
    taxable,
    tax,
    remainingExemption: Math.max(0, exemption + carried - net),
    withheld,
    difference: withheld === null ? null : tax - withheld,
    incomplete: sales.some((s) => s.incomplete),
    indicativeLosses: losses.some((s) => s.indicative),
    reynders: {
      sales: reynders,
      realizedGains: reynders.reduce((t, s) => t + Math.max(0, s.my.fiscalGain), 0),
      rvPart: reynders.reduce((t, s) => t + s.my.rvPart, 0),
      withheldRv: manual.withheldRv ?? null,
    },
  };
}

/**
 * "What if I sell `quantity` of `securityId` from `investAccountId` for `gross` on `date`":
 * nothing is stored. Returns the lots used, fiscal gain, expected stock tax,
 * regime and the effect on the remaining exemption of each owner this year.
 */
export function simulateSale(data, { investAccountId, securityId, quantity, gross, date }) {
  const security = data.securities.find((s) => s.id === securityId);
  if (!security) throw new Error('Kies het effect.');
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Geef het aantal op.');
  if (!Number.isSafeInteger(gross) || gross <= 0) throw new Error('Geef het verkoopbedrag op.');
  const stockTax = suggestStockTax(data, security, date, gross);
  const op = { id: '__simulatie__', createdAt: '￿', investAccountId, securityId, kind: 'verkoop', date, quantity, gross, costs: 0, stockTax, withholding: 0 };
  const sim = { ...data, operations: [...data.operations, op] };
  const lots = computeLots(sim);
  const sale = lots.sales.find((s) => s.op.id === op.id);
  const year = Number(date.slice(0, 4));
  const owners = ownersOf(data, investAccountId).map((o) => {
    const before = yearSummary(data, o.name, year);
    const after = yearSummary(sim, o.name, year, lots);
    return { name: o.name, share: o.share, remainingBefore: before.remainingExemption, remainingAfter: after.remainingExemption, taxBefore: before.tax, taxAfter: after.tax };
  });
  return { sale, stockTax, regime: security.regime, shortfall: lots.issues.some((i) => i.opId === op.id), owners };
}
