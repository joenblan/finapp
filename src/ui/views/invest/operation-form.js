// Form for a manual investment operation. The gross amount is leading: the
// price is derived (shown only), the stock tax is suggested (overridable), and
// when the net amount is known (from the bank transaction) the difference is
// shown live. "Nog een verrichting" keeps account and security.
import { h, clear, append } from '../../dom.js';
import { openModal } from '../../components/modal.js';
import { formatMilli } from '../../../core/money.js';
import { fmtMoney } from '../../format.js';
import { KINDS, netAmount, priceOf, validateOperation } from '../../../core/invest/operations.js';
import { parseQuantity, formatQuantity, formatPrice, parseMoney } from '../../../core/invest/units.js';
import { suggestStockTax } from '../../../core/invest/stocktax.js';

const moneyText = (m) => (m ? formatMilli(m) : '');

/**
 * @param opts { op? (edit), prefill?: { investAccountId, securityId, kind, date, bankAmount, bankTxId }, onDone? }
 */
export function openOperationForm(ctx, { op = null, prefill = {}, onDone = null } = {}) {
  const data = ctx.service.data;
  if (!data.investAccounts.length) {
    ctx.toast('Maak eerst een beleggingsrekening aan (Beleggingen › Rekeningen & effecten).', true);
    return;
  }
  const base = { investAccountId: data.investAccounts[0].id, securityId: data.securities[0]?.id ?? '', kind: 'aankoop', date: new Date().toISOString().slice(0, 10), ...prefill, ...(op ?? {}) };
  let taxTouched = Boolean(op);
  const sel = (map, v) => Object.entries(map).map(([k, l]) => h('option', { value: k, selected: k === v }, l));
  const account = h('select', null, data.investAccounts.map((a) => h('option', { value: a.id, selected: a.id === base.investAccountId }, a.name)));
  const security = h('select', null, h('option', { value: '' }, '— kies —'), data.securities.map((s) => h('option', { value: s.id, selected: s.id === base.securityId }, s.name)));
  const kind = h('select', null, sel(KINDS, base.kind));
  const date = h('input', { type: 'date', value: base.date });
  const quantity = h('input', { size: 10, value: base.quantity ? formatQuantity(base.quantity) : '', placeholder: 'bv. 12 of 0,5' });
  const gross = h('input', { size: 12, value: moneyText(base.gross), placeholder: 'bv. 301,50' });
  const costs = h('input', { size: 10, value: moneyText(base.costs) });
  const stockTax = h('input', { size: 10, value: moneyText(base.stockTax) });
  const withholding = h('input', { size: 10, value: moneyText(base.withholding) });
  const rvPart = h('input', { size: 10, value: base.rvPart !== null && base.rvPart !== undefined ? formatMilli(base.rvPart) : '', placeholder: 'volledige meerwaarde' });
  const splitFrom = h('input', { type: 'number', min: 1, size: 3, value: base.split?.from ?? 1 });
  const splitTo = h('input', { type: 'number', min: 1, size: 3, value: base.split?.to ?? 2 });
  const bankAmount = h('input', { size: 12, value: base.bankAmount ? formatMilli(Math.abs(base.bankAmount)) : '', placeholder: 'uit de banktransactie' });
  const note = h('input', { size: 30, value: base.note ?? '' });
  const live = h('div', { class: 'small' });
  const error = h('div', { class: 'small', style: { color: 'var(--err)' } });
  const rows = {};
  const row = (key, label, el, hint) => (rows[key] = h('div', { class: 'form-row' }, h('label', { style: { minWidth: '170px' } }, label), el, hint ? h('span', { class: 'muted small' }, hint) : null));

  const money = (el) => {
    try {
      return parseMoney(el.value) ?? 0;
    } catch {
      return NaN;
    }
  };
  const read = () => {
    const k = kind.value;
    const o = {
      ...(op ? { id: op.id } : {}),
      investAccountId: account.value,
      securityId: security.value || null,
      kind: k,
      date: date.value,
      quantity: null,
      gross: 0,
      costs: 0,
      stockTax: 0,
      withholding: 0,
      rvPart: null,
      split: null,
      note: note.value.trim(),
    };
    if (k === 'aankoop' || k === 'verkoop') {
      o.quantity = parseQuantity(quantity.value);
      o.gross = money(gross);
      o.costs = money(costs);
      o.stockTax = money(stockTax);
      if (k === 'verkoop') {
        o.withholding = money(withholding);
        o.rvPart = rvPart.value.trim() ? money(rvPart) : null;
      }
    } else if (k === 'dividend') {
      o.gross = money(gross);
      o.withholding = money(withholding);
    } else if (k === 'kosten') o.costs = money(costs);
    else if (k === 'taks') o.stockTax = money(stockTax);
    else if (k === 'splitsing') o.split = { from: Number(splitFrom.value), to: Number(splitTo.value) };
    return o;
  };
  const visible = () => {
    const k = kind.value;
    const show = { security: k !== 'kosten' && k !== 'taks', quantity: k === 'aankoop' || k === 'verkoop', gross: ['aankoop', 'verkoop', 'dividend'].includes(k), costs: ['aankoop', 'verkoop', 'kosten'].includes(k), stockTax: ['aankoop', 'verkoop', 'taks'].includes(k), withholding: k === 'verkoop' || k === 'dividend', rvPart: k === 'verkoop' && data.securities.find((s) => s.id === security.value)?.regime === 'reynders', split: k === 'splitsing', bank: k !== 'splitsing' };
    for (const [key, el] of Object.entries(rows)) el.style.display = show[key] === false ? 'none' : '';
  };
  const update = () => {
    visible();
    const k = kind.value;
    const sec = data.securities.find((s) => s.id === security.value);
    if ((k === 'aankoop' || k === 'verkoop') && !taxTouched && sec && date.value) {
      const g = money(gross);
      if (Number.isFinite(g)) stockTax.value = moneyText(suggestStockTax(data, sec, date.value, g));
    }
    let o;
    try {
      o = read();
    } catch (e) {
      append(clear(live), [h('span', { style: { color: 'var(--err)' } }, e.message)]);
      return;
    }
    const parts = [];
    const price = priceOf(o);
    if (price) parts.push(`Afgeleide koers: € ${formatPrice(price)}`);
    if (k !== 'splitsing' && Object.values(o).every((v) => !Number.isNaN(v))) {
      const net = netAmount(o);
      parts.push(`Nettobedrag: ${fmtMoney(Math.abs(net))} (${net < 0 ? 'afschrijving' : 'bijschrijving'})`);
      if (bankAmount.value.trim()) {
        const b = money(bankAmount);
        if (Number.isFinite(b)) {
          const diff = b - Math.abs(net);
          parts.push(diff === 0 ? h('strong', { style: { color: 'var(--ok)' } }, 'Komt overeen met de banktransactie.') : h('strong', { style: { color: 'var(--warn)' } }, `Verschil met de banktransactie: ${fmtMoney(diff)}. Kijk de kosten of taks na.`));
        }
      }
    }
    append(clear(live), parts.map((p) => h('div', null, p)));
  };
  stockTax.addEventListener('input', () => (taxTouched = true));
  for (const el of [account, security, kind, date, quantity, gross, costs, stockTax, withholding, rvPart, splitFrom, splitTo, bankAmount]) {
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  }

  const save = async (again) => {
    let o;
    try {
      o = read();
      if (Object.values(o).some((v) => Number.isNaN(v))) throw new Error('Een bedrag is ongeldig (gebruik bv. 12,34).');
      const errors = validateOperation(data, { ...o, quantity: o.quantity ?? 0, gross: o.gross ?? 0 });
      if (errors.length) throw new Error(errors.join(' '));
    } catch (e) {
      clear(error).append(e.message);
      return;
    }
    try {
      const res = await ctx.service.saveOperation(o);
      if (base.bankTxId && !op) await ctx.service.linkOperation(res.item.id, base.bankTxId);
      modal.close();
      ctx.toast(op ? 'Verrichting bijgewerkt.' : 'Verrichting opgeslagen.');
      onDone?.(res.item);
      if (again) openOperationForm(ctx, { prefill: { investAccountId: o.investAccountId, securityId: o.securityId, kind: o.kind, date: o.date }, onDone });
    } catch (e) {
      clear(error).append(e.message);
    }
  };
  const modal = openModal(
    op ? 'Verrichting bewerken' : base.bankTxId ? 'Verrichting van deze transactie' : 'Nieuwe verrichting',
    h(
      'div',
      null,
      row('account', 'Beleggingsrekening', account),
      row('kind', 'Soort', kind),
      row('security', 'Effect', security),
      row('date', 'Datum', date),
      row('quantity', 'Aantal', quantity),
      row('gross', 'Brutobedrag', gross, 'leidend; de koers wordt afgeleid'),
      row('costs', 'Makelaarskosten', costs),
      row('stockTax', 'Beurstaks', stockTax, 'voorgesteld volgens het tarief van het effect, aanpasbaar'),
      row('withholding', 'Roerende voorheffing', withholding),
      row('rvPart', 'Deel meerwaarde belast via RV', rvPart, 'Reynderstaks; leeg = volledige meerwaarde'),
      row('split', 'Splitsing', h('span', null, splitFrom, ' wordt ', splitTo)),
      row('bank', 'Nettobedrag volgens bank', bankAmount, 'optioneel, voor de controle'),
      row('note', 'Notitie', note),
      live,
      error,
      h(
        'div',
        { class: 'form-row' },
        h('button', { class: 'primary', onclick: () => save(false) }, 'Opslaan'),
        op || base.bankTxId ? null : h('button', { onclick: () => save(true) }, 'Opslaan + nog een verrichting'),
        h('button', { onclick: () => modal.close() }, 'Annuleren'),
      ),
    ),
  );
  update();
  setTimeout(() => (base.bankTxId ? security : quantity).focus(), 0);
}
