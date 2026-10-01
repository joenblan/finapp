// Budget perspectives (derived, phase 2 categories are not changed):
//  - persoonlijk: all individual accounts; free space on the current accounts
//    (kind 'zicht'), savings accounts only in the forecast.
//  - gemeenschappelijk: the joint account(s).
// Every transaction on a "flow" account is classified as a flow:
//   inkomen | vast | variabel | sparen | neutraal
import { ownIbans } from '../transfers.js';
import { SYSTEM_CONTRIBUTION } from '../categories/defaults.js';
import { categoryById } from '../categories/categories.js';

export const PERSPECTIVES = [
  { id: 'persoonlijk', label: 'Persoonlijk' },
  { id: 'gemeenschappelijk', label: 'Gemeenschappelijk' },
];

export const isJoint = (a) => a?.ownership?.type === 'gemeenschappelijk';
export const isSavings = (a) => a?.kind === 'spaar';

export function perspectiveAccounts(data, perspective) {
  const all = Object.values(data.accounts).filter((a) => (perspective === 'gemeenschappelijk' ? isJoint(a) : !isJoint(a)));
  const flow = perspective === 'gemeenschappelijk' ? all : all.filter((a) => !isSavings(a));
  return { all: all.map((a) => a.id), flow: flow.map((a) => a.id) };
}

export const GROUPS = {
  'bijdrage-gemeenschappelijk': 'Bijdrage gemeenschappelijke rekening',
  'bijdrage-eigen': 'Bijdrage van eigen rekening',
  [SYSTEM_CONTRIBUTION]: 'Bijdrage mede-eigenaar',
  sparen: 'Sparen',
  none: 'Niet gecategoriseerd',
};

export function makeClassifier(data, perspective) {
  const own = ownIbans(data);
  const { flow } = perspectiveAccounts(data, perspective);
  const flowSet = new Set(flow);
  /** @returns null (not in this perspective) or { flow, group, categoryId } */
  return function classify(tx) {
    if (!flowSet.has(tx.accountId)) return null;
    if (tx.foreignCurrency) return { flow: 'neutraal', group: 'andere-munt', categoryId: null };
    const cp = tx.counterparty?.account;
    const internal = cp && cp !== tx.accountId && own.has(cp) && !data.annotations?.[tx.id]?.notInternal;
    if (internal) {
      const target = data.accounts[cp];
      if (perspective === 'persoonlijk' && isJoint(target)) return { flow: 'vast', group: 'bijdrage-gemeenschappelijk', categoryId: null };
      if (perspective === 'gemeenschappelijk' && target && !isJoint(target)) return { flow: 'inkomen', group: 'bijdrage-eigen', categoryId: null };
      if (!target || isSavings(target)) return { flow: 'sparen', group: 'sparen', categoryId: null };
      return { flow: 'neutraal', group: 'intern', categoryId: null };
    }
    const categoryId = data.allocations?.[tx.id]?.[0]?.categoryId ?? null;
    const cat = categoryId ? categoryById(data, categoryId) : null;
    if (!cat) return { flow: 'variabel', group: 'none', categoryId: null };
    if (cat.id === SYSTEM_CONTRIBUTION) return { flow: perspective === 'gemeenschappelijk' ? 'inkomen' : 'neutraal', group: SYSTEM_CONTRIBUTION, categoryId };
    if (cat.budgetType === 'sparen') return { flow: 'sparen', group: 'sparen', categoryId };
    if (cat.kind === 'inkomst') return { flow: 'inkomen', group: categoryId, categoryId };
    if (cat.kind === 'neutraal') return { flow: 'neutraal', group: categoryId, categoryId };
    return { flow: cat.budgetType === 'vast' ? 'vast' : 'variabel', group: categoryId, categoryId };
  };
}

export function groupLabel(data, group) {
  if (GROUPS[group]) return GROUPS[group];
  const c = categoryById(data, group);
  if (!c) return group;
  const p = c.parentId ? categoryById(data, c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
}
