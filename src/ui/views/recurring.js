import { h } from '../dom.js';
import { openModal } from '../components/modal.js';
import { INTERVALS } from '../../core/budget/recurring.js';
import { categoryTree, categoryLabel } from '../../core/categories/categories.js';
import { parseEuroInput, formatMilli } from '../../core/money.js';
import { fmtDate, fmtMoney, moneyEl, formatIban } from '../format.js';
import { today, seriesRowData } from './budget-common.js';

const intervalOptions = (sel) => Object.entries(INTERVALS).map(([k, v]) => h('option', { value: k, selected: k === sel }, v.label));
const catOptions = (data, sel) => [h('option', { value: '' }, '— geen —'), ...categoryTree(data).map((c) => h('option', { value: c.id, selected: c.id === sel }, categoryLabel(data, c.id)))];

export function renderRecurring(ctx) {
  const data = ctx.service.data;
  const t = today();
  const run = (p, ok) => p.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));
  const proposals = data.recurring.filter((s) => s.status === 'voorstel');
  const confirmed = data.recurring.filter((s) => s.status === 'bevestigd');
  const rejected = data.recurring.filter((s) => s.status === 'geweigerd');
  const acc = (id) => data.accounts[id]?.displayName ?? id;
  // a series of loan payments is counted via the loan (phase 4), not separately
  const loanBadge = (s) => {
    const loan = s.loanId ? data.loans.find((l) => l.id === s.loanId) : null;
    return loan ? h('div', null, h('span', { class: 'badge info', title: 'Telt in budget en prognose via de lening, niet apart.' }, `gekoppeld aan woonkrediet ${loan.name}`)) : null;
  };

  const adjust = (s) => {
    const interval = h('select', null, intervalOptions(s.interval));
    const day = h('input', { type: 'number', min: 1, max: 31, value: s.day ?? '', size: 4 });
    const amount = h('input', { value: formatMilli(s.expectedAmount), size: 10 });
    const cat = h('select', null, catOptions(data, s.categoryId));
    const modal = openModal(
      `Reeks aanpassen: ${s.counterparty?.name || s.counterparty?.iban}`,
      h(
        'div',
        null,
        h('div', { class: 'form-row' }, h('label', null, 'Interval'), interval),
        h('div', { class: 'form-row' }, h('label', null, 'Dag van de maand'), day),
        h('div', { class: 'form-row' }, h('label', null, 'Verwacht bedrag'), amount, h('span', { class: 'muted small' }, 'negatief = betaling')),
        h('div', { class: 'form-row' }, h('label', null, 'Categorie'), cat),
        h(
          'div',
          { class: 'form-row' },
          h(
            'button',
            {
              class: 'primary',
              onclick: () => {
                try {
                  const patch = { interval: interval.value, day: interval.value === 'week' ? null : Number(day.value) || null, categoryId: cat.value || null };
                  const a = parseEuroInput(amount.value);
                  if (a !== s.expectedAmount) patch.expectedAmount = a;
                  modal.close();
                  run(ctx.service.adjustRecurring(s.id, patch), 'Reeks aangepast.');
                } catch (e) {
                  ctx.toast(e.message, true);
                }
              },
            },
            'Opslaan',
          ),
          h('button', { onclick: () => modal.close() }, 'Annuleren'),
        ),
      ),
    );
  };

  const proposalCard = (s) => {
    const r = seriesRowData(data, s);
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'title' }, r.name),
      h('div', { class: 'muted small' }, `${acc(s.accountId)} · ${s.direction === 'in' ? 'ontvangst' : 'betaling'} · ${r.interval}${s.day ? ` rond de ${s.day}e` : ''}`),
      h('div', { class: 'balance' }, moneyEl(s.expectedAmount, 'EUR')),
      h('div', { class: 'small' }, `${s.txIds.length} keer gezien, laatst op ${fmtDate(s.lastDate)} · volgende verwacht ${r.next ? fmtDate(r.next) : '—'} · zekerheid ${Math.round((s.confidence ?? 0) * 100)} %`),
      h('div', { class: 'small muted' }, `Categorie: ${categoryLabel(data, s.categoryId)}`),
      loanBadge(s),
      h(
        'div',
        { class: 'form-row' },
        h('button', { class: 'primary', onclick: () => run(ctx.service.confirmRecurring(s.id), 'Bevestigd.') }, 'Bevestigen'),
        h('button', { onclick: () => adjust(s) }, 'Aanpassen'),
        h('button', { class: 'danger', onclick: () => run(ctx.service.rejectRecurring(s.id), 'Geweigerd; dit voorstel komt niet terug.') }, 'Weigeren'),
      ),
    );
  };

  let yearTotal = 0;
  let monthTotal = 0;
  const rows = confirmed.map((s) => {
    const r = seriesRowData(data, s);
    if (s.direction === 'uit') {
      yearTotal += r.yearly;
      monthTotal += r.monthly;
    }
    return h(
      'tr',
      null,
      h('td', null, r.name, h('div', { class: 'muted small' }, `${acc(s.accountId)}${s.counterparty?.iban ? ` · ${formatIban(s.counterparty.iban)}` : ''}${s.origin === 'manueel' ? ' · manueel' : ''}`), loanBadge(s)),
      h('td', null, r.interval),
      h('td', null, categoryLabel(data, s.categoryId)),
      h('td', { class: 'num' }, r.last ? moneyEl(r.last.amount, 'EUR') : '—', r.last ? h('div', { class: 'muted small' }, fmtDate(r.last.entryDate)) : null),
      h('td', null, r.next ? fmtDate(r.next) : '—', r.next && r.next < t ? h('span', { class: 'badge err', style: { marginLeft: '4px' } }, 'te laat') : null),
      h('td', { class: 'num' }, moneyEl(s.expectedAmount, 'EUR')),
      h('td', { class: 'num' }, fmtMoney(r.yearly)),
      h('td', { class: 'num' }, fmtMoney(r.monthly)),
      h('td', { style: { whiteSpace: 'nowrap' } }, h('button', { onclick: () => adjust(s) }, 'Aanpassen'), s.origin === 'manueel' ? h('button', { class: 'danger', onclick: () => confirm('Deze manuele reeks verwijderen?') && run(ctx.service.deleteRecurring(s.id), 'Verwijderd.') }, 'Verwijderen') : h('button', { class: 'danger', onclick: () => run(ctx.service.rejectRecurring(s.id), 'Niet langer opgevolgd.') }, 'Stoppen')),
    );
  });

  // manual series form
  const accountSel = h('select', null, Object.values(data.accounts).map((a) => h('option', { value: a.id }, a.displayName)));
  const name = h('input', { size: 20, placeholder: 'bv. Kadaster' });
  const ibanIn = h('input', { size: 22, placeholder: 'IBAN (optioneel)' });
  const interval = h('select', null, intervalOptions('jaar'));
  const amount = h('input', { size: 10, placeholder: 'bv. -950,00' });
  const date = h('input', { type: 'date' });
  const cat = h('select', null, catOptions(data, null));
  const add = () => {
    try {
      const a = parseEuroInput(amount.value);
      run(
        ctx.service.addManualRecurring({ accountId: accountSel.value, name: name.value, iban: ibanIn.value.replace(/\s/g, '').toUpperCase() || null, interval: interval.value, expectedAmount: a, startDate: date.value, categoryId: cat.value || null }),
        'Vaste betaling toegevoegd.',
      );
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };

  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('h2', null, `Voorstellen (${proposals.length})`),
      h('p', { class: 'muted small' }, 'Automatisch gevonden terugkerende betalingen en ontvangsten. Bevestig ze om ze op te volgen (budget, prognose, waarschuwingen). Een geweigerd voorstel komt niet terug.'),
      proposals.length ? h('div', { class: 'cards' }, proposals.map(proposalCard)) : h('p', { class: 'muted' }, 'Geen nieuwe voorstellen.'),
      h('div', { class: 'form-row' }, h('button', { onclick: () => run(ctx.service.recalculateRecurring(), 'Opnieuw gezocht.') }, 'Opnieuw zoeken')),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, `Vaste betalingen en abonnementen (${confirmed.length})`),
      confirmed.length
        ? h(
            'table',
            { class: 'grid small' },
            h('thead', null, h('tr', null, ['Tegenpartij', 'Interval', 'Categorie', 'Laatste bedrag', 'Volgende', 'Verwacht', 'Jaarkost', 'Per maand', ''].map((x, i) => h('th', { class: i >= 3 && i !== 4 && i < 8 ? 'num' : '' }, x)))),
            h('tbody', null, rows, h('tr', { class: 'total' }, h('td', { colspan: '6' }, h('strong', null, 'Totaal betalingen')), h('td', { class: 'num' }, h('strong', null, fmtMoney(yearTotal))), h('td', { class: 'num' }, h('strong', null, fmtMoney(monthTotal))), h('td', null))),
          )
        : h('p', { class: 'muted' }, 'Nog geen bevestigde vaste betalingen.'),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Manueel toevoegen'),
      h('p', { class: 'muted small' }, 'Bijvoorbeeld een jaarlijkse kost zonder historiek. Bedrag negatief voor een betaling. De datum is de eerstvolgende verwachte datum.'),
      h('div', { class: 'form-row' }, accountSel, name, ibanIn),
      h('div', { class: 'form-row' }, interval, amount, date, cat, h('button', { onclick: add }, 'Toevoegen')),
    ),
    rejected.length
      ? h(
          'div',
          { class: 'panel' },
          h('details', null, h('summary', null, `Geweigerd of gestopt (${rejected.length})`), h('table', { class: 'grid small' }, h('tbody', null, rejected.map((s) => h('tr', null, h('td', null, s.counterparty?.name || s.counterparty?.iban), h('td', null, INTERVALS[s.interval].label), h('td', { class: 'num' }, moneyEl(s.expectedAmount, 'EUR')), h('td', null, h('button', { onclick: () => run(ctx.service.confirmRecurring(s.id), 'Toch bevestigd.') }, 'Toch opvolgen'))))))),
        )
      : null,
  );
}
