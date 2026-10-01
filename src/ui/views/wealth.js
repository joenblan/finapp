// Vermogen: net worth per month, perspectives Persoonlijk / Huishouden, and
// the input of homes (valuations), other assets / debts and shares.
import { h } from '../dom.js';
import { parseEuroInput } from '../../core/money.js';
import { fmtDate, fmtMoney } from '../format.js';
import { kpi, today } from './budget-common.js';
import { lineChart } from '../components/line-chart.js';
import { netWorthSeries, WEALTH_PERSPECTIVES } from '../../core/wealth/wealth.js';
import { isJoint } from '../../core/budget/perspectives.js';
import { monthShort } from '../../core/budget/dates.js';
import { parsePercentBp, bpText } from './loans.js';

const LISTS = {
  properties: { title: 'Woningen', values: 'valuations', valueLabel: 'Waardering', empty: 'Nog geen woning. Een woning telt pas mee vanaf de eerste waardering.' },
  otherAssets: { title: 'Overige bezittingen', values: 'values', valueLabel: 'Waarde', empty: 'Geen.' },
  otherLiabilities: { title: 'Overige schulden', values: 'values', valueLabel: 'Openstaand', empty: 'Geen.' },
};

const parseOwners = (text) =>
  text
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = /^(.*\S)\s+([\d.,]+)\s*%?$/.exec(x);
      if (!m) throw new Error(`Eigenaar "${x}": geef naam en aandeel, bv. "Jan 50".`);
      return { name: m[1], share: parsePercentBp(m[2]) };
    });
const ownersText = (owners) => (owners ?? []).map((o) => `${o.name} ${bpText(o.share)}`).join('; ');

export function renderWealth(ctx) {
  const data = ctx.service.data;
  const st = (ctx.state.wealth ??= { perspective: 'persoonlijk' });
  const run = (p, ok) => p.then((r) => (ok && ctx.toast(ok), r)).catch((e) => ctx.toast(e.message, true));
  const series = netWorthSeries(data, st.perspective, { today: today() });
  const cur = series.at(-1);
  const prev = series.at(-2);

  const head = h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Vermogen'),
    h('div', { class: 'subnav' }, WEALTH_PERSPECTIVES.map((p) => h('button', { class: p.id === st.perspective ? 'active' : '', onclick: () => ((st.perspective = p.id), ctx.rerender()) }, p.label))),
    h('p', { class: 'muted small' }, st.perspective === 'persoonlijk' ? `Persoonlijk: individuele rekeningen voor 100 %, gemeenschappelijke rekeningen, woning en lening volgens jouw aandeel${data.wealth?.myName ? ` (${data.wealth.myName})` : ' (stel bij Instellingen hieronder in wie jij bent)'}.` : 'Huishouden: alles voor 100 %.'),
    cur
      ? h(
          'div',
          { class: 'kpis' },
          kpi('Nettovermogen', fmtMoney(cur.total)),
          kpi('Bezittingen', fmtMoney(cur.assets)),
          kpi('Schulden', fmtMoney(cur.liabilities)),
          prev ? kpi('Verschil t.o.v. vorige maand', fmtMoney(cur.total - prev.total), cur.total >= prev.total ? 'ok' : 'err') : null,
        )
      : h('p', { class: 'muted' }, 'Nog geen gegevens.'),
    cur?.incomplete.length ? h('div', { class: 'banner warn' }, `Onvolledig: ${cur.incomplete.map((i) => `${i.label} (${i.note})`).join(', ')}. Ontbrekende gegevens tellen niet als 0 mee.`) : null,
  );

  const chart = series.length > 1 ? h('div', { class: 'panel' }, h('h3', null, 'Nettovermogen per maand'), lineChart(series.map((m) => ({ date: m.date, balance: m.total, items: m.incomplete.map((i) => ({ label: `onvolledig: ${i.label}`, amount: 0 })) })), { monthly: true, label: 'Nettovermogen per maand', valueLabel: 'Nettovermogen' })) : null;

  // table: items x last 12 months
  const months = series.slice(-12);
  const rowsByKey = new Map();
  for (const m of months) for (const g of m.groups) for (const it of g.items) {
    const key = `${g.id}|${it.id}`;
    if (!rowsByKey.has(key)) rowsByKey.set(key, { group: g.label, label: it.label, cells: new Map() });
    rowsByKey.get(key).cells.set(m.month, it);
  }
  const cell = (it) => {
    if (!it) return h('td', null);
    if (it.counted === null) return h('td', { class: 'num muted', title: it.note ?? '' }, '—');
    return h('td', { class: 'num', title: it.note ?? '' }, fmtMoney(it.counted), it.missing ? h('span', { class: 'muted' }, ' *') : null);
  };
  const table = months.length
    ? h(
        'div',
        { class: 'panel' },
        h('h3', null, 'Detail per maandeinde'),
        h('p', { class: 'muted small' }, '* onvolledig (bv. gegevens van de rekening nog niet tot het einde van de maand); — geen gegevens, niet meegeteld. De lopende maand toont de stand van vandaag.'),
        h(
          'div',
          { class: 'report-wrap' },
          h(
            'table',
            { class: 'grid small' },
            h('thead', null, h('tr', null, h('th', null, ''), months.map((m) => h('th', { class: 'num' }, `${monthShort(m.date)} ${m.date.slice(2, 4)}${m.current ? ' (nu)' : ''}`)))),
            h(
              'tbody',
              null,
              [...rowsByKey.values()].map((r) => h('tr', null, h('td', null, r.label, h('div', { class: 'muted small' }, r.group)), months.map((m) => cell(r.cells.get(m.month))))),
              h('tr', { class: 'total' }, h('td', null, h('strong', null, 'Nettovermogen')), months.map((m) => h('td', { class: 'num' }, h('strong', null, fmtMoney(m.total)), m.incomplete.length ? h('span', { class: 'muted' }, ' *') : null))),
            ),
          ),
        ),
      )
    : null;

  return h('div', null, head, chart, table, Object.keys(LISTS).map((k) => itemsPanel(ctx, k, run)), settingsPanel(ctx, run));
}

