// Tab "Beleggingen": overview, operations (with settlement links), unlinked
// operations, prices, capital gains + simulation, accounts and securities.
import { h, clear, append } from '../../dom.js';
import { openModal } from '../../components/modal.js';
import { formatMilli } from '../../../core/money.js';
import { fmtDate, fmtMoney, moneyEl, formatIban } from '../../format.js';
import { kpi, today } from '../budget-common.js';
import { openOperationForm } from './operation-form.js';
import { KINDS, SECURITY_TYPES, REGIMES, netAmount, priceOf, sortedOperations } from '../../../core/invest/operations.js';
import { formatQuantity, formatPrice, parsePrice, parseQuantity, parseMoney } from '../../../core/invest/units.js';
import { computeLots } from '../../../core/invest/lots.js';
import { valuePositions, totals, priceUpdateList } from '../../../core/invest/valuation.js';
import { linkState, linkedTxMap, settlementAccountOf, unlinkedOperations } from '../../../core/invest/settlement.js';
import { yearSummary, simulateSale, investPersons } from '../../../core/invest/capital-gains.js';
import { paramsFor, FISCAL_DISCLAIMER } from '../../../core/fiscal/params.js';
import { communicationForDisplay } from '../../../core/csv/card.js';

const SECTIONS = [
  ['overzicht', 'Overzicht'],
  ['verrichtingen', 'Verrichtingen'],
  ['niet-gekoppeld', 'Niet-gekoppeld'],
  ['koersen', 'Koersen bijwerken'],
  ['meerwaarden', 'Meerwaarden & simulatie'],
  ['beheer', 'Rekeningen & effecten'],
];
const pct = (bp) => (bp === null || bp === undefined ? '—' : `${(bp / 100).toFixed(2).replace('.', ',')} %`);
export const disclaimer = () => h('p', { class: 'muted small' }, `ℹ ${FISCAL_DISCLAIMER}`);

export function renderInvest(ctx) {
  const st = (ctx.state.invest ??= { section: 'overzicht' });
  const data = ctx.service.data;
  const nav = h('div', { class: 'subnav' }, SECTIONS.map(([id, label]) => h('button', { class: id === st.section ? 'active' : '', onclick: () => ((st.section = id), ctx.rerender()) }, label)));
  const empty = !data.investAccounts.length || !data.securities.length;
  const body =
    empty && st.section !== 'beheer'
      ? h('div', { class: 'panel' }, h('p', null, 'Maak eerst een beleggingsrekening en een effect aan.'), h('button', { class: 'primary', onclick: () => ((st.section = 'beheer'), ctx.rerender()) }, 'Rekeningen & effecten'))
      : { overzicht: overview, verrichtingen: operations, 'niet-gekoppeld': unlinked, koersen: prices, meerwaarden: gains, beheer: manage }[st.section](ctx);
  return h('div', null, h('div', { class: 'panel' }, h('h2', null, 'Beleggingen'), nav), body);
}

const run = (ctx, p, ok) => p.then((r) => (ok && ctx.toast(ok), r)).catch((e) => ctx.toast(e.message, true));
const secName = (data, id) => data.securities.find((s) => s.id === id)?.name ?? '—';
const accName = (data, id) => data.investAccounts.find((a) => a.id === id)?.name ?? '—';

// ---- overview ----------------------------------------------------------------

