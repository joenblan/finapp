import { h } from '../dom.js';
import { lineChart } from '../components/line-chart.js';
import { PERSPECTIVES, perspectiveAccounts } from '../../core/budget/perspectives.js';
import { forecastAccount, forecastPerspective, forecastWarnings } from '../../core/budget/forecast.js';
import { parseEuroInput, formatMilli } from '../../core/money.js';
import { fmtDate, fmtMoney, moneyEl, formatIban } from '../format.js';
import { today, kpi } from './budget-common.js';

export function renderForecast(ctx) {
  const data = ctx.service.data;
  const t = today();
  const st = (ctx.state.forecast ??= { target: 'persoonlijk', months: 3 });
  const run = (p, ok) => p.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));
  const perspectives = PERSPECTIVES.filter((p) => perspectiveAccounts(data, p.id).all.length);
  if (!perspectives.length) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Nog geen rekeningen.'));
  const target = h(
    'select',
    null,
    perspectives.map((p) => h('option', { value: p.id, selected: st.target === p.id }, `Perspectief: ${p.label}`)),
    Object.values(data.accounts).map((a) => h('option', { value: a.id, selected: st.target === a.id }, `Rekening: ${a.displayName} (${formatIban(a.id)})`)),
  );
  target.addEventListener('change', () => {
    st.target = target.value;
    ctx.rerender();
  });
  const horizon = h('div', { class: 'subnav' }, [3, 6, 12].map((m) => h('button', { class: st.months === m ? 'active' : '', onclick: () => { st.months = m; ctx.rerender(); } }, `${m} maanden`)));
  const variable = h('select', null, h('option', { value: 'gemiddelde', selected: data.budget.forecastVariable === 'gemiddelde' }, 'gemiddelde van de laatste 3 periodes'), h('option', { value: 'budget', selected: data.budget.forecastVariable === 'budget' }, 'budget'));
  variable.addEventListener('change', () => run(ctx.service.updateBudgetSettings({ forecastVariable: variable.value }), 'Opgeslagen.'));

  const isPerspective = PERSPECTIVES.some((p) => p.id === st.target);
  const f = isPerspective ? forecastPerspective(data, st.target, { months: st.months, today: t }) : forecastAccount(data, st.target, { months: st.months, today: t });
  const accountForecasts = isPerspective ? f?.accounts ?? [] : f ? [f] : [];
  const warnings = forecastWarnings(data, accountForecasts);
  const minimum = isPerspective ? null : data.budget.minBalance?.[st.target] ?? 0;

  // planned one-off items
  const accountIds = isPerspective ? perspectiveAccounts(data, st.target).all : [st.target];
  const items = data.plannedItems.filter((p) => accountIds.includes(p.accountId)).sort((a, b) => a.date.localeCompare(b.date));
  const accSel = h('select', null, accountIds.map((id) => h('option', { value: id }, data.accounts[id]?.displayName ?? id)));
  const date = h('input', { type: 'date' });
  const amount = h('input', { size: 10, placeholder: 'bv. -1.500,00' });
  const desc = h('input', { size: 24, placeholder: 'bv. Vakantie' });
  const addItem = () => {
    try {
      run(ctx.service.addPlannedItem({ date: date.value, amount: parseEuroInput(amount.value), accountId: accSel.value, description: desc.value }), 'Verwachte post toegevoegd.');
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };

  return h(
    'div',
    null,
    h('div', { class: 'panel' }, h('h2', null, 'Kasstroomprognose'), h('div', { class: 'filters' }, target, horizon), h('div', { class: 'form-row small' }, h('label', null, 'Variabele uitgaven volgens'), variable)),
    f
      ? h(
          'div',
          { class: 'panel' },
          h(
            'div',
            { class: 'kpis' },
            kpi(`Saldo op ${fmtDate(f.start.date)}`, fmtMoney(f.start.balance)),
            f.min ? kpi('Laagste verwachte saldo', `${fmtMoney(f.min.balance)} op ${fmtDate(f.min.date)}`, f.min.balance < 0 ? 'neg' : '') : null,
            kpi(`Verwacht saldo op ${fmtDate(f.end)}`, fmtMoney(f.days[f.days.length - 1]?.balance ?? f.start.balance)),
          ),
          warnings.map((w) => h('div', { class: 'banner err' }, `${data.accounts[w.accountId]?.displayName}: verwacht saldo ${fmtMoney(w.balance)} op ${fmtDate(w.date)}, onder het minimum van ${fmtMoney(w.minimum)}.`)),
          lineChart(f.days, { minimum, lowest: f.min }),
          h('p', { class: 'muted small' }, 'Op basis van het actuele saldo, de bevestigde vaste betalingen, de verwachte posten hieronder en de verwachte variabele uitgaven (gelijk gespreid over de periode). Beweeg over de grafiek voor de details per dag.'),
        )
      : h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Geen gegevens voor deze keuze.')),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Eenmalige verwachte posten'),
      items.length
        ? h('table', { class: 'grid small' }, h('tbody', null, items.map((p) => h('tr', null, h('td', null, fmtDate(p.date)), h('td', null, p.description), h('td', null, data.accounts[p.accountId]?.displayName ?? ''), h('td', { class: 'num' }, moneyEl(p.amount, 'EUR')), h('td', null, h('button', { class: 'danger', onclick: () => run(ctx.service.removePlannedItem(p.id), 'Verwijderd.') }, 'Wissen'))))))
        : h('p', { class: 'muted' }, 'Nog geen.'),
      h('div', { class: 'form-row' }, accSel, date, amount, desc, h('button', { onclick: addItem }, 'Toevoegen')),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Minimumsaldo per rekening'),
      h('p', { class: 'muted small' }, 'Je krijgt een waarschuwing als het verwachte saldo hieronder zakt (standaard € 0).'),
      accountIds.map((id) => {
        const input = h('input', { size: 10, value: formatMilli(data.budget.minBalance?.[id] ?? 0) });
        return h(
          'div',
          { class: 'form-row' },
          h('label', null, data.accounts[id]?.displayName ?? id),
          input,
          h('button', { onclick: () => { try { run(ctx.service.updateBudgetSettings({ minBalance: { accountId: id, amount: parseEuroInput(input.value) ?? 0 } }), 'Opgeslagen.'); } catch (e) { ctx.toast(e.message, true); } } }, 'Opslaan'),
        );
      }),
    ),
  );
}
