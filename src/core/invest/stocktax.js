// Stock exchange tax ("beurstaks"): expected value = gross × rate of the
// security, rounded to the cent, capped at the maximum of that rate. The rates
// come from the fiscal parameters; the user chooses the rate per security.
import { applyRate } from './units.js';
import { paramsFor } from '../fiscal/params.js';

export function taxRateOf(data, security, year) {
  if (!security?.taxRateId) return null;
  return paramsFor(data, year).stockTaxRates.find((r) => r.id === security.taxRateId) ?? null;
}

export function expectedStockTax(gross, rate) {
  if (!rate || !gross) return 0;
  const t = applyRate(gross, rate.rate);
  return rate.max !== null && rate.max !== undefined ? Math.min(t, rate.max) : t;
}

export function suggestStockTax(data, security, date, gross) {
  return expectedStockTax(gross, taxRateOf(data, security, Number(date.slice(0, 4))));
}
