// Woonkrediet: input of the loan with tranches, follow-up of the payments,
// amortisation table, checkpoints and simulation of an extra repayment.
import { h, append, clear } from '../dom.js';
import { openModal } from '../components/modal.js';
import { parseEuroInput, formatMilli } from '../../core/money.js';
import { fmtDate, fmtMoney, moneyEl, formatIban } from '../format.js';
import { kpi, today } from './budget-common.js';
import { trancheSchedule } from '../../core/loans/schedule.js';
import { followUp, checkpointDiffs, outstandingOn } from '../../core/loans/payments.js';
import { simulateExtra, feeFor } from '../../core/loans/simulate.js';
import { monthlyRate, fixedToPercentText, solveMonthlyRate } from '../../core/loans/decimal.js';
import { validateLoan } from '../../core/loans/loans.js';

const STATUS = { betaald: ['ok', 'betaald'], afwijkend: ['warn', 'afwijkend bedrag'], openstaand: ['err', 'openstaand'], verwacht: ['info', 'verwacht'], 'geen-gegevens': ['', 'geen gegevens'] };
const TYPES = { annuiteit: 'Vaste maandlast (annuïteit)', lineair: 'Constante kapitaalaflossing' };
const METHODS = { gelijkwaardig: 'Jaarrente, gelijkwaardige maandrente ((1+j)^(1/12)−1)', nominaal: 'Jaarrente, nominale maandrente (j/12)', periodiek: 'Periodieke maandrente (zoals op de kredietakte, bv. 0,21 %)' };
const options = (map, sel) => Object.entries(map).map(([k, v]) => h('option', { value: k, selected: k === sel }, v));

/** "50" / "33,33" -> basis points */
export function parsePercentBp(text) {
  const s = String(text ?? '').trim().replace(',', '.').replace('%', '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw new Error(`Ongeldig percentage "${text}".`);
  const [i, f = ''] = s.split('.');
  const bp = Number(i) * 100 + Number((f + '00').slice(0, 2));
  if (bp > 10000) throw new Error('Percentage boven 100 %.');
  return bp;
}
export const bpText = (bp) => `${Math.floor(bp / 100)}${bp % 100 ? `,${String(bp % 100).padStart(2, '0')}` : ''}`;

export function renderLoans(ctx) {
  const data = ctx.service.data;
  const st = (ctx.state.loans ??= { selected: null, editing: null });
  const run = (p, ok) => p.then((r) => (ok && ctx.toast(ok), r)).catch((e) => ctx.toast(e.message, true));
  if (st.editing) return loanForm(ctx, st, run);
  const loans = data.loans;
  const loan = loans.find((l) => l.id === st.selected) ?? loans[0] ?? null;
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Woonkrediet'),
      loans.length
        ? h('div', { class: 'subnav' }, loans.map((l) => h('button', { class: l === loan ? 'active' : '', onclick: () => ((st.selected = l.id), ctx.rerender()) }, l.name, l.status === 'concept' ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, 'concept') : null)))
        : h('p', { class: 'muted' }, 'Nog geen lening ingevoerd. Voer de gegevens in uit je kredietakte of aflossingstabel.'),
      h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: () => ((st.editing = { new: true }), ctx.rerender()) }, 'Nieuwe lening')),
    ),
    loan ? loanDetail(ctx, loan, st, run) : null,
  );
}

// ---- input form -------------------------------------------------------------

function emptyTranche(n) {
  return { name: `Deelkrediet ${n}`, principal: null, annualRate: '', months: 300, firstPaymentDate: '', paymentDay: null, type: 'annuiteit', rateMethod: 'gelijkwaardig' };
}

