import { h } from '../dom.js';
import { statusLabel } from '../../core/report.js';
import { fmtDateTime } from '../format.js';

const BADGE = { ok: 'ok', waarschuwing: 'warn', fout: 'err', overgeslagen: 'info' };

export function renderImports(ctx) {
  const { data } = ctx.service;
  const fileInput = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
  fileInput.addEventListener('change', async () => {
    await ctx.importFileList(fileInput.files);
    fileInput.value = '';
  });
  const drop = h(
    'div',
    { class: 'dropzone' },
    h('p', null, 'Sleep CODA-bestanden hierheen, of'),
    h('button', { onclick: () => fileInput.click() }, 'Bestanden kiezen…'),
    fileInput,
  );
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    await ctx.importFileList(e.dataTransfer.files);
  });

  const history = [...data.imports].reverse();
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Importeren'),
      ctx.mode === 'folder'
        ? h(
            'div',
            { class: 'form-row' },
            h('button', { class: 'primary', onclick: () => ctx.scan() }, 'Nu scannen'),
            h('span', { class: 'muted small' }, 'Leest alle bestanden in de map inbox/. Geslaagde bestanden gaan naar archief/, mislukte naar fout/ met een foutrapport.'),
          )
        : h('p', { class: 'muted small' }, 'Handmatige modus: kies bestanden of sleep ze hieronder. Vergeet niet het databestand te downloaden.'),
      drop,
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, `Importgeschiedenis (${history.length})`),
      history.length
        ? h(
            'table',
            { class: 'grid' },
            h('thead', null, h('tr', null, h('th', null, 'Tijdstip'), h('th', null, 'Bestand'), h('th', null, 'Resultaat'), h('th', { class: 'num' }, 'Nieuw'), h('th', { class: 'num' }, 'Al aanwezig'), h('th', null, 'Meldingen'))),
            h(
              'tbody',
              null,
              history.map((r) =>
                h(
                  'tr',
                  null,
                  h('td', { class: 'small' }, fmtDateTime(r.at)),
                  h('td', null, r.fileName, h('div', { class: 'muted small' }, r.source === 'inbox' ? 'uit inbox' : 'upload')),
                  h('td', null, h('span', { class: `badge ${BADGE[r.status] ?? 'info'}` }, statusLabel(r.status))),
                  h('td', { class: 'num' }, String(r.newTransactions)),
                  h('td', { class: 'num' }, String(r.duplicateTransactions)),
                  h(
                    'td',
                    null,
                    r.messages.length
                      ? h('details', { open: r.status === 'fout' }, h('summary', { class: 'small' }, `${r.messages.length} melding(en)`), h('ul', { class: 'messages' }, r.messages.map((m) => h('li', { class: m.level }, m.message))))
                      : h('span', { class: 'muted small' }, '—'),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Nog geen imports.'),
    ),
  );
}
