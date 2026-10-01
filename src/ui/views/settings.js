import { h } from '../dom.js';
import { renderCategories } from './categories.js';
import { renderRules } from './rules.js';
import { renderProfiles } from './wizard.js';
import { renderBackups } from './backups.js';
import { formatIban } from '../format.js';
import { parseEuroInput, formatMilli } from '../../core/money.js';

const SECTIONS = [
  ['categorieen', 'Categorieën', renderCategories],
  ['regels', 'Regels', renderRules],
  ['eigen', 'Eigen rekeningen', renderOwn],
  ['budget', 'Budget & detectie', renderBudgetSettings],
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
  const jointAccounts = Object.values(data.accounts).filter((a) => a.ownership?.type === 'gemeenschappelijk');

  const list = [...(data.externalOwnAccounts ?? [])];
  const ibanIn = h('input', { size: 28, placeholder: 'BE00 0000 0000 0000' });
  const nameIn = h('input', { size: 24, placeholder: 'bv. Spaarrekening bank X' });

  return h(
    'div',
    null,
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
    jointAccounts.map((a) => {
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

function renderBudgetSettings(ctx) {
  const b = ctx.service.data.budget;
  const run = (p, ok) => p.then(() => ok && ctx.toast(ok)).catch((e) => ctx.toast(e.message, true));
  const num = (value) => h('input', { type: 'number', value, size: 5, style: { width: '80px' } });
  const fallback = h('select', null, h('option', { value: 'laatste', selected: b.fallbackStartDay === 'laatste' }, 'laatste dag van de maand'), Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1), selected: b.fallbackStartDay === i + 1 }, `dag ${i + 1}`)));
  const tol = num(b.amountTolerancePct);
  const pct = num(b.priceIncreasePct);
  const min = h('input', { value: formatMilli(b.priceIncreaseMin), size: 8 });
  const grace = num(b.missedGraceDays);
  const save = () => {
    try {
      run(
        ctx.service.updateBudgetSettings({
          fallbackStartDay: fallback.value === 'laatste' ? 'laatste' : Number(fallback.value),
          amountTolerancePct: Number(tol.value),
          priceIncreasePct: Number(pct.value),
          priceIncreaseMin: parseEuroInput(min.value) ?? 0,
          missedGraceDays: Number(grace.value),
        }),
        'Instellingen opgeslagen; reeksen en waarschuwingen bijgewerkt.',
      );
    } catch (e) {
      ctx.toast(e.message, true);
    }
  };
  const row = (label, el, note) => h('div', { class: 'form-row' }, h('label', null, label), el, note ? h('span', { class: 'muted small' }, note) : null);
  return h(
    'div',
    { class: 'panel' },
    h('h2', null, 'Budget & detectie'),
    row('Startdag loonperiode als er geen loon gekend is', fallback),
    row('Toegelaten bedragsverschil bij detectie', tol, '% (standaard 10)'),
    row('Waarschuwing prijsstijging vanaf', pct, '%'),
    row('… en minstens', min, 'euro'),
    row('Uitgebleven betaling melden na', grace, 'dagen na de verwachte datum'),
    h('div', { class: 'form-row' }, h('button', { class: 'primary', onclick: save }, 'Opslaan')),
    h('p', { class: 'muted small' }, 'De periode (loon of kalendermaand), het geplande sparen en de budgetten stel je per perspectief in bij het tabblad Budget. Het minimumsaldo per rekening bij Prognose.'),
  );
}