function loanForm(ctx, st, run) {
  const data = ctx.service.data;
  const src = st.editing.new ? null : data.loans.find((l) => l.id === st.editing.id);
  const draft = structuredClone(src ?? { name: 'Woonkrediet', accountId: Object.keys(data.accounts)[0] ?? '', counterparty: { iban: '', name: '' }, borrowers: [], drawdownDate: '', propertyId: null, tranches: [emptyTranche(1)] });
  const root = h('div', { class: 'panel' });
  const preview = h('div');

  const field = (label, input, hint) => h('div', { class: 'form-row' }, h('label', { style: { minWidth: '190px' } }, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);
  const name = h('input', { value: draft.name, size: 30 });
  const account = h('select', null, Object.values(data.accounts).map((a) => h('option', { value: a.id, selected: a.id === draft.accountId }, `${a.displayName} (${formatIban(a.id)})`)));
  const lenderIban = h('input', { value: draft.counterparty?.iban ?? '', size: 24, placeholder: 'IBAN kredietgever' });
  const lenderName = h('input', { value: draft.counterparty?.name ?? '', size: 20, placeholder: 'naam kredietgever' });
  const drawdown = h('input', { type: 'date', value: draft.drawdownDate ?? '' });
  const property = h('select', null, h('option', { value: '' }, '— geen —'), data.properties.map((p) => h('option', { value: p.id, selected: p.id === draft.propertyId }, p.name)));
  const borrowers = h('input', { size: 40, value: (draft.borrowers ?? []).map((b) => `${b.name} ${bpText(b.share)}`).join('; '), placeholder: 'bv. Jan 50; An 50' });

  const trancheBox = h('div');
  const trancheInputs = [];
  const drawTranches = () => {
    trancheInputs.length = 0;
    clear(trancheBox);
    draft.tranches.forEach((t, i) => {
      const inp = {
        name: h('input', { value: t.name, size: 18 }),
        principal: h('input', { value: t.principal ? formatMilli(t.principal) : '', size: 12, placeholder: 'bv. 200.000,00' }),
        rate: h('input', { value: t.annualRate, size: 6, placeholder: 'bv. 3,00' }),
        months: h('input', { type: 'number', min: 1, max: 600, value: t.months ?? '', size: 5 }),
        first: h('input', { type: 'date', value: t.firstPaymentDate }),
        day: h('input', { type: 'number', min: 1, max: 31, value: t.paymentDay ?? '', size: 3, placeholder: 'dag' }),
        type: h('select', null, options(TYPES, t.type)),
        method: h('select', null, options(METHODS, t.rateMethod)),
        bankPayment: h('input', { size: 10, placeholder: 'bv. 1.342,52' }),
      };
      for (const el of Object.values(inp)) el.addEventListener('input', updatePreview);
      trancheInputs.push(inp);
      trancheBox.append(
        h(
          'fieldset',
          { class: 'card', style: { marginBottom: '10px' } },
          h('legend', null, `Deelkrediet ${i + 1}`),
          h('div', { class: 'form-row' }, h('label', null, 'Naam'), inp.name, h('label', null, 'Ontleend bedrag'), inp.principal, h('label', null, 'Rente %'), inp.rate, h('label', null, 'Looptijd (maanden)'), inp.months),
          h('div', { class: 'form-row' }, h('label', null, 'Eerste afbetaling'), inp.first, h('label', null, 'Afbetalingsdag'), inp.day, inp.type, inp.method),
          h(
            'div',
            { class: 'form-row' },
            h('label', null, 'Maandlast volgens bank'),
            inp.bankPayment,
            h('button', {
              onclick: () => {
                try {
                  const principal = parseEuroInput(inp.principal.value);
                  const months = Number(inp.months.value);
                  if (!Number.isInteger(months) || months < 1) throw new Error('Vul eerst de looptijd in.');
                  if (inp.type.value !== 'annuiteit') throw new Error('Enkel voor een vaste maandlast (annuïteit).');
                  inp.rate.value = solveMonthlyRate(principal, months, parseEuroInput(inp.bankPayment.value));
                  inp.method.value = 'periodiek';
                  updatePreview();
                  ctx.toast(`Exacte maandrente ${inp.rate.value} % ingevuld.`);
                } catch (e) {
                  ctx.toast(e.message, true);
                }
              },
            }, 'Rente berekenen'),
            h('span', { class: 'muted small' }, 'Staat op je akte een afgeronde rente (bv. 0,21 %)? Laat de exacte maandrente berekenen uit bedrag, looptijd en maandlast.'),
          ),
          draft.tranches.length > 1 ? h('button', { class: 'danger', onclick: () => (readTranches(), draft.tranches.splice(i, 1), drawTranches(), updatePreview()) }, 'Deelkrediet verwijderen') : null,
        ),
      );
    });
  };
  const readTranches = () => {
    draft.tranches = trancheInputs.map((inp, i) => {
      let principal = null;
      try {
        principal = inp.principal.value.trim() ? parseEuroInput(inp.principal.value) : null;
      } catch {
        principal = NaN;
      }
      return {
        ...(draft.tranches[i]?.id ? { id: draft.tranches[i].id } : {}),
        name: inp.name.value.trim(),
        principal,
        annualRate: inp.rate.value.trim(),
        months: Number(inp.months.value) || null,
        firstPaymentDate: inp.first.value,
        paymentDay: inp.day.value ? Number(inp.day.value) : inp.first.value ? Number(inp.first.value.slice(8, 10)) : null,
        type: inp.type.value,
        rateMethod: inp.method.value,
      };
    });
  };
  const readLoan = () => {
    readTranches();
    const bs = borrowers.value.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = /^(.*\S)\s+([\d.,]+)\s*%?$/.exec(x);
      if (!m) throw new Error(`Kredietnemer "${x}": geef naam en aandeel, bv. "Jan 50".`);
      return { name: m[1], share: parsePercentBp(m[2]) };
    });
    return {
      ...(src ?? {}),
      name: name.value.trim(),
      accountId: account.value,
      counterparty: { iban: lenderIban.value.replace(/\s/g, '').toUpperCase(), name: lenderName.value.trim() },
      borrowers: bs,
      drawdownDate: drawdown.value || null,
      propertyId: property.value || null,
      tranches: draft.tranches,
    };
  };

  function updatePreview() {
    readTranches();
    const rows = draft.tranches.map((t, i) => {
      try {
        const s = trancheSchedule(t);
        const other = t.rateMethod === 'gelijkwaardig' ? 'nominaal' : t.rateMethod === 'nominaal' ? 'gelijkwaardig' : null;
        const alt = other ? trancheSchedule({ ...t, rateMethod: other }) : null;
        return h(
          'tr',
          null,
          h('td', null, t.name || `Deelkrediet ${i + 1}`),
          h('td', { class: 'num' }, `${fixedToPercentText(monthlyRate(t.annualRate, t.rateMethod))} %`),
          h('td', { class: 'num' }, fmtMoney(s.rows[0].payment)),
          h('td', { class: 'num' }, fmtMoney(s.rows[0].interest)),
          h('td', { class: 'num' }, fmtMoney(s.rows[0].capital)),
          h('td', { class: 'num' }, fmtMoney(s.totalInterest)),
          h('td', null, fmtDate(s.endDate)),
          h('td', { class: 'small muted' }, alt ? `Met ${other === 'nominaal' ? 'nominale' : 'gelijkwaardige'} maandrente: eerste afbetaling ${fmtMoney(alt.rows[0].payment)}. Staat op je akte een maandrente (bv. 0,21 %)? Kies dan "Periodieke maandrente".` : `Ingevoerd als maandrente ${t.annualRate} %.`),
        );
      } catch (e) {
        return h('tr', null, h('td', null, t.name || `Deelkrediet ${i + 1}`), h('td', { colspan: '7', class: 'muted small' }, e.message));
      }
    });
    append(clear(preview), [
      h('h3', null, 'Controle: eerste afbetaling'),
      h('p', { class: 'muted small' }, 'Vergelijk de eerste afbetaling met je aflossingstabel van de bank. Klopt ze niet? Probeer de andere rentemethode (zie rechts).'),
      h('table', { class: 'grid small' }, h('thead', null, h('tr', null, ['Deelkrediet', 'Maandrente', 'Eerste afbetaling', 'Interest', 'Kapitaal', 'Totale interest', 'Laatste afbetaling', ''].map((x, i) => h('th', { class: i >= 1 && i <= 5 ? 'num' : '' }, x)))), h('tbody', null, rows)),
    ]);
  }

  drawTranches();
  updatePreview();
  const save = (confirmIt) => {
    let loan;
    try {
      loan = readLoan();
    } catch (e) {
      ctx.toast(e.message, true);
      return;
    }
    const errors = validateLoan(data, loan);
    if (errors.length) {
      ctx.toast(errors.join(' '), true);
      return;
    }
    run(ctx.service.saveLoan(confirmIt ? { ...loan, status: 'bevestigd' } : loan), 'Lening opgeslagen.').then((r) => {
      if (!r) return; // error already shown
      const list = ctx.service.data.loans;
      st.selected = (src ? list.find((l) => l.id === src.id) : list[list.length - 1])?.id ?? null;
      st.editing = null;
      ctx.rerender();
    });
  };
  return append(root, [
    h('h2', null, src ? `Lening bewerken: ${src.name}` : 'Nieuwe lening'),
    field('Naam', name),
    field('Afbetaald van rekening', account),
    field('Kredietgever', h('span', null, lenderIban, ' ', lenderName), 'IBAN of naam om de afbetalingen te herkennen'),
    field('Kredietnemers en aandeel %', borrowers, 'voor het persoonlijk vermogen; leeg = 100 %'),
    field('Datum opname', drawdown, 'leeg = 1 maand vóór de eerste afbetaling'),
    field('Woning', property),
    h('h3', null, 'Deelkredieten'),
    trancheBox,
    h('div', { class: 'form-row' }, h('button', { onclick: () => (readTranches(), draft.tranches.push(emptyTranche(draft.tranches.length + 1)), drawTranches(), updatePreview()) }, '+ Deelkrediet')),
    preview,
    h(
      'div',
      { class: 'form-row' },
      h('button', { class: 'primary', onclick: () => save(false) }, src ? 'Opslaan' : 'Opslaan als concept'),
      !src || src.status === 'concept' ? h('button', { onclick: () => save(true) }, 'Opslaan en bevestigen') : null,
      h('button', { onclick: () => ((st.editing = null), ctx.rerender()) }, 'Annuleren'),
    ),
  ]);
}

