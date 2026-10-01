// Virtualised list with fixed row height: only visible rows exist in the DOM,
// so 20.000+ transactions stay smooth.
import { h, clear } from './dom.js';

export class VirtualList {
  constructor({ rowHeight = 48, renderRow, overscan = 8 }) {
    this.rowHeight = rowHeight;
    this.renderRow = renderRow;
    this.overscan = overscan;
    this.items = [];
    this.spacer = h('div', { class: 'vlist-spacer' });
    this.el = h('div', { class: 'vlist', role: 'list', tabindex: '0' }, this.spacer);
    this.pending = false;
    this.el.addEventListener('scroll', () => this.schedule());
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.schedule()) : null;
    this.resizeObserver?.observe(this.el);
  }

  setItems(items, { keepScroll = false } = {}) {
    this.items = items;
    this.spacer.style.height = `${items.length * this.rowHeight}px`;
    if (!keepScroll) this.el.scrollTop = 0;
    this.render();
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    const top = this.el.scrollTop;
    const height = this.el.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / this.rowHeight) - this.overscan);
    const last = Math.min(this.items.length, Math.ceil((top + height) / this.rowHeight) + this.overscan);
    clear(this.spacer);
    for (let i = first; i < last; i++) {
      const row = this.renderRow(this.items[i], i);
      row.style.position = 'absolute';
      row.style.top = `${i * this.rowHeight}px`;
      row.style.height = `${this.rowHeight}px`;
      row.style.left = '0';
      row.style.right = '0';
      this.spacer.append(row);
    }
  }
}
