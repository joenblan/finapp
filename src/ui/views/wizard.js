// Mapping wizard for unknown CSV exports: choose columns, preview, save as profile.
import { h, clear, append } from '../dom.js';
import { fmtDate, fmtMoney } from '../format.js';
import { readStructure, guessHeaderRow, guessDateFormat, guessDecimal, metadataKeys, buildProfile } from '../../core/csv/wizard-helpers.js';
import { PROFILE_FIELDS, BUILT_IN_PROFILES } from '../../core/csv/profiles.js';
import { DATE_FORMATS } from '../../core/csv/notation.js';
import { parseCsvExport } from '../../core/csv/adapter.js';
import { checkFileChain } from '../../core/checks/chain.js';
import { validateProfile } from '../../core/csv/profile-check.js';
import { communicationForDisplay } from '../../core/csv/card.js';

export function renderProfiles(ctx) {
  const custom = ctx.service.data.profiles ?? [];
  const row = (p) =>
    h(
      'tr',
      null,
      h('td', null, p.name),
      h('td', null, p.builtIn ? 'ingebouwd' : 'eigen profiel'),
      h('td', { class: 'small' }, `${p.key === 'bankRef' ? 'sleutel: referentie' : 'sleutel: datum+bedrag+tegenpartij+mededeling'}${p.columns.balanceAfter ? ' · saldoketen' : ' · geen saldokolom (gebruik controlesaldi)'}`),
    );
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'CSV-profielen'),
      h('p', { class: 'muted small' }, 'Een profiel beschrijft het CSV-formaat van een bank. CODA-bestanden hebben geen profiel nodig.'),
      h('table', { class: 'grid' }, h('tbody', null, [...BUILT_IN_PROFILES, ...custom].map(row))),
    ),
    renderWizard(ctx),
  );
}

