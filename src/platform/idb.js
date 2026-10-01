// IndexedDB is used ONLY to remember the folder handle between sessions.
const DB = 'financien';
const STORE = 'handles';
const KEY = 'dataDir';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function loadDirHandle() {
  try {
    return (await tx('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export function saveDirHandle(handle) {
  return tx('readwrite', (s) => s.put(handle, KEY));
}

export function forgetDirHandle() {
  return tx('readwrite', (s) => s.delete(KEY));
}