// ---- detail -----------------------------------------------------------------

function loanDetail(ctx, loan, st, run) {
  const data = ctx.service.data;
  const t = today();
  let f;
  try {
    f = followUp(data, loan, { today: t, graceDays: data.budget?.missedGraceDays ?? 5 });
  } catch (e) {
    return h('div', { class: 'panel' }, h('div', { class: 'banner err' }, `Deze lening kan niet berekend worden: ${e.message}`), h('button', { onclick: () => ((st.editing = { id: loan.id }), ctx.rerender()) }, 'Bewerken'));
  }
  const s = f.schedule;
  const remaining = outstandingOn(loan, t, s);
  const next = f.terms.find((x) => x.date >= t);
  const byTx = new Map(data.transactions.map((x) => [x.id, x]));
  const counts = f.terms.reduce((m, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {});

  const header = h(
    'div',
    { class: 'panel' },
    h('h2', null, loan.name, ' ', loan.status === 'concept' ? h('span', { class: 'badge warn' }, 'concept') : h('span', { class: 'badge ok' }, 'bevestigd')),
    h('p', { class: 'muted small' }, `${data.accounts[loan.accountId]?.displayName ?? loan.accountId} · kredietgever ${loan.counterparty?.name || ''} ${loan.counterparty?.iban ? formatIban(loan.counterparty.iban) : ''} · ${loan.tranches.length} deelkrediet(en)`),
    loan.status === 'concept' ? h('div', { class: 'banner info' }, 'Concept: controleer de eerste afbetaling en bevestig de lening. Pas dan telt ze mee in budget, prognose en vermogen.') : null,
    h(
      'div',
      { class: 'kpis' },
      kpi('Openstaand kapitaal', fmtMoney(remaining)),
      kpi('Volgende afbetaling', next ? `${fmtMoney(next.expected)} op ${fmtDate(next.date)}` : '—'),
      kpi('Einddatum', fmtDate(s.endDate)),
      kpi('Totale interest', fmtMoney(s.totalInterest)),
    ),
    h(
      'div',
      { class: 'form-row' },
      h('button', { onclick: () => ((st.editing = { id: loan.id }), ctx.rerender()) }, 'Bewerken'),
      loan.status === 'concept' ? h('button', { class: 'primary', onclick: () => run(ctx.service.confirmLoan(loan.id), 'Lening bevestigd.') }, 'Bevestigen') : h('button', { onclick: () => run(ctx.service.confirmLoan(loan.id, false), 'Terug naar concept.') }, 'Terug naar concept'),
      h('button', { class: 'danger', onclick: () => confirm(`Lening "${loan.name}" verwijderen? Transacties blijven behouden.`) && run(ctx.service.deleteLoan(loan.id), 'Lening verwijderd.') }, 'Verwijderen'),
    ),
  );

  // follow-up: past terms + the next 3
  const shown = f.terms.filter((x) => x.date <= t || f.terms.indexOf(x) < f.terms.findIndex((y) => y.date > t) + 3);
  const linkModal = (term) => {
    const cands = f.candidates.filter((x) => Math.abs((Date.parse(x.entryDate) - Date.parse(term.date)) / 86400000) <= 40).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    const boxes = cands.map((x) => ({ x, cb: h('input', { type: 'checkbox', checked: term.txIds.includes(x.id) }) }));
    const m = openModal(
      `Betaling van ${fmtDate(term.date)} koppelen`,
      h(
        'div',
        null,
        h('p', { class: 'small' }, `Verwacht: ${fmtMoney(term.expected)}. Kies de transactie(s) van deze afbetaling.`),
        cands.length ? h('table', { class: 'grid small' }, h('tbody', null, boxes.map(({ x, cb }) => h('tr', null, h('td', null, cb), h('td', null, fmtDate(x.entryDate)), h('td', { class: 'num' }, moneyEl(x.amount, 'EUR')), h('td', null, x.counterparty?.name ?? ''))))) : h('p', { class: 'muted' }, 'Geen betalingen aan de kredietgever rond deze datum.'),
        h(
          'div',
          { class: 'form-row' },
          h('button', { class: 'primary', onclick: () => (m.close(), run(ctx.service.setPaymentLink(loan.id, term.date, { txIds: boxes.filter((b) => b.cb.checked).map((b) => b.x.id) }), 'Koppeling opgeslagen.')) }, 'Koppelen'),
          h('button', { onclick: () => (m.close(), run(ctx.service.setPaymentLink(loan.id, term.date, { none: true }), 'Gemarkeerd als niet betaald.')) }, 'Niet betaald'),
          term.manual ? h('button', { onclick: () => (m.close(), run(ctx.service.setPaymentLink(loan.id, term.date, null), 'Terug automatisch.')) }, 'Automatisch koppelen') : null,
          h('button', { onclick: () => m.close() }, 'Annuleren'),
        ),
      ),
    );
  };
  const follow = h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Opvolging afbetalingen'),
    h('p', { class: 'muted small' }, `Automatisch gekoppeld: betalingen aan de kredietgever op de afbetalingsrekening binnen 5 dagen van de vervaldag. ${counts.betaald ?? 0} betaald, ${counts.afwijkend ?? 0} afwijkend, ${counts.openstaand ?? 0} openstaand.`),
    h(
      'table',
      { class: 'grid small' },
      h('thead', null, h('tr', null, ['Vervaldag', 'Verwacht', 'Status', 'Betaald', 'Verschil', 'Transactie', ''].map((x, i) => h('th', { class: [1, 3, 4].includes(i) ? 'num' : '' }, x)))),
      h(
        'tbody',
        null,
        shown.reverse().map((x) => {
          const [cls, label] = STATUS[x.status];
          return h(
            'tr',
            null,
            h('td', null, fmtDate(x.date)),
            h('td', { class: 'num' }, fmtMoney(x.expected)),
            h('td', null, h('span', { class: `badge ${cls}` }, label), x.manual ? h('span', { class: 'muted small' }, ' manueel') : null),
            h('td', { class: 'num' }, x.txIds.length ? fmtMoney(x.paid) : '—'),
            h('td', { class: 'num' }, x.txIds.length && x.diff ? `${x.diff > 0 ? '+' : ''}${fmtMoney(x.diff)} ${x.diff > 0 ? 'te veel' : 'te weinig'}` : ''),
            h('td', { class: 'small' }, x.txIds.map((id) => byTx.get(id)).filter(Boolean).map((tx) => `${fmtDate(tx.entryDate)} ${tx.counterparty?.name ?? ''}`).join(', ')),
            h('td', null, x.date <= addDaysIso(t, 5) ? h('button', { onclick: () => linkModal(x) }, 'Koppeling…') : null),
          );
        }),
      ),
    ),
  );

  return h('div', null, header, follow, tablePanel(s, loan), checkpointPanel(ctx, loan, s, run), simulationPanel(ctx, loan, run));
}

