import { h } from '../dom.js';
import { fmtDate, fmtDateTime, moneyEl } from '../format.js';
import { communicationForDisplay } from '../../core/csv/card.js';

export function openReviewCount(data) {
  return (data.possibleDuplicates ?? []).filter((p) => p.status === 'open').length;
}

export function renderReview(ctx) {
  const { data } = ctx.service;
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  for (const r of Object.values(data.removedTransactions ?? {})) byId.set(r.transaction.id, r.transaction);
  const items = [...(data.possibleDuplicates ?? [])].reverse();
  const open = items.filter((p) => p.status === 'open');
  const done = items.filter((p) => p.status !== 'open');

  const txBox = (t, label) =>
    t
      ? h(
          'div',
          { class: 'card' },
          h('div', { class: 'muted small' }, label),
          h('div', { class: 'title' }, t.counterparty?.name || t.bankType || '(geen naam)'),
          h('div', { class: 'balance' }, moneyEl(t.amount, t.currency)),
          h('div', { class: 'small' }, `Boekingsdatum ${fmtDate(t.entryDate)} · referentie ${t.bankReference || '—'}`),
          h('div', { class: 'small muted', style: { whiteSpace: 'pre-wrap' } }, communicationForDisplay(t)),
        )
      : h('div', { class: 'card muted' }, '(niet meer aanwezig)');

  const decide = async (item, decision) => {
    if (decision === 'verwijderd' && !confirm('Deze beweging verwijderen?\n\nZe verdwijnt uit de lijsten en wordt bij een volgende import niet opnieuw toegevoegd. Er wordt eerst een back-up gemaakt.')) return;
    try {
      await ctx.service.resolvePossibleDuplicate(item.id, decision);
      ctx.toast(decision === 'behouden' ? 'Beweging behouden.' : 'Beweging verwijderd.');
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };

  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('h2', null, `Mogelijke dubbels (${open.length} open)`),
      h(
        'p',
        { class: 'muted small' },
        'Een nieuwe beweging met een ander refertenummer, maar met dezelfde datum, hetzelfde bedrag, dezelfde tegenpartij en mededeling als een bestaande beweging. Ze werd geïmporteerd (de bank vermeldt ze als aparte beweging), maar kijk na of het geen vergissing is. "Verwijderen" haalt ze uit de lijsten; de saldocontrole blijft gebaseerd op wat de bank boekte.',
      ),
      open.length ? null : h('p', null, 'Niets na te kijken.'),
    ),
    open.map((item) =>
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'cards' }, txBox(byId.get(item.txId), 'Nieuwe beweging'), item.matchIds.map((id) => txBox(byId.get(id), 'Bestaande beweging'))),
        h(
          'div',
          { class: 'form-row' },
          h('button', { class: 'primary', onclick: () => decide(item, 'behouden') }, 'Behouden (geen dubbel)'),
          h('button', { class: 'danger', onclick: () => decide(item, 'verwijderd') }, 'Nieuwe beweging verwijderen'),
        ),
      ),
    ),
    done.length
      ? h(
          'div',
          { class: 'panel' },
          h('h2', null, 'Afgehandeld'),
          h(
            'table',
            { class: 'grid small' },
            h('tbody', null, done.map((p) => {
              const t = byId.get(p.txId);
              return h('tr', null, h('td', null, fmtDateTime(p.resolvedAt)), h('td', null, t ? `${fmtDate(t.entryDate)} ${t.counterparty?.name ?? ''}` : p.txId), h('td', null, t ? moneyEl(t.amount, t.currency) : ''), h('td', null, p.status));
            })),
          ),
        )
      : null,
  );
}
