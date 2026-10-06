// Phase 2 part of the transaction detail: category and internal transfer.
import { h } from '../dom.js';
import { openModal } from './modal.js';
import { createCategoryPicker } from './category-picker.js';
import { openRuleEditor } from './rule-editor.js';
import { allocationOf } from '../../core/categories/categorize.js';
import { categoryLabel } from '../../core/categories/categories.js';
import { isInternal, ownIbans, contributionSide } from '../../core/transfers.js';
import { fmtDate, fmtMoney } from '../format.js';
import { refundLinks, refundsFor, refundCandidates, refundSourceCandidates, proposeSplit, openAmount } from '../../core/categories/refunds.js';
import { parseEuroInput, formatMilli } from '../../core/money.js';
import { linkedTxMap, unlinkedOperations } from '../../core/invest/settlement.js';
import { netAmount, KINDS } from '../../core/invest/operations.js';
import { openOperationForm } from '../views/invest/operation-form.js';
import { communicationForDisplay } from '../../core/csv/card.js';

const isJointAcc = (data, id) => data.accounts[id]?.ownership?.type === 'gemeenschappelijk';
const SOURCE = { manueel: 'manueel gekozen', regel: 'via regel', geen: '' };

export function txPhase2(ctx, t, { links, onShowTx }) {
  const data = ctx.service.data;
  const run = (p, ok) => p.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));
  const alloc = allocationOf(data, t.id);
  const rule = alloc?.ruleId ? data.rules.find((r) => r.id === alloc.ruleId) : null;
  const sourceText = alloc?.source === 'regel' ? (alloc.ruleId?.startsWith('systeem:') ? 'automatisch' : `via regel "${rule?.name ?? '?'}"`) : SOURCE[alloc?.source ?? 'geen'];

  const choose = () => {
    const modal = openModal(
      'Categorie kiezen',
      (() => {
        const picker = createCategoryPicker(data, {
          onPick: async (id) => {
            modal.close();
            try {
              await ctx.service.assignCategory([t.id], id);
              offerRule(ctx, t, id);
            } catch (e) {
              ctx.toast(e.message, true);
            }
          },
        });
        setTimeout(() => picker.input.focus(), 0);
        return picker.el;
      })(),
    );
  };

  const byId = new Map(data.transactions.map((x) => [x.id, x]));
  const label = (x) => `${fmtDate(x.entryDate)} · ${x.counterparty?.name || communicationForDisplay(x).split('\n')[0] || 'zonder naam'} · ${fmtMoney(x.amount)}`;
  const linkTo = (x) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); onShowTx(x); } }, label(x));
  const rLinks = refundLinks(data, t.id).filter((l) => byId.has(l.expenseId));
  const expense = rLinks.length ? byId.get(rLinks[0].expenseId) : null;
  const allocs = data.allocations?.[t.id] ?? [];
  const section = [
    h('h2', { style: { marginTop: '16px' } }, 'Categorie'),
    allocs.length > 1
      ? h('div', null, h('strong', null, 'Verdeeld: '), allocs.map((a) => `${categoryLabel(data, a.categoryId ?? null)} ${fmtMoney(a.amount)}`).join(' · '), h('span', { class: 'muted small' }, ' (volgt de uitgaven)'))
      : h('div', null, h('strong', null, categoryLabel(data, alloc?.categoryId ?? null)), expense ? h('span', { class: 'muted small' }, ' (volgt de uitgave)') : sourceText ? h('span', { class: 'muted small' }, ` (${sourceText})`) : null),
    expense
      ? null
      : h(
          'div',
          { class: 'form-row' },
          h('button', { onclick: choose }, 'Kiezen…'),
          alloc?.source === 'manueel' ? h('button', { onclick: () => run(ctx.service.resetCategory([t.id]), 'Terug naar automatisch.') }, 'Automatisch') : null,
          h('button', { onclick: () => openRuleEditor(ctx, { fromTx: t, categoryId: alloc?.categoryId ?? null }) }, 'Regel maken…'),
        ),
  ];

  // investments: a transaction on a settlement account ("afrekenrekening")
  const investAccs = (data.investAccounts ?? []).filter((a) => a.cash?.mode === 'afrekenrekening' && a.cash.accountId === t.accountId);
  if (investAccs.length) {
    const op = linkedTxMap(data).get(t.id);
    section.push(h('h2', { style: { marginTop: '16px' } }, 'Belegging'));
    if (op) {
      const diff = t.amount - netAmount(op);
      section.push(
        h('div', null, `Hoort bij: ${KINDS[op.kind]} ${data.securities.find((s) => s.id === op.securityId)?.name ?? ''} van ${fmtDate(op.date)} (${data.investAccounts.find((a) => a.id === op.investAccountId)?.name ?? ''}).`),
        diff ? h('div', { class: 'banner warn' }, `Verschil met het nettobedrag van de verrichting: ${fmtMoney(diff)}. Kijk de kosten of taks na.`) : h('div', { class: 'small muted' }, 'Bedrag komt overeen met de verrichting. Telt niet als inkomst of uitgave.'),
        h('div', { class: 'form-row' }, h('button', { onclick: () => openOperationForm(ctx, { op }) }, 'Verrichting bewerken'), h('button', { onclick: () => run(ctx.service.unlinkOperation(op.id), 'Losgekoppeld; de vorige categorie is hersteld.') }, 'Loskoppelen')),
      );
    } else {
      const open = unlinkedOperations(data).filter((o) => investAccs.some((a) => a.id === o.investAccountId) && Math.sign(netAmount(o)) === Math.sign(t.amount));
      section.push(
        h('div', { class: 'small muted' }, 'Is dit een aan- of verkoop (of dividend) van je beleggingen?'),
        h(
          'div',
          { class: 'form-row' },
          h('button', { class: 'primary', onclick: () => openOperationForm(ctx, { prefill: { investAccountId: investAccs[0].id, kind: t.amount < 0 ? 'aankoop' : 'verkoop', date: t.entryDate, bankAmount: t.amount, bankTxId: t.id } }) }, 'Maak verrichting van deze transactie'),
          open.length
            ? h(
                'select',
                {
                  onchange: (e) => e.target.value && run(ctx.service.linkOperation(e.target.value, t.id), 'Gekoppeld.'),
                },
                h('option', { value: '' }, 'Koppelen aan bestaande verrichting…'),
                open.map((o) => h('option', { value: o.id }, `${fmtDate(o.date)} ${KINDS[o.kind]} ${data.securities.find((s) => s.id === o.securityId)?.name ?? ''} ${fmtMoney(netAmount(o))}`)),
              )
            : null,
        ),
      );
    }
  }

  // refunds (e.g. a friend pays back part of a dinner)
  // also a transfer from/to the joint account (e.g. the joint account pays you back)
  if (t.amount > 0 && (!isInternal(t, data) || contributionSide(t, data))) {
    section.push(h('h2', { style: { marginTop: '16px' } }, 'Terugbetaling'));
    if (expense) {
      section.push(
        rLinks.length === 1
          ? h('div', null, 'Terugbetaling van: ', linkTo(expense))
          : h('div', null, 'Terugbetaling van:', h('ul', { class: 'small' }, rLinks.map((l) => h('li', null, linkTo(byId.get(l.expenseId)), ` — deel ${fmtMoney(l.amount)}`)))),
        h('div', { class: 'small muted' }, 'Telt als min-uitgave in de categorie van die uitgave(n).'),
        h('div', { class: 'form-row' }, h('button', { onclick: () => pickExpense(ctx, t, run, rLinks) }, 'Koppeling wijzigen…'), h('button', { onclick: () => run(ctx.service.unlinkRefund(t.id), 'Koppeling losgemaakt.') }, 'Losmaken')),
      );
    } else {
      section.push(
        h('div', { class: 'small muted' }, 'Is dit een terugbetaling van een uitgave (bv. een vriend die zijn deel van een etentje terugstort)? Koppel ze aan die uitgave: ze krijgt dan dezelfde categorie en verlaagt die uitgave.'),
        h('div', { class: 'form-row' }, h('button', { onclick: () => pickExpense(ctx, t, run) }, 'Koppelen aan uitgave(n)…')),
      );
    }
  }
  if (t.amount < 0) {
    const r = refundsFor(data, t.id);
    if (!r.list.length && !isInternal(t, data)) {
      section.push(
        h('h2', { style: { marginTop: '16px' } }, 'Terugbetaling'),
        h('div', { class: 'small muted' }, 'Werd (een deel van) deze uitgave terugbetaald, ook als het geld al vóór de uitgave binnenkwam? Koppel die ontvangst hier.'),
        h('div', { class: 'form-row' }, h('button', { onclick: () => pickRefund(ctx, t, run) }, 'Terugbetaling koppelen…')),
      );
    }
    if (r.list.length) {
      const net = t.amount + r.total;
      section.push(
        h('h2', { style: { marginTop: '16px' } }, 'Terugbetaald'),
        h('div', null, `${fmtMoney(r.total)} terugbetaald, netto ${fmtMoney(net)}`),
        net > 0 ? h('div', { class: 'banner warn' }, 'Er werd meer terugbetaald dan deze uitgave. Kijk de koppelingen na.') : null,
        h('ul', { class: 'small' }, r.list.map((x) => h('li', null, linkTo(x.tx), x.amount !== x.tx.amount ? ` — deel ${fmtMoney(x.amount)}` : null))),
        h('div', { class: 'form-row' }, h('button', { onclick: () => pickRefund(ctx, t, run) }, 'Nog een terugbetaling koppelen…')),
      );
    }
  }

  // internal transfer
  const own = ownIbans(data);
  const cp = t.counterparty?.account;
  if (cp && own.has(cp) && cp !== t.accountId) {
    const internal = isInternal(t, data, own);
    const otherId = links.get(t.id);
    const other = otherId ? data.transactions.find((x) => x.id === otherId) : null;
    const target = data.accounts[cp]?.displayName ?? data.externalOwnAccounts.find((e) => e.iban === cp)?.name ?? cp;
    section.push(
      h('h2', { style: { marginTop: '16px' } }, 'Interne overboeking'),
      internal
        ? h(
            'div',
            null,
            h('div', null, contributionSide(t, data) ? `Overboeking ${t.amount < 0 ? 'naar' : 'van'} eigen rekening "${target}" (tussen persoonlijk en gemeenschappelijk): telt als ${t.amount < 0 === !isJointAcc(data, t.accountId) ? 'uitgave' : 'inkomst'} (bijdrage), tenzij je zelf een categorie kiest of ze aan een uitgave koppelt.` : `Overboeking ${t.amount < 0 ? 'naar' : 'van'} eigen rekening "${target}". Telt niet mee als inkomst of uitgave.`),
            other
              ? h('div', { class: 'small' }, 'Tegenhanger: ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); onShowTx(other); } }, `${fmtDate(other.entryDate)} ${fmtMoney(other.amount)} op ${data.accounts[other.accountId]?.displayName}`))
              : h('div', { class: 'small muted' }, data.accounts[cp] ? 'Geen tegenhanger gevonden (binnen 5 dagen, tegengesteld bedrag). Dat is geen fout.' : 'Rekening zonder geïmporteerde gegevens.'),
            h('div', { class: 'form-row' }, h('button', { onclick: () => run(ctx.service.setNotInternal(t.id, true), 'Niet langer als interne overboeking behandeld.') }, 'Geen interne overboeking')),
          )
        : h('div', null, h('div', { class: 'muted small' }, 'Door jou gemarkeerd als géén interne overboeking.'), h('button', { onclick: () => run(ctx.service.setNotInternal(t.id, false), 'Weer interne overboeking.') }, 'Toch interne overboeking')),
    );
  }

  return h('div', null, section);
}

