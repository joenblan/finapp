import { h } from '../dom.js';
import { renderCategories } from './categories.js';
import { renderRules } from './rules.js';
import { renderProfiles } from './wizard.js';
import { renderBackups } from './backups.js';
import { jointAccounts } from '../../core/joint.js';
import { formatIban } from '../format.js';

const SECTIONS = [
  ['categorieen', 'Categorieën', renderCategories],
  ['regels', 'Regels', renderRules],
  ['eigen', 'Eigen rekeningen & mijn naam', renderOwn],
  ['profielen', 'CSV-profielen', renderProfiles],
  ['backups', 'Back-ups', renderBackups],
];

export function renderSettings(ctx) {
  const current = ctx.state.settingsSection ?? 'categorieen';
  const section = SECTIONS.find((s) => s[0] === current) ?? SECTIONS[0];
  return h(
    'div',
    null,
    h('div', { class: 'subnav' }, SECTIONS.map(([id, label]) => h('button', { class: id === section[0] ? 'active' : '', onclick: () => { ctx.state.settingsSection = id; ctx.rerender(); } }, label))),
    section[2](ctx),
  );
}

function renderOwn(ctx) {
  const data = ctx.service.data;
  const run = (p, ok) => p.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));
  const myName = h('input', { value: data.settings.myName ?? '', size: 24, placeholder: 'bv. Jan' });
  const owners = [...new Set(jointAccounts(data).flatMap((a) => a.ownership.owners))];

  const list = [...(data.externalOwnAccounts ?? [])];
  const ibanIn = h('input', { size: 28, placeholder: 'BE00 0000 0000 0000' });
  const nameIn = h('input', { size: 24, placeholder: 'bv. Spaarrekening bank X' });

  return h(
    'div',
    null,
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Mijn naam'),
      h('p', { class: 'muted small' }, `Welke mede-eigenaar van de gemeenschappelijke rekening(en) ben jij? Een voorschot vanaf je individuele rekening wordt op jouw naam geboekt.${owners.length ? ` Mede-eigenaars: ${owners.join(', ')}.` : ''}`),
      h('div', { class: 'form-row' }, myName, h('button', { onclick: () => run(ctx.service.setMyName(myName.value), 'Opgeslagen.') }, 'Opslaan')),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h2', null, 'Eigen rekeningen zonder bankbestanden'),
      h('p', { class: 'muted small' }, 'Rekeningen van jezelf waarvan je geen CODA of CSV importeert (bv. een spaarrekening bij een andere bank). Overboekingen naar of van deze IBAN\'s zijn interne overboekingen. Alle geïmporteerde rekeningen tellen automatisch als eigen rekening.'),
      list.length
        ? h('table', { class: 'grid' }, h('tbody', null, list.map((e, i) => h('tr', null, h('td', null, formatIban(e.iban)), h('td', null, e.name), h('td', null, h('button', { class: 'danger', onclick: () => run(ctx.service.setExternalOwnAccounts(list.filter((_, j) => j !== i)), 'Verwijderd.') }, 'Wissen'))))))
        : h('p', { class: 'muted' }, 'Nog geen.'),
      h('div', { class: 'form-row' }, ibanIn, nameIn, h('button', { onclick: () => run(ctx.service.setExternalOwnAccounts([...list, { iban: ibanIn.value, name: nameIn.value }]), 'Toegevoegd; interne overboekingen bijgewerkt.') }, 'Toevoegen')),
    ),
    jointAccounts(data).map((a) => {
      const input = h('input', { size: 48, value: (a.coOwnerIbans ?? []).map(formatIban).join(', '), placeholder: 'IBAN(s) van de mede-eigenaar, gescheiden door komma' });
      return h(
        'div',
        { class: 'panel' },
        h('h2', null, `Bijdragen mede-eigenaar: ${a.displayName}`),
        h('p', { class: 'muted small' }, 'Stortingen vanaf deze IBAN\'s op de gemeenschappelijke rekening krijgen automatisch de categorie "Bijdrage mede-eigenaar" (neutraal, geen inkomen).'),
        h('div', { class: 'form-row' }, input, h('button', { onclick: () => run(ctx.service.setCoOwnerIbans(a.id, input.value.split(',')), 'Opgeslagen; categorieën bijgewerkt.') }, 'Opslaan')),
      );
    }),
  );
}
