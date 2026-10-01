// Default category set (Belgian), editable by the user. Two levels:
// main category (parentId null) and subcategories. Kind: inkomst | uitgave | neutraal.

export const SYSTEM_INTERNAL = 'intern';
export const SYSTEM_CONTRIBUTION = 'bijdrage-mede-eigenaar';

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
  out.push({ id: SYSTEM_CONTRIBUTION, name: 'Bijdrage mede-eigenaar', parentId: null, kind: 'neutraal', system: true });
  return out;
}
