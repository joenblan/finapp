// Fiscal parameters per income year. These are DEFAULT VALUES, editable in
// Instellingen › Fiscale parameters; the calculation modules only read them
// via paramsFor() and never contain rates, ceilings or dates themselves.
// Rates are integers in millionths (0,12 % = 1200; 30 % = 300000); amounts in milli.
export const FISCAL_DISCLAIMER = 'Indicatief, controleer met je bank of de officiële bronnen.';

export function defaultFiscalParams() {
  return {
    stockTaxRates: [
      { id: 'tob-012', label: '0,12 %', rate: 1_200, max: 1_300_000 },
      { id: 'tob-035', label: '0,35 %', rate: 3_500, max: 1_600_000 },
      { id: 'tob-132', label: '1,32 %', rate: 13_200, max: 4_000_000 },
    ],
    cgt: {
      startDate: '2026-01-01', // lots bought from this date: acquisition value = cost
      referenceDate: '2025-12-31', // reference price date for older lots
      transitionEnd: '2030-12-31', // until this date: the higher of reference value and cost
      exemption: 10_000_000, // per person per year
      rate: 100_000, // 10 %
      costsCount: false, // costs and stock tax count in the fiscal result
      reyndersLossDeductible: true, // losses of bond funds (Reynders tax) count as deductible loss (indicative)
    },
    pension: {
      basisCeiling: 1_050_000,
      basisRate: 300_000,
      increasedCeiling: 1_350_000,
      increasedRate: 250_000,
      warnFrom: '12-01', // from this day (MM-DD) warn when there is still room
    },
    staleDays: 35, // price older than this: "koers verouderd"
  };
}

export function defaultFiscalSettings() {
  return {
    params: { 2026: defaultFiscalParams() },
    perPersonYear: {}, // "Naam|2026" -> { carriedExemption, withheldCgt, withheldRv }
  };
}

/** Parameters of a year: that year, else the latest earlier year, else the earliest later year. */
export function paramsFor(data, year) {
  const all = data.fiscal?.params ?? {};
  const years = Object.keys(all).map(Number).sort((a, b) => a - b);
  if (!years.length) return defaultFiscalParams();
  const y = Number(year);
  const pick = all[y] ?? all[[...years].reverse().find((x) => x < y)] ?? all[years[0]];
  return pick;
}

export const personYear = (data, person, year) => data.fiscal?.perPersonYear?.[`${person}|${year}`] ?? {};
