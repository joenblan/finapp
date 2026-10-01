// Bank profiles describe a CSV export format. A profile is plain JSON data, so
// user-defined profiles (made with the mapping wizard) are stored in the data
// file (`data.profiles`). Adding a bank (e.g. Crelan) = adding a profile.

import { decodeCodaBytes } from '../coda/decode.js';
import { parseCsv } from './csv.js';

export const VDK_PROFILE = Object.freeze({
  id: 'vdk',
  name: 'VDK (CSV-export "verwerkte bewegingen")',
  builtIn: true,
  format: 'csv',
  encoding: 'windows-1252',
  delimiter: ';',
  quote: '"',
  decimal: ',',
  thousands: '.',
  dateFormat: 'D/M/YYYY',
  order: 'newest-first',
  detect: {
    headerColumns: ['Uitvoeringsdatum', 'VDK-refertenummer', 'Saldo na beweging'],
    fileNamePattern: '^verwerkte_bewegingen_([A-Z]{2}[0-9]{2}[A-Z0-9]+)_\\d{4}_\\d{2}_\\d{2}__\\d{2}_\\d{2}_\\d{2}\\.csv$',
    fileNameIbanGroup: 1,
  },
  metadata: {
    accountNumber: 'Rekeningnummer',
    holderName: 'Naam',
    accountLabel: 'Soort',
    balance: 'Saldo',
    balanceAt: 'Datum saldo',
    filterActive: 'Filter actief',
    filterInactiveValues: ['Neen', 'Nee', 'No'],
  },
  ownAccount: { source: 'metadata' },
  amount: { mode: 'single', column: 'Bedrag' },
  key: 'bankRef',
  columns: {
    entryDate: 'Uitvoeringsdatum',
    valueDate: 'Valutadatum',
    statementYear: 'Jaar uittreksel',
    statementNumber: 'Nummer uittreksel',
    bankRef: 'VDK-refertenummer',
    bankType: 'Soort beweging',
    counterpartyAccount: 'Tegenpartij rekeningnummer',
    counterpartyBic: 'Tegenpartij BIC/SWIFT',
    counterpartyName: 'Tegenpartij naam',
    counterpartyStreet: 'Tegenpartij adres',
    counterpartyPostcode: 'Tegenpartij postnummer',
    counterpartyCity: 'Tegenpartij woonplaats',
    counterpartyCountry: 'Tegenpartij land',
    communication: 'Mededeling',
    balanceAfter: 'Saldo na beweging',
    exchangeRate: 'Wisselkoers',
    costs: 'Kosten',
  },
  cardPayment: { bankTypes: ['Visa Debit betaling'] },
});

export const BUILT_IN_PROFILES = [VDK_PROFILE];

/** Fields a profile can map, with Dutch labels (used by the wizard). */
export const PROFILE_FIELDS = [
  { key: 'entryDate', label: 'Boekingsdatum (uitvoeringsdatum)', required: true },
  { key: 'valueDate', label: 'Valutadatum' },
  { key: 'counterpartyAccount', label: 'Tegenpartij IBAN' },
  { key: 'counterpartyName', label: 'Tegenpartij naam' },
  { key: 'communication', label: 'Mededeling' },
  { key: 'balanceAfter', label: 'Saldo na beweging' },
  { key: 'bankRef', label: 'Referentie (uniek per beweging)' },
  { key: 'bankType', label: 'Soort beweging' },
  { key: 'counterpartyBic', label: 'Tegenpartij BIC' },
  { key: 'statementYear', label: 'Jaar uittreksel' },
  { key: 'statementNumber', label: 'Nummer uittreksel' },
  { key: 'exchangeRate', label: 'Wisselkoers' },
  { key: 'costs', label: 'Kosten' },
];

export function allProfiles(customProfiles = []) {
  return [...BUILT_IN_PROFILES, ...customProfiles];
}

export function findProfile(id, customProfiles = []) {
  return allProfiles(customProfiles).find((p) => p.id === id) ?? null;
}

export const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Index of the header record: the first record that contains all given column names. */
export function findHeaderIndex(records, headerColumns) {
  const wanted = headerColumns.map(norm);
  return records.findIndex((r) => {
    const names = new Set(r.fields.map(norm));
    return wanted.every((w) => names.has(w));
  });
}

export function decodeForProfile(bytes, profile) {
  const { text, encoding } = decodeCodaBytes(bytes);
  const expected = profile?.encoding ?? 'auto';
  const compatible = expected === 'auto' || encoding === 'ascii' || encoding === expected;
  return { text, encoding, warning: compatible ? null : `Bestand is gecodeerd als ${encoding}, profiel verwacht ${expected}; automatisch herkend.` };
}

/**
 * Find the profile for a CSV file: the header row must contain all detection
 * columns. The file name pattern is an extra check, not required.
 */
export function detectProfile(bytes, fileName, customProfiles = [], forceId = null) {
  const candidates = forceId ? allProfiles(customProfiles).filter((p) => p.id === forceId) : allProfiles(customProfiles);
  if (!candidates.length) return { profile: null, reason: forceId ? `profiel "${forceId}" bestaat niet` : 'geen profielen' };
  const { text } = decodeCodaBytes(bytes);
  const parsedByDelimiter = new Map();
  const matches = [];
  for (const p of candidates) {
    if (!parsedByDelimiter.has(p.delimiter)) {
      try {
        parsedByDelimiter.set(p.delimiter, parseCsv(text, { delimiter: p.delimiter, quote: p.quote ?? '"' }));
      } catch {
        parsedByDelimiter.set(p.delimiter, []);
      }
    }
    const records = parsedByDelimiter.get(p.delimiter);
    if (findHeaderIndex(records, p.detect.headerColumns) < 0) continue;
    const nameMatch = p.detect.fileNamePattern ? new RegExp(p.detect.fileNamePattern, 'i').test(fileName ?? '') : false;
    matches.push({ profile: p, score: p.detect.headerColumns.length + (nameMatch ? 100 : 0) });
  }
  if (!matches.length) return { profile: null, reason: 'geen profiel herkent de kopregel' };
  matches.sort((a, b) => b.score - a.score);
  return { profile: matches[0].profile };
}
