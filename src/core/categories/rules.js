// Categorisation rules. All conditions of a rule must match; text comparison
// is case-insensitive. Rules are ordered: the first matching rule wins.
import { normalizeIban } from '../coda/parser.js';
import { communicationForDisplay } from '../csv/card.js';

const lower = (s) => String(s ?? '').toLowerCase();

export function emptyConditions() {
  return { counterpartyIban: null, nameContains: null, communicationContains: null, direction: null, minAbs: null, maxAbs: null, accountId: null };
}

export function ruleMatches(rule, tx) {
  if (rule.enabled === false) return false;
  const c = rule.conditions ?? {};
  let any = false;
  if (c.counterpartyIban) {
    any = true;
    if (normalizeIban(c.counterpartyIban) !== (tx.counterparty?.account ?? '')) return false;
  }
  if (c.nameContains) {
    any = true;
    if (!lower(tx.counterparty?.name).includes(lower(c.nameContains))) return false;
  }
  if (c.communicationContains) {
    any = true;
    const comm = `${communicationForDisplay(tx)} ${tx.communication?.structured ?? ''}`;
    if (!lower(comm).includes(lower(c.communicationContains))) return false;
  }
  if (c.direction) {
    any = true;
    if (c.direction === 'in' ? tx.amount <= 0 : tx.amount >= 0) return false;
  }
  const abs = tx.amount < 0 ? -tx.amount : tx.amount;
  if (c.minAbs !== null && c.minAbs !== undefined) {
    any = true;
    if (abs < c.minAbs) return false;
  }
  if (c.maxAbs !== null && c.maxAbs !== undefined) {
    any = true;
    if (abs > c.maxAbs) return false;
  }
  if (c.accountId) {
    any = true;
    if (tx.accountId !== c.accountId) return false;
  }
  return any; // a rule without conditions never matches
}

export function firstMatchingRule(rules, tx) {
  for (const r of rules) if (ruleMatches(r, tx)) return r;
  return null;
}

/** Conditions suggested from a transaction (the user can adjust them). */
export function suggestConditions(tx) {
  const c = emptyConditions();
  if (tx.counterparty?.account) c.counterpartyIban = tx.counterparty.account;
  else if (tx.counterparty?.name) c.nameContains = tx.counterparty.name;
  else if (tx.communication?.text) c.communicationContains = communicationForDisplay(tx).split('\n')[0].slice(0, 40);
  c.direction = tx.amount < 0 ? 'uit' : 'in';
  return c;
}

export function validateRule(rule, categories) {
  if (!rule.categoryId || !categories.some((c) => c.id === rule.categoryId)) throw new Error('Kies een geldige categorie voor de regel.');
  const c = rule.conditions ?? {};
  const hasAny = c.counterpartyIban || c.nameContains || c.communicationContains || c.direction || c.accountId || (c.minAbs !== null && c.minAbs !== undefined) || (c.maxAbs !== null && c.maxAbs !== undefined);
  if (!hasAny) throw new Error('Een regel heeft minstens één voorwaarde nodig.');
  if (c.minAbs !== null && c.minAbs !== undefined && c.maxAbs !== null && c.maxAbs !== undefined && c.minAbs > c.maxAbs) throw new Error('Het minimumbedrag is groter dan het maximum.');
  if (c.counterpartyIban && !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalizeIban(c.counterpartyIban))) throw new Error('Ongeldige IBAN in de regel.');
  return true;
}