function overview(ctx) {
  const data = ctx.service.data;
  const t = today();
  const all = valuePositions(data, t);
  const tot = totals(all);
  const table = (list) =>
    h(
      'table',
      { class: 'grid small' },
      h('thead', null, h('tr', null, ['Effect', 'Aantal', 'Gem. aankoopprijs', 'Geïnvesteerd', 'Koers', 'Waarde', 'Resultaat', '%', 'Dividenden (netto)', 'Kosten + taksen'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h(
        'tbody',
        null,
        list.map((p) =>
          h(
            'tr',
            null,
            h('td', null, secName(data, p.securityId)),
            h('td', { class: 'num' }, formatQuantity(p.quantity)),
            h('td', { class: 'num' }, p.avgPrice ? `€ ${formatPrice(p.avgPrice)}` : '—'),
            h('td', { class: 'num' }, fmtMoney(p.cost)),
            h('td', { class: 'num' }, p.price ? `€ ${formatPrice(p.price)}` : '—', h('div', { class: 'muted small' }, p.priceDate ? fmtDate(p.priceDate) : p.quantity ? 'geen koers' : ''), p.stale ? h('span', { class: 'badge warn' }, 'koers verouderd') : null),
            h('td', { class: 'num' }, p.value === null ? h('span', { class: 'badge warn' }, 'onbekend') : fmtMoney(p.value)),
            h('td', { class: 'num' }, p.unrealized === null ? '—' : moneyEl(p.unrealized, 'EUR')),
            h('td', { class: 'num' }, pct(p.unrealizedPct)),
            h('td', { class: 'num' }, fmtMoney(p.dividends.gross - p.dividends.withholding)),
            h('td', { class: 'num' }, fmtMoney(p.costs + p.taxes)),
          ),
        ),
      ),
    );
  const perAccount = data.investAccounts.map((a) => {
    const list = all.filter((p) => p.investAccountId === a.id && (p.quantity || p.dividends.gross || p.costs));
    const at = totals(list);
    const cash = a.cash.mode === 'afrekenrekening' ? `cash op afrekenrekening ${data.accounts[a.cash.accountId]?.displayName ?? a.cash.accountId}` : 'cash niet gevolgd';
    return h(
      'div',
      { class: 'panel' },
      h('h3', null, a.name, ' ', h('span', { class: 'muted small' }, `· ${a.institution || ''} · ${a.owners.map((o) => `${o.name}${a.owners.length > 1 ? ` ${o.share / 100} %` : ''}`).join(', ')} · ${cash}`)),
      list.length ? table(list) : h('p', { class: 'muted' }, 'Geen posities.'),
      h('div', { class: 'small' }, `Waarde ${fmtMoney(at.value)}${at.incomplete ? ' (onvolledig: koers ontbreekt)' : ''} · geïnvesteerd ${fmtMoney(at.cost)} · niet-gerealiseerd ${fmtMoney(at.unrealized)}`),
    );
  });
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'kpis' }, kpi('Totale waarde', `${fmtMoney(tot.value)}${tot.incomplete ? ' *' : ''}`), kpi('Geïnvesteerd', fmtMoney(tot.cost)), kpi('Niet-gerealiseerd', `${fmtMoney(tot.unrealized)} (${pct(tot.unrealizedPct)})`, tot.unrealized < 0 ? 'neg' : ''), kpi('Dividenden (netto)', fmtMoney(tot.dividendsNet)), kpi('Kosten + taksen', fmtMoney(tot.costs + tot.taxes))),
      tot.incomplete ? h('div', { class: 'banner warn' }, '* Voor minstens één effect is geen koers gekend: die positie telt niet mee in de waarde (niet als € 0). Vul de koers in bij "Koersen bijwerken".') : null,
      tot.stale ? h('div', { class: 'banner warn' }, 'Minstens één koers is verouderd. Werk de koersen bij.') : null,
      h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: () => openOperationForm(ctx) }, 'Nieuwe verrichting'), h('button', { onclick: () => ((ctx.state.invest.section = 'koersen'), ctx.rerender()) }, 'Koersen bijwerken')),
    ),
    perAccount,
  );
}

// ---- operations --------------------------------------------------------------