/** From an expense: choose the incoming payment that refunds it (also one that came earlier). */
function pickRefund(ctx, expense, run) {
  const data = ctx.service.data;
  const own = ownIbans(data);
  const all = refundSourceCandidates(data, expense, { isInternal: (x) => isInternal(x, data, own) && !contributionSide(x, data, own) });
  const search = h('input', { size: 30, placeholder: 'zoek op naam, mededeling of bedrag' });
  const list = h('div', { style: { maxHeight: '420px', overflow: 'auto' } });
  const draw = () => {
    const q = search.value.trim().toLowerCase().replace(',', '.');
    const hits = all.filter((x) => !q || `${x.counterparty?.name ?? ''} ${communicationForDisplay(x)} ${(x.amount / 1000).toFixed(2)} ${x.entryDate}`.toLowerCase().includes(q)).slice(0, 60);
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!hits.length) list.append(h('p', { class: 'muted' }, 'Geen ontvangsten gevonden (90 dagen ervoor tot 180 dagen erna).'));
    for (const x of hits) {
      const linked = refundLinks(data, x.id);
      list.append(
        h(
          'div',
          { class: 'alert-row' },
          h('div', { style: { flex: '1' } }, h('div', null, `${fmtDate(x.entryDate)} · ${x.counterparty?.name || communicationForDisplay(x).split('\n')[0] || 'zonder naam'}`), h('div', { class: 'small muted' }, `${data.accounts[x.accountId]?.displayName ?? ''}${linked.length ? ` · al gekoppeld aan ${linked.length} uitgave(n)` : ''}`)),
          h('strong', null, fmtMoney(x.amount)),
          h('button', {
            onclick: () => {
              modal.close();
              // open the split of that refund with this expense added
              pickExpense(ctx, x, run, [...linked, { expenseId: expense.id, amount: 0 }], true);
            },
          }, 'Kiezen'),
        ),
      );
    }
  };
  search.addEventListener('input', draw);
  const modal = openModal(`Terugbetaling van ${fmtMoney(expense.amount)} koppelen`, h('div', null, h('p', { class: 'small muted' }, 'Kies de ontvangst die (een deel van) deze uitgave terugbetaalt. Ze mag ook vóór de uitgave binnengekomen zijn.'), h('div', { class: 'form-row' }, search), list));
  draw();
  setTimeout(() => search.focus(), 0);
}