const addDaysIso = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

function tablePanel(s, loan) {
  const rowsOf = (rows, withParts) =>
    rows.map((r) =>
      h(
        'tr',
        null,
        h('td', { class: 'num' }, String(r.n)),
        h('td', null, fmtDate(r.date)),
        h('td', { class: 'num' }, fmtMoney(r.payment)),
        h('td', { class: 'num' }, fmtMoney(r.interest)),
        h('td', { class: 'num' }, fmtMoney(r.capital)),
        h('td', { class: 'num' }, r.extraBefore ? fmtMoney(r.extraBefore) : ''),
        h('td', { class: 'num' }, fmtMoney(r.balance)),
        withParts ? h('td', { class: 'small muted' }, r.parts.length > 1 ? r.parts.map((p) => fmtMoney(p.payment)).join(' + ') : '') : null,
      ),
    );
  const head = (withParts) => h('thead', null, h('tr', null, ['Nr', 'Datum', 'Afbetaling', 'Interest', 'Kapitaal', 'Extra aflossing', 'Saldo na', withParts ? 'Per deelkrediet' : null].filter((x) => x !== null).map((x, i) => h('th', { class: [0, 2, 3, 4, 5, 6].includes(i) ? 'num' : '' }, x))));
  return h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Aflossingstabel'),
    h('p', { class: 'muted small' }, 'Interest per maand afgerond op de cent op het openstaande saldo; de laatste afbetaling lost het volledige restsaldo af.'),
    h('details', null, h('summary', null, `Totaal (${s.total.length} afbetalingen)`), h('div', { class: 'report-wrap' }, h('table', { class: 'grid small' }, head(true), h('tbody', null, rowsOf(s.total, true))))),
    loan.tranches.length > 1 ? s.perTranche.map((p) => h('details', null, h('summary', null, `${p.tranche.name} (${p.rows.length} afbetalingen, interest ${fmtMoney(p.totalInterest)})`), h('div', { class: 'report-wrap' }, h('table', { class: 'grid small' }, head(false), h('tbody', null, rowsOf(p.rows, false)))))) : null,
  );
}

