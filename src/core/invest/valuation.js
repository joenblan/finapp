// Valuation: value of a position on a date = quantity on that date × the last
// known price on or before that date. A price older than staleDays (fiscal
// parameters) is marked "koers verouderd"; without a price the value is
// UNKNOWN (null), never 0.
import { computeLots } from './lots.js';
import { valueAt, derivedPrice, mulDiv } from './units.js';
import { paramsFor } from '../fiscal/params.js';

const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function priceOn(data, securityId, date) {
  const list = data.prices?.[securityId] ?? [];
  let best = null;
  for (const p of list) if (p.date <= date && (!best || p.date > best.date)) best = p;
  if (!best) return null;
  const staleDays = paramsFor(data, Number(date.slice(0, 4))).staleDays;
  return { ...best, age: dayDiff(best.date, date), stale: dayDiff(best.date, date) > staleDays };
}

/**
 * Positions on a date with their value.
 * @returns [{ investAccountId, securityId, quantity, cost, avgPrice, price, priceDate, stale, value (null = unknown),
 *             unrealized, unrealizedPct (basis points), dividends, costs, taxes }]
 */
export function valuePositions(data, date, lots = computeLots(data, { until: date })) {
  const out = [];
  for (const p of lots.positions.values()) {
    const pr = p.quantity ? priceOn(data, p.securityId, date) : null;
    const value = p.quantity === 0 ? 0 : pr ? valueAt(p.quantity, pr.price) : null;
    const unrealized = value === null ? null : value - p.cost;
    out.push({
      investAccountId: p.investAccountId,
      securityId: p.securityId,
      quantity: p.quantity,
      cost: p.cost,
      avgPrice: p.quantity ? derivedPrice(p.cost, p.quantity) : null,
      price: pr?.price ?? null,
      priceDate: pr?.date ?? null,
      stale: Boolean(pr?.stale),
      value,
      unrealized,
      unrealizedPct: unrealized === null || !p.cost ? null : mulDiv(unrealized, 10000, p.cost),
      dividends: p.dividends,
      costs: p.costs,
      taxes: p.taxes,
      openLots: p.openLots,
    });
  }
  return out;
}

/** Totals of a list of valued positions; value is the sum of the known values, `incomplete` when one is unknown. */
export function totals(list) {
  const t = { cost: 0, value: 0, unrealized: 0, dividendsGross: 0, dividendsNet: 0, costs: 0, taxes: 0, incomplete: false, stale: false };
  for (const p of list) {
    t.costs += p.costs;
    t.taxes += p.taxes;
    t.dividendsGross += p.dividends.gross;
    t.dividendsNet += p.dividends.gross - p.dividends.withholding;
    if (!p.quantity) continue;
    t.cost += p.cost;
    if (p.value === null) t.incomplete = true;
    else {
      t.value += p.value;
      t.unrealized += p.value - p.cost;
    }
    if (p.stale) t.stale = true;
  }
  t.unrealizedPct = t.cost && !t.incomplete ? mulDiv(t.unrealized, 10000, t.cost) : null;
  return t;
}

/** Securities in the portfolio on a date with their last known price (for "Koersen bijwerken"). */
export function priceUpdateList(data, date) {
  const held = new Set(valuePositions(data, date).filter((p) => p.quantity > 0).map((p) => p.securityId));
  return data.securities.filter((s) => held.has(s.id)).map((s) => ({ security: s, last: priceOn(data, s.id, date) }));
}
