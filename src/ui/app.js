// Application shell: header, tabs, toasts, and wiring between views and service.
import { h, clear, append } from './dom.js';
import { renderAccounts } from './views/accounts.js';
import { renderTransactions } from './views/transactions.js';
import { renderImports } from './views/imports.js';
import { renderReview, openReviewCount } from './views/review.js';
import { renderWorklist, uncategorized } from './views/worklist.js';
import { renderSettings } from './views/settings.js';
import { renderJoint } from './views/joint.js';
import { renderOverview } from './views/overview.js';

const TABS = [
  { id: 'rekeningen', label: 'Rekeningen', render: renderAccounts },
  { id: 'transacties', label: 'Transacties', render: renderTransactions },
  { id: 'categoriseren', label: 'Te categoriseren', render: renderWorklist, count: (data) => uncategorized(data).length },
  { id: 'overzicht', label: 'Overzicht', render: renderOverview },
  { id: 'gemeenschappelijk', label: 'Gemeenschappelijk', render: renderJoint },
  { id: 'importeren', label: 'Importeren', render: renderImports },
  { id: 'nakijken', label: 'Nakijken', render: renderReview, count: (data) => openReviewCount(data) },
  { id: 'instellingen', label: 'Instellingen', render: renderSettings },
];

export function startApp(root, { service, mode, folderName, onChangeFolder }) {
  const ctx = {
    service,
    mode,
    state: { tab: 'rekeningen', txFilter: {} },
    toast,
    rerender: render,
    showTransactions(accountId) {
      ctx.state.txFilter = { accountId };
      ctx.state.tab = 'transacties';
      render();
    },
    async scan() {
      try {
        const reports = await service.scanInbox();
        summarize(reports, 'inbox');
      } catch (e) {
        toast(`Scannen mislukt: ${e.message}`, true);
      }
    },
    async importFileList(fileList) {
      const files = [];
      for (const f of fileList) files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      if (!files.length) return;
      try {
        summarize(await service.importUploads(files), 'upload');
      } catch (e) {
        toast(`Importeren mislukt: ${e.message}`, true);
      }
    },
    downloadData() {
      const blob = new Blob([service.exportDataText()], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'financien-data.json' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      service.store.markSaved?.();
    },
  };

  const toastArea = h('div', { class: 'toast-area', 'aria-live': 'polite' });
  const nav = h('nav', { class: 'tabs' });
  const main = h('main');
  const header = h(
    'header',
    { class: 'top' },
    h('h1', null, 'Financiën'),
    nav,
    h('div', { class: 'spacer' }),
    h('span', { class: 'folder' }, mode === 'folder' ? `Datamap: ${folderName}` : 'Handmatige modus (geen map)'),
    mode === 'folder' ? h('button', { onclick: onChangeFolder }, 'Andere map…') : null,
  );
  clear(root).append(header, main, toastArea);

  function toast(message, isError = false) {
    const el = h('div', { class: `toast${isError ? ' err' : ''}`, role: isError ? 'alert' : 'status' }, message);
    toastArea.append(el);
    setTimeout(() => el.remove(), isError ? 10000 : 4000);
  }

  function summarize(reports, source) {
    if (!reports.length) {
      toast(source === 'inbox' ? 'Geen nieuwe bestanden in inbox/.' : 'Geen bestanden.');
      return;
    }
    const failed = reports.filter((r) => r.status === 'fout').length;
    const added = reports.reduce((n, r) => n + r.newTransactions, 0);
    toast(`${reports.length} bestand(en) verwerkt: ${added} nieuwe transacties${failed ? `, ${failed} mislukt (zie Importeren)` : ''}.`, failed > 0);
    if (failed) ctx.state.tab = 'importeren';
    render();
  }

  function render() {
    append(clear(nav), [
      TABS.map((t) =>
        h(
          'button',
          {
            class: t.id === ctx.state.tab ? 'active' : '',
            onclick: () => {
              ctx.state.tab = t.id;
              render();
            },
          },
          t.label,
          t.count && t.count(service.data) ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, String(t.count(service.data))) : null,
        ),
      ),
    ]);
    const tab = TABS.find((t) => t.id === ctx.state.tab);
    const banners = [];
    if (mode === 'manual') {
      banners.push(
        h('div', { class: 'banner warn' }, 'Deze browser ondersteunt geen rechtstreekse toegang tot een map (File System Access API). De app werkt in handmatige modus: gegevens blijven enkel bewaard als je het databestand downloadt (Instellingen › Back-ups). Gebruik Chrome of Edge voor de volledige werking.'),
      );
    }
    if (service.lastMigration.length) {
      banners.push(h('div', { class: 'banner info' }, `Het databestand werd bijgewerkt naar een nieuwere schemaversie (${service.lastMigration.join(', ')}). Een kopie van de vorige versie staat in backups/.`));
    }
    append(clear(main), [banners, tab.render(ctx)]);
  }

  service.onChange(() => render());
  render();
  return ctx;
}
