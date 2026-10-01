// Schema migrations. Each entry upgrades data from version N to N+1 and must
// be non-destructive: it may add collections or fields, never drop data.
// The application makes a backup of the data file before writing a migrated
// version (see AppService.load).

import { CURRENT_SCHEMA_VERSION, APP_ID } from './schema.js';
import { assignBookingOrder } from './booking-order.js';

export const MIGRATIONS = {
  // 1 -> 2: CSV support. Adds collections and per-transaction source fields,
  // and records the real booking order of existing CODA transactions.
  1: (d) => {
    const transactions = d.transactions.map((t) => ({
      ...t,
      source: 'coda',
      profileId: 'coda',
      bankType: null,
      balanceAfter: null,
      costs: null,
      exchangeRate: null,
      card: null,
    }));
    const accounts = {};
    for (const [id, a] of Object.entries(d.accounts)) {
      accounts[id] = { ...a, sourceFormat: 'coda', profileId: 'coda', bankAccountType: null };
    }
    return {
      ...d,
      schemaVersion: 2,
      accounts,
      transactions: assignBookingOrder(transactions, new Set(Object.keys(accounts))),
      imports: d.imports.map((i) => ({ format: 'coda', profileId: 'coda', enrichedTransactions: 0, possibleDuplicates: 0, ...i })),
      profiles: d.profiles ?? [],
      balanceSnapshots: d.balanceSnapshots ?? {},
      controlBalances: d.controlBalances ?? {},
      possibleDuplicates: d.possibleDuplicates ?? [],
      removedTransactions: d.removedTransactions ?? {},
      annotations: d.annotations ?? {},
    };
  },
};

export class DataFileError extends Error {}

export function migrate(input, { migrations = MIGRATIONS, target = CURRENT_SCHEMA_VERSION } = {}) {
  validateShape(input);
  let data = input;
  const applied = [];
  if (data.schemaVersion > target) {
    throw new DataFileError(
      `Het databestand heeft schemaversie ${data.schemaVersion}, deze app kent maximaal versie ${target}. Gebruik een nieuwere versie van de app.`,
    );
  }
  while (data.schemaVersion < target) {
    const step = migrations[data.schemaVersion];
    if (!step) throw new DataFileError(`Geen migratie beschikbaar van schemaversie ${data.schemaVersion}.`);
    const from = data.schemaVersion;
    data = step(data);
    if (data.schemaVersion !== from + 1) throw new DataFileError(`Migratie ${from} gaf geen versie ${from + 1}.`);
    applied.push(`${from}→${from + 1}`);
  }
  return { data, applied };
}

export function validateShape(data) {
  if (!data || typeof data !== 'object') throw new DataFileError('Het databestand is geen geldig JSON-object.');
  if (data.app !== APP_ID) throw new DataFileError('Dit is geen databestand van deze app.');
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
    throw new DataFileError('Het databestand heeft geen geldige schemaVersion.');
  }
  for (const key of ['accounts', 'statements', 'fileHashes']) {
    if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) {
      throw new DataFileError(`Onderdeel "${key}" ontbreekt of is ongeldig.`);
    }
  }
  for (const key of ['transactions', 'imports']) {
    if (!Array.isArray(data[key])) throw new DataFileError(`Onderdeel "${key}" ontbreekt of is ongeldig.`);
  }
  for (const t of data.transactions) {
    if (!Number.isSafeInteger(t.amount)) throw new DataFileError(`Transactie ${t.id} heeft een ongeldig bedrag.`);
    if (t.balanceAfter !== undefined && t.balanceAfter !== null && !Number.isSafeInteger(t.balanceAfter)) {
      throw new DataFileError(`Transactie ${t.id} heeft een ongeldig saldo.`);
    }
  }
}

export function parseDataFile(text, options) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new DataFileError(`Het databestand is geen geldige JSON: ${e.message}`);
  }
  return migrate(json, options);
}

export function serializeData(data) {
  return JSON.stringify(data);
}
