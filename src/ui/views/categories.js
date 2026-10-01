import { h } from '../dom.js';
import { openModal } from '../components/modal.js';
import { categoryTree, categoryLabel, KINDS, BUDGET_TYPES } from '../../core/categories/categories.js';

export function renderCategories(ctx) {
  const data = ctx.service.data;
  const counts = new Map();
  for (const list of Object.values(data.allocations ?? {})) for (const a of list) if (a.categoryId) counts.set(a.categoryId, (counts.get(a.categoryId) ?? 0) + 1);
  const ruleCounts = new Map();
  for (const r of data.rules ?? []) ruleCounts.set(r.categoryId, (ruleCounts.get(r.categoryId) ?? 0) + 1);
  const run = (p, ok) => p.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));

  const kindSelect = (c) => {
    const el = h('select', { disabled: c.system }, KINDS.map((k) => h('option', { value: k, selected: c.kind === k }, k)));
    el.addEventListener('change', () => run(ctx.service.updateCategory(c.id, { kind: el.value }), 'Soort aangepast.'));
    return el;
  };
  const budgetSelect = (c) => {
    const el = h('select', null, BUDGET_TYPES.map((k) => h('option', { value: k, selected: (c.budgetType ?? 'variabel') === k }, k)));
    el.addEventListener('change', () => run(ctx.service.setCategoryBudgetType(c.id, el.value), 'Budgettype aangepast.'));
    return el;
  };
  const rename = (c) => {
    const name = prompt('Nieuwe naam:', c.name);
    if (name !== null) run(ctx.service.updateCategory(c.id, { name }), 'Categorie hernoemd.');
  };
  const addSub = (parent) => {
    const name = prompt(parent ? `Nieuwe subcategorie onder "${parent.name}":` : 'Nieuwe hoofdcategorie:');
    if (name) run(ctx.service.addCategory({ name, parentId: parent?.id ?? null, kind: parent?.kind ?? 'uitgave' }), 'Categorie toegevoegd.');
  };
  const removeOrMerge = (c, merge) => {
    const subs = data.categories.filter((x) => x.parentId === c.id);
    const excluded = new Set([c.id, ...subs.map((x) => x.id)]);
    const target = h(
      'select',
      null,
      merge ? null : h('option', { value: '' }, 'Geen categorie (transacties worden ongecategoriseerd, regels verdwijnen)'),
      categoryTree(data).filter((x) => !excluded.has(x.id)).map((x) => h('option', { value: x.id }, categoryLabel(data, x.id))),
    );
    const n = [...excluded].reduce((s, id) => s + (counts.get(id) ?? 0), 0);
    const r = [...excluded].reduce((s, id) => s + (ruleCounts.get(id) ?? 0), 0);
    const modal = openModal(
      merge ? `"${c.name}" samenvoegen met…` : `"${c.name}" verwijderen`,
      h(
        'div',
        null,
        h('p', null, `${n} transactie(s) en ${r} regel(s) gebruiken deze categorie${subs.length ? ` of haar ${subs.length} subcategorie(ën), die mee verdwijnen` : ''}. Waar moeten ze naartoe?`),
        h('div', { class: 'form-row' }, target),
        h(
          'div',
          { class: 'form-row' },
          h(
            'button',
            {
              class: 'primary',
              onclick: () => {
                modal.close();
                run(merge ? ctx.service.mergeCategory(c.id, target.value) : ctx.service.deleteCategory(c.id, target.value || null), merge ? 'Samengevoegd.' : 'Categorie verwijderd.');
              },
            },
            merge ? 'Samenvoegen' : 'Verwijderen',
          ),
          h('button', { onclick: () => modal.close() }, 'Annuleren'),
        ),
      ),
    );
  };

  return h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Categorieën'),
    h('p', { class: 'muted small' }, 'Twee niveaus. De soort bepaalt of een categorie meetelt als inkomst of uitgave; neutrale categorieën (zoals interne overboekingen en bijdragen van de mede-eigenaar) tellen niet mee. Budget: hoe de categorie in het budget telt (vast, variabel of sparen).'),
    h('div', { class: 'form-row' }, h('button', { onclick: () => addSub(null) }, 'Nieuwe hoofdcategorie')),
    h(
      'table',
      { class: 'grid' },
      h('thead', null, h('tr', null, h('th', null, 'Categorie'), h('th', null, 'Soort'), h('th', null, 'Budget'), h('th', { class: 'num' }, 'Transacties'), h('th', { class: 'num' }, 'Regels'), h('th', null, ''))),
      h(
        'tbody',
        null,
        categoryTree(data).map((c) =>
          h(
            'tr',
            null,
            h('td', { style: { paddingLeft: c.parentId ? '28px' : '8px', fontWeight: c.parentId ? '400' : '600' } }, c.name, c.system ? h('span', { class: 'cat-chip', style: { marginLeft: '6px' } }, 'systeem') : null),
            h('td', null, kindSelect(c)),
            h('td', null, budgetSelect(c)),
            h('td', { class: 'num' }, String(counts.get(c.id) ?? 0)),
            h('td', { class: 'num' }, String(ruleCounts.get(c.id) ?? 0)),
            h(
              'td',
              null,
              h('button', { onclick: () => rename(c) }, 'Hernoemen'),
              ' ',
              !c.parentId && !c.system ? h('button', { onclick: () => addSub(c) }, '+ sub') : null,
              ' ',
              !c.system ? h('button', { onclick: () => removeOrMerge(c, true) }, 'Samenvoegen') : null,
              ' ',
              !c.system ? h('button', { class: 'danger', onclick: () => removeOrMerge(c, false) }, 'Verwijderen') : null,
            ),
          ),
        ),
      ),
    ),
  );
}
