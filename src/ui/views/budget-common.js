import { h } from '../dom.js';
import { fmtMoney } from '../format.js';
import { nextOccurrence, yearlyCost, INTERVALS } from '../../core/budget/recurring.js';
import { seriesName } from '../../core/budget/alerts.js';
import { todayIso } from '../../core/budget/dates.js';

export const today = () => todayIso();

export const kpi = (label, value, cls = '') => h('div', { class: `kpi ${cls}` }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));

/** Next expected payments of confirmed series, soonest first. */
export function upcoming(data, limit = 5) {
  return (data.recurring ?? [])
    .filter((s) => s.status === 'bevestigd')
    .map((s) => ({ s, date: s.lastDate ? nextOccurrence(s, s.lastDate) : s.startDate }))
    .filter((x) => x.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

export function seriesRowData(data, s) {
  const last = s.txIds.length ? data.transactions.find((t) => t.id === s.txIds[s.txIds.length - 1]) : null;
  const next = s.lastDate ? nextOccurrence(s, s.lastDate) : s.startDate;
  return { name: seriesName(s), interval: INTERVALS[s.interval].label, last, next, ...yearlyCost(s) };
}

export function summaryKpis(s) {
  return h(
    'div',
    { class: 'kpis' },
    kpi('Vrij te besteden', fmtMoney(s.totalFree)),
    kpi('Al uitgegeven', fmtMoney(s.spent)),
    kpi('Nog beschikbaar', fmtMoney(s.available), s.available < 0 ? 'neg' : ''),
    s.current ? kpi(`Per resterende dag (${s.remainingDays} d)`, fmtMoney(s.perDay)) : null,
  );
}
