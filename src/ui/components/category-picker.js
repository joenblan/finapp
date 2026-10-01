// Searchable category picker: type to filter, ↑/↓ to choose, Enter to confirm.
import { h, clear } from '../dom.js';
import { categoryTree, categoryLabel } from '../../core/categories/categories.js';

const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function createCategoryPicker(data, { onPick, placeholder = 'Zoek een categorie… (Enter = kiezen)', allowNone = false } = {}) {
  const options = categoryTree(data).map((c) => ({ id: c.id, label: categoryLabel(data, c.id), kind: c.kind, isMain: !c.parentId }));
  if (allowNone) options.unshift({ id: null, label: 'Geen categorie', kind: '', isMain: true });
  const input = h('input', { class: 'picker-input', placeholder, autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'picker-list', role: 'listbox' });
  let filtered = options;
  let active = 0;
  const render = () => {
    const q = fold(input.value.trim());
    filtered = q ? options.filter((o) => q.split(/\s+/).every((w) => fold(o.label).includes(w))) : options;
    if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
    clear(list);
    filtered.slice(0, 50).forEach((o, i) => {
      list.append(
        h(
          'div',
          {
            class: `picker-item${i === active ? ' active' : ''}${o.isMain ? ' main' : ''}`,
            role: 'option',
            onmousedown: (e) => {
              e.preventDefault();
              onPick(o.id);
            },
          },
          o.label,
          o.kind ? h('span', { class: 'muted small' }, ` ${o.kind}`) : null,
        ),
      );
    });
    if (!filtered.length) list.append(h('div', { class: 'muted small', style: { padding: '6px' } }, 'Geen categorie gevonden.'));
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      active = Math.min(active + 1, filtered.length - 1);
      render();
    } else if (e.key === 'ArrowUp' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      render();
    } else if (e.key === 'Enter' && filtered[active] && !e.ctrlKey) {
      e.preventDefault();
      onPick(filtered[active].id);
    }
  });
  render();
  return {
    el: h('div', { class: 'picker' }, input, list),
    input,
    reset() {
      input.value = '';
      active = 0;
      render();
    },
  };
}