export function chooseBankTx(ctx, op) {
  const data = ctx.service.data;
  const accountId = settlementAccountOf(data, op);
  const linked = linkedTxMap(data);
  const net = netAmount(op);
  const day = (iso) => Date.parse(iso) / 86400000;
  const list = data.transactions
    .filter((t) => t.accountId === accountId && Math.sign(t.amount) === Math.sign(net) && (!linked.has(t.id) || linked.get(t.id).id === op.id) && Math.abs(day(t.entryDate) - day(op.date)) <= 31)
    .sort((a, b) => Math.abs(a.amount - net) - Math.abs(b.amount - net) || Math.abs(day(a.entryDate) - day(op.date)) - Math.abs(day(b.entryDate) - day(op.date)))
    .slice(0, 40);
  const m = openModal(
    `Banktransactie kiezen (${fmtMoney(Math.abs(net))})`,
    h(
      'div',
      null,
      h('p', { class: 'small muted' }, `Transacties op ${data.accounts[accountId]?.displayName ?? accountId} binnen 31 dagen, met het dichtste bedrag bovenaan.`),
      list.length
        ? list.map((t) => h('div', { class: 'alert-row' }, h('div', { style: { flex: '1' } }, `${fmtDate(t.entryDate)} · ${t.counterparty?.name || communicationForDisplay(t).split('\n')[0] || ''}`, t.amount !== net ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, `verschil ${fmtMoney(t.amount - net)}`) : null), moneyEl(t.amount, 'EUR'), h('button', { onclick: () => (m.close(), run(ctx, ctx.service.linkOperation(op.id, t.id), 'Gekoppeld.')) }, 'Koppelen')))
        : h('p', { class: 'muted' }, 'Geen passende transacties gevonden.'),
    ),
  );
}

export function linkCell(ctx, op, linked) {
  const data = ctx.service.data;
  const s = linkState(data, op, linked);
  if (s.status === 'niet-gevolgd') return h('span', { class: 'muted small' }, '—');
  const diff = s.diff ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, `verschil ${fmtMoney(s.diff)}: kijk kosten of taks na`) : null;
  if (s.status === 'gekoppeld') return h('div', null, h('span', { class: 'badge ok' }, 'gekoppeld'), h('div', { class: 'small muted' }, s.tx ? `${fmtDate(s.tx.entryDate)} ${fmtMoney(s.tx.amount)}` : 'transactie niet gevonden'), diff, h('button', { onclick: () => run(ctx, ctx.service.unlinkOperation(op.id), 'Losgekoppeld; de vorige categorie is hersteld.') }, 'Loskoppelen'));
  if (s.status === 'voorstel') return h('div', null, h('span', { class: 'badge info' }, 'voorstel'), h('div', { class: 'small muted' }, `${fmtDate(s.tx.entryDate)} ${fmtMoney(s.tx.amount)}`), diff, h('button', { class: 'primary', onclick: () => run(ctx, ctx.service.linkOperation(op.id, s.tx.id), 'Gekoppeld.') }, 'Bevestigen'), h('button', { onclick: () => chooseBankTx(ctx, op) }, 'Andere…'));
  return h('div', null, h('span', { class: 'badge warn' }, 'niet gekoppeld'), h('button', { onclick: () => chooseBankTx(ctx, op) }, 'Kiezen…'));
}

