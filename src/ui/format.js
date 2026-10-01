import { formatMilli } from '../core/money.js';
import { formatIban } from '../core/model/ids.js';
import { h } from './dom.js';

export const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
export const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' });
};
export const fmtMoney = (milli, currency = 'EUR') => (milli === null || milli === undefined ? '—' : formatMilli(milli, { currency }));
export const moneyEl = (milli, currency) =>
  h('span', { class: `money ${milli < 0 ? 'neg' : 'pos'}` }, fmtMoney(milli, currency));
export { formatIban };
