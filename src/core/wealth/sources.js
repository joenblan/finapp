// Sources of the net worth overview. Every source returns the items on a date:
//   [{ kind, id, label, value (milli, liabilities negative), share (bp), note?, missing? }]
// share: my share in the personal perspective (basis points).
// Extension point: `investments` returns nothing yet (later phase).
import { balanceOn } from './balances.js';
import { outstandingOn } from '../loans/payments.js';
import { loanLabel } from '../loans/loans.js';
import { isJoint } from '../budget/perspectives.js';
import { valuePositions } from '../invest/valuation.js';
import { valueOn } from '../pension/pension.js';

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
    // Phase 5: value of the positions per investment account. There is no cash
    // position: the cash is in the balance of the settlement account (no double count).
    id: 'beleggingen',
    label: 'Beleggingen',
    items(data, date, ctx) {
      let valued = ctx.investValues?.get(date);
      if (!valued) {
        valued = valuePositions(data, date);
        ctx.investValues?.set(date, valued);
      }
      return (data.investAccounts ?? [])
        .filter((a) => (data.operations ?? []).some((o) => o.investAccountId === a.id && o.date <= date))
        .map((a) => {
          const list = valued.filter((p) => p.investAccountId === a.id && p.quantity > 0);
          const unknown = list.filter((p) => p.value === null);
          const stale = list.filter((p) => p.stale);
          const sec = (id) => data.securities.find((s) => s.id === id)?.name ?? id;
          const notes = [];
          if (unknown.length) notes.push(`geen koers: ${unknown.map((p) => sec(p.securityId)).join(', ')}`);
          if (stale.length) notes.push(`koers verouderd: ${stale.map((p) => sec(p.securityId)).join(', ')}`);
          const known = list.filter((p) => p.value !== null);
          const value = unknown.length && !known.length ? null : known.reduce((s, p) => s + p.value, 0);
          return { kind: 'belegging', id: a.id, label: a.name, value, share: myShare(a.owners, data.wealth?.myName), missing: Boolean(unknown.length || stale.length), note: notes.join('; ') || null };
        });
    },
  },
  {
    id: 'pensioensparen',
    label: 'Pensioensparen',
    items(data, date) {
      return (data.pension ?? []).map((p) => {
        const v = valueOn(p, date);
        return { kind: 'pensioen', id: p.id, label: `${p.provider || 'Pensioensparen'} (${p.person})`, value: v ? v.value : null, share: myShare([{ name: p.person, share: 10000 }], data.wealth?.myName), missing: !v, notCounted: !v, note: v ? `waarde ${fmt(v.date)}` : 'nog geen waarde' };
      });
    },
  },
];
