// Schema migrations. Each entry upgrades data from version N to N+1 and must
// be non-destructive: it may add collections or fields, never drop data.
// The application makes a backup of the data file before writing a migrated
// version (see AppService.load).

import { CURRENT_SCHEMA_VERSION, APP_ID } from './schema.js';
import { assignBookingOrder } from './booking-order.js';
import { defaultCategories, defaultBudgetType, contributionCategories, SYSTEM_CONTRIBUTION, REFUNDS_NAME, FRIENDS_REFUND } from '../categories/defaults.js';
import { deleteCategory } from '../categories/categories.js';
import { defaultBudgetSettings, defaultWealthSettings } from './schema.js';
import { categorize } from '../categories/categorize.js';
import { repairRecurring } from '../budget/recurring.js';

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
  // 2 -> 3: phase 2 (categories, rules, internal transfers).
  // Every transaction gets an allocation ('geen', or the internal-transfer category).
  2: (d) => {
    const next = {
      ...d,
      schemaVersion: 3,
      categories: d.categories ?? defaultCategories(),
      allocations: d.allocations ?? {},
      rules: d.rules ?? [],
      externalOwnAccounts: d.externalOwnAccounts ?? [],
    };
    return categorize(next, { mode: 'all' }).data;
  },
  // 3 -> 4: phase 3 (budgets, recurring payments, alerts, forecast).
  3: (d) => ({
    ...d,
    schemaVersion: 4,
    categories: d.categories.map((c) => (c.budgetType ? c : { ...c, budgetType: defaultBudgetType(c) })),
    budget: d.budget ?? defaultBudgetSettings(),
    recurring: d.recurring ?? [],
    alerts: d.alerts ?? [],
    plannedItems: d.plannedItems ?? [],
  }),
  // 4 -> 5: phase 4 (mortgage loans, net worth).
  4: (d) => ({
    ...d,
    schemaVersion: 5,
    loans: d.loans ?? [],
    properties: d.properties ?? [],
    otherAssets: d.otherAssets ?? [],
    otherLiabilities: d.otherLiabilities ?? [],
    wealth: d.wealth ?? defaultWealthSettings(),
  }),
  // 5 -> 6: contributions to the joint account count as expense (individual
  // account) and income (joint account); the contribution of the co-owner
  // becomes income. Manual choices are kept.
  5: (d) => {
    const existing = new Set(d.categories.map((c) => c.id));
    const categories = [
      ...d.categories.map((c) => (c.id === SYSTEM_CONTRIBUTION ? { ...c, kind: 'inkomst' } : c)),
      ...contributionCategories().filter((c) => !existing.has(c.id)),
    ];
    return { ...categorize({ ...d, schemaVersion: 6, categories }, { mode: 'import' }).data };
  },
  // 6 -> 7: repair recurring series that shared an id (see repairRecurring).
  6: (d) => ({ ...d, schemaVersion: 7, recurring: repairRecurring(d.recurring) }),
  // 7 -> 8: category review. "Terugbetaling vrienden & familie" (income) is
  // added, "Terugbetalingen" gets a clearer name (only if not renamed by the
  // user), and "Voorschotten" is removed: its transactions become
  // uncategorised (refunds can now be linked to the expense), its rules go.
  7: (d) => {
    let data = { ...d, schemaVersion: 8 };
    let categories = data.categories.map((c) => (c.id === 'inkomen--terugbetalingen' && c.name === 'Terugbetalingen' ? { ...c, name: REFUNDS_NAME } : c));
    if (!categories.some((c) => c.id === FRIENDS_REFUND) && categories.some((c) => c.id === 'inkomen')) {
      const cat = { id: FRIENDS_REFUND, name: 'Terugbetaling vrienden & familie', parentId: 'inkomen', kind: 'inkomst', system: false };
      categories.push({ ...cat, budgetType: defaultBudgetType(cat) });
    }
    data = { ...data, categories };
    const voorschotten = categories.find((c) => c.id === 'voorschotten' && !c.system);
    if (voorschotten) {
      data = deleteCategory(data, 'voorschotten', null).data;
      for (const [k, v] of Object.entries(data.budget?.perspectives ?? {})) {
        const budgets = Object.fromEntries(Object.entries(v.budgets ?? {}).filter(([id]) => id !== 'voorschotten' && !id.startsWith('voorschotten--')));
        data = { ...data, budget: { ...data.budget, perspectives: { ...data.budget.perspectives, [k]: { ...v, budgets } } } };
      }
    }
    return data;
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
