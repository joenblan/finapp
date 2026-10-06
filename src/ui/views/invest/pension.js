// Tab "Pensioensparen": per product the follow-up of the running year,
// deposits (from the bank category, corrections, manual), values and history.
import { h } from '../../dom.js';
import { formatMilli } from '../../../core/money.js';
import { fmtDate, fmtMoney } from '../../format.js';
import { kpi, today } from '../budget-common.js';
import { PENSION_TYPES, yearStatus, depositsOf, history, valueOn, productForTx } from '../../../core/pension/pension.js';
import { parseMoney } from '../../../core/invest/units.js';
import { PENSION_CATEGORY } from '../../../core/categories/defaults.js';
import { disclaimer } from './invest.js';

export function renderPension(ctx) {
  const data = ctx.service.data;
  const run = (p, ok) => p.then((r) => (ok && ctx.toast(ok), r)).catch((e) => ctx.toast(e.message, true));
  const t = today();
  const year = Number(t.slice(0, 4));
  const person = h('input', { size: 12, value: data.wealth?.myName ?? '', placeholder: 'persoon' });
  const type = h('select', null, Object.entries(PENSION_TYPES).map(([k, l]) => h('option', { value: k }, l)));
  const provider = h('input', { size: 16, placeholder: 'aanbieder' });
  const add = h('div', { class: 'panel' }, h('h3', null, 'Nieuw pensioenspaarproduct'), h('div', { class: 'form-row' }, person, type, provider, h('button', { class: 'primary', onclick: () => run(ctx.service.savePension({ person: person.value.trim(), type: type.value, provider: provider.value.trim() }), 'Toegevoegd.') }, 'Toevoegen')), h('p', { class: 'muted small' }, 'Stortingen worden automatisch overgenomen uit banktransacties met de categorie "Sparen & beleggen › Pensioensparen". Heb je meerdere producten, kies dan per product van welke bankrekening de stortingen komen.'));
  const cards = data.pension.map((p) => {
    const s = yearStatus(data, p, year, { today: t });
    const regime = h('select', null, [['basis', 'Basisstelsel'], ['verhoogd', 'Verhoogd stelsel']].map(([k, l]) => h('option', { value: k, selected: s.regime === k }, l)));
    regime.addEventListener('change', () => run(ctx.service.setPensionRegime(p.id, year, regime.value), 'Stelsel opgeslagen.'));
    const accounts = h('select', { multiple: true, size: Math.min(4, Object.keys(data.accounts).length || 1) }, Object.values(data.accounts).map((a) => h('option', { value: a.id, selected: (p.accountIds ?? []).includes(a.id) }, a.displayName)));
    const saveAccounts = () => run(ctx.service.savePension({ ...p, accountIds: [...accounts.selectedOptions].map((o) => o.value) }), 'Opgeslagen.');
    const dDate = h('input', { type: 'date', value: t });
    const dAmount = h('input', { size: 9, placeholder: 'bedrag' });
    const vDate = h('input', { type: 'date', value: `${year - 1}-12-31` });
    const vAmount = h('input', { size: 11, placeholder: 'waarde' });
    const deposits = depositsOf(data, p).filter((d) => d.date.startsWith(`${year}-`));
    const excluded = data.transactions.filter((x) => (p.excludedTxIds ?? []).includes(x.id));
    const value = valueOn(p, t);
    const money = (el) => {
      try {
        return parseMoney(el.value);
      } catch (e) {
        ctx.toast(e.message, true);
        return null;
      }
    };
    return h(
      'div',
      { class: 'panel' },
      h('h3', null, `${p.provider || PENSION_TYPES[p.type]} · ${p.person}`, ' ', h('span', { class: 'muted small' }, PENSION_TYPES[p.type])),
      h('div', { class: 'form-row' }, h('label', null, `Stelsel ${year}`), regime),
      h('div', { class: 'kpis' }, kpi(`Gestort ${year}`, fmtMoney(s.deposited)), kpi('Plafond', fmtMoney(s.ceiling)), kpi('Nog te storten', fmtMoney(s.remaining)), kpi('Verwachte vermindering', fmtMoney(s.reduction)), kpi('Laatst gekende waarde', value ? `${fmtMoney(value.value)} (${fmtDate(value.date)})` : '—')),
      s.warnings.map((w) => h('div', { class: `banner ${w.type === 'ruimte' ? 'info' : 'warn'}` }, w.message)),
      h('h4', null, `Stortingen ${year}`),
      deposits.length
        ? h('table', { class: 'grid small' }, h('tbody', null, deposits.map((d) => h('tr', null, h('td', null, fmtDate(d.date)), h('td', null, d.source === 'bank' ? 'bank' : `manueel${d.note ? ` · ${d.note}` : ''}`), h('td', { class: 'num' }, fmtMoney(d.amount)), h('td', null, d.source === 'bank' ? h('button', { onclick: () => run(ctx.service.setPensionTxExcluded(p.id, d.txId, true), 'Telt niet meer mee.') }, 'Niet meetellen') : h('button', { class: 'danger', onclick: () => run(ctx.service.removePensionDeposit(p.id, d.id), 'Verwijderd.') }, 'x'))))))
        : h('p', { class: 'muted small' }, 'Nog geen stortingen dit jaar.'),
      excluded.length ? h('div', { class: 'small muted' }, 'Niet meegeteld: ', excluded.map((x) => h('button', { onclick: () => run(ctx.service.setPensionTxExcluded(p.id, x.id, false), 'Telt weer mee.') }, `${fmtDate(x.entryDate)} ${fmtMoney(-x.amount)} terugzetten`))) : null,
      h('div', { class: 'form-row' }, h('label', null, 'Manuele storting'), dDate, dAmount, h('button', { onclick: () => { const a = money(dAmount); if (a) run(ctx.service.addPensionDeposit(p.id, { date: dDate.value, amount: a }), 'Storting toegevoegd.'); } }, 'Toevoegen')),
      h('h4', null, 'Waarde en historiek'),
      h('div', { class: 'form-row' }, h('label', null, 'Waarde op'), vDate, vAmount, h('button', { onclick: () => { const v = money(vAmount); if (v !== null) run(ctx.service.addPensionValue(p.id, { date: vDate.value, value: v }), 'Waarde toegevoegd.'); } }, 'Toevoegen'), h('span', { class: 'muted small' }, 'bv. uit het jaaroverzicht')),
      h('table', { class: 'grid small' }, h('thead', null, h('tr', null, ['Jaar', 'Gestort', 'Waarde eind van het jaar'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))), h('tbody', null, history(data, p).map((r) => h('tr', null, h('td', null, String(r.year)), h('td', { class: 'num' }, fmtMoney(r.deposited)), h('td', { class: 'num' }, r.value ? `${fmtMoney(r.value.value)} (${fmtDate(r.value.date)})` : '—'))))),
      (p.values ?? []).length ? h('details', null, h('summary', null, 'Ingevoerde waardes'), (p.values ?? []).map((v) => h('div', { class: 'small' }, `${fmtDate(v.date)} ${fmtMoney(v.value)} `, h('button', { class: 'danger', onclick: () => run(ctx.service.removePensionValue(p.id, v.date), 'Verwijderd.') }, 'x')))) : null,
      data.pension.length > 1 ? h('div', { class: 'form-row' }, h('label', null, 'Stortingen van rekening(en)'), accounts, h('button', { onclick: saveAccounts }, 'Opslaan')) : null,
      h('div', { class: 'form-row' }, h('button', { class: 'danger', onclick: () => confirm('Dit pensioenspaarproduct verwijderen? Banktransacties blijven behouden.') && run(ctx.service.deletePension(p.id), 'Verwijderd.') }, 'Product verwijderen')),
      disclaimer(),
    );
  });
  const orphan = data.transactions.filter((x) => data.allocations?.[x.id]?.[0]?.categoryId === PENSION_CATEGORY && data.pension.length && !productForTx(data, x));
  return h(
    'div',
    null,
    h('div', { class: 'panel' }, h('h2', null, 'Pensioensparen'), data.pension.length ? null : h('p', { class: 'muted' }, 'Nog geen pensioenspaarproduct.')),
    orphan.length ? h('div', { class: 'banner warn' }, `${orphan.length} storting(en) met de categorie Pensioensparen horen bij geen enkel product. Kies per product de bankrekening(en).`) : null,
    cards,
    add,
  );
}
