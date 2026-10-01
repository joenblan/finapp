import { h } from '../dom.js';
import { PERSPECTIVES, perspectiveAccounts } from '../../core/budget/perspectives.js';
import { perspectiveOverview } from '../../core/budget/freespace.js';
import { categoryTree, categoryLabel } from '../../core/categories/categories.js';
import { parseEuroInput, formatMilli } from '../../core/money.js';
import { fmtDate, fmtMoney } from '../format.js';
import { today, summaryKpis } from './budget-common.js';

export function renderBudget(ctx) {
  const data = ctx.service.data;
  const available = PERSPECTIVES.filter((p) => perspectiveAccounts(data, p.id).flow.length);
  if (!available.length) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Nog geen rekeningen.'));
  const pid = available.some((p) => p.id === ctx.state.budgetPerspective) ? ctx.state.budgetPerspective : available[0].id;
  const cfg = data.budget.perspectives[pid];
  const list = perspectiveOverview(data, pid, { today: today(), previous: 5 });
  const cur = list[0];
  const run = (p, ok) => p.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));

  const nav = h('div', { class: 'subnav' }, available.map((p) => h('button', { class: p.id === pid ? 'active' : '', onclick: () => { ctx.state.budgetPerspective = p.id; ctx.rerender(); } }, p.label)));
  const table = (title, rows) =>
    h('div', null, h('h3', null, title), rows.length ? h('table', { class: 'grid small' }, h('tbody', null, rows)) : h('p', { class: 'muted small' }, 'Geen.'));
  const line = (label, amount, note = null) => h('tr', null, h('td', null, label, note ? h('span', { class: 'muted small' }, ` ${note}`) : null), h('td', { class: 'num' }, fmtMoney(amount)));

  const current = cur
    ? h(
        'div',
        { class: 'panel' },
        h('h2', null, `Lopende periode: ${cur.period.label}`),
        h('div', { class: 'muted small' }, `${fmtDate(cur.period.start)} t.e.m. ${fmtDate(cur.period.end)}${cur.period.expectedStart ? ' (start op verwachte datum)' : ''}`),
        summaryKpis(cur),
        h(
          'div',
          { class: 'two-col' },
          h(
            'div',
            null,
            table('Inkomen', [...cur.details.income.map((x) => line(x.label, x.amount)), ...cur.details.expected.filter((e) => e.amount > 0).map((e) => line(e.label, e.amount, `verwacht ${fmtDate(e.date)}`)), line('Totaal', cur.income.total)]),
            table('Vaste kosten', [
              ...cur.details.fixed.map((x) => line(x.label, x.amount, 'betaald')),
              ...cur.details.expected.filter((e) => e.amount < 0 && e.group !== 'sparen').map((e) => line(e.label, -e.amount, `verwacht ${fmtDate(e.date)}`)),
              line('Totaal', cur.fixed.total),
            ]),
            table('Sparen', [line('Gepland', cur.savings.planned), line('Werkelijk (+ verwacht)', cur.savings.actual + cur.savings.expected), line('Meegeteld (hoogste)', cur.savings.counted)]),
          ),
          h(
            'div',
            null,
            table('Variabele uitgaven', [...cur.details.variable.map((x) => line(x.label, x.amount)), line('Totaal', cur.spent)]),
            h('h3', null, 'Budgetten'),
            cur.budgets.length
              ? cur.budgets.map((b) =>
                  h(
                    'div',
                    { style: { margin: '8px 0' } },
                    h('div', { class: 'small' }, `${b.label}: ${fmtMoney(b.used)} van ${fmtMoney(b.budget)} (${b.pct} %)`, b.status !== 'ok' ? h('span', { class: `badge ${b.status === 'over' ? 'err' : 'warn'}`, style: { marginLeft: '6px' } }, b.status === 'over' ? 'budget overschreden' : '80 % bereikt') : null),
                    h('div', { class: `progress ${b.status}` }, h('div', { style: { width: `${Math.min(100, b.pct)}%` } })),
                  ),
                )
              : h('p', { class: 'muted small' }, 'Nog geen budgetten ingesteld (zie hieronder).'),
          ),
        ),
      )
    : h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Nog geen periode met gegevens.'));

  const previous = h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Vorige periodes'),
    h(
      'table',
      { class: 'grid small' },
      h('thead', null, h('tr', null, ['Periode', 'Inkomen', 'Vaste kosten', 'Sparen', 'Variabel', 'Over'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', null, list.slice(1).map((s) => h('tr', null, h('td', null, s.period.label), ...[s.income.total, s.fixed.total, s.savings.counted, s.spent, s.available].map((v) => h('td', { class: 'num' }, fmtMoney(v)))))),
    ),
  );

  // settings
  const mode = h('select', null, h('option', { value: 'loon', selected: cfg.periodMode === 'loon' }, 'Loonperiode'), h('option', { value: 'kalender', selected: cfg.periodMode === 'kalender' }, 'Kalendermaand'));
  mode.addEventListener('change', () => run(ctx.service.updateBudgetSettings({ periodMode: mode.value }, pid), 'Periode aangepast.'));
  const savings = h('input', { value: formatMilli(cfg.plannedSavings ?? 0), size: 10 });
  const saveSavings = () => {
    try {
      run(ctx.service.updateBudgetSettings({ plannedSavings: parseEuroInput(savings.value) ?? 0 }, pid), 'Gepland sparen opgeslagen.');
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };
  const catSel = h('select', null, categoryTree(data).filter((c) => c.kind === 'uitgave').map((c) => h('option', { value: c.id }, categoryLabel(data, c.id))));
  const amount = h('input', { size: 10, placeholder: 'bv. 400' });
  const addBudget = () => {
    try {
      run(ctx.service.updateBudgetSettings({ budget: { categoryId: catSel.value, amount: parseEuroInput(amount.value) } }, pid), 'Budget opgeslagen.');
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };
  const settings = h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Instellingen voor dit perspectief'),
    h('div', { class: 'form-row' }, h('label', null, 'Periode'), mode),
    h('div', { class: 'form-row' }, h('label', null, 'Gepland sparen per periode'), savings, h('button', { onclick: saveSavings }, 'Opslaan')),
    h('h3', null, 'Budget per categorie per periode'),
    Object.entries(cfg.budgets ?? {}).map(([id, v]) => h('div', { class: 'form-row' }, h('label', null, categoryLabel(data, id)), h('span', null, fmtMoney(v)), h('button', { class: 'danger', onclick: () => run(ctx.service.updateBudgetSettings({ budget: { categoryId: id, amount: null } }, pid), 'Budget verwijderd.') }, 'Wissen'))),
    h('div', { class: 'form-row' }, catSel, amount, h('button', { onclick: addBudget }, 'Budget toevoegen')),
    h('p', { class: 'muted small' }, pid === 'persoonlijk' ? 'Persoonlijk: alle individuele zichtrekeningen. Overboekingen naar de gemeenschappelijke rekening tellen als vaste kost, naar eigen spaarrekeningen als sparen.' : 'Gemeenschappelijk: de gemeenschappelijke rekening(en). Bijdragen van jezelf en van de mede-eigenaar zijn het inkomen.'),
  );
  return h('div', null, nav, current, previous, settings);
}