function operations(ctx) {
  const data = ctx.service.data;
  const lots = computeLots(data);
  const saleOf = new Map(lots.sales.map((s) => [s.op.id, s]));
  const issueOf = new Map(lots.issues.map((i) => [i.opId, i]));
  const linked = linkedTxMap(data);
  const ops = sortedOperations(data.operations).reverse();
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: () => openOperationForm(ctx) }, 'Nieuwe verrichting')),
    ops.length
      ? h(
          'table',
          { class: 'grid small' },
          h('thead', null, h('tr', null, ['Datum', 'Rekening', 'Effect', 'Soort', 'Aantal', 'Bruto', 'Koers', 'Kosten', 'Beurstaks', 'RV', 'Netto', 'Bank', ''].map((x, i) => h('th', { class: i >= 4 && i <= 10 ? 'num' : '' }, x)))),
          h(
            'tbody',
            null,
            ops.map((o) => {
              const sale = saleOf.get(o.id);
              return [
                h(
                  'tr',
                  null,
                  h('td', null, fmtDate(o.date)),
                  h('td', null, accName(data, o.investAccountId)),
                  h('td', null, o.securityId ? secName(data, o.securityId) : '—'),
                  h('td', null, KINDS[o.kind], o.kind === 'splitsing' ? ` ${o.split.from}→${o.split.to}` : null, issueOf.get(o.id) ? h('div', { class: 'small', style: { color: 'var(--err)' } }, issueOf.get(o.id).message) : null),
                  h('td', { class: 'num' }, o.quantity ? formatQuantity(o.quantity) : ''),
                  h('td', { class: 'num' }, o.gross ? fmtMoney(o.gross) : ''),
                  h('td', { class: 'num' }, priceOf(o) ? formatPrice(priceOf(o)) : ''),
                  h('td', { class: 'num' }, o.costs ? fmtMoney(o.costs) : ''),
                  h('td', { class: 'num' }, o.stockTax ? fmtMoney(o.stockTax) : ''),
                  h('td', { class: 'num' }, o.withholding ? fmtMoney(o.withholding) : ''),
                  h('td', { class: 'num' }, o.kind === 'splitsing' ? '' : moneyEl(netAmount(o), 'EUR')),
                  h('td', null, linkCell(ctx, o, linked)),
                  h('td', { style: { whiteSpace: 'nowrap' } }, h('button', { onclick: () => openOperationForm(ctx, { op: o }) }, 'Bewerken'), h('button', { class: 'danger', onclick: () => confirm('Deze verrichting verwijderen? Loten en resultaten worden herberekend.') && run(ctx, ctx.service.deleteOperation(o.id), 'Verwijderd.') }, 'x')),
                ),
                sale
                  ? h(
                      'tr',
                      null,
                      h(
                        'td',
                        { colspan: '13', class: 'small' },
                        h(
                          'details',
                          null,
                          h('summary', null, `Fiscaal resultaat ${fmtMoney(sale.fiscalGain)}${sale.regime === 'reynders' ? ` (RV-deel ${fmtMoney(sale.rvPart)}, in basis ${fmtMoney(sale.basisAmount)})` : sale.regime === 'vrijgesteld' ? ' (vrijgesteld)' : ''} · economisch resultaat ${fmtMoney(sale.economic)}${sale.incomplete ? ' · onvolledig: referentiekoers ontbreekt' : ''}${sale.indicative ? ' · minwaarde indicatief' : ''}`),
                          h('div', null, `Opbrengst (fiscaal) ${fmtMoney(sale.proceeds)} − fiscale aankoopwaarde ${fmtMoney(sale.acquisition)}. Economisch: netto-opbrengst min kostprijs inclusief kosten en taksen.`),
                          h('table', { class: 'grid small' }, h('thead', null, h('tr', null, ['Lot (aankoop)', 'Aantal', 'Kostprijs', 'Referentiewaarde', 'Fiscale aankoopwaarde'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))), h('tbody', null, sale.parts.map((p) => h('tr', null, h('td', null, fmtDate(p.lotDate)), h('td', { class: 'num' }, formatQuantity(p.quantity)), h('td', { class: 'num' }, fmtMoney(p.cost)), h('td', { class: 'num' }, p.refValue === null ? (p.incomplete ? 'ontbreekt' : '—') : fmtMoney(p.refValue)), h('td', { class: 'num' }, fmtMoney(p.acquisition)))))),
                          disclaimer(),
                        ),
                      ),
                    )
                  : null,
              ];
            }),
          ),
        )
      : h('p', { class: 'muted' }, 'Nog geen verrichtingen.'),
  );
}

// ---- unlinked ----------------------------------------------------------------

function unlinked(ctx) {
  const data = ctx.service.data;
  const linked = linkedTxMap(data);
  const settle = data.investAccounts.filter((a) => a.cash.mode === 'afrekenrekening');
  if (!settle.length) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Geen beleggingsrekening met een afrekenrekening.'));
  return h(
    'div',
    null,
    settle.map((a) => {
      const ops = unlinkedOperations(data, a.id);
      const bankTx = data.transactions.filter((t) => t.accountId === a.cash.accountId && !linked.has(t.id) && /^beleggingen/.test(data.allocations?.[t.id]?.[0]?.categoryId ?? '') === false);
      return h(
        'div',
        { class: 'panel' },
        h('h3', null, `${a.name} · afrekenrekening ${data.accounts[a.cash.accountId]?.displayName ?? a.cash.accountId}`),
        h('h4', null, `Niet-gekoppelde verrichtingen (${ops.length})`),
        ops.length ? h('table', { class: 'grid small' }, h('tbody', null, ops.map((o) => h('tr', null, h('td', null, fmtDate(o.date)), h('td', null, KINDS[o.kind]), h('td', null, o.securityId ? secName(data, o.securityId) : ''), h('td', { class: 'num' }, moneyEl(netAmount(o), 'EUR')), h('td', null, linkCell(ctx, o, linked)))))) : h('p', { class: 'muted small' }, 'Alles gekoppeld.'),
        h('p', { class: 'muted small' }, `Tip: open een banktransactie van deze rekening bij Transacties en kies "Maak verrichting van deze transactie". ${bankTx.length} transacties op de afrekenrekening zijn niet aan een verrichting gekoppeld (ook gewone uitgaven).`),
      );
    }),
  );
}

