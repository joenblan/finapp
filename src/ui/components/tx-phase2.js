// Phase 2 part of the transaction detail: category and internal transfer.
import { h } from '../dom.js';
import { openModal } from './modal.js';
import { createCategoryPicker } from './category-picker.js';
import { openRuleEditor } from './rule-editor.js';
import { allocationOf } from '../../core/categories/categorize.js';
import { categoryLabel } from '../../core/categories/categories.js';
import { isInternal, ownIbans } from '../../core/transfers.js';
import { fmtDate, fmtMoney } from '../format.js';
import { refundOf, refundsFor, refundCandidates } from '../../core/categories/refunds.js';
import { communicationForDisplay } from '../../core/csv/card.js';

const SOURCE = { manueel: 'manueel gekozen', regel: 'via regel', geen: '' };

export function txPhase2(ctx, t, { links, onShowTx }) {
  const data = ctx.service.data;
  const run = (p, ok) => p.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));
  const alloc = allocationOf(data, t.id);
  const rule = alloc?.ruleId ? data.rules.find((r) => r.id === alloc.ruleId) : null;
  const sourceText = alloc?.source === 'regel' ? (alloc.ruleId?.startsWith('systeem:') ? 'automatisch' : `via regel "${rule?.name ?? '?'}"`) : SOURCE[alloc?.source ?? 'geen'];

  const choose = () => {
    const modal = openModal(
      'Categorie kiezen',
      (() => {
        const picker = createCategoryPicker(data, {
          onPick: async (id) => {
            modal.close();
            try {
              await ctx.service.assignCategory([t.id], id);
              offerRule(ctx, t, id);
            } catch (e) {
              ctx.toast(e.message, true);
            }
          },
        });
        setTimeout(() => picker.input.focus(), 0);
        return picker.el;
      })(),
    );
  };

  const byId = new Map(data.transactions.map((x) => [x.id, x]));
  const label = (x) => `${fmtDate(x.entryDate)} · ${x.counterparty?.name || communicationForDisplay(x).split('\n')[0] || 'zonder naam'} · ${fmtMoney(x.amount)}`;
  const linkTo = (x) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); onShowTx(x); } }, label(x));
  const expense = refundOf(data, t.id) ? byId.get(refundOf(data, t.id)) : null;
  const section = [
    h('h2', { style: { marginTop: '16px' } }, 'Categorie'),
    h('div', null, h('strong', null, categoryLabel(data, alloc?.categoryId ?? null)), expense ? h('span', { class: 'muted small' }, ' (volgt de uitgave)') : sourceText ? h('span', { class: 'muted small' }, ` (${sourceText})`) : null),
    expense
      ? null
      : h(
          'div',
          { class: 'form-row' },
          h('button', { onclick: choose }, 'Kiezen…'),
          alloc?.source === 'manueel' ? h('button', { onclick: () => run(ctx.service.resetCategory([t.id]), 'Terug naar automatisch.') }, 'Automatisch') : null,
          h('button', { onclick: () => openRuleEditor(ctx, { fromTx: t, categoryId: alloc?.categoryId ?? null }) }, 'Regel maken…'),
        ),
  ];

  // refunds (e.g. a friend pays back part of a dinner)
  if (t.amount > 0 && !isInternal(t, data)) {
    section.push(h('h2', { style: { marginTop: '16px' } }, 'Terugbetaling'));
    if (expense) {
      section.push(
        h('div', null, 'Terugbetaling van: ', linkTo(expense)),
        h('div', { class: 'small muted' }, 'Telt als min-uitgave in de categorie van die uitgave.'),
        h('div', { class: 'form-row' }, h('button', { onclick: () => run(ctx.service.unlinkRefund(t.id), 'Koppeling losgemaakt.') }, 'Losmaken')),
      );
    } else {
      section.push(
        h('div', { class: 'small muted' }, 'Is dit een terugbetaling van een uitgave (bv. een vriend die zijn deel van een etentje terugstort)? Koppel ze aan die uitgave: ze krijgt dan dezelfde categorie en verlaagt die uitgave.'),
        h('div', { class: 'form-row' }, h('button', { onclick: () => pickExpense(ctx, t, run) }, 'Koppelen aan uitgave…')),
      );
    }
  }
  if (t.amount < 0) {
    const r = refundsFor(data, t.id);
    if (r.list.length) {
      const net = t.amount + r.total;
      section.push(
        h('h2', { style: { marginTop: '16px' } }, 'Terugbetaald'),
        h('div', null, `${fmtMoney(r.total)} terugbetaald, netto ${fmtMoney(net)}`),
        net > 0 ? h('div', { class: 'banner warn' }, 'Er werd meer terugbetaald dan deze uitgave. Kijk de koppelingen na.') : null,
        h('ul', { class: 'small' }, r.list.map((x) => h('li', null, linkTo(x)))),
      );
    }
  }

  // internal transfer
  const own = ownIbans(data);
  const cp = t.counterparty?.account;
  if (cp && own.has(cp) && cp !== t.accountId) {
    const internal = isInternal(t, data, own);
    const otherId = links.get(t.id);
    const other = otherId ? data.transactions.find((x) => x.id === otherId) : null;
    const target = data.accounts[cp]?.displayName ?? data.externalOwnAccounts.find((e) => e.iban === cp)?.name ?? cp;
    section.push(
      h('h2', { style: { marginTop: '16px' } }, 'Interne overboeking'),
      internal
        ? h(
            'div',
            null,
            h('div', null, `Overboeking ${t.amount < 0 ? 'naar' : 'van'} eigen rekening "${target}". Telt niet mee als inkomst of uitgave.`),
            other
              ? h('div', { class: 'small' }, 'Tegenhanger: ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); onShowTx(other); } }, `${fmtDate(other.entryDate)} ${fmtMoney(other.amount)} op ${data.accounts[other.accountId]?.displayName}`))
              : h('div', { class: 'small muted' }, data.accounts[cp] ? 'Geen tegenhanger gevonden (binnen 5 dagen, tegengesteld bedrag). Dat is geen fout.' : 'Rekening zonder geïmporteerde gegevens.'),
            h('div', { class: 'form-row' }, h('button', { onclick: () => run(ctx.service.setNotInternal(t.id, true), 'Niet langer als interne overboeking behandeld.') }, 'Geen interne overboeking')),
          )
        : h('div', null, h('div', { class: 'muted small' }, 'Door jou gemarkeerd als géén interne overboeking.'), h('button', { onclick: () => run(ctx.service.setNotInternal(t.id, false), 'Weer interne overboeking.') }, 'Toch interne overboeking')),
    );
  }

  return h('div', null, section);
}

