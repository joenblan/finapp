// Phase 2 part of the transaction detail: category and internal transfer.
import { h } from '../dom.js';
import { openModal } from './modal.js';
import { createCategoryPicker } from './category-picker.js';
import { openRuleEditor } from './rule-editor.js';
import { allocationOf } from '../../core/categories/categorize.js';
import { categoryLabel } from '../../core/categories/categories.js';
import { isInternal, ownIbans } from '../../core/transfers.js';
import { fmtDate, fmtMoney } from '../format.js';

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

  const section = [
    h('h2', { style: { marginTop: '16px' } }, 'Categorie'),
    h('div', null, h('strong', null, categoryLabel(data, alloc?.categoryId ?? null)), sourceText ? h('span', { class: 'muted small' }, ` (${sourceText})`) : null),
    h(
      'div',
      { class: 'form-row' },
      h('button', { onclick: choose }, 'Kiezen…'),
      alloc?.source === 'manueel' ? h('button', { onclick: () => run(ctx.service.resetCategory([t.id]), 'Terug naar automatisch.') }, 'Automatisch') : null,
      h('button', { onclick: () => openRuleEditor(ctx, { fromTx: t, categoryId: alloc?.categoryId ?? null }) }, 'Regel maken…'),
    ),
  ];

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