// ---- prices ------------------------------------------------------------------

function prices(ctx) {
  const data = ctx.service.data;
  const t = today();
  const list = priceUpdateList(data, t);
  const date = h('input', { type: 'date', value: t });
  const inputs = list.map((x) => ({ x, input: h('input', { size: 10, placeholder: x.last ? formatPrice(x.last.price) : 'koers' }) }));
  const saveAll = async () => {
    let n = 0;
    for (const { x, input } of inputs) {
      if (!input.value.trim()) continue;
      try {
        await ctx.service.setPrice(x.security.id, date.value, parsePrice(input.value));
        n++;
      } catch (e) {
        ctx.toast(`${x.security.name}: ${e.message}`, true);
        return;
      }
    }
    ctx.toast(`${n} koers(en) opgeslagen.`);
  };
  const staleDays = paramsFor(data, Number(t.slice(0, 4))).staleDays;
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('h3', null, 'Koersen bijwerken'),
      h('p', { class: 'muted small' }, `Koersen worden nooit online opgehaald: vul ze zelf in (bv. uit je bankapp). Een koers ouder dan ${staleDays} dagen wordt als verouderd gemarkeerd.`),
      h('div', { class: 'form-row' }, h('label', null, 'Datum'), date),
      list.length
        ? h('table', { class: 'grid small' }, h('thead', null, h('tr', null, ['Effect', 'Laatst gekende koers', 'Datum', 'Nieuwe koers (€)'].map((x) => h('th', null, x)))), h('tbody', null, inputs.map(({ x, input }) => h('tr', null, h('td', null, x.security.name, x.security.isin ? h('div', { class: 'muted small' }, x.security.isin) : null), h('td', { class: 'num' }, x.last ? `€ ${formatPrice(x.last.price)}` : '—'), h('td', null, x.last ? fmtDate(x.last.date) : '', x.last?.stale ? h('span', { class: 'badge warn' }, 'verouderd') : null), h('td', null, input)))))
        : h('p', { class: 'muted' }, 'Geen effecten in portefeuille.'),
      h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: saveAll }, 'Opslaan')),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h3', null, 'Historiek'),
      data.securities.map((s) => {
        const ps = [...(data.prices[s.id] ?? [])].reverse();
        return h('details', null, h('summary', null, `${s.name} (${ps.length})`), h('table', { class: 'grid small' }, h('tbody', null, ps.slice(0, 50).map((p) => h('tr', null, h('td', null, fmtDate(p.date)), h('td', { class: 'num' }, `€ ${formatPrice(p.price)}`), h('td', null, h('button', { class: 'danger', onclick: () => run(ctx, ctx.service.setPrice(s.id, p.date, null), 'Koers verwijderd.') }, 'x')))))));
      }),
    ),
  );
}

// ---- capital gains + simulation ----------------------------------------------

