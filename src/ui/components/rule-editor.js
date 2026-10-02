// Rule editor (modal) with live preview of how many transactions it would hit.
import { h, clear, debounce } from '../dom.js';
import { openModal } from './modal.js';
import { emptyConditions, suggestConditions } from '../../core/categories/rules.js';
import { rulePreview } from '../../core/categories/categorize.js';
import { categoryTree, categoryLabel } from '../../core/categories/categories.js';
import { parseEuroInput, formatMilli } from '../../core/money.js';
import { formatIban } from '../format.js';

/**
 * @param opts { rule? (existing), fromTx? (suggest conditions), categoryId? }
 */
export function openRuleEditor(ctx, { rule = null, fromTx = null, categoryId = null } = {}) {
  const data = ctx.service.data;
  const base = rule ?? { id: undefined, name: '', categoryId: categoryId ?? null, enabled: true, conditions: fromTx ? suggestConditions(fromTx) : emptyConditions() };
  const c = { ...emptyConditions(), ...base.conditions };
  const name = h('input', { value: base.name ?? '', size: 32, placeholder: 'bv. Energieleverancier' });
  const category = h(
    'select',
    null,
    h('option', { value: '' }, '— kies een categorie —'),
    categoryTree(data).map((x) => h('option', { value: x.id, selected: x.id === base.categoryId }, categoryLabel(data, x.id))),
  );
  // known counterparty IBANs (most used first), with their most frequent name, to pick from
  const known = new Map();
  for (const t of data.transactions) {
    const acc = t.counterparty?.account;
    if (!acc || !/^[A-Z]{2}\d{2}/.test(acc)) continue;
    const e = known.get(acc) ?? { n: 0, names: new Map() };
    e.n++;
    const nm = (t.counterparty?.name ?? '').trim();
    if (nm) e.names.set(nm, (e.names.get(nm) ?? 0) + 1);
    known.set(acc, e);
  }
  const listId = `iban-lijst-${Math.random().toString(36).slice(2, 8)}`;
  const ibanList = h(
    'datalist',
    { id: listId },
    [...known]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 1000)
      .map(([acc, e]) => {
        const nm = [...e.names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        const own = data.accounts[acc] ? ' (eigen rekening)' : '';
        return h('option', { value: formatIban(acc), label: `${nm}${own} · ${e.n}×` });
      }),
  );
  const iban = h('input', { value: c.counterpartyIban ? formatIban(c.counterpartyIban) : '', size: 28, placeholder: 'BE00 0000 0000 0000 (kies of typ)', list: listId });
  const nameContains = h('input', { value: c.nameContains ?? '', size: 28 });
  const commContains = h('input', { value: c.communicationContains ?? '', size: 28 });
  const direction = h('select', null, h('option', { value: '' }, 'beide'), h('option', { value: 'in', selected: c.direction === 'in' }, 'in (ontvangst)'), h('option', { value: 'uit', selected: c.direction === 'uit' }, 'uit (betaling)'));
  const min = h('input', { value: c.minAbs !== null && c.minAbs !== undefined ? formatMilli(c.minAbs) : '', size: 10, placeholder: 'bv. 10,00' });
  const max = h('input', { value: c.maxAbs !== null && c.maxAbs !== undefined ? formatMilli(c.maxAbs) : '', size: 10 });
  const account = h(
    'select',
    null,
    h('option', { value: '' }, 'alle rekeningen'),
    Object.values(data.accounts).map((a) => h('option', { value: a.id, selected: a.id === c.accountId }, `${a.displayName} (${formatIban(a.id)})`)),
  );
  const applyNow = h('input', { type: 'checkbox', checked: true });
  const preview = h('div', { class: 'banner info small' });
  const error = h('div', { class: 'small', style: { color: 'var(--err)' } });

  const current = () => ({
    ...base,
    name: name.value,
    categoryId: category.value || null,
    conditions: {
      counterpartyIban: iban.value.trim() || null,
      nameContains: nameContains.value.trim() || null,
      communicationContains: commContains.value.trim() || null,
      direction: direction.value || null,
      minAbs: parseEuroInput(min.value),
      maxAbs: parseEuroInput(max.value),
      accountId: account.value || null,
    },
  });
  const update = () => {
    clear(error);
    try {
      const r = current();
      const probe = { ...r, id: r.id ?? '__preview__', categoryId: r.categoryId ?? '__geen__', conditions: { ...r.conditions, counterpartyIban: r.conditions.counterpartyIban?.replace(/\s/g, '').toUpperCase() ?? null } };
      const p = rulePreview(data, probe);
      clear(preview).append(`Deze voorwaarden passen op ${p.matching} bestaande transactie(s); de regel zou er ${p.applied} een categorie geven (manuele keuzes, interne overboekingen en eerdere regels gaan voor).`);
    } catch (e) {
      clear(preview).append('—');
      error.append(e.message);
    }
  };
  const later = debounce(update, 150);
  for (const el of [name, iban, nameContains, commContains, min, max]) el.addEventListener('input', later);
  for (const el of [category, direction, account]) el.addEventListener('change', update);

  const row = (label, el) => h('div', { class: 'form-row' }, h('label', null, label), el);
  const save = async () => {
    try {
      const r = current();
      if (!r.name.trim()) r.name = categoryLabel(data, r.categoryId);
      const res = await ctx.service.saveRule(r, { apply: applyNow.checked });
      modal.close();
      ctx.toast(applyNow.checked ? `Regel bewaard en toegepast (${res.changed ?? 0} transactie(s) gewijzigd).` : 'Regel bewaard.');
    } catch (e) {
      clear(error).append(e.message);
    }
  };
  const body = h(
    'div',
    null,
    row('Naam', name),
    row('Categorie *', category),
    h('p', { class: 'muted small' }, 'Voorwaarden (alle ingevulde moeten kloppen; tekst zonder onderscheid hoofdletters/kleine letters):'),
    row('Tegenpartij-IBAN', h('span', null, iban, ibanList)),
    row('Naam tegenpartij bevat', nameContains),
    row('Mededeling bevat', commContains),
    row('Richting', direction),
    row('Bedrag vanaf', min),
    row('Bedrag tot', max),
    row('Rekening', account),
    preview,
    h('label', { class: 'small' }, applyNow, ' Meteen toepassen op bestaande transacties (manuele keuzes blijven altijd behouden)'),
    error,
    h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: save }, 'Regel bewaren'), h('button', { onclick: () => modal.close() }, 'Annuleren')),
  );
  const modal = openModal(rule ? 'Regel bewerken' : 'Nieuwe regel', body);
  update();
  return modal;
}
