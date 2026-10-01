// Worklist "Te categoriseren": transactions without category, newest first.
// Keyboard: type to search a category, ↑/↓ choose it, Enter assigns and moves to
// the next transaction; Ctrl+↓/Ctrl+↑ next/previous transaction; Ctrl+Space
// selects; with a selection, Enter assigns to all selected transactions.
import { h, clear, append } from '../dom.js';
import { VirtualList } from '../virtual-list.js';
import { sortForList } from '../../core/filter.js';
import { allocationOf } from '../../core/categories/categorize.js';
import { categoryLabel } from '../../core/categories/categories.js';
import { communicationForDisplay } from '../../core/csv/card.js';
import { createCategoryPicker } from '../components/category-picker.js';
import { openRuleEditor } from '../components/rule-editor.js';
import { fmtDate, fmtMoney, moneyEl, formatIban } from '../format.js';

export function uncategorized(data) {
  return sortForList(data.transactions.filter((t) => !allocationOf(data, t.id)?.categoryId));
}

export function renderWorklist(ctx) {
  const data = ctx.service.data;
  const st = (ctx.state.worklist ??= { currentId: null, selected: new Set(), lastAssigned: null });
  const items = uncategorized(data);
  for (const id of [...st.selected]) if (!items.some((t) => t.id === id)) st.selected.delete(id);
  let index = Math.max(0, items.findIndex((t) => t.id === st.currentId));
  if (!items.length) index = -1;
  st.currentId = items[index]?.id ?? null;

  const detail = h('div', { class: 'panel detail' });
  const info = h('div', { class: 'summary-line' });
  const ruleBar = h('div');
  const list = new VirtualList({
    rowHeight: 52,
    renderRow: (t, i) => {
      const box = h('input', { type: 'checkbox', class: 'check', checked: st.selected.has(t.id), onclick: (e) => { e.stopPropagation(); toggle(t.id); } });
      return h(
        'div',
        { class: `tx-row${i === index ? ' selected' : ''}`, onclick: () => go(i) },
        box,
        h('div', { class: 'small' }, fmtDate(t.entryDate)),
        h('div', { class: 'main' }, h('div', null, t.counterparty?.name || t.bankType || communicationForDisplay(t) || '(geen omschrijving)'), h('div', { class: 'sub' }, [data.accounts[t.accountId]?.displayName, communicationForDisplay(t).replace(/\n/g, ' · ')].filter(Boolean).join(' · '))),
        moneyEl(t.amount, t.currency),
      );
    },
  });

  const picker = createCategoryPicker(data, { onPick: (id) => assign(id) });

  function toggle(id) {
    if (st.selected.has(id)) st.selected.delete(id);
    else st.selected.add(id);
    refresh();
  }
  function go(i) {
    if (i < 0 || i >= items.length) return;
    index = i;
    st.currentId = items[i].id;
    refresh();
    picker.input.focus();
  }
  async function assign(categoryId) {
    if (index < 0 && !st.selected.size) return;
    const ids = st.selected.size ? [...st.selected] : [items[index].id];
    const single = ids.length === 1 ? data.transactions.find((t) => t.id === ids[0]) : null;
    const nextId = items.slice(index + 1).find((t) => !ids.includes(t.id))?.id ?? items.slice(0, index).reverse().find((t) => !ids.includes(t.id))?.id ?? null;
    try {
      st.currentId = nextId;
      st.selected.clear();
      st.lastAssigned = single ? { tx: single, categoryId } : null;
      await ctx.service.assignCategory(ids, categoryId); // triggers a re-render
      ctx.toast(`${ids.length} transactie(s): ${categoryLabel(ctx.service.data, categoryId)}.`);
    } catch (e) {
      ctx.toast(e.message, true);
    }
  }
  function refresh() {
    list.render();
    clear(info).append(`${items.length} transactie(s) zonder categorie${st.selected.size ? ` · ${st.selected.size} geselecteerd (Enter wijst toe aan de selectie)` : ''}`);
    clear(detail);
    const t = items[index];
    if (!t) {
      detail.append(h('h2', null, 'Alles gecategoriseerd'), h('p', { class: 'muted' }, 'Er zijn geen transacties zonder categorie.'));
      return;
    }
    append(detail, [
      h('div', { class: 'muted small' }, `${fmtDate(t.entryDate)} · ${data.accounts[t.accountId]?.displayName ?? ''}`),
      h('h2', { style: { margin: '4px 0' } }, t.counterparty?.name || t.bankType || '(geen naam)'),
      h('div', { class: 'balance' }, moneyEl(t.amount, t.currency)),
      t.counterparty?.account ? h('div', { class: 'small' }, formatIban(t.counterparty.account)) : null,
      h('div', { class: 'small muted', style: { whiteSpace: 'pre-wrap', margin: '6px 0 10px' } }, [t.bankType, communicationForDisplay(t), t.communication?.structured].filter(Boolean).join('\n')),
      picker.el,
      h(
        'p',
        { class: 'small muted' },
        h('span', { class: 'kbd' }, 'Enter'), ' kiezen en volgende · ',
        h('span', { class: 'kbd' }, 'Ctrl+↓'), '/', h('span', { class: 'kbd' }, 'Ctrl+↑'), ' volgende/vorige · ',
        h('span', { class: 'kbd' }, 'Ctrl+Spatie'), ' selecteren',
      ),
    ]);
  }

  picker.input.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'ArrowDown') {
      e.preventDefault();
      go(index + 1);
    } else if (e.ctrlKey && e.key === 'ArrowUp') {
      e.preventDefault();
      go(index - 1);
    } else if (e.ctrlKey && (e.key === ' ' || e.code === 'Space')) {
      e.preventDefault();
      if (items[index]) toggle(items[index].id);
    }
  });

  // After a manual assignment of one transaction: offer to make a rule.
  if (st.lastAssigned) {
    const { tx, categoryId } = st.lastAssigned;
    append(ruleBar, [
      h(
        'div',
        { class: 'banner info form-row' },
        `"${tx.counterparty?.name || communicationForDisplay(tx).slice(0, 40) || 'transactie'}" → ${categoryLabel(data, categoryId)}. Hiervan een regel maken?`,
        h('button', { onclick: () => { st.lastAssigned = null; openRuleEditor(ctx, { fromTx: tx, categoryId }); } }, 'Regel maken…'),
        h('button', { onclick: () => { st.lastAssigned = null; ruleBar.remove(); } }, 'Nee'),
      ),
    ]);
  }

  const selectAll = h('button', { onclick: () => { items.forEach((t) => st.selected.add(t.id)); refresh(); } }, 'Alles selecteren');
  const selectNone = h('button', { onclick: () => { st.selected.clear(); refresh(); } }, 'Selectie wissen');
  const view = h(
    'div',
    { class: 'worklist' },
    h('div', { class: 'panel' }, h('h2', null, 'Te categoriseren'), info, h('div', { class: 'form-row' }, selectAll, selectNone)),
    ruleBar,
    h('div', { class: 'tx-layout' }, list.el, detail),
  );
  list.setItems(items);
  if (index > 0) list.el.scrollTop = Math.max(0, index * 52 - 120);
  refresh();
  setTimeout(() => picker.input.focus(), 0);
  return view;
}