function gains(ctx) {
  const data = ctx.service.data;
  const persons = investPersons(data);
  const st = ctx.state.invest;
  st.year ??= Number(today().slice(0, 4));
  st.person = persons.includes(st.person) ? st.person : persons[0];
  if (!st.person) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'Nog geen eigenaars.'));
  const y = yearSummary(data, st.person, st.year);
  const yearIn = h('input', { type: 'number', value: st.year, size: 5 });
  yearIn.addEventListener('change', () => ((st.year = Number(yearIn.value)), ctx.rerender()));
  const personSel = h('select', null, persons.map((p) => h('option', { value: p, selected: p === st.person }, p)));
  personSel.addEventListener('change', () => ((st.person = personSel.value), ctx.rerender()));
  const manual = (field, label) => {
    const v = y[field === 'withheldCgt' ? 'withheld' : field === 'carriedExemption' ? 'carried' : 'reynders'];
    const cur = field === 'withheldRv' ? y.reynders.withheldRv : v;
    const input = h('input', { size: 10, value: cur ? formatMilli(cur) : '' });
    return h('div', { class: 'form-row' }, h('label', { style: { minWidth: '220px' } }, label), input, h('button', { onclick: () => { try { run(ctx, ctx.service.setPersonYear(st.person, st.year, { [field]: input.value.trim() ? parseMoney(input.value) : null }), 'Opgeslagen.'); } catch (e) { ctx.toast(e.message, true); } } }, 'Opslaan'));
  };
  const line = (label, amount, strong = false) => h('tr', null, h('td', null, strong ? h('strong', null, label) : label), h('td', { class: 'num' }, strong ? h('strong', null, fmtMoney(amount)) : fmtMoney(amount)));
  const salesTable = (list) => h('table', { class: 'grid small' }, h('thead', null, h('tr', null, ['Datum', 'Effect', 'Aantal', 'Fiscaal', 'In basis', ''].map((x, i) => h('th', { class: i >= 2 && i <= 4 ? 'num' : '' }, x)))), h('tbody', null, list.map((s) => h('tr', null, h('td', null, fmtDate(s.date)), h('td', null, secName(data, s.securityId)), h('td', { class: 'num' }, formatQuantity(s.quantity)), h('td', { class: 'num' }, fmtMoney(s.my.fiscalGain)), h('td', { class: 'num' }, fmtMoney(s.my.basisAmount)), h('td', { class: 'small' }, [s.incomplete ? 'onvolledig' : null, s.indicative ? 'indicatief' : null, s.share !== 10000 ? `aandeel ${s.share / 100} %` : null].filter(Boolean).join(' · '))))));
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'form-row' }, h('label', null, 'Persoon'), personSel, h('label', null, 'Inkomstenjaar'), yearIn),
      h('h3', null, `Meerwaardebelasting ${st.year} – ${st.person}`),
      y.incomplete ? h('div', { class: 'banner warn' }, 'Onvolledig: voor minstens één lot van vóór de startdatum ontbreekt de referentiekoers (Rekeningen & effecten).') : null,
      h('table', { class: 'grid small', style: { maxWidth: '520px' } }, h('tbody', null, line('Meerwaarden in de basis', y.gainTotal), line(`Aftrekbare minwaarden${y.indicativeLosses ? ' (deels indicatief)' : ''}`, y.lossTotal), line('Netto (niet onder nul)', y.net), line('Vrijstelling', y.exemption), line('Overgedragen vrijstelling', y.carried), line('Belastbare basis', y.taxable, true), line(`Belasting (${(y.params.rate / 10000).toLocaleString('nl-BE')} %)`, y.tax, true), line('Resterende vrijstelling', y.remainingExemption), y.withheld !== null ? line('Reeds ingehouden door de bank', y.withheld) : null, y.difference !== null ? line('Verschil (berekend − ingehouden)', y.difference, true) : null)),
      manual('carriedExemption', 'Overgedragen vrijstelling'),
      manual('withheldCgt', 'Reeds ingehouden door de bank'),
      y.gains.length || y.losses.length ? h('details', null, h('summary', null, `Verkopen (${y.gains.length + y.losses.length})`), salesTable([...y.gains, ...y.losses])) : null,
      disclaimer(),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h3', null, 'Effecten onder Reynderstaks'),
      h('p', { class: 'muted small' }, 'De Reynderstaks zelf wordt niet berekend. Standaard valt de volledige meerwaarde onder de roerende voorheffing en dus buiten de basis hierboven; pas per verkoop het RV-deel aan indien nodig.'),
      h('table', { class: 'grid small', style: { maxWidth: '520px' } }, h('tbody', null, line('Gerealiseerde meerwaarden', y.reynders.realizedGains), line('Deel belast via roerende voorheffing', y.reynders.rvPart), y.reynders.withheldRv !== null ? line('Ingehouden roerende voorheffing', y.reynders.withheldRv) : null)),
      manual('withheldRv', 'Ingehouden roerende voorheffing'),
      y.reynders.sales.length ? salesTable(y.reynders.sales) : null,
      disclaimer(),
    ),
    simulationPanel(ctx),
  );
}

