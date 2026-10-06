// Instellingen › Fiscale parameters: all rates, ceilings, exemptions and dates
// per income year (defaults are filled in; nothing is hard-coded in the logic).
import { h } from '../../dom.js';
import { formatMilli } from '../../../core/money.js';
import { paramsFor, FISCAL_DISCLAIMER } from '../../../core/fiscal/params.js';
import { parseMoney } from '../../../core/invest/units.js';

// percent text (up to 4 decimals) <-> millionths
const pctText = (ppm) => (ppm / 10000).toLocaleString('nl-BE', { maximumFractionDigits: 4 });
function parsePct(text) {
  const s = String(text ?? '').trim().replace('%', '').replace(',', '.').trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) throw new Error(`Ongeldig percentage "${text}".`);
  const [i, f = ''] = s.split('.');
  return Number(i) * 10000 + Number(f.padEnd(4, '0'));
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function renderFiscalParams(ctx) {
  const data = ctx.service.data;
  const years = Object.keys(data.fiscal.params).map(Number).sort((a, b) => a - b);
  const st = (ctx.state.fiscalParams ??= { year: years.at(-1) });
  if (!years.includes(st.year)) st.year = years.at(-1);
  const p = structuredClone(paramsFor(data, st.year));
  const yearSel = h('select', null, years.map((y) => h('option', { value: y, selected: y === st.year }, String(y))));
  yearSel.addEventListener('change', () => ((st.year = Number(yearSel.value)), ctx.rerender()));
  const newYear = h('input', { type: 'number', size: 5, value: st.year + 1 });
  const run = (pr, ok) => pr.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));

  const inp = (v, size = 10) => h('input', { size, value: v });
  const rateRows = p.stockTaxRates.map((r) => ({ r, label: inp(r.label, 8), rate: inp(pctText(r.rate), 6), max: inp(r.max === null ? '' : formatMilli(r.max), 10) }));
  const f = {
    startDate: h('input', { type: 'date', value: p.cgt.startDate }),
    referenceDate: h('input', { type: 'date', value: p.cgt.referenceDate }),
    transitionEnd: h('input', { type: 'date', value: p.cgt.transitionEnd }),
    exemption: inp(formatMilli(p.cgt.exemption)),
    rate: inp(pctText(p.cgt.rate), 6),
    costsCount: h('input', { type: 'checkbox', checked: p.cgt.costsCount }),
    reyndersLoss: h('input', { type: 'checkbox', checked: p.cgt.reyndersLossDeductible }),
    basisCeiling: inp(formatMilli(p.pension.basisCeiling)),
    basisRate: inp(pctText(p.pension.basisRate), 6),
    increasedCeiling: inp(formatMilli(p.pension.increasedCeiling)),
    increasedRate: inp(pctText(p.pension.increasedRate), 6),
    warnFrom: inp(p.pension.warnFrom, 6),
    staleDays: h('input', { type: 'number', min: 1, size: 4, value: p.staleDays }),
  };
  const read = () => {
    for (const k of ['startDate', 'referenceDate', 'transitionEnd']) if (!isDate(f[k].value)) throw new Error('Vul alle datums in.');
    if (!/^\d{2}-\d{2}$/.test(f.warnFrom.value.trim())) throw new Error('Waarschuwingsdatum als MM-DD, bv. 12-01.');
    const days = Number(f.staleDays.value);
    if (!Number.isInteger(days) || days < 1) throw new Error('Ongeldig aantal dagen.');
    return {
      stockTaxRates: rateRows.map(({ r, label, rate, max }) => ({ id: r.id, label: label.value.trim() || r.label, rate: parsePct(rate.value), max: max.value.trim() ? parseMoney(max.value) : null })),
      cgt: { startDate: f.startDate.value, referenceDate: f.referenceDate.value, transitionEnd: f.transitionEnd.value, exemption: parseMoney(f.exemption.value) ?? 0, rate: parsePct(f.rate.value), costsCount: f.costsCount.checked, reyndersLossDeductible: f.reyndersLoss.checked },
      pension: { basisCeiling: parseMoney(f.basisCeiling.value) ?? 0, basisRate: parsePct(f.basisRate.value), increasedCeiling: parseMoney(f.increasedCeiling.value) ?? 0, increasedRate: parsePct(f.increasedRate.value), warnFrom: f.warnFrom.value.trim() },
      staleDays: days,
    };
  };
  const save = () => {
    try {
      run(ctx.service.saveFiscalParams(st.year, read()), `Parameters ${st.year} opgeslagen.`);
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };
  const row = (label, el, hint) => h('div', { class: 'form-row' }, h('label', { style: { minWidth: '260px' } }, label), el, hint ? h('span', { class: 'muted small' }, hint) : null);
  return h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Fiscale parameters'),
    h('p', { class: 'muted small' }, `Standaardwaarden, per inkomstenjaar aan te passen. Een jaar zonder eigen waarden gebruikt die van het laatste vorige jaar. ${FISCAL_DISCLAIMER}`),
    h('div', { class: 'form-row' }, h('label', null, 'Inkomstenjaar'), yearSel, h('span', { class: 'muted small' }, 'nieuw jaar (kopie):'), newYear, h('button', { onclick: () => { const y = Number(newYear.value); try { run(ctx.service.saveFiscalParams(y, read()).then(() => { st.year = y; ctx.rerender(); }), `Jaar ${y} aangemaakt.`); } catch (e) { ctx.toast(e.message, true); } } }, 'Aanmaken'), years.length > 1 ? h('button', { class: 'danger', onclick: () => confirm(`Parameters van ${st.year} verwijderen?`) && run(ctx.service.removeFiscalYear(st.year), 'Verwijderd.') }, `${st.year} verwijderen`) : null),
    h('h3', null, 'Beurstaks'),
    h('table', { class: 'grid small' }, h('thead', null, h('tr', null, ['Naam', 'Tarief %', 'Maximum €'].map((x) => h('th', null, x)))), h('tbody', null, rateRows.map((x) => h('tr', null, h('td', null, x.label), h('td', null, x.rate), h('td', null, x.max))))),
    h('h3', null, 'Meerwaardebelasting'),
    row('Startdatum (vanaf: kostprijs)', f.startDate),
    row('Referentiedatum (referentiekoers)', f.referenceDate),
    row('Einde overgangsregel (hoogste van beide)', f.transitionEnd),
    row('Vrijstelling per persoon per jaar (€)', f.exemption),
    row('Tarief (%)', f.rate),
    row('Kosten en beurstaks tellen fiscaal mee', f.costsCount, 'aankoopkosten bij de aankoopwaarde, verkoopkosten, taks en RV van de opbrengst af'),
    row('Minwaarden Reynderstaks-effecten aftrekbaar', f.reyndersLoss, 'indicatief'),
    h('h3', null, 'Pensioensparen'),
    row('Basisplafond (€)', f.basisCeiling),
    row('Basistarief (%)', f.basisRate),
    row('Verhoogd plafond (€)', f.increasedCeiling),
    row('Verhoogd tarief (%)', f.increasedRate),
    row('Waarschuwen vanaf (MM-DD)', f.warnFrom, 'als er nog ruimte is'),
    h('h3', null, 'Koersen'),
    row('Koers verouderd na (dagen)', f.staleDays),
    h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: save }, `Parameters ${st.year} opslaan`)),
  );
}
