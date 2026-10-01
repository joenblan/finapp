import { h, clear } from '../dom.js';
import { fmtDateTime } from '../format.js';

export function renderBackups(ctx) {
  if (ctx.mode !== 'folder') return renderManualData(ctx);
  const body = h('div', null, h('p', { class: 'muted' }, 'Back-ups laden…'));
  ctx.service.listBackups().then(
    (list) => {
      clear(body).append(
        h('p', { class: 'muted small' }, `Vóór elke import wordt een kopie van het databestand in backups/ bewaard (de laatste ${ctx.service.retention()}).`),
        list.length
          ? h(
              'table',
              { class: 'grid' },
              h('thead', null, h('tr', null, h('th', null, 'Bestand'), h('th', null, 'Gemaakt'), h('th', { class: 'num' }, 'Grootte'), h('th', null, ''))),
              h(
                'tbody',
                null,
                list.map((b) =>
                  h(
                    'tr',
                    null,
                    h('td', null, b.name),
                    h('td', null, fmtDateTime(new Date(b.lastModified).toISOString())),
                    h('td', { class: 'num' }, `${Math.max(1, Math.round(b.size / 1024))} kB`),
                    h('td', null, h('button', { class: 'danger', onclick: () => restore(b.name) }, 'Back-up terugzetten')),
                  ),
                ),
              ),
            )
          : h('p', null, 'Nog geen back-ups.'),
      );
    },
    (e) => clear(body).append(h('div', { class: 'banner err' }, `Back-ups lezen mislukt: ${e.message}`)),
  );
  async function restore(name) {
    if (!confirm(`Back-up "${name}" terugzetten?\n\nDe huidige gegevens worden eerst zelf als back-up bewaard.`)) return;
    try {
      await ctx.service.restoreBackup(name);
      ctx.toast('Back-up teruggezet.');
    } catch (e) {
      ctx.toast(`Terugzetten mislukt: ${e.message}`, true);
    }
  }
  return h('div', { class: 'panel' }, h('h2', null, 'Back-ups'), body);
}

function renderManualData(ctx) {
  const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      await ctx.service.loadDataText(await file.text());
      ctx.toast('Databestand geladen.');
    } catch (e) {
      ctx.toast(`Databestand ongeldig: ${e.message}`, true);
    }
  });
  return h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Databestand (handmatige modus)'),
    h('p', null, 'In deze browser kan de app niet rechtstreeks in een map schrijven. Download het databestand na elke wijziging en bewaar het zelf veilig; open het de volgende keer opnieuw.'),
    h(
      'div',
      { class: 'form-row' },
      h('button', { onclick: () => input.click() }, 'Databestand openen…'),
      h('button', { class: 'primary', onclick: () => ctx.downloadData() }, 'Databestand downloaden'),
      input,
    ),
  );
}