function simulationPanel(ctx) {
  const data = ctx.service.data;
  const out = h('div');
  const account = h('select', null, data.investAccounts.map((a) => h('option', { value: a.id }, a.name)));
  const security = h('select', null, data.securities.map((s) => h('option', { value: s.id }, s.name)));
  const qty = h('input', { size: 8, placeholder: 'aantal' });
  const gross = h('input', { size: 10, placeholder: 'bedrag' });
  const date = h('input', { type: 'date', value: today() });
  const go = () => {
    try {
      const r = simulateSale(data, { investAccountId: account.value, securityId: security.value, quantity: parseQuantity(qty.value), gross: parseMoney(gross.value), date: date.value });
      append(clear(out), [
        r.shortfall ? h('div', { class: 'banner warn' }, 'Zoveel stuks zijn er op die datum niet in portefeuille.') : null,
        h('div', { class: 'kpis' }, kpi('Fiscale meerwaarde', fmtMoney(r.sale.fiscalGain)), kpi('Verwachte beurstaks', fmtMoney(r.stockTax)), kpi('Regime', REGIMES[r.regime]), kpi('Economisch resultaat', fmtMoney(r.sale.economic))),
        h('table', { class: 'grid small' }, h('thead', null, h('tr', null, ['Verbruikt lot', 'Aantal', 'Kostprijs', 'Fiscale aankoopwaarde'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))), h('tbody', null, r.sale.parts.map((p) => h('tr', null, h('td', null, fmtDate(p.lotDate)), h('td', { class: 'num' }, formatQuantity(p.quantity)), h('td', { class: 'num' }, fmtMoney(p.cost)), h('td', { class: 'num' }, fmtMoney(p.acquisition)))))),
        h('ul', { class: 'small' }, r.owners.map((o) => h('li', null, `${o.name}${o.share !== 10000 ? ` (${o.share / 100} %)` : ''}: resterende vrijstelling dit jaar ${fmtMoney(o.remainingBefore)} → ${fmtMoney(o.remainingAfter)}; belasting ${fmtMoney(o.taxBefore)} → ${fmtMoney(o.taxAfter)}`))),
        h('p', { class: 'muted small' }, 'Simulatie: er wordt niets bewaard.'),
        disclaimer(),
      ]);
    } catch (e) {
      append(clear(out), [h('div', { class: 'banner err' }, e.message)]);
    }
  };
  return h('div', { class: 'panel' }, h('h3', null, 'Simulatie: wat als ik verkoop?'), h('div', { class: 'form-row' }, account, security, qty, h('span', null, 'stuks voor €'), gross, date, h('button', { class: 'primary', onclick: go }, 'Berekenen')), out);
}

// ---- accounts and securities -------------------------------------------------

