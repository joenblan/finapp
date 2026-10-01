// Minimal in-memory implementation of the FileSystemDirectoryHandle subset
// used by FolderStore, for Node tests.
class NotFound extends Error {
  constructor(name) {
    super(`Not found: ${name}`);
    this.name = 'NotFoundError';
  }
}

export class FakeFile {
  constructor(name, dir) {
    this.kind = 'file';
    this.name = name;
    this.dir = dir;
  }
  async getFile() {
    const content = this.dir.files.get(this.name);
    if (content === undefined) throw new NotFound(this.name);
    const bytes = content.bytes;
    return {
      size: bytes.length,
      lastModified: content.mtime,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async (data) => chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer ?? data)),
      close: async () => {
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.length;
        }
        this.dir.files.set(this.name, { bytes: out, mtime: Date.now() });
      },
      abort: async () => {},
    };
  }
}

export class FakeDir {
  constructor(name = 'root') {
    this.kind = 'directory';
    this.name = name;
    this.files = new Map();
    this.dirs = new Map();
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.dirs.has(name)) {
      if (!create) throw new NotFound(name);
      this.dirs.set(name, new FakeDir(name));
    }
    return this.dirs.get(name);
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) throw new NotFound(name);
      this.files.set(name, { bytes: new Uint8Array(0), mtime: Date.now() });
    }
    return new FakeFile(name, this);
  }
  async removeEntry(name) {
    if (!this.files.delete(name) && !this.dirs.delete(name)) throw new NotFound(name);
  }
  async *values() {
    for (const name of this.dirs.keys()) yield this.dirs.get(name);
    for (const name of this.files.keys()) yield new FakeFile(name, this);
  }
  // helpers for tests
  put(name, content) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    this.files.set(name, { bytes, mtime: Date.now() });
  }
  text(name) {
    return new TextDecoder().decode(this.files.get(name).bytes);
  }
  names() {
    return [...this.files.keys()].sort();
  }
}
