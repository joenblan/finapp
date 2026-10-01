import { h } from '../dom.js';
import { PERSPECTIVES, perspectiveAccounts } from '../../core/budget/perspectives.js';
import { perspectiveOverview } from '../../core/budget/freespace.js';
import { forecastPerspective, forecastWarnings } from '../../core/budget/forecast.js';
import { openAlerts } from '../../core/budget/alerts.js';
import { fmtDate, fmtMoney, moneyEl } from '../format.js';
import { kpi, today, upcoming, summaryKpis } from './budget-common.js';

const ALERT = { prijsstijging: ['warn', 'Prijsstijging'], 'nieuwe-reeks': ['info', 'Nieuw'], uitgebleven: ['err', 'Uitgebleven'], gestopt: ['warn', 'Gestopt'] };

export function renderStart(ctx) {
  const data = ctx.service.data;
  if (!data.transactions.length) {
    return h('div', { class: 'panel' }, h('h2', null, 'Welkom'), h('p', null, 'Nog geen gegevens. Importeer je bankbestanden via het tabblad Importeren.'));
  }
  const t = today();
  const go = (tab) => {
    ctx.state.tab = tab;
    ctx.rerender();
  };
  const perspectives = PERSPECTIVES.filter((p) => perspectiveAccounts(data, p.id).flow.length);
  const cards = perspectives.map((p) => {
    const [cur] = perspectiveOverview(data, p.id, { today: t, previous: 0 });
    const f = forecastPerspective(data, p.id, { months: 3, today: t });
    return h(
      'div',
      { class: 'panel' },
      h('h2', null, `${p.label}${cur ? ` · ${cur.period.label}` : ''}`),
      cur ? summaryKpis(cur) : h('p', { class: 'muted' }, 'Nog geen periode.'),
      f?.min ? h('div', { class: 'kpis' }, kpi('Laagste verwachte saldo (3 maanden)', `${fmtMoney(f.min.balance)} op ${fmtDate(f.min.date)}`, f.min.balance < 0 ? 'neg' : '')) : null,
      h('div', { class: 'form-row' }, h('button', { onclick: () => { ctx.state.budgetPerspective = p.id; go('budget'); } }, 'Budget'), h('button', { onclick: () => { ctx.state.forecast = { target: p.id, months: 3 }; go('prognose'); } }, 'Prognose')),
    );
  });
  // account warnings from the forecast (minimum balance)
  const accForecasts = perspectives.flatMap((p) => forecastPerspective(data, p.id, { months: 3, today: t })?.accounts ?? []);
  const warnings = forecastWarnings(data, accForecasts);
  const alerts = openAlerts(data);
  const next = upcoming(data, 5);
  return h(
    'div',
    null,
    h('div', { class: 'two-col' }, cards),
    h(
      'div',
      { class: 'two-col' },
      h(
        'div',
        { class: 'panel' },
        h('h2', null, `Waarschuwingen (${alerts.length + warnings.length})`),
        warnings.map((w) => h('div', { class: 'alert-row' }, h('span', { class: 'badge err' }, 'Saldo'), h('div', { style: { flex: '1' } }, `${data.accounts[w.accountId]?.displayName}: verwacht saldo ${fmtMoney(w.balance)} op ${fmtDate(w.date)}, onder het minimum van ${fmtMoney(w.minimum)}.`))),
        alerts.map((a) =>
          h(
            'div',
            { class: 'alert-row' },
            h('span', { class: `badge ${ALERT[a.type]?.[0] ?? 'info'}` }, ALERT[a.type]?.[1] ?? a.type),
            h('div', { style: { flex: '1' } }, a.message),
            h('button', { onclick: () => ctx.service.dismissAlert(a.id).catch((e) => ctx.toast(e.message, true)) }, 'Afvinken'),
          ),
        ),
        !alerts.length && !warnings.length ? h('p', { class: 'muted' }, 'Geen openstaande waarschuwingen.') : null,
      ),
      h(
        'div',
        { class: 'panel' },
        h('h2', null, 'Eerstvolgende vaste betalingen'),
        next.length
          ? h('table', { class: 'grid small' }, h('tbody', null, next.map(({ s, date }) => h('tr', null, h('td', null, fmtDate(date), date < t ? h('span', { class: 'badge err', style: { marginLeft: '6px' } }, 'te laat') : null), h('td', null, s.counterparty?.name || s.counterparty?.iban), h('td', null, data.accounts[s.accountId]?.displayName ?? ''), h('td', { class: 'num' }, moneyEl(s.expectedAmount, 'EUR'))))))
          : h('p', { class: 'muted' }, 'Nog geen bevestigde vaste betalingen. Bekijk de voorstellen bij "Vaste betalingen".'),
        h('div', { class: 'form-row' }, h('button', { onclick: () => go('vast') }, 'Alle vaste betalingen')),
      ),
    ),
  );
}