function manage(ctx) {
  const data = ctx.service.data;
  const accForm = (a = null) => {
    const name = h('input', { size: 20, value: a?.name ?? '' });
    const inst = h('input', { size: 16, value: a?.institution ?? '' });
    const owner = h('input', { size: 14, value: a?.owners?.[0]?.name ?? data.wealth?.myName ?? '' });
    const mode = h('select', null, [['afrekenrekening', 'Afrekenrekening (bankrekening)'], ['niet-gevolgd', 'Cash niet gevolgd']].map(([v, l]) => h('option', { value: v, selected: (a?.cash?.mode ?? 'afrekenrekening') === v }, l)));
    const bank = h('select', null, Object.values(data.accounts).map((b) => h('option', { value: b.id, selected: a?.cash?.accountId === b.id }, `${b.displayName} (${formatIban(b.id)})`)));
    const save = () => run(ctx, ctx.service.saveInvestAccount({ ...(a ? { id: a.id } : {}), name: name.value.trim(), institution: inst.value.trim(), owners: a?.owners?.length > 1 ? a.owners : [{ name: owner.value.trim(), share: 10000 }], cash: { mode: mode.value, accountId: mode.value === 'afrekenrekening' ? bank.value : null } }), 'Beleggingsrekening opgeslagen.');
    return h('div', { class: 'form-row' }, h('label', null, 'Naam'), name, h('label', null, 'Instelling'), inst, h('label', null, 'Eigenaar'), owner, mode, bank, h('button', { class: 'primary', onclick: save }, a ? 'Opslaan' : 'Toevoegen'), a ? h('button', { class: 'danger', onclick: () => confirm(`"${a.name}" verwijderen?`) && run(ctx, ctx.service.deleteInvestAccount(a.id), 'Verwijderd.') }, 'Verwijderen') : null);
  };
  const rates = paramsFor(data, Number(today().slice(0, 4))).stockTaxRates;
  const secForm = (s = null) => {
    const name = h('input', { size: 18, value: s?.name ?? '', placeholder: 'naam' });
    const isin = h('input', { size: 13, value: s?.isin ?? '', placeholder: 'ISIN (optioneel)' });
    const type = h('select', null, Object.entries(SECURITY_TYPES).map(([k, l]) => h('option', { value: k, selected: (s?.type ?? 'etf') === k }, l)));
    const dist = h('select', null, [['kapitaliserend', 'Kapitaliserend'], ['distribuerend', 'Distribuerend']].map(([k, l]) => h('option', { value: k, selected: (s?.distribution ?? 'kapitaliserend') === k }, l)));
    const rate = h('select', null, h('option', { value: '' }, 'beurstaks: geen'), rates.map((r) => h('option', { value: r.id, selected: s?.taxRateId === r.id }, `beurstaks ${r.label}`)));
    const regime = h('select', null, Object.entries(REGIMES).map(([k, l]) => h('option', { value: k, selected: (s?.regime ?? 'meerwaarde') === k }, l)));
    const ref = h('input', { size: 9, value: s?.referencePrice ? formatPrice(s.referencePrice) : '', placeholder: 'ref.koers' });
    const save = () => {
      try {
        run(ctx, ctx.service.saveSecurity({ ...(s ? { id: s.id } : {}), name: name.value.trim(), isin: isin.value.trim().toUpperCase() || null, type: type.value, distribution: dist.value, taxRateId: rate.value || null, regime: regime.value, referencePrice: ref.value.trim() ? parsePrice(ref.value) : null }), 'Effect opgeslagen.');
      } catch (e) {
        ctx.toast(e.message, true);
      }
    };
    return h('div', { class: 'form-row' }, name, isin, type, dist, rate, regime, ref, h('button', { class: 'primary', onclick: save }, s ? 'Opslaan' : 'Toevoegen'), s ? h('button', { class: 'danger', onclick: () => confirm(`"${s.name}" verwijderen?`) && run(ctx, ctx.service.deleteSecurity(s.id), 'Verwijderd.') }, 'Verwijderen') : null);
  };
  const p = paramsFor(data, Number(today().slice(0, 4)));
  return h(
    'div',
    null,
    h('div', { class: 'panel' }, h('h3', null, 'Beleggingsrekeningen'), h('p', { class: 'muted small' }, 'Een beleggingsrekening heeft geen eigen kaspositie. Aan- en verkopen worden verrekend op de afrekenrekening (een bankrekening uit de app), of de cash wordt niet gevolgd.'), data.investAccounts.map((a) => accForm(a)), h('h4', null, 'Nieuwe beleggingsrekening'), accForm()),
    h('div', { class: 'panel' }, h('h3', null, 'Effecten'), h('p', { class: 'muted small' }, `Kies zelf het beurstakstarief (de app raadt het niet). Referentiekoers: de koers op ${fmtDate(p.cgt.referenceDate)}, nodig voor loten gekocht vóór ${fmtDate(p.cgt.startDate)}.`), data.securities.map((s) => secForm(s)), h('h4', null, 'Nieuw effect'), secForm()),
  );
}
