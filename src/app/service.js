// Application service: orchestrates storage + pure core logic. No DOM.
// All mutating operations run one at a time through a queue, and the data file
// is written after every change.

import { createEmptyData, ACCOUNT_KINDS, OWNERSHIP_TYPES } from '../core/model/schema.js';
import { parseDataFile, serializeData, DataFileError } from '../core/model/migrations.js';
import { importFile } from '../core/import/importer.js';
import { formatReportText } from '../core/report.js';
import { sha256Hex } from '../core/hash.js';
import { validateProfile } from '../core/csv/profile-check.js';
import { normalizeIban } from '../core/coda/parser.js';
import * as cats from '../core/categories/categories.js';
import { categorize, assignManual, resetToAutomatic } from '../core/categories/categorize.js';
import { validateRule } from '../core/categories/rules.js';
import { syncRecurring, makeManualSeries, INTERVALS } from '../core/budget/recurring.js';
import { syncAlerts } from '../core/budget/alerts.js';
import { BUDGET_TYPES } from '../core/categories/categories.js';
import { linkSeriesToLoans } from '../core/loans/budget-link.js';
import { validateLoan } from '../core/loans/loans.js';
import { loanSchedule } from '../core/loans/schedule.js';
import { feeFor } from '../core/loans/simulate.js';

