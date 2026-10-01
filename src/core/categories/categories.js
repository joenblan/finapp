// Category operations (pure). Two levels: main categories (parentId null) and
// subcategories. System categories (internal transfer, contribution co-owner)
// can be renamed but not deleted or merged away.
import { slugify } from './defaults.js';

export const KINDS = ['inkomst', 'uitgave', 'neutraal'];

export function categoryById(data, id) {
  return (data.categories ?? []).find((c) => c.id === id) ?? null;
}

export function categoryLabel(data, id) {
  const c = categoryById(data, id);
  if (!c) return id ? '(verwijderde categorie)' : 'Niet gecategoriseerd';
  const p = c.parentId ? categoryById(data, c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
}

/** Categories ordered as a tree: main, its subs, next main… */
export function categoryTree(data) {
  const cats = data.categories ?? [];
  const mains = cats.filter((c) => !c.parentId);
  const out = [];
  for (const m of mains) {
    out.push(m);
    out.push(...cats.filter((c) => c.parentId === m.id).sort((a, b) => a.name.localeCompare(b.name, 'nl')));
  }
  return out;
}

export function addCategory(data, { name, parentId = null, kind = null }) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('Geef een naam op.');
  const parent = parentId ? categoryById(data, parentId) : null;
  if (parentId && !parent) throw new Error('Onbekende hoofdcategorie.');
  if (parent?.parentId) throw new Error('Er zijn maar twee niveaus: kies een hoofdcategorie als ouder.');
  if (parent?.system) throw new Error('Onder een systeemcategorie kunnen geen subcategorieën.');
  const k = kind ?? parent?.kind ?? 'uitgave';
  if (!KINDS.includes(k)) throw new Error('Ongeldige soort.');
  const siblings = data.categories.filter((c) => (c.parentId ?? null) === (parentId ?? null));
  if (siblings.some((c) => c.name.toLowerCase() === clean.toLowerCase())) throw new Error('Er bestaat al een categorie met die naam op dit niveau.');
  const base = parent ? `${parent.id}--${slugify(clean)}` : slugify(clean) || 'categorie';
  let id = base;
  for (let i = 2; categoryById(data, id); i++) id = `${base}-${i}`;
  const category = { id, name: clean, parentId: parentId ?? null, kind: k, system: false };
  return { data: { ...data, categories: [...data.categories, category] }, category };
}

export function updateCategory(data, id, { name, kind }) {
  const c = categoryById(data, id);
  if (!c) throw new Error('Onbekende categorie.');
  const next = { ...c };
  if (name !== undefined) {
    const clean = String(name).trim();
    if (!clean) throw new Error('Geef een naam op.');
    const siblings = data.categories.filter((x) => x.id !== id && (x.parentId ?? null) === (c.parentId ?? null));
    if (siblings.some((x) => x.name.toLowerCase() === clean.toLowerCase())) throw new Error('Er bestaat al een categorie met die naam op dit niveau.');
    next.name = clean;
  }
  if (kind !== undefined) {
    if (!KINDS.includes(kind)) throw new Error('Ongeldige soort.');
    if (c.system && kind !== c.kind) throw new Error('De soort van een systeemcategorie ligt vast.');
    next.kind = kind;
  }
  return { ...data, categories: data.categories.map((x) => (x.id === id ? next : x)) };
}

/**
 * Delete a category (and its subcategories). Its transactions and rules move
 * to `targetId`; with targetId null the transactions become uncategorised and
 * the rules are removed. Manual choices stay manual (with the new category).
 */
export function deleteCategory(data, id, targetId) {
  const c = categoryById(data, id);
  if (!c) throw new Error('Onbekende categorie.');
  if (c.system) throw new Error('Een systeemcategorie kan niet verwijderd worden.');
  const removed = new Set([id, ...data.categories.filter((x) => x.parentId === id).map((x) => x.id)]);
  if (targetId !== null) {
    if (!categoryById(data, targetId)) throw new Error('Kies een bestaande doelcategorie.');
    if (removed.has(targetId)) throw new Error('De doelcategorie mag niet de verwijderde categorie (of een subcategorie ervan) zijn.');
  }
  const allocations = {};
  let moved = 0;
  for (const [txId, list] of Object.entries(data.allocations ?? {})) {
    allocations[txId] = list.map((a) => {
      if (!removed.has(a.categoryId)) return a;
      moved++;
      if (targetId === null) return { ...a, categoryId: null, source: 'geen', ruleId: null };
      return { ...a, categoryId: targetId };
    });
  }
  const rules = (data.rules ?? [])
    .filter((r) => targetId !== null || !removed.has(r.categoryId))
    .map((r) => (removed.has(r.categoryId) ? { ...r, categoryId: targetId } : r));
  return { data: { ...data, categories: data.categories.filter((x) => !removed.has(x.id)), allocations, rules }, moved };
}

/** Merge = move everything to the target and delete the source. */
export function mergeCategory(data, sourceId, targetId) {
  if (!targetId) throw new Error('Kies de categorie waarmee samengevoegd wordt.');
  return deleteCategory(data, sourceId, targetId);
}
