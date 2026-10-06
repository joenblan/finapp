// Entry point: choose storage (folder via File System Access, or manual mode),
// load the data file, scan the inbox, start the interface.
import { h, clear } from './ui/dom.js';
import { startApp } from './ui/app.js';
import { AppService } from './app/service.js';
import { FolderStore } from './platform/folder-store.js';
import { ManualStore } from './platform/manual-store.js';
import { loadDirHandle, saveDirHandle } from './platform/idb.js';

const root = document.getElementById('app');
const hasFsAccess = typeof window.showDirectoryPicker === 'function';

function setupScreen(...content) {
  clear(root).append(h('div', { class: 'setup panel' }, h('h2', null, 'Penningmeester'), content));
}

function showError(e) {
  console.error(e);
  setupScreen(
    h('div', { class: 'banner err' }, `Er ging iets mis: ${e.message}`),
    h('p', null, 'Er werd niets overschreven. Controleer de datamap of zet een back-up terug.'),
    h('button', { onclick: () => chooseFolder() }, 'Andere map kiezen…'),
  );
}

async function startWithFolder(handle) {
  const service = new AppService(new FolderStore(handle));
  await service.load();
  const ctx = startApp(root, { service, mode: 'folder', folderName: handle.name, onChangeFolder: chooseFolder });
  await ctx.scan(); // automatic inbox scan on open
}

async function chooseFolder() {
  try {
    const handle = await window.showDirectoryPicker({ id: 'financien', mode: 'readwrite' });
    await saveDirHandle(handle);
    await startWithFolder(handle);
  } catch (e) {
    if (e?.name === 'AbortError') return;
    showError(e);
  }
}

async function grantAccess(handle) {
  try {
    const result = await handle.requestPermission({ mode: 'readwrite' });
    if (result !== 'granted') {
      setupScreen(h('div', { class: 'banner warn' }, 'Zonder toegang tot de datamap kan de app niets lezen of bewaren.'), h('button', { class: 'primary', onclick: () => grantAccess(handle) }, 'Opnieuw proberen'));
      return;
    }
    await startWithFolder(handle);
  } catch (e) {
    showError(e);
  }
}

async function startManual() {
  const service = new AppService(new ManualStore());
  await service.load();
  startApp(root, { service, mode: 'manual' });
  window.addEventListener('beforeunload', (e) => {
    if (service.store.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

async function boot() {
  if (!hasFsAccess) return startManual();
  const handle = await loadDirHandle();
  if (!handle) {
    setupScreen(
      h('p', null, 'Kies een map waarin de app je gegevens bewaart. De app maakt daarin de mappen inbox/, archief/, fout/ en backups/ en het bestand financien-data.json aan.'),
      h('p', { class: 'muted small' }, 'Tip: kies een map die door je eigen back-up (bv. externe schijf of cloudmap) wordt meegenomen.'),
      h('button', { class: 'primary', onclick: chooseFolder }, 'Datamap kiezen…'),
    );
    return;
  }
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission === 'granted') return startWithFolder(handle);
  setupScreen(
    h('p', null, `Datamap: `, h('strong', null, handle.name)),
    h('p', { class: 'muted' }, 'De browser vraagt bij elke nieuwe sessie opnieuw toestemming om de datamap te gebruiken.'),
    h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: () => grantAccess(handle) }, 'Toegang verlenen'), h('button', { onclick: chooseFolder }, 'Andere map kiezen…')),
  );
}

boot().catch(showError);
