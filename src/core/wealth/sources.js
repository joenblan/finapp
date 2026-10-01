// Sources of the net worth overview. Every source returns the items on a date:
//   [{ kind, id, label, value (milli, liabilities negative), share (bp), note?, missing? }]
// share: my share in the personal perspective (basis points).
// Extension point: `investments` returns nothing yet (later phase).
import { balanceOn } from './balances.js';
import { outstandingOn } from '../loans/payments.js';
import { loanLabel } from '../loans/loans.js';
import { isJoint } from '../budget/perspectives.js';

const fmt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** My share (bp) in owners [{ name, share }]: by my name, else equal parts; no owners = 100 %. */
export function myShare(owners, myName) {
  if (!owners?.length) return 10000;
  if (myName) {
    const o = owners.find((x) => x.name === myName);
    if (o) return o.share;
    return 0;
  }
  return Math.floor(10000 / owners.length);
}

const latestOnOrBefore = (list, date) => [...(list ?? [])].filter((v) => v.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

export const SOURCES = [
  {
    id: 'rekeningen',
    label: 'Rekeningen',
    items(data, date, ctx) {
      return Object.values(ctx.balances).map((e) => {
        const r = balanceOn(e, date);
        const share = isJoint(e.account) ? (data.wealth?.jointShares?.[e.account.id] ?? 5000) : 10000;
        if (!r) return { kind: 'rekening', id: e.account.id, label: e.account.displayName, value: null, share, missing: true, note: 'geen gegevens voor deze datum' };
        return { kind: 'rekening', id: e.account.id, label: e.account.displayName, value: r.balance, share, missing: r.partial, note: r.partial ? `gegevens tot ${fmt(r.asOf)}` : null };
      });
    },
  },
  {
    id: 'woningen',
    label: 'Woningen',
    items(data, date) {
      return (data.properties ?? []).map((p) => {
        const v = latestOnOrBefore(p.valuations, date);
        return { kind: 'woning', id: p.id, label: p.name, value: v ? v.value : null, share: myShare(p.owners, data.wealth?.myName), note: v ? `waardering ${fmt(v.date)}` : 'nog geen waardering', missing: !v, notCounted: !v };
      });
    },
  },
  {
    id: 'leningen',
    label: 'Leningen',
    items(data, date, ctx) {
      return (data.loans ?? [])
        .filter((l) => l.status === 'bevestigd')
        .map((l) => {
          let value = null;
          try {
            value = -outstandingOn(l, date, ctx.schedules.get(l.id));
          } catch {
            return { kind: 'lening', id: l.id, label: loanLabel(l), value: null, share: 10000, missing: true, note: 'lening ongeldig' };
          }
          return { kind: 'lening', id: l.id, label: loanLabel(l), value: value === 0 ? 0 : value, share: myShare(l.borrowers, data.wealth?.myName) };
        });
    },
  },
  {
    id: 'overig',
    label: 'Overige bezittingen en schulden',
    items(data, date) {
      const map = (list, sign, kind) =>
        (list ?? []).map((a) => {
          const v = latestOnOrBefore(a.values, date);
          return { kind, id: a.id, label: a.name, value: v ? sign * v.value : null, share: myShare(a.owners, data.wealth?.myName), missing: !v, notCounted: !v, note: v ? null : 'nog geen waarde' };
        });
      return [...map(data.otherAssets, 1, 'bezitting'), ...map(data.otherLiabilities, -1, 'schuld')];
    },
  },
  {
    id: 'beleggingen',
    label: 'Beleggingen',
    items() {
      return []; // extension point for a later phase
    },
  },
];
