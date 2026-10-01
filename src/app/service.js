// Application service: orchestrates storage + pure core logic. No DOM.
// All mutating operations run one at a time through a queue, and the data file
// is written after every change.

import { createEmptyData, ACCOUNT_KINDS, OWNERSHIP_TYPES } from '../core/model/schema.js';
import { parseDataFile, serializeData, DataFileError } from '../core/model/migrations.js';
import { importFile } from '../core/import/importer.js';
import { formatReportText } from '../core/report.js';
import { sha256Hex } from '../core/hash.js';

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
  importUploads(files) {
    return this.run(() => this.#importBatch(files, 'upload'));
  }

  async #importBatch(files, source) {
    await this.store.backup(this.now(), this.retention(), 'vóór import');
    const results = [];
    let data = this.data;
    for (const f of files) {
      const fileHash = await sha256Hex(f.bytes);
      const { data: next, report } = importFile(data, { fileName: f.name, bytes: f.bytes, fileHash, source, now: this.now() });
      data = next;
      results.push({ file: f, report });
    }
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
      this.data = { ...this.data, accounts: { ...this.data.accounts, [id]: next } };
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
