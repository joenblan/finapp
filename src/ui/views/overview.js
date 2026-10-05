import { h } from '../dom.js';
import { openModal } from '../components/modal.js';
import { buildCategoryReport, defaultPeriod } from '../../core/report-categories.js';
import { categoryLabel } from '../../core/categories/categories.js';
import { categoryOf } from '../../core/categories/categorize.js';
import { communicationForDisplay } from '../../core/csv/card.js';
import { formatMilli } from '../../core/money.js';
import { fmtDate, moneyEl, formatIban } from '../format.js';

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const cell = (v) => (v === undefined || v === 0 ? '' : formatMilli(v));

export function renderOverview(ctx) {
  const data = ctx.service.data;
  // Persoonlijk and Gemeenschappelijk are shown separately: a contribution to the
  // joint account is an expense on one side and income on the other.
  const f = (ctx.state.overview ??= { ...defaultPeriod(data), side: 'individueel', accounts: 'individueel' });
  const sideOf = (a) => (a.ownership?.type === 'gemeenschappelijk' ? 'gemeenschappelijk' : 'individueel');
  const sides = [['individueel', 'Persoonlijk'], ['gemeenschappelijk', 'Gemeenschappelijk']].filter(([s]) => Object.values(data.accounts).some((a) => sideOf(a) === s));
  if (!sides.some(([s]) => s === f.side)) f.side = sides[0]?.[0] ?? 'individueel';
  if (f.accounts !== f.side && data.accounts[f.accounts] && sideOf(data.accounts[f.accounts]) !== f.side) f.accounts = f.side;
  if (f.accounts !== f.side && !data.accounts[f.accounts]) f.accounts = f.side;
  const from = h('input', { type: 'month', value: f.from });
  const to = h('input', { type: 'month', value: f.to });
  const sideAccounts = Object.values(data.accounts).filter((a) => sideOf(a) === f.side);
  const accounts = h(
    'select',
    null,
    h('option', { value: f.side, selected: f.accounts === f.side }, f.side === 'gemeenschappelijk' ? 'Alle gemeenschappelijke rekeningen' : 'Alle persoonlijke rekeningen'),
    sideAccounts.map((a) => h('option', { value: a.id, selected: f.accounts === a.id }, `${a.displayName} (${formatIban(a.id)})`)),
  );
  const sideNav = h(
    'div',
    { class: 'subnav' },
    sides.map(([s, label]) => h('button', { class: s === f.side ? 'active' : '', onclick: () => (Object.assign(f, { side: s, accounts: s }), ctx.rerender()) }, label)),
  );
  const change = () => {
    if (from.value && to.value && from.value <= to.value) {
      Object.assign(f, { from: from.value, to: to.value, accounts: accounts.value });
      ctx.rerender();
    }
  };
  for (const el of [from, to, accounts]) el.addEventListener('change', change);

  const r = buildCategoryReport(data, f);
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const showCell = (label, month, ids) => {
    if (!ids?.length) return;
    const txs = ids.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => b.entryDate.localeCompare(a.entryDate));
    const modal = openModal(
      `${label} · ${month ? monthLabel(month) : 'hele periode'}`,
      h(
        'table',
        { class: 'grid small' },
        h(
          'tbody',
          null,
          txs.map((t) =>
            h(
              'tr',
              {
                style: { cursor: 'pointer' },
                onclick: () => {
                  modal.close();
                  ctx.state.txFilter = { accountId: t.accountId };
                  ctx.state.txSelected = t.id;
                  ctx.state.tab = 'transacties';
                  ctx.rerender();
                },
              },
              h('td', null, fmtDate(t.entryDate)),
              h('td', null, data.accounts[t.accountId]?.displayName ?? ''),
              h('td', null, t.counterparty?.name || communicationForDisplay(t).split('\n')[0]),
              h('td', null, categoryLabel(data, categoryOf(data, t.id))),
              h('td', { class: 'num' }, moneyEl(t.amount, t.currency)),
            ),
          ),
        ),
      ),
    );
  };
  const allIds = (row) => Object.values(row.txIds ?? {}).flat();
  const rowEl = (row, cls) =>
    h(
      'tr',
      { class: cls },
      h('td', null, row.label),
      r.months.map((m) => h('td', { class: 'num', onclick: () => showCell(row.label, m, row.txIds?.[m]) }, cell(row.cells[m]))),
      h('td', { class: 'num', onclick: () => showCell(row.label, null, allIds(row)) }, h('strong', null, cell(row.total))),
    );
  const head = h('tr', null, h('th', null, 'Categorie'), r.months.map((m) => h('th', { class: 'num' }, monthLabel(m))), h('th', { class: 'num' }, 'Totaal'));
  const body = [];
  for (const s of r.sections) {
    body.push(h('tr', { class: 'section' }, h('td', { colspan: String(r.months.length + 2) }, s.label)));
    if (!s.rows.length) body.push(h('tr', null, h('td', { class: 'muted', colspan: String(r.months.length + 2) }, 'Geen.')));
    for (const row of s.rows) body.push(rowEl(row, row.level ? 'child' : 'parent'));
    body.push(rowEl({ label: `Totaal ${s.label.toLowerCase()}`, ...s.totals }, 'total'));
  }
  body.push(rowEl({ label: 'Saldo (inkomsten + uitgaven)', ...r.saldo }, 'total'));
  const ex = r.excluded;
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Overzicht per categorie'),
      sideNav,
      h('div', { class: 'filters' }, h('label', { class: 'field' }, h('span', null, 'Van'), from), h('label', { class: 'field' }, h('span', null, 'Tot en met'), to), h('label', { class: 'field' }, h('span', null, 'Rekeningen'), accounts)),
      h('p', { class: 'muted small' }, `Bedragen in euro; uitgaven zijn negatief. Niet meegeteld: ${ex.internal} interne overboeking(en), ${ex.neutral} beweging(en) in een neutrale categorie (bv. sparen, voorschotten)${ex.foreign ? `, ${ex.foreign} in een andere munt` : ''}. Klik op een bedrag voor de transacties.`),
    ),
    h('div', { class: 'panel report-wrap' }, h('table', { class: 'grid report small' }, h('thead', null, head), h('tbody', null, body))),
  );
}
