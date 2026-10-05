import { h } from '../dom.js';
import { accountSummaries } from '../../core/status.js';
import { fmtDate, fmtMoney, moneyEl, formatIban } from '../format.js';
import { parseEuroInput } from '../../core/money.js';
import { findProfile } from '../../core/csv/profiles.js';

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
  const group = (type, title) => {
    const list = summaries.filter((s) => (s.account.ownership?.type === 'gemeenschappelijk' ? 'gemeenschappelijk' : 'individueel') === type);
    if (!list.length) return null;
    const known = list.filter((s) => s.balance !== null && s.account.currency === 'EUR');
    const total = known.reduce((sum, s) => sum + s.balance, 0);
    return h(
      'section',
      { class: 'account-group' },
      h('h2', null, title, ' ', h('span', { class: 'muted small' }, `· ${list.length} rekening${list.length > 1 ? 'en' : ''} · totaal `), moneyEl(total, 'EUR'), known.length < list.length ? h('span', { class: 'muted small' }, ' (niet alle saldi gekend)') : null),
      h('div', { class: 'cards' }, list.map((s) => (ctx.state.editing === s.account.id ? editForm(ctx, s.account) : accountCard(ctx, s)))),
    );
  };
  return h('div', null, group('individueel', 'Persoonlijke rekeningen'), group('gemeenschappelijk', 'Gemeenschappelijke rekeningen'));
}

function accountCard(ctx, s) {
  const { account } = s;
  const errors = s.issues.filter((i) => i.level === 'error').length;
  const warnings = s.issues.length - errors;
  const status = errors
    ? h('span', { class: 'badge err' }, `${errors} ${errors > 1 ? 'problemen' : 'probleem'}`)
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
    h('div', { class: 'muted small' }, s.balanceDate ? `Saldo op ${fmtDate(s.balanceDate)} · ${s.balanceSource}` : 'Geen saldo bekend'),
    h('div', { class: 'small', style: { margin: '8px 0' } }, `${account.kind === 'spaar' ? 'Spaarrekening' : 'Zichtrekening'} · ${owners}`),
    h(
      'div',
      { class: 'small muted' },
      account.sourceFormat === 'csv' || account.sourceFormat === 'pdf'
        ? `Bron: ${findProfile(account.profileId, ctx.service.data.profiles)?.name ?? account.profileId} · ${s.txCount} transacties${s.firstDate ? ` · ${fmtDate(s.firstDate)} t.e.m. ${fmtDate(s.lastDate)}` : ''}`
        : `Bron: CODA · ${s.statementCount} uittreksels · ${s.txCount} transacties`,
    ),
    h('div', { style: { marginTop: '8px' } }, status),
    account.ownershipConfirmed === false ? confirmBox(ctx, account) : null,
    s.issues.length ? h('ul', { class: 'issues' }, s.issues.map((i) => h('li', { class: i.level }, i.message))) : null,
    h(
      'div',
      { class: 'form-row' },
      h('button', { onclick: () => ctx.showTransactions(account.id) }, 'Transacties'),
      h(
        'button',
        {
          onclick: () => {
            ctx.state.editing = account.id;
            ctx.rerender();
          },
        },
        'Instellingen',
      ),
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
        ownershipConfirmed: true,
      });
      ctx.state.editing = null;
      ctx.rerender();
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
    h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: save }, 'Opslaan'), h(
        'button',
        {
          onclick: () => {
            ctx.state.editing = null;
            ctx.rerender();
          },
        },
        'Sluiten',
      ),
    ),
    controlBalances(ctx, account),
  );
}

function controlBalances(ctx, account) {
  const summary = accountSummaries(ctx.service.data).find((x) => x.account.id === account.id);
  const list = [...(ctx.service.data.controlBalances?.[account.id] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const date = h('input', { type: 'date' });
  const amount = h('input', { placeholder: 'bv. 1.234,56', size: 12 });
  const add = async () => {
    try {
      const balance = parseEuroInput(amount.value);
      if (balance === null) throw new Error('Vul het saldo in.');
      await ctx.service.addControlBalance(account.id, { date: date.value, balance });
      ctx.toast('Controlesaldo toegevoegd.');
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };
  const resultFor = (c) => summary?.controls.find((r) => r.control.id === c.id);
  return h(
    'div',
    { style: { marginTop: '16px', borderTop: '1px solid var(--line)', paddingTop: '8px' } },
    h('div', { class: 'title' }, 'Controlesaldi'),
    h('p', { class: 'muted small' }, 'Saldo op het einde van een dag volgens de bank (bv. van een uittreksel). De app vergelijkt het met de geïmporteerde bewegingen.'),
    list.length
      ? h(
          'table',
          { class: 'grid small' },
          h(
            'tbody',
            null,
            list.map((c) => {
              const r = resultFor(c);
              const badge = !r || r.ok === null ? h('span', { class: 'badge info' }, r?.reason ?? '—') : r.ok ? h('span', { class: 'badge ok' }, 'klopt') : h('span', { class: 'badge err' }, `verschil ${fmtMoney(r.difference)}`);
              return h(
                'tr',
                null,
                h('td', null, fmtDate(c.date)),
                h('td', { class: 'num' }, fmtMoney(c.balance, account.currency)),
                h('td', null, badge),
                h('td', null, h('button', { class: 'danger', onclick: () => ctx.service.removeControlBalance(account.id, c.id).catch((e) => ctx.toast(e.message, true)) }, 'Wissen')),
              );
            }),
          ),
        )
      : h('p', { class: 'muted small' }, 'Nog geen controlesaldi.'),
    h('div', { class: 'form-row' }, date, amount, h('button', { onclick: add }, 'Toevoegen')),
  );
}

/** New account (e.g. first Crelan import): the user confirms type and ownership. */
function confirmBox(ctx, account) {
  const kind = h('select', null, h('option', { value: 'zicht', selected: account.kind === 'zicht' }, 'Zichtrekening'), h('option', { value: 'spaar', selected: account.kind === 'spaar' }, 'Spaarrekening'));
  const ownType = h('select', null, h('option', { value: 'individueel' }, 'Individueel'), h('option', { value: 'gemeenschappelijk' }, 'Gemeenschappelijk'));
  const owners = h('input', { size: 24, placeholder: 'bv. Jan, An' });
  const ownersRow = h('div', { class: 'form-row' }, h('label', null, 'Mede-eigenaars'), owners);
  const sync = () => (ownersRow.style.display = ownType.value === 'gemeenschappelijk' ? '' : 'none');
  ownType.addEventListener('change', sync);
  sync();
  const confirm = async () => {
    try {
      await ctx.service.confirmAccount(account.id, { kind: kind.value, ownership: { type: ownType.value, owners: owners.value.split(',') } });
      ctx.toast('Rekening bevestigd.');
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };
  return h(
    'div',
    { class: 'banner warn', style: { marginTop: '10px' } },
    h('strong', null, 'Nieuwe rekening: bevestig type en eigendom'),
    h('div', { class: 'form-row' }, h('label', null, 'Type'), kind),
    h('div', { class: 'form-row' }, h('label', null, 'Eigendom'), ownType),
    ownersRow,
    h('button', { class: 'primary', onclick: confirm }, 'Bevestigen'),
  );
}
