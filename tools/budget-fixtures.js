// Helpers for phase 3 tests: small synthetic datasets (fictitious IBANs).
import { createEmptyData } from '../src/core/model/schema.js';
import { categorize, assignManual } from '../src/core/categories/categorize.js';

export const ZICHT = 'BE00000000000001';
export const SPAAR = 'BE00000000000009';
export const JOINT = 'BE00000000000003';
export const EXTERNAL_SAVINGS = 'BE00000000000002';
export const CO_OWNER = 'BE00000000000011';

let n = 0;
export function tx(accountId, entryDate, amount, extra = {}) {
  n++;
  const { cp = '', name = '', bankType = null, ...rest } = extra;
  return {
    id: rest.id ?? `t${n}`,
    accountId,
    entryDate,
    amount,
    bookingOrder: n,
    currency: 'EUR',
    counterparty: { account: cp, name },
    communication: { text: rest.comm ?? '', structured: null },
    bankType,
    balanceAfter: null,
    ...rest,
  };
}

export function dataset(transactions, { categories = {}, accounts = null, extra = {} } = {}) {
  let d = {
    ...createEmptyData('2026-01-01T00:00:00.000Z'),
    accounts: accounts ?? {
      [ZICHT]: { id: ZICHT, number: ZICHT, displayName: 'Zicht', kind: 'zicht', currency: 'EUR', ownership: { type: 'individueel', owners: [] } },
      [SPAAR]: { id: SPAAR, number: SPAAR, displayName: 'Spaar', kind: 'spaar', currency: 'EUR', ownership: { type: 'individueel', owners: [] } },
      [JOINT]: { id: JOINT, number: JOINT, displayName: 'Gemeenschappelijk', kind: 'zicht', currency: 'EUR', ownership: { type: 'gemeenschappelijk', owners: ['Jan', 'An'] }, coOwnerIbans: [CO_OWNER] },
    },
    externalOwnAccounts: [{ iban: EXTERNAL_SAVINGS, name: 'Spaarboekje' }],
    transactions,
    ...extra,
  };
  d = categorize(d).data;
  for (const [categoryId, ids] of Object.entries(categories)) d = assignManual(d, ids, categoryId);
  return d;
}
