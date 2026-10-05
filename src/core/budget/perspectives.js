// Budget perspectives (derived, phase 2 categories are not changed):
//  - persoonlijk: all individual accounts; free space on the current accounts
//    (kind 'zicht'), savings accounts only in the forecast.
//  - gemeenschappelijk: the joint account(s).
// Every transaction on a "flow" account is classified as a flow:
//   inkomen | vast | variabel | sparen | neutraal
import { ownIbans } from '../transfers.js';
import { SYSTEM_CONTRIBUTION } from '../categories/defaults.js';
import { categoryById } from '../categories/categories.js';
import { loanTxIds } from '../loans/budget-link.js';
import { LOAN_CATEGORY } from '../loans/loans.js';
import { RULE_REFUND } from '../categories/refunds.js';

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

/**
 * A transaction split over several categories (a refund linked to several
 * expenses) as parts: [{ ...tx, amount, __categoryId, __part }]; else [tx].
 */
export function txParts(data, tx) {
  const list = data.allocations?.[tx.id];
  if (!list || list.length < 2) return [tx];
  return list.map((a) => ({ ...tx, amount: a.amount, __categoryId: a.categoryId, __part: true }));
}

export function makeClassifier(data, perspective) {
  const own = ownIbans(data);
  const { flow } = perspectiveAccounts(data, perspective);
  const flowSet = new Set(flow);
  // a transaction without own category takes the category of its confirmed recurring series
  const seriesCategory = new Map();
  for (const r of data.recurring ?? []) if (r.status === 'bevestigd' && r.categoryId) for (const id of r.txIds) seriesCategory.set(id, r.categoryId);
  // a payment linked to a confirmed loan without own category counts as the loan category (fixed cost)
  for (const id of loanTxIds(data)) if (!seriesCategory.has(id)) seriesCategory.set(id, LOAN_CATEGORY);
  /** @returns null (not in this perspective) or { flow, group, categoryId } */
  return function classify(tx) {
    if (!flowSet.has(tx.accountId)) return null;
    if (tx.foreignCurrency) return { flow: 'neutraal', group: 'andere-munt', categoryId: null };
    const cp = tx.counterparty?.account;
    const internal = cp && cp !== tx.accountId && own.has(cp) && !data.annotations?.[tx.id]?.notInternal;
    // a transfer between an individual and a joint account that the user categorised
    // himself (e.g. a repayment for a personal purchase made with the joint card)
    // or linked to an expense counts in that category, not as a contribution
    const alloc = data.allocations?.[tx.id]?.[0];
    const own_choice = alloc && (alloc.source === 'manueel' || alloc.ruleId === RULE_REFUND);
    const crossing = internal && data.accounts[cp] && isJoint(data.accounts[cp]) !== isJoint(data.accounts[tx.accountId]);
    if (internal && !tx.__part && !(crossing && own_choice && tx.__categoryId === undefined)) {
      const target = data.accounts[cp];
      if (perspective === 'persoonlijk' && isJoint(target)) return { flow: 'vast', group: 'bijdrage-gemeenschappelijk', categoryId: null };
      if (perspective === 'gemeenschappelijk' && target && !isJoint(target)) return { flow: 'inkomen', group: 'bijdrage-eigen', categoryId: null };
      if (!target || isSavings(target)) return { flow: 'sparen', group: 'sparen', categoryId: null };
      return { flow: 'neutraal', group: 'intern', categoryId: null };
    }
    // tx.__categoryId: used to classify the expected payment of a recurring series
    const categoryId = tx.__categoryId !== undefined ? tx.__categoryId : (data.allocations?.[tx.id]?.[0]?.categoryId ?? seriesCategory.get(tx.id) ?? null);
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
