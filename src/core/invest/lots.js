// Lots and realised results. One lot per purchase; sales consume lots FIFO.
//  - cost of a lot = gross amount of the purchase
//  - partial sale: proportional part of the ORIGINAL lot cost, rounded half-up
//    to the cent; the last part of a lot gets the rest (no cent is lost)
//  - split from -> to: quantities × to/from, cost unchanged
//  - fiscal acquisition value (parameters of the year of the sale):
//      lot bought on/after startDate: its cost
//      older lot: reference price (per security) × quantity at the reference
//      date; until transitionEnd the higher of that and the cost.
//      No reference price: result marked incomplete (cost is used).
//  - fiscal result = proceeds - acquisition; costs, stock tax (and withholding
//    on the sale) only count when the parameter costsCount is set
//  - economic result = net proceeds - (cost + purchase costs and tax)
// Everything is recomputed from the operations, so editing or deleting an
// operation updates all later results.
import { mulDiv, valueAt } from './units.js';
import { sortedOperations } from './operations.js';
import { paramsFor } from '../fiscal/params.js';

const n = (v) => v ?? 0;
/** part of `total` for `take` out of `of`, rounded half-up to the cent */
const share = (total, take, of) => mulDiv(total, take, of * 10) * 10;

function allocate(lot, take) {
  // the last part of the lot gets the remaining cost
  const last = take === lot.remaining;
  const cost = last ? lot.cost - lot.costUsed : share(lot.cost, take, lot.qty);
  const extra = last ? lot.extra - lot.extraUsed : share(lot.extra, take, lot.qty);
  lot.remaining -= take;
  lot.costUsed += cost;
  lot.extraUsed += extra;
  return { cost, extra };
}

/**
 * @returns {{ positions: Map<key, { investAccountId, securityId, lots, quantity, cost }>,
 *             sales: [sale], issues: [{ opId, message }] }}
 *   key = `${investAccountId}|${securityId}`
 */
export function computeLots(data, { until = null } = {}) {
  const positions = new Map();
  const sales = [];
  const issues = [];
  const secById = new Map(data.securities.map((s) => [s.id, s]));
  const pos = (op) => {
    const key = `${op.investAccountId}|${op.securityId}`;
    if (!positions.has(key)) positions.set(key, { key, investAccountId: op.investAccountId, securityId: op.securityId, lots: [], dividends: { gross: 0, withholding: 0 }, costs: 0, taxes: 0 });
    return positions.get(key);
  };
  for (const op of sortedOperations(data.operations)) {
    if (until && op.date > until) continue;
    if (op.kind === 'kosten' || op.kind === 'taks') {
      if (op.securityId) {
        const p = pos(op);
        p.costs += n(op.costs);
        p.taxes += n(op.stockTax);
      }
      continue;
    }
    const p = pos(op);
    const security = secById.get(op.securityId);
    if (op.kind === 'aankoop') {
      p.lots.push({ opId: op.id, date: op.date, qty: op.quantity, remaining: op.quantity, cost: op.gross, costUsed: 0, extra: n(op.costs) + n(op.stockTax), extraUsed: 0, refNum: 1, refDen: 1 });
      p.costs += n(op.costs);
      p.taxes += n(op.stockTax);
    } else if (op.kind === 'splitsing') {
      const { from, to } = op.split;
      const params = paramsFor(data, Number(op.date.slice(0, 4)));
      for (const lot of p.lots) {
        lot.qty = mulDiv(lot.qty, to, from);
        lot.remaining = mulDiv(lot.remaining, to, from);
        // a split after the reference date: the reference price applies to the pre-split quantity
        if (op.date > params.cgt.referenceDate) {
          lot.refNum *= to;
          lot.refDen *= from;
        }
      }
    } else if (op.kind === 'dividend') {
      p.dividends.gross += n(op.gross);
      p.dividends.withholding += n(op.withholding);
    } else if (op.kind === 'verkoop') {
      p.costs += n(op.costs);
      p.taxes += n(op.stockTax);
      const params = paramsFor(data, Number(op.date.slice(0, 4)));
      let need = op.quantity;
      const parts = [];
      for (const lot of p.lots) {
        if (!need) break;
        if (!lot.remaining) continue;
        const take = Math.min(need, lot.remaining);
        const { cost, extra } = allocate(lot, take);
        need -= take;
        let acquisition = cost;
        let refValue = null;
        let incomplete = false;
        if (lot.date < params.cgt.startDate) {
          if (security?.referencePrice) {
            refValue = valueAt(mulDiv(take, lot.refDen, lot.refNum), security.referencePrice);
            acquisition = op.date <= params.cgt.transitionEnd ? Math.max(refValue, cost) : refValue;
          } else incomplete = true;
        }
        if (params.cgt.costsCount) acquisition += extra;
        parts.push({ lotOpId: lot.opId, lotDate: lot.date, quantity: take, cost, extra, refValue, acquisition, incomplete });
      }
      if (need > 0) issues.push({ opId: op.id, message: 'Er worden meer stuks verkocht dan er op dat moment in portefeuille zijn.' });
      const sold = op.quantity - need;
      const proceeds = params.cgt.costsCount ? n(op.gross) - n(op.costs) - n(op.stockTax) - n(op.withholding) : n(op.gross);
      const acquisition = parts.reduce((s, x) => s + x.acquisition, 0);
      const cost = parts.reduce((s, x) => s + x.cost, 0);
      const extra = parts.reduce((s, x) => s + x.extra, 0);
      const fiscalGain = proceeds - acquisition;
      const regime = security?.regime ?? 'meerwaarde';
      // Reynders tax: by default the whole gain is taxed via withholding tax and stays out of the basis
      let rvPart = 0;
      let basisAmount = 0;
      let indicative = false;
      if (regime === 'meerwaarde') basisAmount = fiscalGain;
      else if (regime === 'reynders') {
        if (fiscalGain > 0) {
          rvPart = op.rvPart === null || op.rvPart === undefined ? fiscalGain : Math.min(op.rvPart, fiscalGain);
          basisAmount = fiscalGain - rvPart;
        } else if (fiscalGain < 0 && params.cgt.reyndersLossDeductible) {
          basisAmount = fiscalGain;
          indicative = true;
        }
      }
      sales.push({
        op,
        investAccountId: op.investAccountId,
        securityId: op.securityId,
        date: op.date,
        year: Number(op.date.slice(0, 4)),
        quantity: sold,
        parts,
        proceeds,
        acquisition,
        cost,
        fiscalGain,
        economic: n(op.gross) - n(op.costs) - n(op.stockTax) - n(op.withholding) - cost - extra,
        regime,
        rvPart,
        basisAmount,
        indicative,
        incomplete: parts.some((x) => x.incomplete),
      });
    }
  }
  for (const p of positions.values()) {
    p.quantity = p.lots.reduce((s, l) => s + l.remaining, 0);
    p.cost = p.lots.reduce((s, l) => s + (l.remaining ? l.cost - l.costUsed : 0), 0);
    p.openLots = p.lots.filter((l) => l.remaining > 0).map((l) => ({ opId: l.opId, date: l.date, quantity: l.remaining, cost: l.cost - l.costUsed }));
  }
  return { positions, sales, issues };
}