function itemsPanel(ctx, list, run) {
  const data = ctx.service.data;
  const cfg = LISTS[list];
  const items = data[list];
  const name = h('input', { size: 20, placeholder: 'naam' });
  const owners = h('input', { size: 26, placeholder: 'eigenaars, bv. Jan 50; An 50' });
  const card = (it) => {
    const date = h('input', { type: 'date', value: today() });
    const value = h('input', { size: 12, placeholder: 'bedrag' });
    const ownersIn = h('input', { size: 26, value: ownersText(it.owners) });
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'title' }, it.name),
      h('div', { class: 'form-row' }, h('label', null, 'Eigenaars'), ownersIn, h('button', { onclick: () => { try { run(ctx.service.saveWealthItem(list, { ...it, owners: parseOwners(ownersIn.value) }), 'Opgeslagen.'); } catch (e) { ctx.toast(e.message, true); } } }, 'Opslaan')),
      h('table', { class: 'grid small' }, h('tbody', null, (it[cfg.values] ?? []).map((v) => h('tr', null, h('td', null, fmtDate(v.date)), h('td', { class: 'num' }, fmtMoney(v.value)), h('td', null, h('button', { class: 'danger', onclick: () => run(ctx.service.removeWealthValue(list, it.id, v.date)) }, 'x')))))),
      h('div', { class: 'form-row' }, h('label', null, cfg.valueLabel), date, value, h('button', { onclick: () => { try { run(ctx.service.addWealthValue(list, it.id, { date: date.value, value: parseEuroInput(value.value) }), 'Toegevoegd.'); } catch (e) { ctx.toast(e.message, true); } } }, 'Toevoegen')),
      h('button', { class: 'danger', onclick: () => confirm(`"${it.name}" verwijderen?`) && run(ctx.service.deleteWealthItem(list, it.id), 'Verwijderd.') }, 'Verwijderen'),
    );
  };
  return h(
    'div',
    { class: 'panel' },
    h('h3', null, cfg.title),
    items.length ? h('div', { class: 'cards' }, items.map(card)) : h('p', { class: 'muted small' }, cfg.empty),
    h('div', { class: 'form-row' }, name, owners, h('button', { onclick: () => { try { run(ctx.service.saveWealthItem(list, { name: name.value, owners: parseOwners(owners.value) }), 'Toegevoegd.'); } catch (e) { ctx.toast(e.message, true); } } }, 'Toevoegen')),
  );
}

function settingsPanel(ctx, run) {
  const data = ctx.service.data;
  const names = new Set();
  for (const l of data.loans) for (const b of l.borrowers ?? []) names.add(b.name);
  for (const k of Object.keys(LISTS)) for (const it of data[k]) for (const o of it.owners ?? []) names.add(o.name);
  for (const a of Object.values(data.accounts)) for (const o of a.ownership?.owners ?? []) if (o.trim()) names.add(o.trim());
  const me = h('select', null, h('option', { value: '' }, '— niet ingesteld (gelijke delen) —'), [...names].sort().map((n) => h('option', { value: n, selected: n === data.wealth?.myName }, n)));
  const joint = Object.values(data.accounts).filter(isJoint).map((a) => ({ a, input: h('input', { size: 5, value: bpText(data.wealth?.jointShares?.[a.id] ?? 5000) }) }));
  const save = () => {
    try {
      const jointShares = {};
      for (const { a, input } of joint) jointShares[a.id] = parsePercentBp(input.value);
      run(ctx.service.updateWealthSettings({ myName: me.value || null, jointShares }), 'Instellingen opgeslagen.');
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };
  return h(
    'div',
    { class: 'panel' },
    h('h3', null, 'Instellingen persoonlijk vermogen'),
    h('div', { class: 'form-row' }, h('label', null, 'Wie ben jij?'), me, h('span', { class: 'muted small' }, 'bepaalt jouw aandeel in woning, lening en overige posten')),
    joint.map(({ a, input }) => h('div', { class: 'form-row' }, h('label', null, `Mijn aandeel in ${a.displayName} (%)`), input)),
    h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: save }, 'Opslaan')),
    h('p', { class: 'muted small' }, 'Beleggingen komen in een latere fase.'),
  );
}