function checkpointPanel(ctx, loan, s, run) {
  const diffs = checkpointDiffs(loan, s);
  const date = h('input', { type: 'date' });
  const tranche = h('select', null, h('option', { value: '' }, 'hele lening'), loan.tranches.map((t) => h('option', { value: t.id }, t.name)));
  const bal = h('input', { size: 12, placeholder: 'saldo volgens bank' });
  return h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Controlepunten'),
    h('p', { class: 'muted small' }, 'Openstaand saldo volgens de bank (jaaroverzicht, attest) vergeleken met de berekende tabel.'),
    diffs.length
      ? h('table', { class: 'grid small' }, h('tbody', null, diffs.map((c) => h('tr', null, h('td', null, fmtDate(c.date)), h('td', null, c.trancheId ? loan.tranches.find((t) => t.id === c.trancheId)?.name : 'hele lening'), h('td', { class: 'num' }, `bank ${fmtMoney(c.balance)}`), h('td', { class: 'num' }, `berekend ${fmtMoney(c.computed)}`), h('td', null, c.diff === 0 ? h('span', { class: 'badge ok' }, 'klopt') : h('span', { class: 'badge warn' }, `verschil ${fmtMoney(c.diff)}`)), h('td', null, h('button', { class: 'danger', onclick: () => run(ctx.service.removeCheckpoint(loan.id, c.id)) }, 'Verwijderen'))))))
      : null,
    h(
      'div',
      { class: 'form-row' },
      date,
      tranche,
      bal,
      h('button', {
        onclick: () => {
          try {
            run(ctx.service.addCheckpoint(loan.id, { date: date.value, trancheId: tranche.value || null, balance: parseEuroInput(bal.value) }), 'Controlepunt toegevoegd.');
          } catch (e) {
            ctx.toast(e.message, true);
          }
        },
      }, 'Toevoegen'),
    ),
  );
}

