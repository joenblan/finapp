import { defaultCategories } from '../categories/defaults.js';

// Data file layout (financien-data.json). See README for a description.
// Bank facts (statements, transactions) are never overwritten once imported;
// empty fields may be completed by a later import of the same movement.
// User data lives in separate collections (`annotations`, account settings,
// control balances) so that an import can never touch it.

export const CURRENT_SCHEMA_VERSION = 5;
export const APP_ID = 'financien';

export function createEmptyData(now = new Date().toISOString()) {
  return {
    app: APP_ID,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    settings: {
      backupRetention: 30,
    },
    accounts: {}, // keyed by account number (IBAN, no spaces)
    statements: {}, // CODA statements, keyed by statement id
    transactions: [], // unique by id; `bookingOrder` = real booking order per account
    imports: [], // import history, oldest first
    fileHashes: {}, // sha256 -> import id, for successfully imported files
    // since schema 2:
    profiles: [], // user-defined CSV profiles (built-in profiles live in the code)
    balanceSnapshots: {}, // accountId -> [{ at, balance, importId }] (balance reported by the bank in an export)
    controlBalances: {}, // accountId -> [{ id, date, balance, note, createdAt }] (entered by the user)
    possibleDuplicates: [], // [{ id, txId, matchIds, status: 'open'|'behouden'|'verwijderd', createdAt, resolvedAt }]
    removedTransactions: {}, // txId -> { transaction, removedAt, reason } (never re-imported)
    annotations: {}, // txId -> user flags (e.g. currencyChecked, notInternal)
    // since schema 3 (phase 2):
    categories: defaultCategories(), // [{ id, name, parentId, kind: 'inkomst'|'uitgave'|'neutraal', system }]
    allocations: {}, // txId -> [{ categoryId, amount, source: 'manueel'|'regel'|'geen', ruleId }]
    rules: [], // ordered; first match wins
    externalOwnAccounts: [], // [{ iban, name }] own accounts without imported data
    // since schema 4 (phase 3):
    budget: defaultBudgetSettings(),
    recurring: [], // recurring payment series: proposals, confirmed and rejected
    alerts: [], // warnings (price increase, new series, missed payment, stopped series)
    plannedItems: [], // one-off expected items for the forecast [{ id, date, amount, accountId, description }]
    // since schema 5 (phase 4):
    loans: [], // mortgage loans with tranches (see core/loans)
    properties: [], // homes: [{ id, name, owners: [{ name, share (basis points) }], valuations: [{ date, value }] }]
    otherAssets: [], // [{ id, name, owners, values: [{ date, value }] }]
    otherLiabilities: [], // [{ id, name, owners, values: [{ date, value }] }]
    wealth: defaultWealthSettings(),
  };
}

export function defaultWealthSettings() {
  return {
    myName: null, // which owner / borrower is "me" (personal perspective)
    jointShares: {}, // joint accountId -> my share in basis points (default 5000 = 50 %)
  };
}

export function defaultBudgetSettings() {
  return {
    perspectives: {
      persoonlijk: { periodMode: 'loon', budgets: {}, plannedSavings: 0 },
      gemeenschappelijk: { periodMode: 'kalender', budgets: {}, plannedSavings: 0 },
    },
    fallbackStartDay: 'laatste', // salary period start when no salary is known: 'laatste' or 1-31
    amountTolerancePct: 10, // recurring detection: allowed amount variation
    priceIncreasePct: 5, // alert: price increase above 5 % ...
    priceIncreaseMin: 1000, // ... and at least € 1 (milli)
    missedGraceDays: 5, // alert: expected payment not seen 5 days after its date
    forecastVariable: 'gemiddelde', // 'gemiddelde' (last 3 periods) | 'budget'
    minBalance: {}, // accountId -> milli (default 0)
  };
}

export const ACCOUNT_KINDS = ['zicht', 'spaar'];
export const OWNERSHIP_TYPES = ['individueel', 'gemeenschappelijk'];
