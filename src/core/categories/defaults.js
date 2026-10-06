// Default category set (Belgian), editable by the user. Two levels:
// main category (parentId null) and subcategories. Kind: inkomst | uitgave | neutraal.

export const SYSTEM_INTERNAL = 'intern';
export const SYSTEM_CONTRIBUTION = 'bijdrage-mede-eigenaar';
// Transfers between an individual and a joint account count as expense on the
// individual account and as income on the joint account (schema 6).
export const SYSTEM_CONTRIBUTION_PAID = 'bijdrage-gemeenschappelijk';
export const SYSTEM_CONTRIBUTION_RECEIVED = 'bijdrage-eigen-rekening';

/** System categories added or changed in schema 6. */
export function contributionCategories() {
  return [
    { id: SYSTEM_CONTRIBUTION_PAID, name: 'Bijdrage gemeenschappelijke rekening', parentId: null, kind: 'uitgave', system: true, budgetType: 'vast' },
    { id: SYSTEM_CONTRIBUTION_RECEIVED, name: 'Bijdrage van eigen rekening', parentId: null, kind: 'inkomst', system: true, budgetType: 'variabel' },
  ];
}

// Phase 5: bank transactions linked to an investment operation (schema 9).
// Purchase counts as savings in the free space; sale is neutral; dividend is income.
export const INVEST_BUY = 'beleggingen--aankoop';
export const INVEST_SELL = 'beleggingen--verkoop';
export const INVEST_DIVIDEND = 'beleggingen--dividend';
export const PENSION_CATEGORY = 'sparen-beleggen--pensioensparen';
export function investCategories() {
  return [
    { id: 'beleggingen', name: 'Beleggingen', parentId: null, kind: 'neutraal', system: false, budgetType: 'sparen' },
    { id: INVEST_BUY, name: 'Aankoop', parentId: 'beleggingen', kind: 'neutraal', system: false, budgetType: 'sparen' },
    { id: INVEST_SELL, name: 'Verkoop', parentId: 'beleggingen', kind: 'neutraal', system: false, budgetType: 'variabel' },
    { id: INVEST_DIVIDEND, name: 'Dividend', parentId: 'beleggingen', kind: 'inkomst', system: false, budgetType: 'variabel' },
  ];
}

export const REFUNDS_NAME = 'Terugbetalingen (mutualiteit, belastingen…)';
export const FRIENDS_REFUND = 'inkomen--terugbetaling-vrienden-en-familie';

const tree = [
  ['wonen', 'Wonen', 'uitgave', ['Huur', 'Woonkrediet', 'Onroerende voorheffing', 'Energie', 'Water', 'Internet & telecom', 'Onderhoud & inrichting']],
  ['boodschappen', 'Boodschappen', 'uitgave', ['Supermarkt', 'Bakker & slager']],
  ['mobiliteit', 'Mobiliteit', 'uitgave', ['Brandstof & laden', 'Openbaar vervoer', 'Onderhoud wagen', 'Verkeersbelasting', 'Parkeren']],
  ['verzekeringen', 'Verzekeringen', 'uitgave', ['Brandverzekering', 'Autoverzekering', 'Familiale verzekering', 'Hospitalisatieverzekering']],
  ['gezondheid', 'Gezondheid', 'uitgave', ['Mutualiteit', 'Dokter & apotheek', 'Tandarts', 'Opticien']],
  ['abonnementen', 'Abonnementen', 'uitgave', ['Streaming', 'Krant & tijdschriften', 'Sport']],
  ['vrije-tijd', 'Vrije tijd', 'uitgave', ['Restaurant & café', 'Uitstappen', 'Reizen', 'Hobby']],
  ['belastingen', 'Belastingen', 'uitgave', ['Personenbelasting', 'Andere belastingen']],
  ['sparen-beleggen', 'Sparen & beleggen', 'neutraal', ['Sparen', 'Pensioensparen', 'Beleggingen']],
  // a sub can be [name, id-slug] to keep the id stable after a rename
  ['inkomen', 'Inkomen', 'inkomst', ['Loon', 'Groeipakket', [REFUNDS_NAME, 'terugbetalingen'], 'Terugbetaling vrienden & familie', 'Andere inkomsten']],
  ['overig', 'Overig', 'uitgave', ['Bankkosten', 'Cadeaus', 'Diversen']],
];

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'en')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function defaultCategories() {
  const out = [];
  for (const [id, name, kind, subs] of tree) {
    out.push({ id, name, parentId: null, kind, system: false });
    for (const sub of subs) {
      const [name, slug] = Array.isArray(sub) ? sub : [sub, slugify(sub)];
      out.push({ id: `${id}--${slug}`, name, parentId: id, kind, system: false });
    }
  }
  out.push({ id: SYSTEM_INTERNAL, name: 'Interne overboeking', parentId: null, kind: 'neutraal', system: true });
  out.push({ id: SYSTEM_CONTRIBUTION, name: 'Bijdrage mede-eigenaar', parentId: null, kind: 'inkomst', system: true });
  return [...out.map((c) => ({ ...c, budgetType: defaultBudgetType(c) })), ...contributionCategories(), ...investCategories()];
}

// Phase 3: how a category counts in the budget: vast | variabel | sparen.
const FIXED_MAIN = new Set(['wonen', 'verzekeringen', 'abonnementen', 'belastingen']);
const FIXED_SUB = new Set(['gezondheid--mutualiteit']);
const VARIABLE_SUB = new Set(['wonen--onderhoud-en-inrichting']);
export function defaultBudgetType(c) {
  if (c.id === 'sparen-beleggen' || c.parentId === 'sparen-beleggen') return 'sparen';
  if (VARIABLE_SUB.has(c.id)) return 'variabel';
  if (FIXED_SUB.has(c.id) || FIXED_MAIN.has(c.id) || FIXED_MAIN.has(c.parentId)) return 'vast';
  return 'variabel';
}