/** Choose the expense(s) a refund belongs to, with the part per expense. */
function pickExpense(ctx, t, run, existing = [], redistributeFirst = false) {
  const data = ctx.service.data;
  const own = ownIbans(data);
  const byId = new Map(data.transactions.map((x) => [x.id, x]));
  const all = refundCandidates(data, t, { isInternal: (x) => isInternal(x, data, own) });
  for (const l of existing) if (!all.some((x) => x.id === l.expenseId) && byId.has(l.expenseId)) all.unshift(byId.get(l.expenseId));
  const chosen = existing.map((l) => ({ ...l })); // [{ expenseId, amount }]
  const name = (x) => `${fmtDate(x.entryDate)} · ${x.counterparty?.name || communicationForDisplay(x).split('\n')[0] || 'zonder naam'}`;
  const search = h('input', { size: 30, placeholder: 'zoek op naam, mededeling of bedrag' });
  const picked = h('div');
  const list = h('div', { style: { maxHeight: '320px', overflow: 'auto' } });
  const status = h('div', { class: 'small' });
  const save = h('button', { class: 'primary' }, 'Koppelen');
  const rest = () => t.amount - chosen.reduce((s, c) => s + c.amount, 0);
  const redistribute = () => {
    const split = proposeSplit(data, t, chosen.map((c) => c.expenseId));
    split.forEach((p, i) => (chosen[i].amount = p.amount));
  };
  const drawPicked = () => {
    while (picked.firstChild) picked.removeChild(picked.firstChild);
    if (!chosen.length) picked.append(h('p', { class: 'muted small' }, 'Nog geen uitgave gekozen.'));
    for (const c of chosen) {
      const x = byId.get(c.expenseId);
      const input = h('input', { size: 9, value: formatMilli(c.amount) });
      input.addEventListener('change', () => {
        try {
          c.amount = parseEuroInput(input.value);
        } catch (e) {
          ctx.toast(e.message, true);
        }
        setTimeout(drawPicked, 0); // not while the input is losing focus
      });
      picked.append(
        h(
          'div',
          { class: 'alert-row' },
          h('div', { style: { flex: '1' } }, h('div', null, name(x)), h('div', { class: 'small muted' }, `${categoryLabel(data, allocationOf(data, x.id)?.categoryId ?? null)} · uitgave ${fmtMoney(x.amount)} · nog open ${fmtMoney(openAmount(data, x, t.id))}`), c.amount > openAmount(data, x, t.id) ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, 'Dit deel is groter dan wat er van deze uitgave nog open staat.') : null),
          h('label', { class: 'small' }, 'deel € ', input),
          h('button', { onclick: () => { chosen.splice(chosen.indexOf(c), 1); redistribute(); drawPicked(); drawList(); } }, 'x'),
        ),
      );
    }
    const r = rest();
    status.textContent = r === 0 ? `Volledig verdeeld (${fmtMoney(t.amount)}).` : r > 0 ? `Nog te verdelen: ${fmtMoney(r)}` : `Te veel verdeeld: ${fmtMoney(-r)}`;
    status.className = `small ${r === 0 ? '' : 'banner warn'}`;
    save.disabled = r !== 0 || !chosen.length || chosen.some((c) => c.amount <= 0);
  };
  const drawList = () => {
    const q = search.value.trim().toLowerCase().replace(',', '.');
    const hits = all
      .filter((x) => !chosen.some((c) => c.expenseId === x.id))
      .filter((x) => !q || `${x.counterparty?.name ?? ''} ${communicationForDisplay(x)} ${(-x.amount / 1000).toFixed(2)} ${x.entryDate}`.toLowerCase().includes(q))
      .slice(0, 60);
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!hits.length) list.append(h('p', { class: 'muted' }, 'Geen uitgaven gevonden (laatste 180 dagen).'));
    for (const x of hits) {
      list.append(
        h(
          'div',
          { class: 'alert-row' },
          h('div', { style: { flex: '1' } }, h('div', null, name(x)), h('div', { class: 'small muted' }, `${categoryLabel(data, allocationOf(data, x.id)?.categoryId ?? null)} · ${data.accounts[x.accountId]?.displayName ?? ''}`)),
          h('strong', null, fmtMoney(x.amount)),
          h('button', { onclick: () => { chosen.push({ expenseId: x.id, amount: 0 }); redistribute(); drawPicked(); drawList(); } }, 'Toevoegen'),
        ),
      );
    }
  };
  save.addEventListener('click', () => {
    modal.close();
    run(ctx.service.linkRefund(t.id, chosen.map((c) => ({ expenseId: c.expenseId, amount: c.amount }))), chosen.length > 1 ? 'Gekoppeld en verdeeld over de uitgaven.' : 'Gekoppeld: de terugbetaling volgt nu de categorie van de uitgave.');
  });
  search.addEventListener('input', drawList);
  const modal = openModal(
    `Terugbetaling van ${fmtMoney(t.amount)} koppelen`,
    h(
      'div',
      null,
      h('p', { class: 'small muted' }, 'Voeg de uitgave(n) toe die terugbetaald worden. Het bedrag wordt automatisch verdeeld (elke uitgave krijgt maximaal wat er nog open staat); je kan de delen aanpassen. Samen moeten ze de terugbetaling vormen.'),
      h('h3', null, 'Gekozen uitgaven'),
      picked,
      status,
      h('div', { class: 'form-row' }, save, h('button', { onclick: () => modal.close() }, 'Annuleren')),
      h('h3', null, 'Uitgaven'),
      h('div', { class: 'form-row' }, search),
      list,
    ),
  );
  if (redistributeFirst) redistribute();
  drawPicked();
  drawList();
  setTimeout(() => search.focus(), 0);
}

/** After a manual choice: offer to create a rule. */
export function offerRule(ctx, t, categoryId) {
  const modal = openModal(
    'Regel maken?',
    h(
      'div',
      null,
      h('p', null, `"${t.counterparty?.name || 'deze transactie'}" is nu ${categoryLabel(ctx.service.data, categoryId)}. Wil je hiervan een regel maken, zodat gelijkaardige transacties automatisch deze categorie krijgen?`),
      h(
        'div',
        { class: 'form-row' },
        h('button', { class: 'primary', onclick: () => { modal.close(); openRuleEditor(ctx, { fromTx: t, categoryId }); } }, 'Regel maken…'),
        h('button', { onclick: () => modal.close() }, 'Nee, enkel deze transactie'),
      ),
    ),
  );
}
