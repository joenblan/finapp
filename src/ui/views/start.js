import { h } from '../dom.js';
import { PERSPECTIVES, perspectiveAccounts } from '../../core/budget/perspectives.js';
import { perspectiveOverview } from '../../core/budget/freespace.js';
import { forecastPerspective, forecastWarnings } from '../../core/budget/forecast.js';
import { openAlerts } from '../../core/budget/alerts.js';
import { fmtDate, fmtMoney, moneyEl } from '../format.js';
import { kpi, today, upcoming, summaryKpis } from './budget-common.js';
import { netWorthSummary, WEALTH_PERSPECTIVES } from '../../core/wealth/wealth.js';
import { loanStatus } from '../../core/loans/payments.js';

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
  // phase 4: net worth and loans
  const loans = data.loans.filter((l) => l.status === 'bevestigd').map((l) => {
    try {
      return { loan: l, ...loanStatus(data, l, { today: t }) };
    } catch {
      return null;
    }
  }).filter(Boolean);
  const loanNext = loans.filter((x) => x.next).map((x) => ({ loan: x.loan, term: x.next }));
  const loanWarnings = loans.flatMap((x) => [
    ...x.open.map((term) => `${x.loan.name}: afbetaling van ${fmtMoney(term.expected)} op ${fmtDate(term.date)} niet gevonden.`),
    ...x.deviating.slice(-3).map((term) => `${x.loan.name}: afbetaling op ${fmtDate(term.date)} was ${fmtMoney(term.paid)} in plaats van ${fmtMoney(term.expected)}.`),
  ]);
  const wealthPanel = h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Vermogen'),
    h(
      'div',
      { class: 'kpis' },
      WEALTH_PERSPECTIVES.map((p) => {
        const w = netWorthSummary(data, p.id, { today: t });
        return kpi(`${p.label}${w.now.incomplete.length ? ' (onvolledig)' : ''}`, `${fmtMoney(w.now.total)} · ${w.diff >= 0 ? '+' : ''}${fmtMoney(w.diff)} t.o.v. ${fmtDate(w.prev.date)}`, w.diff >= 0 ? '' : 'neg');
      }),
      loans.map((x) => kpi(`${x.loan.name}: openstaand kapitaal`, `${fmtMoney(x.remaining)} · einde ${fmtDate(x.endDate)}`)),
    ),
    h('div', { class: 'form-row' }, h('button', { onclick: () => go('vermogen') }, 'Vermogen'), loans.length ? h('button', { onclick: () => go('woonkrediet') }, 'Woonkrediet') : null),
  );
  return h(
    'div',
    null,
    h('div', { class: 'two-col' }, cards),
    wealthPanel,
    h(
      'div',
      { class: 'two-col' },
      h(
        'div',
        { class: 'panel' },
        h('h2', null, `Waarschuwingen (${alerts.length + warnings.length + loanWarnings.length})`),
        loanWarnings.map((m) => h('div', { class: 'alert-row' }, h('span', { class: 'badge err' }, 'Lening'), h('div', { style: { flex: '1' } }, m), h('button', { onclick: () => go('woonkrediet') }, 'Bekijken'))),
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
        !alerts.length && !warnings.length && !loanWarnings.length ? h('p', { class: 'muted' }, 'Geen openstaande waarschuwingen.') : null,
      ),
      h(
        'div',
        { class: 'panel' },
        h('h2', null, 'Eerstvolgende vaste betalingen'),
        next.length || loanNext.length
          ? h('table', { class: 'grid small' }, h('tbody', null, next.map(({ s, date }) => h('tr', null, h('td', null, fmtDate(date), date < t ? h('span', { class: 'badge err', style: { marginLeft: '6px' } }, 'te laat') : null), h('td', null, s.counterparty?.name || s.counterparty?.iban), h('td', null, data.accounts[s.accountId]?.displayName ?? ''), h('td', { class: 'num' }, moneyEl(s.expectedAmount, 'EUR')))), loanNext.map(({ loan, term }) => h('tr', null, h('td', null, fmtDate(term.date)), h('td', null, loan.name), h('td', null, data.accounts[loan.accountId]?.displayName ?? ''), h('td', { class: 'num' }, moneyEl(-term.expected, 'EUR'))))))
          : h('p', { class: 'muted' }, 'Nog geen bevestigde vaste betalingen. Bekijk de voorstellen bij "Vaste betalingen".'),
        h('div', { class: 'form-row' }, h('button', { onclick: () => go('vast') }, 'Alle vaste betalingen')),
      ),
    ),
  );
}
