import { h } from '../dom.js';
import { accountSummaries } from '../../core/status.js';
import { fmtDate, moneyEl, formatIban } from '../format.js';

export function renderAccounts(ctx) {
  const { data } = ctx.service;
  const summaries = accountSummaries(data);
  if (!summaries.length) {
    return h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Nog geen rekeningen'),
      h('p', { class: 'muted' }, 'Rekeningen worden automatisch aangemaakt bij de import van een bankbestand. Plaats bestanden in de map inbox/ en klik op "Nu scannen", of sleep ze naar het tabblad Importeren.'),
    );
  }
  return h('div', { class: 'cards' }, summaries.map((s) => accountCard(ctx, s)));
}

function accountCard(ctx, s) {
  const { account } = s;
  const errors = s.issues.filter((i) => i.level === 'error').length;
  const warnings = s.issues.length - errors;
  const status = errors
    ? h('span', { class: 'badge err' }, `${errors} probleem${errors > 1 ? 'en' : ''}`)
    : warnings
      ? h('span', { class: 'badge warn' }, `${warnings} waarschuwing${warnings > 1 ? 'en' : ''}`)
      : h('span', { class: 'badge ok' }, 'Saldocontrole OK');
  const owners = account.ownership.type === 'gemeenschappelijk' ? `Gemeenschappelijk: ${account.ownership.owners.join(', ')}` : 'Individueel';
  const card = h(
    'div',
    { class: 'card' },
    h('div', { class: 'title' }, account.displayName),
    h('div', { class: 'iban' }, formatIban(account.number)),
    h('div', { class: 'balance' }, moneyEl(s.balance, account.currency)),
    h('div', { class: 'muted small' }, s.balanceDate ? `Saldo op ${fmtDate(s.balanceDate)}` : 'Geen saldo bekend'),
    h('div', { class: 'small', style: { margin: '8px 0' } }, `${account.kind === 'spaar' ? 'Spaarrekening' : 'Zichtrekening'} · ${owners}`),
    h('div', { class: 'small muted' }, `${s.statementCount} uittreksels · ${s.txCount} transacties`),
    h('div', { style: { marginTop: '8px' } }, status),
    s.issues.length ? h('ul', { class: 'issues' }, s.issues.map((i) => h('li', { class: i.level }, i.message))) : null,
    h(
      'div',
      { class: 'form-row' },
      h('button', { onclick: () => ctx.showTransactions(account.id) }, 'Transacties'),
      h('button', { onclick: () => card.replaceWith(editForm(ctx, account)) }, 'Instellingen'),
    ),
  );
  return card;
}

function editForm(ctx, account) {
  const name = h('input', { value: account.displayName, size: 28 });
  const kind = h(
    'select',
    null,
    h('option', { value: 'zicht', selected: account.kind === 'zicht' }, 'Zichtrekening'),
    h('option', { value: 'spaar', selected: account.kind === 'spaar' }, 'Spaarrekening'),
  );
  const ownType = h(
    'select',
    null,
    h('option', { value: 'individueel', selected: account.ownership.type === 'individueel' }, 'Individueel'),
    h('option', { value: 'gemeenschappelijk', selected: account.ownership.type === 'gemeenschappelijk' }, 'Gemeenschappelijk'),
  );
  const owners = h('input', { value: account.ownership.owners.join(', '), size: 28, placeholder: 'bv. Jan, An' });
  const ownersRow = h('div', { class: 'form-row' }, h('label', null, 'Mede-eigenaars'), owners);
  const syncOwners = () => (ownersRow.style.display = ownType.value === 'gemeenschappelijk' ? '' : 'none');
  ownType.addEventListener('change', syncOwners);
  syncOwners();
  const save = async () => {
    try {
      await ctx.service.updateAccount(account.id, {
        displayName: name.value,
        kind: kind.value,
        ownership: { type: ownType.value, owners: owners.value.split(',') },
      });
      ctx.toast('Rekening opgeslagen.');
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'title' }, 'Rekening instellen'),
    h('div', { class: 'iban' }, formatIban(account.number), account.holderName ? ` · ${account.holderName}` : ''),
    h('div', { class: 'form-row' }, h('label', null, 'Weergavenaam'), name),
    h('div', { class: 'form-row' }, h('label', null, 'Type'), kind),
    h('div', { class: 'form-row' }, h('label', null, 'Eigendom'), ownType),
    ownersRow,
    h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: save }, 'Opslaan'), h('button', { onclick: () => ctx.rerender() }, 'Annuleren')),
  );
}
