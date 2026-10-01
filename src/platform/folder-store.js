// Storage in a user-chosen folder via the File System Access API.
// Layout: inbox/, archief/, fout/, backups/, financien-data.json
// Works with any object implementing the FileSystemDirectoryHandle subset
// used here (tests use an in-memory fake).

export const DATA_FILE = 'financien-data.json';
export const DIRS = { inbox: 'inbox', archive: 'archief', error: 'fout', backups: 'backups' };
const BACKUP_RE = /^financien-data-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{3})?Z?( \(\d+\))?\.json$/;

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeFile(dir, name, content) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); // writes to a temp file; replaced atomically on close()
  try {
    await w.write(content);
    await w.close();
  } catch (e) {
    try {
      await w.abort?.();
    } catch {
      /* ignore */
    }
    throw e;
  }
}

async function uniqueName(dir, name) {
  if (!(await exists(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
}

export class FolderStore {
  constructor(root) {
    this.root = root;
    this.mode = 'folder';
    this.dirs = null;
  }

  get name() {
    return this.root.name;
  }

  async init() {
    this.dirs = {};
    for (const [key, name] of Object.entries(DIRS)) {
      this.dirs[key] = await this.root.getDirectoryHandle(name, { create: true });
    }
  }

  async readData() {
    try {
      const fh = await this.root.getFileHandle(DATA_FILE);
      return await (await fh.getFile()).text();
    } catch (e) {
      if (e?.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async writeData(text) {
    await writeFile(this.root, DATA_FILE, text);
  }

  async listInbox() {
    const out = [];
    for await (const handle of this.dirs.inbox.values()) {
      if (handle.kind === 'file' && !handle.name.startsWith('.')) out.push(handle.name);
    }
    return out.sort();
  }

  async readInboxFile(name) {
    const fh = await this.dirs.inbox.getFileHandle(name);
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
  }

  /** Copy to archief/ or fout/ and only then remove from inbox. */
  async moveFromInbox(name, bytes, target, reportText = null) {
    const dir = target === 'error' ? this.dirs.error : this.dirs.archive;
    const finalName = await uniqueName(dir, name);
    await writeFile(dir, finalName, bytes);
    if (reportText !== null) await writeFile(dir, `${finalName}.fout.txt`, reportText);
    await this.dirs.inbox.removeEntry(name);
    return finalName;
  }

  /** Store a copy of an uploaded file (not from inbox) in archief/ or fout/. */
  async keepUpload(name, bytes, target, reportText = null) {
    const dir = target === 'error' ? this.dirs.error : this.dirs.archive;
    const finalName = await uniqueName(dir, name);
    await writeFile(dir, finalName, bytes);
    if (reportText !== null) await writeFile(dir, `${finalName}.fout.txt`, reportText);
    return finalName;
  }

  /** Copy the current data file to backups/ with a timestamp; keep the newest `retention`. */
  async backup(now, retention, label = '') {
    const current = await this.readData();
    if (current === null) return null;
    const stamp = now.replace(/:/g, '-').replace(/\./g, '-');
    const name = await uniqueName(this.dirs.backups, `financien-data-${stamp}.json`);
    await writeFile(this.dirs.backups, name, current);
    await this.rotateBackups(retention);
    return { name, label };
  }

  async listBackups() {
    const out = [];
    for await (const handle of this.dirs.backups.values()) {
      if (handle.kind === 'file' && BACKUP_RE.test(handle.name)) {
        const file = await handle.getFile();
        out.push({ name: handle.name, size: file.size, lastModified: file.lastModified });
      }
    }
    // Names contain an ISO timestamp, so lexical order = chronological order.
    return out.sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  async rotateBackups(retention) {
    const list = await this.listBackups();
    for (const b of list.slice(Math.max(1, retention))) {
      await this.dirs.backups.removeEntry(b.name);
    }
  }

  async readBackup(name) {
    const fh = await this.dirs.backups.getFileHandle(name);
    return (await fh.getFile()).text();
  }
}
