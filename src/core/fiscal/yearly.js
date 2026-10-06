// Fiscal year overview per person and income year (indicative). Every amount
// carries the underlying items (operations / transactions / terms), so the
// screen can show them on click. Export as CSV.
import { yearSummary, shareOf, ownersOf } from '../invest/capital-gains.js';
import { yearStatus, depositsOf } from '../pension/pension.js';
import { followUp } from '../loans/payments.js';
import { loanLabel } from '../loans/loans.js';
import { computeLots } from '../invest/lots.js';
import { FISCAL_DISCLAIMER } from './params.js';

const inYear = (date, year) => date.startsWith(`${year}-`);

function borrowerShare(loan, person) {
  if (!loan.borrowers?.length) return 10000;
  return loan.borrowers.find((b) => b.name === person)?.share ?? 0;
}

/** Interest and capital of the loan terms that were effectively paid (linked payments) in the year. */
export function loanYear(data, loan, year, person) {
  const share = borrowerShare(loan, person);
  let f;
  try {
    f = followUp(data, loan, { today: '9999-12-31' });
  } catch {
    return null;
  }
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const terms = f.terms.filter((t) => t.txIds.length && t.txIds.some((id) => inYear(byId.get(id)?.entryDate ?? '', year)));
  const interest = terms.reduce((s, t) => s + t.interest, 0);
  const capital = terms.reduce((s, t) => s + t.capital, 0);
  const paid = terms.reduce((s, t) => s + t.paid, 0);
  return { loan, share, terms, interest, capital, paid, myInterest: shareOf(interest, share), myCapital: shareOf(capital, share), deviating: terms.filter((t) => t.status === 'afwijkend') };
}

export function yearlyOverview(data, person, year, { today = null } = {}) {
  const lots = computeLots(data);
  const products = (data.pension ?? []).filter((p) => p.person === person);
  const pension = products.map((p) => ({ product: p, status: yearStatus(data, p, year, { today }), deposits: depositsOf(data, p).filter((d) => inYear(d.date, year)) }));
  const loans = (data.loans ?? []).filter((l) => l.status === 'bevestigd' && borrowerShare(l, person) > 0).map((l) => loanYear(data, l, year, person)).filter(Boolean);
  const cgt = yearSummary(data, person, year, lots);
  // costs, stock tax and dividends of the person's investment accounts (by share)
  const ops = (data.operations ?? []).filter((o) => inYear(o.date, year) && ownersOf(data, o.investAccountId).some((x) => x.name === person));
  const shareFor = (o) => ownersOf(data, o.investAccountId).find((x) => x.name === person)?.share ?? 0;
  const sumOps = (list, f) => list.reduce((s, o) => s + shareOf(f(o) ?? 0, shareFor(o)), 0);
  const withCosts = ops.filter((o) => o.costs);
  const withTax = ops.filter((o) => o.stockTax);
  const dividends = ops.filter((o) => o.kind === 'dividend');
  return {
    person,
    year: Number(year),
    disclaimer: FISCAL_DISCLAIMER,
    pension,
    loans,
    cgt,
    reynders: cgt.reynders,
    costs: {
      stockTax: { amount: sumOps(withTax, (o) => o.stockTax), ops: withTax },
      brokerCosts: { amount: sumOps(withCosts, (o) => o.costs), ops: withCosts },
      dividends: {
        gross: sumOps(dividends, (o) => o.gross),
        withholding: sumOps(dividends, (o) => o.withholding),
        net: sumOps(dividends, (o) => (o.gross ?? 0) - (o.withholding ?? 0)),
        ops: dividends,
      },
    },
  };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const amt = (m) => (m === null || m === undefined ? '' : (m / 1000).toFixed(2).replace('.', ','));

/** CSV (semicolon, decimal comma) of the overview. */
export function overviewCsv(o) {
  const rows = [['Onderdeel', 'Omschrijving', 'Bedrag (EUR)']];
  const add = (a, b, c) => rows.push([a, b, typeof c === 'number' ? amt(c) : (c ?? '')]);
  add('Algemeen', `Fiscaal jaaroverzicht ${o.year} – ${o.person}`, '');
  add('Algemeen', o.disclaimer, '');
  for (const p of o.pension) {
    const name = `${p.product.provider || 'Pensioensparen'}`;
    add('Pensioensparen', `${name}: gestort`, p.status.deposited);
    add('Pensioensparen', `${name}: stelsel`, p.status.regime === 'verhoogd' ? 'verhoogd' : 'basis');
    add('Pensioensparen', `${name}: verwachte belastingvermindering`, p.status.reduction);
  }
  for (const l of o.loans) {
    add('Woonkrediet', `${loanLabel(l.loan)}: betaalde interest (totaal)`, l.interest);
    add('Woonkrediet', `${loanLabel(l.loan)}: betaald kapitaal (totaal)`, l.capital);
    add('Woonkrediet', `${loanLabel(l.loan)}: interest volgens aandeel (${l.share / 100} %)`, l.myInterest);
    add('Woonkrediet', `${loanLabel(l.loan)}: kapitaal volgens aandeel (${l.share / 100} %)`, l.myCapital);
  }
  const c = o.cgt;
  add('Meerwaardebelasting', 'Meerwaarden', c.gainTotal);
  add('Meerwaardebelasting', 'Minwaarden', c.lossTotal);
  add('Meerwaardebelasting', 'Vrijstelling', c.exemption);
  add('Meerwaardebelasting', 'Overgedragen vrijstelling', c.carried);
  add('Meerwaardebelasting', 'Belastbare basis', c.taxable);
  add('Meerwaardebelasting', 'Berekende belasting', c.tax);
  add('Meerwaardebelasting', 'Reeds ingehouden door de bank', c.withheld);
  add('Reynderstaks', 'Gerealiseerde meerwaarden', o.reynders.realizedGains);
  add('Reynderstaks', 'Ingehouden roerende voorheffing', o.reynders.withheldRv);
  add('Kosten', 'Betaalde beurstaks', o.costs.stockTax.amount);
  add('Kosten', 'Makelaarskosten', o.costs.brokerCosts.amount);
  add('Dividenden', 'Bruto', o.costs.dividends.gross);
  add('Dividenden', 'Roerende voorheffing', o.costs.dividends.withholding);
  add('Dividenden', 'Netto', o.costs.dividends.net);
  return rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}
