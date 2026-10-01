import { h } from '../dom.js';
import { jointAccounts, jointSummary, balanceSentence } from '../../core/joint.js';
import { linkTransfers } from '../../core/transfers.js';
import { categoryLabel } from '../../core/categories/categories.js';
import { categoryOf } from '../../core/categories/categorize.js';
import { fmtDate, fmtMoney, moneyEl, formatIban } from '../format.js';

export function renderJoint(ctx) {
  const data = ctx.service.data;
  const joints = jointAccounts(data);
  if (!joints.length) {
    return h('div', { class: 'panel' }, h('h2', null, 'Gemeenschappelijke rekeningen'), h('p', { class: 'muted' }, 'Er is nog geen gemeenschappelijke rekening. Stel het eigendom van een rekening in via Rekeningen › Instellingen.'));
  }
  const links = linkTransfers(data);
  const open = (t) => {
    ctx.state.txFilter = { accountId: t.accountId };
    ctx.state.txSelected = t.id;
    ctx.state.tab = 'transacties';
    ctx.rerender();
  };
  return h(
    'div',
    null,
    !data.settings.myName ? h('div', { class: 'banner warn' }, 'Stel eerst in wie jij bent (Instellingen › Eigen rekeningen & mijn naam), zodat voorschotten vanaf je individuele rekening op jouw naam komen.') : null,
    joints.map((a) => {
      const s = jointSummary(data, a.id, links);
      const openItems = s.items.filter((i) => i.counted && i.open > 0);
      return h(
        'div',
        { class: 'panel' },
        h('h2', null, `${a.displayName} (${formatIban(a.id)})`),
        h('div', { class: 'muted small' }, `Mede-eigenaars: ${a.ownership.owners.join(', ')}`),
        h('ul', null, s.persons.map((p) => h('li', null, h('strong', null, balanceSentence(p.name, p.balance, (m) => fmtMoney(m)))))),
        h('p', { class: 'muted small' }, 'Saldo per mede-eigenaar ten opzichte van de gemeenschappelijke pot, op basis van de gemarkeerde voorschotten en terugbetalingen. Markeren doe je in het transactiedetail.'),
        h('h3', null, `Openstaand (${openItems.length})`),
        table(data, openItems, open, true),
        h('details', null, h('summary', null, `Alle gemarkeerde transacties (${s.items.length})`), table(data, s.items, open, false)),
      );
    }),
  );
}

function table(data, items, open, onlyOpen) {
  if (!items.length) return h('p', { class: 'muted' }, onlyOpen ? 'Niets openstaand.' : 'Nog geen gemarkeerde transacties.');
  return h(
    'table',
    { class: 'grid small' },
    h('thead', null, h('tr', null, ['Datum', 'Rekening', 'Omschrijving', 'Categorie', 'Soort', 'Voor wie', 'Bedrag', 'Effect', 'Open'].map((x) => h('th', null, x)))),
    h(
      'tbody',
      null,
      items.map((i) =>
        h(
          'tr',
          { style: { cursor: 'pointer', opacity: i.counted ? '1' : '.55' }, onclick: () => open(i.tx), title: i.counted ? '' : 'Andere kant van een overboeking die al meetelt' },
          h('td', null, fmtDate(i.tx.entryDate)),
          h('td', null, data.accounts[i.tx.accountId]?.displayName ?? ''),
          h('td', null, i.tx.counterparty?.name || i.tx.communication?.text?.split('\n')[0] || ''),
          h('td', null, categoryLabel(data, categoryOf(data, i.tx.id))),
          h('td', null, i.mark.type),
          h('td', null, i.mark.person),
          h('td', { class: 'num' }, moneyEl(i.tx.amount, i.tx.currency)),
          h('td', { class: 'num' }, i.counted ? `${i.delta > 0 ? '+' : ''}${fmtMoney(i.delta)}` : 'telt niet'),
          h('td', { class: 'num' }, i.open === null || i.open === undefined ? '' : fmtMoney(i.open)),
        ),
      ),
    ),
  );
}
