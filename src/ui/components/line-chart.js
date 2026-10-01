// Simple line chart in SVG, without external library. Tooltip with date,
// balance and the items of that day. All text is inserted as text nodes.
import { h, clear, append } from '../dom.js';
import { formatMilli } from '../../core/money.js';
import { monthShort } from '../../core/budget/dates.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const eur = (m) => `€ ${formatMilli(m)}`;

/**
 * @param points [{ date, balance, items: [{ label, amount }] }]
 * @param opts { minimum (milli, drawn as a line), lowest: { date, balance } }
 */
export function lineChart(points, { minimum = null, lowest = null, monthly = false, label = 'Verwacht saldo per dag', valueLabel = 'Saldo' } = {}) {
  const W = 900;
  const H = 300;
  const pad = { l: 78, r: 16, t: 14, b: 30 };
  const wrap = h('div', { class: 'chart-wrap' });
  if (!points.length) return wrap;
  const values = points.map((p) => p.balance);
  if (minimum !== null) values.push(minimum);
  let lo = Math.min(...values, 0);
  let hi = Math.max(...values, 0);
  if (lo === hi) hi = lo + 1000;
  const span = hi - lo;
  lo -= span * 0.05;
  hi += span * 0.05;
  const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, points.length - 1);
  const y = (v) => pad.t + ((H - pad.t - pad.b) * (hi - v)) / (hi - lo);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'line-chart', role: 'img', 'aria-label': label });

  // y grid: 5 lines with labels
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    const yy = y(v);
    root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, class: 'grid' }));
    const t = svg('text', { x: pad.l - 6, y: yy + 4, 'text-anchor': 'end', class: 'axis' });
    t.textContent = `€ ${formatMilli(Math.round(v / 1000) * 1000, { decimals: 2 }).replace(/,00$/, '')}`;
    root.append(t);
  }
  // month ticks
  points.forEach((p, i) => {
    if (monthly ? i % Math.max(1, Math.ceil(points.length / 12)) !== 0 : p.date.slice(8, 10) !== '01') return;
    root.append(svg('line', { x1: x(i), x2: x(i), y1: pad.t, y2: H - pad.b, class: 'grid' }));
    const t = svg('text', { x: x(i) + 3, y: H - 10, class: 'axis' });
    t.textContent = `${monthShort(p.date)} ${p.date.slice(2, 4)}`;
    root.append(t);
  });
  if (lo < 0 && hi > 0) root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: 'zero' }));
  if (minimum !== null && minimum !== 0) root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(minimum), y2: y(minimum), class: 'minimum' }));
  root.append(svg('polyline', { points: points.map((p, i) => `${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' '), class: 'line' }));
  if (lowest) {
    const i = points.findIndex((p) => p.date === lowest.date);
    if (i >= 0) root.append(svg('circle', { cx: x(i), cy: y(lowest.balance), r: 5, class: 'lowest' }));
  }
  const cursor = svg('line', { y1: pad.t, y2: H - pad.b, class: 'cursor', visibility: 'hidden' });
  const dot = svg('circle', { r: 4, class: 'dot', visibility: 'hidden' });
  root.append(cursor, dot);
  const overlay = svg('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' });
  root.append(overlay);
  const tip = h('div', { class: 'chart-tip', style: { display: 'none' } });

  const show = (evt) => {
    const box = root.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1))));
    const p = points[i];
    cursor.setAttribute('x1', x(i));
    cursor.setAttribute('x2', x(i));
    cursor.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(p.balance));
    dot.setAttribute('visibility', 'visible');
    append(clear(tip), [
      h('strong', null, fmtDate(p.date)),
      h('div', null, `${valueLabel}: ${eur(p.balance)}`),
      p.items.slice(0, 8).map((it) => h('div', { class: 'small' }, `${it.label}: ${eur(it.amount)}`)),
      p.items.length > 8 ? h('div', { class: 'small muted' }, `+ ${p.items.length - 8} meer`) : null,
    ]);
    tip.style.display = 'block';
    const left = ((x(i) / W) * box.width);
    tip.style.left = `${Math.min(left + 12, box.width - 240)}px`;
    tip.style.top = `${((y(p.balance) / H) * box.height) - 10}px`;
  };
  overlay.addEventListener('mousemove', show);
  overlay.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
    cursor.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
  });
  wrap.append(root, tip);
  return wrap;
}