/** Choose the expense a refund belongs to. */
function pickExpense(ctx, t, run) {
  const data = ctx.service.data;
  const own = ownIbans(data);
  const all = refundCandidates(data, t, { isInternal: (x) => isInternal(x, data, own) });
  const search = h('input', { size: 30, placeholder: 'zoek op naam, mededeling of bedrag' });
  const list = h('div', { class: 'vlist-plain', style: { maxHeight: '420px', overflow: 'auto' } });
  const draw = () => {
    const q = search.value.trim().toLowerCase().replace(',', '.');
    const hits = all
      .filter((x) => !q || `${x.counterparty?.name ?? ''} ${communicationForDisplay(x)} ${(-x.amount / 1000).toFixed(2)} ${x.entryDate}`.toLowerCase().includes(q))
      .slice(0, 60);
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!hits.length) list.append(h('p', { class: 'muted' }, 'Geen uitgaven gevonden (laatste 180 dagen).'));
    for (const x of hits) {
      list.append(
        h(
          'div',
          { class: 'alert-row' },
          h('div', { style: { flex: '1' } }, h('div', null, `${fmtDate(x.entryDate)} · ${x.counterparty?.name || communicationForDisplay(x).split('\n')[0] || 'zonder naam'}`), h('div', { class: 'small muted' }, `${categoryLabel(data, allocationOf(data, x.id)?.categoryId ?? null)} · ${data.accounts[x.accountId]?.displayName ?? ''}`)),
          h('strong', null, fmtMoney(x.amount)),
          h('button', { onclick: () => { modal.close(); run(ctx.service.linkRefund(t.id, x.id), 'Gekoppeld: de terugbetaling volgt nu de categorie van de uitgave.'); } }, 'Kiezen'),
        ),
      );
    }
  };
  search.addEventListener('input', draw);
  const modal = openModal(`Terugbetaling van ${fmtMoney(t.amount)} koppelen`, h('div', null, h('p', { class: 'small muted' }, 'Kies de uitgave die (deels) terugbetaald wordt. Uitgaven van minstens dit bedrag en dicht in de tijd staan bovenaan.'), h('div', { class: 'form-row' }, search), list));
  draw();
  setTimeout(() => search.focus(), 0);
}

/** After a manual choice: offer to create a rule. */
export function offerRule(ctx, t, categoryId) {
  const modal = openModal(
    'Regel maken?',
    h(
      'div',
      null,
      h('p', null, `"${t.counterparty?.name || 'deze transactie'}" is nu ${categoryLabel(ctx.service.data, categoryId)}. Wil je hiervan een regel maken, zodat gelijkaardige transacties automatisch deze categorie krijgen?`),
      h(
        'div',
        { class: 'form-row' },
        h('button', { class: 'primary', onclick: () => { modal.close(); openRuleEditor(ctx, { fromTx: t, categoryId }); } }, 'Regel maken…'),
        h('button', { onclick: () => modal.close() }, 'Nee, enkel deze transactie'),
      ),
    ),
  );
}
