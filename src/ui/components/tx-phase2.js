// Phase 2 part of the transaction detail: category, internal transfer, joint mark.
import { h } from '../dom.js';
import { openModal } from './modal.js';
import { createCategoryPicker } from './category-picker.js';
import { openRuleEditor } from './rule-editor.js';
import { allocationOf } from '../../core/categories/categorize.js';
import { categoryLabel } from '../../core/categories/categories.js';
import { isInternal, ownIbans } from '../../core/transfers.js';
import { jointAccounts, MARK_TYPES } from '../../core/joint.js';
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

  // joint account: advance / repayment
  const joints = jointAccounts(data);
  if (joints.length && !(data.accounts[t.accountId]?.ownership?.type === 'gemeenschappelijk' && !joints.some((j) => j.id === t.accountId))) {
    const mark = data.jointMarks?.[t.id] ?? null;
    const onJoint = joints.some((j) => j.id === t.accountId);
    const type = h('select', null, h('option', { value: '' }, '— geen —'), MARK_TYPES.map((m) => h('option', { value: m, selected: mark?.type === m }, m)));
    const jointSel = h('select', { disabled: onJoint }, joints.map((j) => h('option', { value: j.id, selected: (mark?.jointAccountId ?? (onJoint ? t.accountId : joints[0].id)) === j.id }, j.displayName)));
    const currentJoint = () => data.accounts[jointSel.value];
    const person = h('select', { disabled: !onJoint });
    const fillPersons = () => {
      person.replaceChildren(...(onJoint ? currentJoint().ownership.owners : [data.settings.myName ?? '(stel "Mijn naam" in)']).map((o) => h('option', { value: o, selected: mark?.person === o }, o)));
    };
    fillPersons();
    jointSel.addEventListener('change', fillPersons);
    const advances = Object.entries(data.jointMarks ?? {}).filter(([id, m]) => m.type === 'voorschot' && id !== t.id);
    const linked = h(
      'select',
      { multiple: true, size: Math.min(5, Math.max(2, advances.length)) },
      advances.map(([id, m]) => {
        const a = data.transactions.find((x) => x.id === id);
        return a ? h('option', { value: id, selected: mark?.linkedTo?.includes(id) }, `${fmtDate(a.entryDate)} ${fmtMoney(a.amount)} ${a.counterparty?.name ?? ''} (${m.person})`) : null;
      }),
    );
    const save = () => {
      if (!type.value) return run(ctx.service.setJointMark(t.id, null), 'Markering verwijderd.');
      run(
        ctx.service.setJointMark(t.id, {
          type: type.value,
          jointAccountId: jointSel.value,
          person: onJoint ? person.value : undefined,
          linkedTo: type.value === 'terugbetaling' ? [...linked.selectedOptions].map((o) => o.value) : [],
        }),
        'Markering opgeslagen.',
      );
    };
    const row = (label, el) => h('div', { class: 'form-row' }, h('label', null, label), el);
    section.push(
      h('h2', { style: { marginTop: '16px' } }, 'Gemeenschappelijke rekening'),
      h('p', { class: 'muted small' }, onJoint ? 'Voorschot: deze rekening betaalt een persoonlijke kost van een mede-eigenaar. Terugbetaling: verrekening van zo\'n voorschot.' : 'Voorschot: je betaalt vanaf je individuele rekening een gemeenschappelijke kost. Terugbetaling: verrekening van zo\'n voorschot. De categorie blijft behouden.'),
      row('Markering', type),
      row('Gemeenschappelijke rekening', jointSel),
      row('Voor wie', person),
      advances.length ? row('Verrekent voorschot(ten)', linked) : null,
      h('div', { class: 'form-row' }, h('button', { onclick: save }, 'Opslaan')),
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
