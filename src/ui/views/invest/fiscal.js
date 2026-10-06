// Tab "Fiscaal": yearly overview per person and income year, printable and
// exportable as CSV. Every amount opens the underlying items.
import { h } from '../../dom.js';
import { openModal } from '../../components/modal.js';
import { fmtDate, fmtMoney } from '../../format.js';
import { today } from '../budget-common.js';
import { yearlyOverview, overviewCsv } from '../../../core/fiscal/yearly.js';
import { investPersons } from '../../../core/invest/capital-gains.js';
import { KINDS } from '../../../core/invest/operations.js';
import { loanLabel } from '../../../core/loans/loans.js';
import { disclaimer } from './invest.js';

export function renderFiscal(ctx) {
  const data = ctx.service.data;
  const st = (ctx.state.fiscal ??= { year: Number(today().slice(0, 4)) });
  const persons = [...new Set([...investPersons(data), ...data.loans.flatMap((l) => (l.borrowers ?? []).map((b) => b.name))])].filter(Boolean).sort();
  st.person = persons.includes(st.person) ? st.person : (data.wealth?.myName && persons.includes(data.wealth.myName) ? data.wealth.myName : persons[0]);
  if (!st.person) return h('div', { class: 'panel' }, h('h2', null, 'Fiscaal jaaroverzicht'), h('p', { class: 'muted' }, 'Nog geen personen: voeg een beleggingsrekening, pensioenspaarproduct of kredietnemer toe.'));
  const o = yearlyOverview(data, st.person, st.year, { today: today() });
  const yearIn = h('input', { type: 'number', size: 5, value: st.year });
  yearIn.addEventListener('change', () => ((st.year = Number(yearIn.value)), ctx.rerender()));
  const personSel = h('select', null, persons.map((p) => h('option', { value: p, selected: p === st.person }, p)));
  personSel.addEventListener('change', () => ((st.person = personSel.value), ctx.rerender()));
  const sec = (id) => data.securities.find((s) => s.id === id)?.name ?? '';
  const show = (title, rows) => openModal(title, rows.length ? h('table', { class: 'grid small' }, h('tbody', null, rows)) : h('p', { class: 'muted' }, 'Geen onderliggende verrichtingen.'));
  const opRows = (ops) => ops.map((x) => h('tr', null, h('td', null, fmtDate(x.date)), h('td', null, KINDS[x.kind]), h('td', null, sec(x.securityId)), h('td', { class: 'num' }, fmtMoney(x.gross || x.costs || x.stockTax))));
  const saleRows = (sales) => sales.map((s) => h('tr', null, h('td', null, fmtDate(s.date)), h('td', null, sec(s.securityId)), h('td', { class: 'num' }, `fiscaal ${fmtMoney(s.my.fiscalGain)}`), h('td', { class: 'num' }, `in basis ${fmtMoney(s.my.basisAmount)}`)));
  const amountLink = (amount, title, rows) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); show(title, rows()); } }, fmtMoney(amount));
  const line = (label, value) => h('tr', null, h('td', null, label), h('td', { class: 'num' }, value));
  const block = (title, rows) => h('div', { class: 'panel' }, h('h3', null, title), h('table', { class: 'grid small', style: { maxWidth: '640px' } }, h('tbody', null, rows)));
  const download = () => {
    const blob = new Blob(['﻿' + overviewCsv(o)], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `fiscaal-${st.year}-${st.person}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const c = o.cgt;
  return h(
    'div',
    { class: 'fiscal-print' },
    h('div', { class: 'panel' }, h('h2', null, `Fiscaal jaaroverzicht ${st.year} – ${st.person}`), h('div', { class: 'form-row no-print' }, h('label', null, 'Persoon'), personSel, h('label', null, 'Inkomstenjaar'), yearIn, h('button', { onclick: () => window.print() }, 'Afdrukken'), h('button', { onclick: download }, 'Exporteren (CSV)')), disclaimer()),
    block('Pensioensparen', o.pension.length ? o.pension.flatMap((p) => [line(`${p.product.provider || 'Pensioensparen'}: gestort`, amountLink(p.status.deposited, 'Stortingen', () => p.deposits.map((d) => h('tr', null, h('td', null, fmtDate(d.date)), h('td', null, d.source), h('td', { class: 'num' }, fmtMoney(d.amount)))))), line('Stelsel', p.status.regime === 'verhoogd' ? 'verhoogd' : 'basis'), line('Verwachte belastingvermindering', fmtMoney(p.status.reduction))]) : [line('Geen pensioenspaarproduct', '')]),
    block('Woonkrediet (effectief betaald)', o.loans.length ? o.loans.flatMap((l) => [line(`${loanLabel(l.loan)}: interest totaal`, amountLink(l.interest, 'Betaalde afbetalingen', () => l.terms.map((t) => h('tr', null, h('td', null, fmtDate(t.date)), h('td', { class: 'num' }, `interest ${fmtMoney(t.interest)}`), h('td', { class: 'num' }, `kapitaal ${fmtMoney(t.capital)}`), h('td', { class: 'num' }, `betaald ${fmtMoney(t.paid)}`))))), line(`${loanLabel(l.loan)}: kapitaal totaal`, fmtMoney(l.capital)), line(`Interest volgens aandeel (${l.share / 100} %)`, fmtMoney(l.myInterest)), line(`Kapitaal volgens aandeel (${l.share / 100} %)`, fmtMoney(l.myCapital)), l.deviating.length ? line('Afwijkende betalingen', String(l.deviating.length)) : null]) : [line('Geen woonkrediet', '')]),
    block('Beleggingen onder meerwaardebelasting', [line('Meerwaarden', amountLink(c.gainTotal, 'Meerwaarden', () => saleRows(c.gains))), line('Minwaarden', amountLink(c.lossTotal, 'Minwaarden', () => saleRows(c.losses))), line('Vrijstelling', fmtMoney(c.exemption)), line('Overgedragen vrijstelling', fmtMoney(c.carried)), line('Belastbare basis', fmtMoney(c.taxable)), line('Berekende belasting', fmtMoney(c.tax)), line('Reeds ingehouden', c.withheld === null ? '—' : fmtMoney(c.withheld)), c.incomplete ? line('Let op', 'onvolledig: referentiekoers ontbreekt') : null]),
    block('Effecten onder Reynderstaks', [line('Gerealiseerde meerwaarden', amountLink(o.reynders.realizedGains, 'Verkopen onder Reynderstaks', () => saleRows(o.reynders.sales))), line('Ingehouden roerende voorheffing', o.reynders.withheldRv === null ? '—' : fmtMoney(o.reynders.withheldRv))]),
    block('Kosten en dividenden', [line('Betaalde beurstaks', amountLink(o.costs.stockTax.amount, 'Beurstaks', () => opRows(o.costs.stockTax.ops))), line('Makelaarskosten', amountLink(o.costs.brokerCosts.amount, 'Makelaarskosten', () => opRows(o.costs.brokerCosts.ops))), line('Dividenden bruto', amountLink(o.costs.dividends.gross, 'Dividenden', () => opRows(o.costs.dividends.ops))), line('Roerende voorheffing op dividenden', fmtMoney(o.costs.dividends.withholding)), line('Dividenden netto', fmtMoney(o.costs.dividends.net))]),
  );
}
