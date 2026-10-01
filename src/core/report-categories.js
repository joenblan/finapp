// Overview per category: categories as rows, months as columns. Income and
// expenses in separate sections, plus the balance. Internal transfers,
// neutral categories (e.g. contribution of the co-owner) and movements in
// another currency are excluded from the totals.
import { add } from './money.js';
import { categoryById, categoryTree } from './categories/categories.js';
import { ownIbans, isInternal } from './transfers.js';

export function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 240) break;
  }
  return out;
}

export function accountFilterFn(data, filter) {
  if (!filter || filter === 'alle') return () => true;
  if (filter === 'individueel' || filter === 'gemeenschappelijk') {
    return (t) => (data.accounts[t.accountId]?.ownership?.type ?? 'individueel') === filter;
  }
  return (t) => t.accountId === filter;
}

/**
 * @param opts { from: 'YYYY-MM', to: 'YYYY-MM', accounts: 'alle'|'individueel'|'gemeenschappelijk'|accountId }
 * @returns { months, sections: [{ id, label, rows, totals }], saldo, excluded }
 *   row: { key, label, level: 0|1, cells: {month: milli}, txIds: {month: [id]}, total }
 */
export function buildCategoryReport(data, { from, to, accounts = 'alle' }) {
  const months = monthRange(from, to);
  const inRange = new Set(months);
  const accept = accountFilterFn(data, accounts);
  const own = ownIbans(data);
  const excluded = { internal: 0, neutral: 0, foreign: 0 };
  // section -> mainKey -> { childKey -> cell data }
  const acc = { inkomst: new Map(), uitgave: new Map() };
  const put = (section, mainKey, childKey, month, amount, id) => {
    if (!acc[section].has(mainKey)) acc[section].set(mainKey, new Map());
    const main = acc[section].get(mainKey);
    if (!main.has(childKey)) main.set(childKey, { cells: {}, txIds: {} });
    const c = main.get(childKey);
    c.cells[month] = add(c.cells[month] ?? 0, amount);
    (c.txIds[month] ??= []).push(id);
  };
  for (const t of data.transactions) {
    const month = t.entryDate.slice(0, 7);
    if (!inRange.has(month) || !accept(t)) continue;
    if (t.foreignCurrency) {
      excluded.foreign++;
      continue;
    }
    if (isInternal(t, data, own)) {
      excluded.internal++;
      continue;
    }
    for (const a of data.allocations?.[t.id] ?? [{ categoryId: null, amount: t.amount }]) {
      const cat = a.categoryId ? categoryById(data, a.categoryId) : null;
      if (cat?.kind === 'neutraal') {
        excluded.neutral++;
        continue;
      }
      if (!cat) {
        put(a.amount >= 0 ? 'inkomst' : 'uitgave', '__none__', '__none__', month, a.amount, t.id);
        continue;
      }
      const mainId = cat.parentId ?? cat.id;
      put(cat.kind, mainId, cat.id, month, a.amount, t.id);
    }
  }
  const order = new Map(categoryTree(data).map((c, i) => [c.id, i]));
  const sumCells = (list) => {
    const cells = {};
    const txIds = {};
    for (const r of list) {
      for (const [m, v] of Object.entries(r.cells)) cells[m] = add(cells[m] ?? 0, v);
      for (const [m, ids] of Object.entries(r.txIds)) (txIds[m] ??= []).push(...ids);
    }
    return { cells, txIds, total: Object.values(cells).reduce((s, v) => add(s, v), 0) };
  };
  const sections = [];
  for (const [section, label] of [['inkomst', 'Inkomsten'], ['uitgave', 'Uitgaven']]) {
    const rows = [];
    const mains = [...acc[section].keys()].sort((a, b) => (a === '__none__' ? 1 : b === '__none__' ? -1 : (order.get(a) ?? 0) - (order.get(b) ?? 0)));
    for (const mainKey of mains) {
      const children = acc[section].get(mainKey);
      if (mainKey === '__none__') {
        const c = children.get('__none__');
        rows.push({ key: `${section}:none`, label: 'Niet gecategoriseerd', level: 0, ...c, total: sumCells([c]).total });
        continue;
      }
      const childRows = [...children.entries()]
        .sort((a, b) => (a[0] === mainKey ? -1 : b[0] === mainKey ? 1 : (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)))
        .map(([id, c]) => ({
          key: `${section}:${id}`,
          label: id === mainKey ? `${categoryById(data, mainKey).name} (algemeen)` : categoryById(data, id).name,
          level: 1,
          ...c,
          total: sumCells([c]).total,
        }));
      rows.push({ key: `${section}:${mainKey}`, label: categoryById(data, mainKey).name, level: 0, ...sumCells(childRows) });
      if (!(childRows.length === 1 && childRows[0].key === `${section}:${mainKey}`)) rows.push(...childRows);
    }
    const totals = sumCells(rows.filter((r) => r.level === 0));
    sections.push({ id: section, label, rows, totals });
  }
  const saldo = sumCells(sections.map((s) => s.totals));
  return { months, sections, saldo, excluded };
}

/** Default period: the last 12 months up to the newest transaction (not before the oldest one). */
export function defaultPeriod(data) {
  let first = '';
  let last = '';
  for (const t of data.transactions) {
    if (!first || t.entryDate < first) first = t.entryDate;
    if (t.entryDate > last) last = t.entryDate;
  }
  const end = last ? last.slice(0, 7) : new Date().toISOString().slice(0, 7);
  let [y, m] = end.split('-').map(Number);
  m -= 11;
  while (m < 1) {
    m += 12;
    y--;
  }
  let from = `${y}-${String(m).padStart(2, '0')}`;
  if (first && first.slice(0, 7) > from) from = first.slice(0, 7);
  return { from, to: end };
}
