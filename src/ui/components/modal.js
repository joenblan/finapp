import { h, append } from '../dom.js';

/** Simple modal dialog. Returns { el, close }. Escape or the backdrop closes it. */
export function openModal(title, content, { onClose } = {}) {
  const box = h('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true' }, h('h2', null, title));
  append(box, [content]);
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  return { el: box, close };
}
