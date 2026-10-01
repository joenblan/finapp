import { h } from '../dom.js';
import { openRuleEditor } from '../components/rule-editor.js';
import { categoryLabel } from '../../core/categories/categories.js';
import { formatMilli } from '../../core/money.js';
import { formatIban } from '../format.js';

function describe(data, c) {
  const parts = [];
  if (c.counterpartyIban) parts.push(`IBAN = ${formatIban(c.counterpartyIban)}`);
  if (c.nameContains) parts.push(`naam bevat "${c.nameContains}"`);
  if (c.communicationContains) parts.push(`mededeling bevat "${c.communicationContains}"`);
  if (c.direction) parts.push(c.direction === 'in' ? 'inkomend' : 'uitgaand');
  if (c.minAbs !== null && c.minAbs !== undefined) parts.push(`≥ € ${formatMilli(c.minAbs)}`);
  if (c.maxAbs !== null && c.maxAbs !== undefined) parts.push(`≤ € ${formatMilli(c.maxAbs)}`);
  if (c.accountId) parts.push(`rekening ${data.accounts[c.accountId]?.displayName ?? c.accountId}`);
  return parts.join(' en ');
}

export function renderRules(ctx) {
  const data = ctx.service.data;
  const run = (p, ok) => p.then((r) => ok && ctx.toast(typeof ok === 'function' ? ok(r) : ok)).catch((e) => ctx.toast(e.message, true));
  return h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Regels'),
    h('p', { class: 'muted small' }, 'De eerste regel die past, bepaalt de categorie. Regels worden bij elke import toegepast op nieuwe transacties. Een manuele keuze wordt nooit door een regel overschreven; interne overboekingen en bijdragen van de mede-eigenaar gaan altijd voor.'),
    h(
      'div',
      { class: 'form-row' },
      h('button', { onclick: () => openRuleEditor(ctx) }, 'Nieuwe regel'),
      h('button', { class: 'primary', onclick: () => run(ctx.service.reapplyRules(), (r) => `Regels opnieuw toegepast: ${r.changed} transactie(s) gewijzigd.`) }, 'Regels opnieuw toepassen'),
    ),
    data.rules.length
      ? h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Regel'), h('th', null, 'Voorwaarden'), h('th', null, 'Categorie'), h('th', null, ''))),
          h(
            'tbody',
            null,
            data.rules.map((r, i) =>
              h(
                'tr',
                { style: { opacity: r.enabled === false ? '.5' : '1' } },
                h('td', null, String(i + 1)),
                h('td', null, r.name),
                h('td', { class: 'small' }, describe(data, r.conditions)),
                h('td', null, categoryLabel(data, r.categoryId)),
                h(
                  'td',
                  { style: { whiteSpace: 'nowrap' } },
                  h('button', { disabled: i === 0, onclick: () => run(ctx.service.moveRule(r.id, -1)) }, '↑'),
                  h('button', { disabled: i === data.rules.length - 1, onclick: () => run(ctx.service.moveRule(r.id, 1)) }, '↓'),
                  ' ',
                  h('button', { onclick: () => openRuleEditor(ctx, { rule: r }) }, 'Bewerken'),
                  ' ',
                  h('button', { onclick: () => run(ctx.service.saveRule({ ...r, enabled: r.enabled === false })) }, r.enabled === false ? 'Aanzetten' : 'Uitzetten'),
                  ' ',
                  h('button', { class: 'danger', onclick: () => confirm(`Regel "${r.name}" verwijderen? Al toegewezen categorieën blijven staan tot je de regels opnieuw toepast.`) && run(ctx.service.deleteRule(r.id), 'Regel verwijderd.') }, 'Verwijderen'),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Nog geen regels. Maak er een via "Nieuwe regel" of na een manuele toewijzing.'),
  );
}