export class AppService {
  constructor(store, { now = () => new Date().toISOString() } = {}) {
    this.store = store;
    this.now = now;
    this.data = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.lastMigration = [];
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.data);
  }

  /** Serialize all operations that touch data or files. */
  run(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  load() {
    return this.run(async () => {
      await this.store.init();
      const text = await this.store.readData();
      if (text === null) {
        this.data = createEmptyData(this.now());
        await this.store.writeData(serializeData(this.data));
      } else {
        const { data, applied } = parseDataFile(text);
        if (applied.length) {
          // Keep the pre-migration file before writing the migrated version.
          await this.store.backup(this.now(), this.retention(data), 'vóór migratie');
          this.data = data;
          await this.store.writeData(serializeData(this.data));
        } else {
          this.data = data;
        }
        this.lastMigration = applied;
      }
      this.emit();
      return this.data;
    });
  }

  retention(data = this.data) {
    const n = data?.settings?.backupRetention;
    return Number.isInteger(n) && n > 0 ? n : 30;
  }

  async save() {
    this.data = { ...this.data, updatedAt: this.now() };
    await this.store.writeData(serializeData(this.data));
    this.emit();
  }

  /** Import all files in inbox/. Successful files go to archief/, failed ones to fout/. */
  scanInbox() {
    return this.run(async () => {
      const names = await this.store.listInbox();
      if (!names.length) return [];
      const files = [];
      for (const name of names) files.push({ name, bytes: await this.store.readInboxFile(name) });
      return this.#importBatch(files, 'inbox');
    });
  }

  /** Import files chosen by upload or drag-and-drop. */
  importUploads(files, { profileId = null } = {}) {
    return this.run(() => this.#importBatch(files, 'upload', profileId));
  }

  async #importBatch(files, source, profileId = null) {
    await this.store.backup(this.now(), this.retention(), 'vóór import');
    const results = [];
    let data = this.data;
    for (const f of files) {
      const fileHash = await sha256Hex(f.bytes);
      const { data: next, report } = importFile(data, { fileName: f.name, bytes: f.bytes, fileHash, source, now: this.now(), profileId });
      data = next;
      results.push({ file: f, report });
    }
    // Phase 3: update recurring series and alerts with the new transactions.
    if (results.some((r) => r.report.newTransactions || r.report.enrichedTransactions)) data = this.refreshBudget(data);
    // Write the data file first; only then move files. If the app stops in
    // between, the next scan recognises the files by hash and skips them.
    this.data = data;
    await this.save();
    for (const { file, report } of results) {
      const failed = report.status === 'fout';
      const reportText = failed ? formatReportText(report) : null;
      if (source === 'inbox') {
        await this.store.moveFromInbox(file.name, file.bytes, failed ? 'error' : 'archive', reportText);
      } else if (report.status !== 'overgeslagen') {
        await this.store.keepUpload(file.name, file.bytes, failed ? 'error' : 'archive', reportText);
      }
    }
    return results.map((r) => r.report);
  }

  updateAccount(id, patch) {
    return this.run(async () => {
      const acc = this.data.accounts[id];
      if (!acc) throw new Error(`Onbekende rekening ${id}`);
      const next = { ...acc };
      if (patch.displayName !== undefined) {
        const name = String(patch.displayName).trim();
        if (!name) throw new Error('De weergavenaam mag niet leeg zijn.');
        next.displayName = name;
      }
      if (patch.kind !== undefined) {
        if (!ACCOUNT_KINDS.includes(patch.kind)) throw new Error(`Ongeldig type: ${patch.kind}`);
        next.kind = patch.kind;
      }
      if (patch.ownership !== undefined) {
        const { type, owners = [] } = patch.ownership;
        if (!OWNERSHIP_TYPES.includes(type)) throw new Error(`Ongeldig eigendom: ${type}`);
        const clean = owners.map((o) => String(o).trim()).filter(Boolean);
        if (type === 'gemeenschappelijk' && clean.length < 2) {
          throw new Error('Geef voor een gemeenschappelijke rekening minstens twee mede-eigenaars op.');
        }
        next.ownership = { type, owners: type === 'gemeenschappelijk' ? clean : [] };
      }
      if (patch.ownershipConfirmed === true) next.ownershipConfirmed = true;
      this.data = { ...this.data, accounts: { ...this.data.accounts, [id]: next } };
      // individual <-> joint changes which transfers are contributions (expense / income)
      if (patch.ownership !== undefined) this.data = categorize(this.data, { mode: 'import' }).data;
      await this.save();
    });
  }

  addControlBalance(accountId, { date, balance, note = '' }) {
    return this.run(async () => {
      if (!this.data.accounts[accountId]) throw new Error(`Onbekende rekening ${accountId}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Geef een geldige datum op.');
      if (!Number.isSafeInteger(balance)) throw new Error('Geef een geldig saldo op.');
      const list = this.data.controlBalances?.[accountId] ?? [];
      if (list.some((c) => c.date === date)) throw new Error('Er bestaat al een controlesaldo op die datum.');
      const entry = { id: `cb-${date}-${Math.random().toString(36).slice(2, 6)}`, date, balance, note: String(note).trim(), createdAt: this.now() };
      this.data = { ...this.data, controlBalances: { ...this.data.controlBalances, [accountId]: [...list, entry] } };
      await this.save();
    });
  }

  removeControlBalance(accountId, id) {
    return this.run(async () => {
      const list = (this.data.controlBalances?.[accountId] ?? []).filter((c) => c.id !== id);
      this.data = { ...this.data, controlBalances: { ...this.data.controlBalances, [accountId]: list } };
      await this.save();
    });
  }

  /**
   * Resolve a possible duplicate: 'behouden' keeps the movement,
   * 'verwijderd' moves it to removedTransactions (it will never be re-imported;
   * annotations are kept).
   */
  resolvePossibleDuplicate(id, decision) {
    return this.run(async () => {
      if (decision !== 'behouden' && decision !== 'verwijderd') throw new Error(`Ongeldige beslissing ${decision}`);
      const item = this.data.possibleDuplicates.find((p) => p.id === id);
      if (!item) throw new Error('Onbekend item.');
      if (item.status !== 'open') throw new Error('Dit item werd al afgehandeld.');
      const now = this.now();
      let { transactions, removedTransactions } = this.data;
      if (decision === 'verwijderd') {
        await this.store.backup(now, this.retention(), 'vóór verwijderen');
        const tx = transactions.find((t) => t.id === item.txId);
        if (tx) {
          transactions = transactions.filter((t) => t.id !== item.txId);
          removedTransactions = { ...removedTransactions, [tx.id]: { transaction: tx, removedAt: now, reason: 'mogelijke dubbel' } };
        }
      }
      const possibleDuplicates = this.data.possibleDuplicates.map((p) => (p.id === id ? { ...p, status: decision, resolvedAt: now } : p));
      this.data = { ...this.data, transactions, removedTransactions, possibleDuplicates };
      await this.save();
    });
  }

  /** "Andere munt": the user has seen this movement (stored as user data in annotations). */
  markCurrencyChecked(txId) {
    return this.run(async () => {
      const tx = this.data.transactions.find((t) => t.id === txId);
      if (!tx || !tx.foreignCurrency) throw new Error('Onbekende beweging.');
      const current = this.data.annotations?.[txId] ?? {};
      this.data = { ...this.data, annotations: { ...this.data.annotations, [txId]: { ...current, currencyChecked: true } } };
      await this.save();
    });
  }

  /** Confirm type and ownership of a newly created account. */
  confirmAccount(id, patch) {
    return this.updateAccount(id, { ...patch, ownershipConfirmed: true });
  }

  // ---- Phase 2 -------------------------------------------------------------

  /** Apply a pure change to the data and save. */
  mutate(fn) {
    return this.run(async () => {
      const result = fn(this.data);
      this.data = result.data ?? result;
      await this.save();
      return result;
    });
  }

  assignCategory(txIds, categoryId) {
    return this.mutate((d) => assignManual(d, txIds, categoryId));
  }

  resetCategory(txIds) {
    return this.mutate((d) => resetToAutomatic(d, txIds));
  }

  addCategory(input) {
    return this.mutate((d) => cats.addCategory(d, input));
  }

  updateCategory(id, patch) {
    return this.mutate((d) => cats.updateCategory(d, id, patch));
  }

  deleteCategory(id, targetId) {
    return this.mutate((d) => cats.deleteCategory(d, id, targetId));
  }

  mergeCategory(sourceId, targetId) {
    return this.mutate((d) => cats.mergeCategory(d, sourceId, targetId));
  }

  /** Insert or update a rule. New rules go to the end unless `position` is given. */
  saveRule(rule, { apply = false } = {}) {
    return this.mutate((d) => {
      validateRule(rule, d.categories);
      const clean = {
        id: rule.id ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: String(rule.name ?? '').trim(),
        categoryId: rule.categoryId,
        enabled: rule.enabled !== false,
        conditions: { ...rule.conditions, counterpartyIban: rule.conditions.counterpartyIban ? normalizeIban(rule.conditions.counterpartyIban) : null },
      };
      const rules = [...d.rules];
      const i = rules.findIndex((r) => r.id === clean.id);
      if (i >= 0) rules[i] = clean;
      else rules.push(clean);
      const next = { ...d, rules };
      return apply ? { ...categorize(next, { mode: 'all' }), rule: clean } : { data: next, rule: clean };
    });
  }

  deleteRule(id) {
    return this.mutate((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== id) }));
  }

  moveRule(id, delta) {
    return this.mutate((d) => {
      const rules = [...d.rules];
      const i = rules.findIndex((r) => r.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= rules.length) return d;
      [rules[i], rules[j]] = [rules[j], rules[i]];
      return { ...d, rules };
    });
  }

  /** "Regels opnieuw toepassen": every non-manual transaction. */
  reapplyRules() {
    return this.mutate((d) => categorize(d, { mode: 'all' }));
  }

  setExternalOwnAccounts(list) {
    return this.mutate((d) => {
      const seen = new Set();
      const clean = [];
      for (const e of list) {
        const iban = normalizeIban(e.iban);
        if (!iban) continue;
        if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) throw new Error(`Ongeldige IBAN: ${e.iban}`);
        if (seen.has(iban)) continue;
        seen.add(iban);
        clean.push({ iban, name: String(e.name ?? '').trim() });
      }
      return categorize({ ...d, externalOwnAccounts: clean }, { mode: 'import', newIds: [] });
    });
  }

  setCoOwnerIbans(accountId, ibans) {
    return this.mutate((d) => {
      const acc = d.accounts[accountId];
      if (!acc) throw new Error('Onbekende rekening.');
      const clean = [...new Set(ibans.map(normalizeIban).filter(Boolean))];
      for (const i of clean) if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(i)) throw new Error(`Ongeldige IBAN: ${i}`);
      const next = { ...d, accounts: { ...d.accounts, [accountId]: { ...acc, coOwnerIbans: clean } } };
      return categorize(next, { mode: 'import', newIds: [] });
    });
  }

  /** Undo (or restore) "interne overboeking" for one transaction. */
  setNotInternal(txId, notInternal) {
    return this.mutate((d) => {
      const current = d.annotations?.[txId] ?? {};
      const { notInternal: _drop, ...rest } = current;
      const annotations = { ...d.annotations, [txId]: notInternal ? { ...rest, notInternal: true } : rest };
      return categorize({ ...d, annotations }, { mode: 'import', newIds: [txId] });
    });
  }

  // ---- Phase 3 -------------------------------------------------------------

  refreshBudget(data) {
    return syncAlerts(linkSeriesToLoans(syncRecurring(data, { now: this.now() })), this.now());
  }

  recalculateRecurring() {
    return this.mutate((d) => this.refreshBudget(d));
  }

  #updateSeries(id, fn) {
    return this.mutate((d) => {
      const s = d.recurring.find((r) => r.id === id);
      if (!s) throw new Error('Onbekende reeks.');
      const next = fn(s);
      return this.refreshBudget({ ...d, recurring: d.recurring.map((r) => (r.id === id ? { ...next, updatedAt: this.now() } : r)) });
    });
  }

  confirmRecurring(id) {
    return this.#updateSeries(id, (s) => ({ ...s, status: 'bevestigd' }));
  }

  /** A rejected proposal stays rejected: the same series is never proposed again. */
  rejectRecurring(id) {
    return this.#updateSeries(id, (s) => ({ ...s, status: 'geweigerd' }));
  }

  /** Adjust interval, day, expected amount or category (the adjusted values are kept). */
  adjustRecurring(id, patch) {
    return this.#updateSeries(id, (s) => {
      const next = { ...s, locked: { ...(s.locked ?? {}) } };
      if (patch.interval !== undefined) {
        if (!INTERVALS[patch.interval]) throw new Error('Ongeldig interval.');
        next.interval = patch.interval;
        next.key = `${s.group}|${patch.interval}`;
      }
      if (patch.day !== undefined && patch.day !== null) {
        const day = Number(patch.day);
        if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('Ongeldige dag (1-31).');
        next.day = day;
      }
      if (patch.expectedAmount !== undefined) {
        if (!Number.isSafeInteger(patch.expectedAmount) || patch.expectedAmount === 0) throw new Error('Ongeldig bedrag.');
        next.expectedAmount = patch.expectedAmount;
        next.locked.amount = true;
      }
      if (patch.categoryId !== undefined) {
        next.categoryId = patch.categoryId;
        next.locked.category = true;
      }
      return next;
    });
  }

  addManualRecurring(input) {
    return this.mutate((d) => this.refreshBudget({ ...d, recurring: [...d.recurring, makeManualSeries(d, input, this.now())] }));
  }

  deleteRecurring(id) {
    return this.mutate((d) => {
      const s = d.recurring.find((r) => r.id === id);
      if (!s || s.origin !== 'manueel') throw new Error('Enkel manueel toegevoegde reeksen kunnen verwijderd worden; weiger een gedetecteerde reeks.');
      return this.refreshBudget({ ...d, recurring: d.recurring.filter((r) => r.id !== id) });
    });
  }

  dismissAlert(id) {
    return this.mutate((d) => ({ ...d, alerts: d.alerts.map((a) => (a.id === id ? { ...a, dismissedAt: this.now() } : a)) }));
  }

  /** Budget settings: perspective-level (periodMode, plannedSavings, budgets) or global (thresholds). */
  updateBudgetSettings(patch, perspective = null) {
    return this.mutate((d) => {
      const budget = structuredClone(d.budget);
      if (perspective) {
        const p = budget.perspectives[perspective];
        if (!p) throw new Error('Onbekend perspectief.');
        if (patch.periodMode !== undefined) {
          if (!['loon', 'kalender'].includes(patch.periodMode)) throw new Error('Ongeldige periode.');
          p.periodMode = patch.periodMode;
        }
        if (patch.plannedSavings !== undefined) {
          if (!Number.isSafeInteger(patch.plannedSavings) || patch.plannedSavings < 0) throw new Error('Ongeldig spaarbedrag.');
          p.plannedSavings = patch.plannedSavings;
        }
        if (patch.budget !== undefined) {
          const { categoryId, amount } = patch.budget;
          if (amount === null) delete p.budgets[categoryId];
          else {
            if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Ongeldig budget.');
            p.budgets[categoryId] = amount;
          }
        }
      } else {
        const ints = { amountTolerancePct: [1, 50], priceIncreasePct: [0, 100], priceIncreaseMin: [0, 1e9], missedGraceDays: [0, 60] };
        for (const [k, [min, max]] of Object.entries(ints)) {
          if (patch[k] === undefined) continue;
          if (!Number.isInteger(patch[k]) || patch[k] < min || patch[k] > max) throw new Error(`Ongeldige waarde voor ${k}.`);
          budget[k] = patch[k];
        }
        if (patch.fallbackStartDay !== undefined) {
          const v = patch.fallbackStartDay;
          if (v !== 'laatste' && !(Number.isInteger(v) && v >= 1 && v <= 31)) throw new Error('Ongeldige startdag.');
          budget.fallbackStartDay = v;
        }
        if (patch.forecastVariable !== undefined) {
          if (!['gemiddelde', 'budget'].includes(patch.forecastVariable)) throw new Error('Ongeldige keuze.');
          budget.forecastVariable = patch.forecastVariable;
        }
        if (patch.minBalance !== undefined) {
          const { accountId, amount } = patch.minBalance;
          if (!Number.isSafeInteger(amount)) throw new Error('Ongeldig minimumsaldo.');
          budget.minBalance = { ...budget.minBalance, [accountId]: amount };
        }
      }
      const next = { ...d, budget };
      return patch.amountTolerancePct !== undefined || patch.priceIncreasePct !== undefined || patch.priceIncreaseMin !== undefined || patch.missedGraceDays !== undefined ? this.refreshBudget(next) : next;
    });
  }

  setCategoryBudgetType(id, budgetType) {
    if (!BUDGET_TYPES.includes(budgetType)) return Promise.reject(new Error('Ongeldig budgettype.'));
    return this.mutate((d) => cats.updateCategory(d, id, { budgetType }));
  }

  addPlannedItem({ date, amount, accountId, description }) {
    return this.mutate((d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Geef een datum op.');
      if (!Number.isSafeInteger(amount) || amount === 0) throw new Error('Geef een bedrag op (negatief = uitgave).');
      if (!d.accounts[accountId]) throw new Error('Kies een rekening.');
      const item = { id: `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, date, amount, accountId, description: String(description ?? '').trim() || 'Verwachte post' };
      return { ...d, plannedItems: [...d.plannedItems, item] };
    });
  }

  removePlannedItem(id) {
    return this.mutate((d) => ({ ...d, plannedItems: d.plannedItems.filter((p) => p.id !== id) }));
  }

  // ---- Phase 4 -------------------------------------------------------------

  #id(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  #updateLoan(id, fn, { refresh = true } = {}) {
    return this.mutate((d) => {
      const loan = d.loans.find((l) => l.id === id);
      if (!loan) throw new Error('Onbekende lening.');
      const next = { ...fn(loan), updatedAt: this.now() };
      const errors = validateLoan(d, next);
      if (errors.length) throw new Error(errors.join(' '));
      loanSchedule(next); // throws on an impossible table
      const data = { ...d, loans: d.loans.map((l) => (l.id === id ? next : l)) };
      return refresh ? this.refreshBudget(data) : data;
    });
  }

  /** Create or replace a loan (status 'concept' until confirmed). */
  saveLoan(loan) {
    return this.mutate((d) => {
      const errors = validateLoan(d, loan);
      if (errors.length) throw new Error(errors.join(' '));
      loanSchedule(loan);
      const existing = d.loans.find((l) => l.id === loan.id);
      const next = existing
        ? { ...existing, ...loan, updatedAt: this.now() }
        : { checkpoints: [], extraPayments: [], paymentLinks: {}, borrowers: [], ...loan, id: this.#id('lening'), status: loan.status ?? 'concept', createdAt: this.now() };
      next.tranches = next.tranches.map((t) => ({ ...t, id: t.id ?? this.#id('dk') }));
      const loans = existing ? d.loans.map((l) => (l.id === loan.id ? next : l)) : [...d.loans, next];
      return this.refreshBudget({ ...d, loans });
    });
  }

  confirmLoan(id, confirmed = true) {
    return this.#updateLoan(id, (l) => ({ ...l, status: confirmed ? 'bevestigd' : 'concept' }));
  }

  deleteLoan(id) {
    return this.mutate((d) => this.refreshBudget({ ...d, loans: d.loans.filter((l) => l.id !== id) }));
  }

  /** link: { txIds: [...] } | { none: true } | null (automatic again). */
  setPaymentLink(loanId, dueDate, link) {
    return this.#updateLoan(loanId, (l) => {
      const paymentLinks = { ...(l.paymentLinks ?? {}) };
      if (link) paymentLinks[dueDate] = link;
      else delete paymentLinks[dueDate];
      return { ...l, paymentLinks };
    });
  }

  addCheckpoint(loanId, { date, trancheId = null, balance }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return Promise.reject(new Error('Geef een datum op.'));
    if (!Number.isSafeInteger(balance) || balance < 0) return Promise.reject(new Error('Geef het openstaande saldo op.'));
    return this.#updateLoan(loanId, (l) => ({ ...l, checkpoints: [...(l.checkpoints ?? []), { id: this.#id('cp'), date, trancheId, balance }] }), { refresh: false });
  }

  removeCheckpoint(loanId, id) {
    return this.#updateLoan(loanId, (l) => ({ ...l, checkpoints: l.checkpoints.filter((c) => c.id !== id) }), { refresh: false });
  }

  /** Register a done extra repayment: the table is recalculated from that date. */
  addExtraPayment(loanId, { date, trancheId, amount, mode, fee }) {
    return this.#updateLoan(loanId, (l) => {
      const tranche = l.tranches.find((t) => t.id === trancheId);
      if (!tranche) throw new Error('Kies een deelkrediet.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Geef een datum op.');
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Geef een geldig bedrag op.');
      if (!['korter', 'lager'].includes(mode)) throw new Error('Kies kortere looptijd of lagere maandlast.');
      return { ...l, extraPayments: [...(l.extraPayments ?? []), { id: this.#id('extra'), date, trancheId, amount, mode, fee: fee ?? null, feeAmount: fee ? feeFor(tranche, amount, fee) : 0 }] };
    });
  }

  removeExtraPayment(loanId, id) {
    return this.#updateLoan(loanId, (l) => ({ ...l, extraPayments: l.extraPayments.filter((x) => x.id !== id) }));
  }

  #validateOwners(owners) {
    if (owners?.length && owners.reduce((a, o) => a + o.share, 0) !== 10000) throw new Error('De aandelen van de eigenaars moeten samen 100 % zijn.');
    for (const o of owners ?? []) if (!String(o.name ?? '').trim()) throw new Error('Geef elke eigenaar een naam.');
  }

  /** list: 'properties' | 'otherAssets' | 'otherLiabilities' */
  saveWealthItem(list, item) {
    if (!['properties', 'otherAssets', 'otherLiabilities'].includes(list)) return Promise.reject(new Error('Onbekende lijst.'));
    return this.mutate((d) => {
      if (!String(item.name ?? '').trim()) throw new Error('Geef een naam op.');
      this.#validateOwners(item.owners);
      const valuesKey = list === 'properties' ? 'valuations' : 'values';
      const existing = d[list].find((x) => x.id === item.id);
      const next = existing ? { ...existing, ...item } : { owners: [], [valuesKey]: [], ...item, id: this.#id(list === 'properties' ? 'woning' : 'item') };
      return { ...d, [list]: existing ? d[list].map((x) => (x.id === item.id ? next : x)) : [...d[list], next] };
    });
  }

  deleteWealthItem(list, id) {
    return this.mutate((d) => ({ ...d, [list]: d[list].filter((x) => x.id !== id) }));
  }

  /** A valuation (home) or value (other item) on a date; replaces the one of the same date. */
  addWealthValue(list, id, { date, value }) {
    return this.mutate((d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Geef een datum op.');
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Geef een geldige waarde op.');
      const key = list === 'properties' ? 'valuations' : 'values';
      return { ...d, [list]: d[list].map((x) => (x.id === id ? { ...x, [key]: [...x[key].filter((v) => v.date !== date), { date, value }].sort((a, b) => a.date.localeCompare(b.date)) } : x)) };
    });
  }

  removeWealthValue(list, id, date) {
    const key = list === 'properties' ? 'valuations' : 'values';
    return this.mutate((d) => ({ ...d, [list]: d[list].map((x) => (x.id === id ? { ...x, [key]: x[key].filter((v) => v.date !== date) } : x)) }));
  }

  updateWealthSettings(patch) {
    return this.mutate((d) => {
      const wealth = { ...d.wealth, ...patch };
      for (const v of Object.values(wealth.jointShares ?? {})) if (!Number.isInteger(v) || v < 0 || v > 10000) throw new Error('Aandeel moet tussen 0 en 100 % liggen.');
      return { ...d, wealth };
    });
  }

  saveProfile(profile) {
    return this.run(async () => {
      validateProfile(profile, this.data.profiles);
      const others = this.data.profiles.filter((p) => p.id !== profile.id);
      this.data = { ...this.data, profiles: [...others, { ...profile, builtIn: false }] };
      await this.save();
    });
  }

  listBackups() {
    return this.run(() => this.store.listBackups());
  }

  restoreBackup(name) {
    return this.run(async () => {
      const text = await this.store.readBackup(name);
      const { data } = parseDataFile(text); // validates before anything is overwritten
      await this.store.backup(this.now(), this.retention(), 'vóór terugzetten');
      this.data = data;
      await this.save();
    });
  }

  /** Manual mode: replace the in-memory data with a data file chosen by the user. */
  loadDataText(text) {
    return this.run(async () => {
      const { data } = parseDataFile(text);
      this.data = data;
      this.store.loadText?.(serializeData(data));
      this.emit();
    });
  }

  exportDataText() {
    return serializeData(this.data);
  }
}

export { DataFileError };
