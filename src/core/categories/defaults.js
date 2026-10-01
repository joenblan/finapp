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
  // Joint account: advances and their repayments are only categories (no balances).
  ['voorschotten', 'Voorschotten', 'neutraal', ['Voorschot', 'Terugbetaling voorschot']],
  ['inkomen', 'Inkomen', 'inkomst', ['Loon', 'Groeipakket', 'Terugbetalingen', 'Andere inkomsten']],
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
    for (const sub of subs) out.push({ id: `${id}--${slugify(sub)}`, name: sub, parentId: id, kind, system: false });
  }
  out.push({ id: SYSTEM_INTERNAL, name: 'Interne overboeking', parentId: null, kind: 'neutraal', system: true });
  out.push({ id: SYSTEM_CONTRIBUTION, name: 'Bijdrage mede-eigenaar', parentId: null, kind: 'inkomst', system: true });
  return [...out.map((c) => ({ ...c, budgetType: defaultBudgetType(c) })), ...contributionCategories()];
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
