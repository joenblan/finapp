import { defaultCategories } from '../categories/defaults.js';

// Data file layout (financien-data.json). See README for a description.
// Bank facts (statements, transactions) are never overwritten once imported;
// empty fields may be completed by a later import of the same movement.
// User data lives in separate collections (`annotations`, account settings,
// control balances) so that an import can never touch it.

export const CURRENT_SCHEMA_VERSION = 3;
export const APP_ID = 'financien';

export function createEmptyData(now = new Date().toISOString()) {
  return {
    app: APP_ID,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    settings: {
      backupRetention: 30,
      myName: null, // which co-owner of a joint account is "me" (since schema 3)
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
    jointMarks: {}, // txId -> { type: 'voorschot'|'terugbetaling', jointAccountId, person, linkedTo: [txId] }
  };
}

export const ACCOUNT_KINDS = ['zicht', 'spaar'];
export const OWNERSHIP_TYPES = ['individueel', 'gemeenschappelijk'];
