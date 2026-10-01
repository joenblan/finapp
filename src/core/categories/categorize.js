// Category assignment. Stored separately from the transaction:
//   data.allocations[txId] = [{ categoryId, amount, source: 'manueel'|'regel'|'geen', ruleId }]
// For now exactly one allocation per transaction, for the full amount (the list
// form allows splitting later without a destructive migration).
//
// Priority: manual choice (never overwritten) > internal transfer >
// contribution of the co-owner > user rules (first match wins) > none.
import { SYSTEM_INTERNAL, SYSTEM_CONTRIBUTION } from './defaults.js';
import { firstMatchingRule, ruleMatches } from './rules.js';
import { ownIbans, isInternal } from '../transfers.js';

export const RULE_INTERNAL = 'systeem:intern';
export const RULE_CONTRIBUTION = 'systeem:bijdrage';
const isSystemRule = (id) => typeof id === 'string' && id.startsWith('systeem:');

export function allocationOf(data, txId) {
  return data.allocations?.[txId]?.[0] ?? null;
}

export function categoryOf(data, txId) {
  return allocationOf(data, txId)?.categoryId ?? null;
}

export function makeContext(data) {
  const coOwner = new Map();
  for (const a of Object.values(data.accounts)) {
    if (a.ownership?.type === 'gemeenschappelijk' && a.coOwnerIbans?.length) coOwner.set(a.id, new Set(a.coOwnerIbans));
  }
  return { data, own: ownIbans(data), coOwner, rules: data.rules ?? [] };
}

export function systemAllocation(tx, ctx) {
  if (isInternal(tx, ctx.data, ctx.own)) return { categoryId: SYSTEM_INTERNAL, source: 'regel', ruleId: RULE_INTERNAL };
  const co = ctx.coOwner.get(tx.accountId);
  if (co && tx.amount > 0 && co.has(tx.counterparty?.account ?? '')) {
    return { categoryId: SYSTEM_CONTRIBUTION, source: 'regel', ruleId: RULE_CONTRIBUTION };
  }
  return null;
}

export function autoAllocation(tx, ctx) {
  const sys = systemAllocation(tx, ctx);
  if (sys) return sys;
  const rule = firstMatchingRule(ctx.rules, tx);
  if (rule) return { categoryId: rule.categoryId, source: 'regel', ruleId: rule.id };
  return { categoryId: null, source: 'geen', ruleId: null };
}

const same = (a, b) => a && b && a.categoryId === b.categoryId && a.source === b.source && a.ruleId === b.ruleId && a.amount === b.amount;

/**
 * @param mode 'all'  : recompute every non-manual transaction (button "Regels opnieuw toepassen")
 *             'import': full computation for `newIds`; for the others only the
 *                       system part (internal / contribution) is updated, so
 *                       existing rule results stay as they are.
 * @returns { data, changed }
 */
export function categorize(data, { mode = 'all', newIds = null } = {}) {
  const ctx = makeContext(data);
  const fresh = newIds ? new Set(newIds) : null;
  let allocations = data.allocations ?? {};
  let copied = false;
  let changed = 0;
  for (const tx of data.transactions) {
    const current = allocations[tx.id]?.[0] ?? null;
    if (current?.source === 'manueel') continue;
    let next;
    if (mode === 'all' || !current || (fresh && fresh.has(tx.id))) {
      next = autoAllocation(tx, ctx);
    } else {
      const sys = systemAllocation(tx, ctx);
      if (sys) next = sys;
      else if (isSystemRule(current.ruleId)) next = { categoryId: null, source: 'geen', ruleId: null };
      else continue;
    }
    next = { ...next, amount: tx.amount };
    if (same(current, next)) continue;
    if (!copied) {
      allocations = { ...allocations };
      copied = true;
    }
    allocations[tx.id] = [next];
    changed++;
  }
  return { data: copied ? { ...data, allocations } : data, changed };
}

export function assignManual(data, txIds, categoryId) {
  if (categoryId !== null && !(data.categories ?? []).some((c) => c.id === categoryId)) throw new Error('Onbekende categorie.');
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const allocations = { ...data.allocations };
  for (const id of txIds) {
    const tx = byId.get(id);
    if (!tx) throw new Error(`Onbekende transactie ${id}`);
    allocations[id] = [{ categoryId, amount: tx.amount, source: 'manueel', ruleId: null }];
  }
  return { ...data, allocations };
}

/** Undo a manual choice: back to the automatic result. */
export function resetToAutomatic(data, txIds) {
  const ctx = makeContext(data);
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const allocations = { ...data.allocations };
  for (const id of txIds) {
    const tx = byId.get(id);
    if (tx) allocations[id] = [{ ...autoAllocation(tx, ctx), amount: tx.amount }];
  }
  return { ...data, allocations };
}

/**
 * Preview before saving a rule: how many transactions match its conditions,
 * and how many would actually get its category (taking manual choices,
 * internal transfers and earlier rules into account).
 */
export function rulePreview(data, rule) {
  const rules = [...(data.rules ?? [])];
  const i = rules.findIndex((r) => r.id === rule.id);
  if (i >= 0) rules[i] = rule;
  else rules.push(rule);
  const ctx = { ...makeContext(data), rules };
  let matching = 0;
  let applied = 0;
  for (const tx of data.transactions) {
    if (!ruleMatches(rule, tx)) continue;
    matching++;
    if (allocationOf(data, tx.id)?.source === 'manueel') continue;
    if (autoAllocation(tx, ctx).ruleId === rule.id) applied++;
  }
  return { matching, applied };
}
