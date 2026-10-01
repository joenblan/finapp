// Data file layout (financien-data.json). See README for a description.
// Bank facts (accounts from CODA, statements, transactions) are immutable once
// imported; user settings live on the account object. Later phases add their
// own top-level collections through migrations (e.g. `annotations` keyed by
// transaction id for categories / splits), so bank data never has to change.

export const CURRENT_SCHEMA_VERSION = 1;
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
    accounts: {}, // keyed by account number (IBAN)
    statements: {}, // keyed by statement id
    transactions: [], // array of transaction objects, unique by id
    imports: [], // import history, oldest first
    fileHashes: {}, // sha256 -> import id, for successfully imported files
  };
}

export const ACCOUNT_KINDS = ['zicht', 'spaar'];
export const OWNERSHIP_TYPES = ['individueel', 'gemeenschappelijk'];