function renderWizard(ctx) {
  const st = (ctx.state.wizard ??= { step: 'file' });
  const panel = h('div', { class: 'panel' });
  const redraw = () => append(clear(panel), content());
  // Deferred: a change event can fire (on blur) while the panel is being cleared.
  const later = () => setTimeout(redraw, 0);

  const fileInput = h('input', { type: 'file', accept: '.csv,.txt,text/csv' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    Object.assign(st, { step: 'map', fileName: f.name, bytes, delimiter: null, headerRow: null, columns: {}, name: '' });
    analyse();
    redraw();
  });

  function analyse() {
    const s = readStructure(st.bytes, st.delimiter ?? undefined);
    st.delimiter = s.delimiter;
    st.encoding = s.encoding;
    st.records = s.records;
    st.lines = s.text.split(/\r\n|\n|\r/).slice(0, 15);
    if (st.headerRow === null || st.headerRow >= s.records.length) st.headerRow = guessHeaderRow(s.records);
    st.header = (s.records[st.headerRow]?.fields ?? []).map((x) => x.trim());
    st.metaKeys = metadataKeys(s.records, st.headerRow);
    const sampleRows = s.records.slice(st.headerRow + 1, st.headerRow + 21).filter((r) => r.fields.some((x) => x.trim()));
    const values = (colName) => sampleRows.map((r) => (r.fields[st.header.indexOf(colName)] ?? '').trim()).filter(Boolean);
    st.dateFormat ??= st.columns.entryDate ? guessDateFormat(values(st.columns.entryDate)) : 'D/M/YYYY';
    st.decimal ??= st.amountColumn ? guessDecimal(values(st.amountColumn)) : ',';
    st.order ??= 'newest-first';
    st.amountMode ??= 'single';
    st.ownSource ??= st.metaKeys.length ? 'metadata' : 'fixed';
    st.values = values;
  }

  const select = (value, options, onChange, { empty = '— niet aanwezig —' } = {}) => {
    const el = h('select', null, empty !== null ? h('option', { value: '' }, empty) : null, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  };
  const cols = () => st.header.filter(Boolean).map((c) => [c, c]);
  const row = (label, ...els) => h('div', { class: 'form-row' }, h('label', null, label), ...els);

  function currentProfile() {
    return buildProfile({ ...st, name: st.name || 'Nieuw profiel' });
  }

  function preview() {
    const profile = currentProfile();
    let parsed;
    try {
      parsed = parseCsvExport(st.bytes, st.fileName, profile);
    } catch (e) {
      return h('div', { class: 'banner err' }, e.message);
    }
    const issues = [...parsed.issues, ...checkFileChain(parsed.rows, parsed.snapshot)];
    const ordered = [...parsed.rows].reverse().slice(0, 10); // newest first, as in a bank statement
    return h(
      'div',
      null,
      h('h2', null, 'Voorbeeld van het resultaat'),
      h('p', { class: 'small muted' }, `${parsed.rows.length} bewegingen gelezen · codering ${parsed.encoding} · eigen rekening ${parsed.account?.number || '?'}${parsed.snapshot ? ` · saldo ${fmtMoney(parsed.snapshot.balance)}` : ''}`),
      issues.length ? h('ul', { class: 'messages' }, issues.slice(0, 12).map((i) => h('li', { class: i.level }, `${i.line ? `Regel ${i.line}: ` : ''}${i.message}`))) : h('div', { class: 'banner info' }, 'Geen fouten gevonden.'),
      h(
        'table',
        { class: 'grid small' },
        h('thead', null, h('tr', null, ['Datum', 'Bedrag', 'Tegenpartij', 'Mededeling', 'Saldo na', 'Referentie'].map((x) => h('th', null, x)))),
        h('tbody', null, ordered.map((r) => h('tr', null, h('td', null, fmtDate(r.entryDate)), h('td', { class: 'num' }, fmtMoney(r.amount)), h('td', null, r.counterparty.name || r.counterparty.account), h('td', null, communicationForDisplay(r).slice(0, 80)), h('td', { class: 'num' }, r.balanceAfter === null ? '—' : fmtMoney(r.balanceAfter)), h('td', null, r.bankRef ?? '—')))),
      ),
    );
  }

  async function save(importToo) {
    const profile = currentProfile();
    try {
      if (!st.name?.trim()) throw new Error('Geef het profiel een naam.');
      validateProfile(profile);
      await ctx.service.saveProfile(profile);
      ctx.toast(`Profiel "${profile.name}" bewaard.`);
      if (importToo) {
        const reports = await ctx.service.importUploads([{ name: st.fileName, bytes: st.bytes }], { profileId: profile.id });
        const r = reports[0];
        ctx.toast(`${st.fileName}: ${r.status}, ${r.newTransactions} nieuwe transacties.`, r.status === 'fout');
      }
      ctx.state.wizard = { step: 'file' };
      ctx.rerender();
    } catch (e) {
      ctx.toast(e.message, true);
    }
  }

  function content() {
    if (st.step === 'file') {
      return [
        h('h2', null, 'Koppelingswizard: nieuw CSV-profiel'),
        h('p', { class: 'muted small' }, 'Kies een CSV-export van je bank. Je ziet de eerste regels, koppelt de kolommen aan velden en bekijkt het resultaat voordat je het profiel bewaart. Het bestand wordt pas geïmporteerd als je dat bevestigt.'),
        fileInput,
      ];
    }
    const set = (k) => (v) => {
      st[k] = v;
      if (k === 'delimiter' || k === 'headerRow') {
        st.columns = {};
        st.amountColumn = st.debitColumn = st.creditColumn = st.ownColumn = undefined;
        analyse();
      }
      later();
    };
    const setCol = (field) => (v) => {
      st.columns = { ...st.columns, [field]: v || undefined };
      if (field === 'entryDate' && v) st.dateFormat = guessDateFormat(st.values(v));
      later();
    };
    const recordOptions = st.records.slice(0, 40).map((r, i) => [String(i), `regel ${r.line}: ${r.fields.filter(Boolean).slice(0, 4).join(' | ').slice(0, 60)}`]);
    return [
      h('h2', null, `Koppelingswizard: ${st.fileName}`),
      h('pre', { class: 'small', style: { overflowX: 'auto', background: 'var(--bg)', padding: '8px', borderRadius: '6px' } }, st.lines.join('\n')),
      row('Scheidingsteken', select(st.delimiter, [[';', 'puntkomma ;'], [',', 'komma ,'], ['\t', 'tab'], ['|', 'verticale streep |']], set('delimiter'), { empty: null })),
      row('Kopregel', select(String(st.headerRow), recordOptions, (v) => set('headerRow')(Number(v)), { empty: null })),
      row('Decimaalteken', select(st.decimal, [[',', 'komma (1.234,56)'], ['.', 'punt (1,234.56)']], set('decimal'), { empty: null })),
      row('Datumformaat', select(st.dateFormat, DATE_FORMATS.map((f) => [f, f]), set('dateFormat'), { empty: null })),
      row('Volgorde in bestand', select(st.order, [['newest-first', 'nieuwste beweging bovenaan'], ['oldest-first', 'oudste beweging bovenaan']], set('order'), { empty: null })),
      h('h2', { style: { marginTop: '16px' } }, 'Kolommen'),
      row('Bedrag', select(st.amountMode, [['single', 'één kolom (negatief = uitgave)'], ['debitCredit', 'aparte kolommen debet en credit']], set('amountMode'), { empty: null })),
      st.amountMode === 'debitCredit'
        ? [row('Debetkolom', select(st.debitColumn, cols(), set('debitColumn'))), row('Creditkolom', select(st.creditColumn, cols(), set('creditColumn')))]
        : row('Bedragkolom', select(st.amountColumn, cols(), (v) => { st.amountColumn = v; if (v) st.decimal = guessDecimal(st.values(v)); later(); })),
      PROFILE_FIELDS.map((f) => row(`${f.label}${f.required ? ' *' : ''}`, select(st.columns[f.key], cols(), setCol(f.key)))),
      h('h2', { style: { marginTop: '16px' } }, 'Eigen rekening'),
      row(
        'Eigen IBAN staat',
        select(st.ownSource, [['metadata', 'bovenaan het bestand (metadata)'], ['column', 'in een kolom'], ['fixed', 'nergens: zelf invullen']], set('ownSource'), { empty: null }),
      ),
      st.ownSource === 'metadata'
        ? [
            row('Sleutel rekeningnummer', select(st.ownMetaKey, st.metaKeys.map((k) => [k, k]), set('ownMetaKey'))),
            row('Sleutel saldo (optioneel)', select(st.metaBalanceKey, st.metaKeys.map((k) => [k, k]), set('metaBalanceKey'))),
            row('Sleutel saldodatum (optioneel)', select(st.metaBalanceAtKey, st.metaKeys.map((k) => [k, k]), set('metaBalanceAtKey'))),
          ]
        : st.ownSource === 'column'
          ? row('Kolom eigen IBAN', select(st.ownColumn, cols(), set('ownColumn')))
          : row('Eigen IBAN', (() => {
              const el = h('input', { value: st.ownValue ?? '', size: 30, placeholder: 'BE00 0000 0000 0000' });
              el.addEventListener('change', () => set('ownValue')(el.value));
              return el;
            })()),
      h('p', { class: 'muted small' }, st.columns.bankRef ? 'Dubbels worden herkend aan de referentie.' : 'Zonder referentiekolom worden dubbels herkend aan datum + bedrag + tegenpartij-IBAN + mededeling (twee identieke bewegingen op één dag blijven allebei behouden).'),
      h('div', { style: { marginTop: '16px' } }, preview()),
      h('h2', { style: { marginTop: '16px' } }, 'Bewaren'),
      row(
        'Naam profiel',
        (() => {
          const el = h('input', { value: st.name ?? '', size: 30, placeholder: 'bv. Crelan' });
          el.addEventListener('input', () => (st.name = el.value));
          return el;
        })(),
      ),
      h(
        'div',
        { class: 'form-row' },
        h('button', { class: 'primary', onclick: () => save(true) }, 'Profiel bewaren en bestand importeren'),
        h('button', { onclick: () => save(false) }, 'Enkel profiel bewaren'),
        h('button', { onclick: () => { ctx.state.wizard = { step: 'file' }; redraw(); } }, 'Annuleren'),
      ),
    ];
  }

  redraw();
  return panel;
}
