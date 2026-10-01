import { h, clear, debounce } from '../dom.js';
import { VirtualList } from '../virtual-list.js';
import { filterTransactions, sortForList } from '../../core/filter.js';
import { parseEuroInput, sum } from '../../core/money.js';
import { fmtDate, fmtMoney, moneyEl, formatIban } from '../format.js';

export function renderTransactions(ctx) {
  const { data } = ctx.service;
  const f = ctx.state.txFilter;
  const accounts = Object.values(data.accounts).sort((a, b) => a.displayName.localeCompare(b.displayName, 'nl'));

  const accountSel = h(
    'select',
    null,
    h('option', { value: '' }, 'Alle rekeningen'),
    accounts.map((a) => h('option', { value: a.id, selected: f.accountId === a.id }, `${a.displayName} (${formatIban(a.number)})`)),
  );
  const from = h('input', { type: 'date', value: f.from ?? '' });
  const to = h('input', { type: 'date', value: f.to ?? '' });
  const query = h('input', { class: 'search', type: 'search', value: f.query ?? '', placeholder: 'naam, IBAN, mededeling…' });
  const minIn = h('input', { class: 'amount', value: f.minText ?? '', placeholder: 'bv. 10,00' });
  const maxIn = h('input', { class: 'amount', value: f.maxText ?? '', placeholder: 'bv. 500' });
  const reset = h('button', null, 'Wissen');
  const summary = h('div', { class: 'summary-line' });
  const detail = h('div', { class: 'panel detail' }, h('p', { class: 'muted' }, 'Klik op een transactie voor details.'));
  let selectedId = null;

  const list = new VirtualList({
    rowHeight: 52,
    renderRow: (t) => {
      const acc = data.accounts[t.accountId];
      const title = t.counterparty?.name || t.communication?.structured || t.communication?.text || '(geen omschrijving)';
      const sub = [
        f.accountId ? null : acc?.displayName,
        t.communication?.structured && t.counterparty?.name ? t.communication.structured : t.communication?.text,
      ]
        .filter(Boolean)
        .join(' · ');
      return h(
        'div',
        {
          class: `tx-row${t.id === selectedId ? ' selected' : ''}`,
          role: 'listitem',
          onclick: () => {
            selectedId = t.id;
            showDetail(t);
            list.render();
          },
        },
        h('div', { class: 'small' }, fmtDate(t.entryDate)),
        h('div', { class: 'main' }, h('div', null, title), h('div', { class: 'sub' }, sub)),
        moneyEl(t.amount, t.currency),
      );
    },
  });

  function showDetail(t) {
    const acc = data.accounts[t.accountId];
    const row = (k, v) => (v === null || v === undefined || v === '' ? null : [h('dt', null, k), h('dd', null, v)]);
    clear(detail).append(
      h('h2', null, 'Transactie'),
      h(
        'dl',
        null,
        row('Bedrag', fmtMoney(t.amount, t.currency)),
        row('Rekening', `${acc?.displayName ?? ''} (${formatIban(t.accountId)})`),
        row('Boekingsdatum', fmtDate(t.entryDate)),
        row('Valutadatum', t.valueDate ? fmtDate(t.valueDate) : null),
        row('Tegenpartij', t.counterparty?.name),
        row('IBAN tegenpartij', t.counterparty?.account ? formatIban(t.counterparty.account) : null),
        row('BIC', t.counterparty?.bic),
        row('Gestructureerd', t.communication?.structured ? `${t.communication.structured}${t.communication.structuredValid === false ? ' (controlegetal ongeldig!)' : ''}` : null),
        row('Mededeling', t.communication?.text),
        row('Info', (t.information ?? []).join('\n')),
        row('Details', (t.details ?? []).map((d) => `${fmtMoney(d.amount)}  ${d.counterparty?.name ?? ''} ${d.communication?.structured ?? d.communication?.text ?? ''}`).join('\n')),
        row('Uittreksel', `${t.statementYear}/${String(t.statementNumber).padStart(3, '0')} volgnr ${t.sequence}${t.detail ? `.${t.detail}` : ''}`),
        row('Bankreferentie', t.bankReference),
        row('Transactiecode', t.txCode ? `${t.txCode.type} ${t.txCode.family}-${t.txCode.transaction}-${t.txCode.category}` : null),
      ),
    );
  }

  function apply() {
    let minAbs = null;
    let maxAbs = null;
    try {
      minAbs = parseEuroInput(minIn.value);
      minIn.setCustomValidity('');
    } catch (e) {
      minIn.setCustomValidity(e.message);
    }
    try {
      maxAbs = parseEuroInput(maxIn.value);
      maxIn.setCustomValidity('');
    } catch (e) {
      maxIn.setCustomValidity(e.message);
    }
    Object.assign(f, {
      accountId: accountSel.value || null,
      from: from.value || null,
      to: to.value || null,
      query: query.value,
      minText: minIn.value,
      maxText: maxIn.value,
    });
    const items = sortForList(filterTransactions(data.transactions, { ...f, minAbs: minAbs !== null && minAbs < 0 ? -minAbs : minAbs, maxAbs: maxAbs !== null && maxAbs < 0 ? -maxAbs : maxAbs }));
    const total = sum(items.map((t) => t.amount));
    clear(summary).append(`${items.length} transacties · som `, moneyEl(total, 'EUR'));
    list.setItems(items);
  }

  const applyDebounced = debounce(apply, 150);
  for (const el of [accountSel, from, to]) el.addEventListener('change', apply);
  for (const el of [query, minIn, maxIn]) el.addEventListener('input', applyDebounced);
  reset.addEventListener('click', () => {
    accountSel.value = '';
    from.value = to.value = query.value = minIn.value = maxIn.value = '';
    apply();
  });

  const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
  const view = h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'filters' },
        field('Rekening', accountSel),
        field('Van', from),
        field('Tot en met', to),
        field('Zoeken', query),
        field('Bedrag vanaf (absoluut)', minIn),
        field('Bedrag tot', maxIn),
        reset,
      ),
      summary,
    ),
    h('div', { class: 'tx-layout' }, list.el, detail),
  );
  queueMicrotask(apply);
  return view;
}