function simulationPanel(ctx, loan, run) {
  const out = h('div');
  const date = h('input', { type: 'date', value: today() });
  const tranche = h('select', null, loan.tranches.map((t) => h('option', { value: t.id }, t.name)));
  const amount = h('input', { size: 12, placeholder: 'bv. 20.000,00' });
  const mode = h('select', null, h('option', { value: 'korter' }, 'kortere looptijd'), h('option', { value: 'lager' }, 'lagere maandlast'));
  const feeType = h('select', null, h('option', { value: 'maanden' }, 'maanden interest'), h('option', { value: 'bedrag' }, 'vast bedrag'));
  const feeValue = h('input', { size: 8, value: '3' });
  const read = () => {
    const fee = feeType.value === 'maanden' ? { type: 'maanden', value: Number(feeValue.value) } : { type: 'bedrag', value: parseEuroInput(feeValue.value) };
    return { date: date.value, trancheId: tranche.value, amount: parseEuroInput(amount.value), mode: mode.value, fee };
  };
  const simulate = () => {
    try {
      const x = read();
      const r = simulateExtra(loan, x);
      append(clear(out), [
        h(
          'div',
          { class: 'kpis' },
          kpi('Wederbeleggingsvergoeding', fmtMoney(r.fee)),
          kpi('Bespaarde interest', fmtMoney(r.interestSaved)),
          kpi('Netto voordeel', fmtMoney(r.netGain), r.netGain >= 0 ? 'ok' : 'err'),
          x.mode === 'korter' ? kpi('Einddatum', `${fmtDate(r.endAfter)} (was ${fmtDate(r.endBefore)}, ${r.monthsShorter} maanden korter)`) : kpi('Nieuwe afbetaling', `${fmtMoney(r.paymentAfter)} (was ${fmtMoney(r.paymentBefore)})`),
        ),
        h('p', { class: 'muted small' }, 'De extra aflossing wordt toegepast direct na de laatste afbetaling op of vóór de gekozen datum. Dit is een simulatie: er wordt niets bewaard.'),
        h('button', { onclick: () => confirm('Deze extra aflossing registreren als uitgevoerd? De aflossingstabel wordt herberekend.') && run(ctx.service.addExtraPayment(loan.id, x), 'Extra aflossing geregistreerd.') }, 'Registreren als uitgevoerd'),
      ]);
    } catch (e) {
      append(clear(out), [h('div', { class: 'banner err' }, e.message)]);
    }
  };
  const done = loan.extraPayments ?? [];
  return h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Simulatie extra aflossing'),
    h('div', { class: 'form-row' }, h('label', null, 'Datum'), date, h('label', null, 'Deelkrediet'), tranche, h('label', null, 'Bedrag'), amount, mode),
    h('div', { class: 'form-row' }, h('label', null, 'Vergoeding'), feeValue, feeType, h('span', { class: 'muted small' }, 'standaard 3 maanden interest op het afgeloste bedrag'), h('button', { class: 'primary', onclick: simulate }, 'Berekenen')),
    out,
    done.length
      ? h('div', null, h('h3', null, 'Uitgevoerde extra aflossingen'), h('table', { class: 'grid small' }, h('tbody', null, done.map((x) => h('tr', null, h('td', null, fmtDate(x.date)), h('td', null, loan.tranches.find((t) => t.id === x.trancheId)?.name ?? ''), h('td', { class: 'num' }, fmtMoney(x.amount)), h('td', null, x.mode === 'korter' ? 'kortere looptijd' : 'lagere maandlast'), h('td', { class: 'num' }, `vergoeding ${fmtMoney(x.feeAmount ?? (x.fee ? feeFor(loan.tranches.find((t) => t.id === x.trancheId), x.amount, x.fee) : 0))}`), h('td', null, h('button', { class: 'danger', onclick: () => confirm('Deze extra aflossing verwijderen?') && run(ctx.service.removeExtraPayment(loan.id, x.id), 'Verwijderd.') }, 'Verwijderen')))))))
      : null,
  );
}
