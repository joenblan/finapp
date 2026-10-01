// Profile-driven CSV export reader: metadata block, header row (found by
// content), movement rows. Produces normalized movements, OLDEST FIRST, with
// their position in the file. No merging and no data-file access here.

import { parseCsv, isEmptyRecord, CsvError } from './csv.js';
import { parseAmount, parseDateTime, NotationError } from './notation.js';
import { findHeaderIndex, norm, decodeForProfile } from './profiles.js';
import { parseCardCommunication, parseCrelanCard, looksLikeCrelanCard } from './card.js';
import { detectStructured } from './structured.js';
import { normalizeIban } from '../coda/parser.js';
import { add, negate } from '../money.js';

const emptyToNull = (s) => {
  const v = String(s ?? '').trim();
  return v === '' ? null : v;
};

/**
 * @returns {{ encoding, issues, meta, account, snapshot, rows, header }}
 *   issues: [{ level: 'error'|'warning', message, line? }]
 */
export function parseCsvExport(bytes, fileName, profile) {
  const issues = [];
  const err = (message, line) => issues.push({ level: 'error', message, line });
  const warn = (message, line) => issues.push({ level: 'warning', message, line });
  const { text, encoding, warning } = decodeForProfile(bytes, profile);
  if (warning) warn(warning);
  const result = { encoding, issues, meta: {}, account: null, snapshot: null, rows: [], header: [] };

  let records;
  try {
    records = parseCsv(text, { delimiter: profile.delimiter, quote: profile.quote ?? '"' });
  } catch (e) {
    if (e instanceof CsvError) err(e.message, e.line);
    else err(e.message);
    return result;
  }

  const headerColumns = profile.detect?.headerColumns?.length ? profile.detect.headerColumns : Object.values(profile.columns).filter(Boolean);
  const headerIdx = profile.headerRow !== undefined && profile.headerRow !== null ? profile.headerRow : findHeaderIndex(records, headerColumns);
  if (headerIdx < 0 || headerIdx >= records.length) {
    err('Kopregel niet gevonden: dit bestand past niet bij het profiel.');
    return result;
  }
  const header = records[headerIdx].fields.map((f) => f.trim());
  result.header = header;
  const col = new Map();
  header.forEach((name, i) => {
    if (name && !col.has(norm(name))) col.set(norm(name), i);
  });

  // Metadata block: "key;value" records before the header (up to the first empty record).
  for (const r of records.slice(0, headerIdx)) {
    if (isEmptyRecord(r)) break;
    const key = r.fields[0]?.trim();
    if (key) result.meta[key] = (r.fields[1] ?? '').trim();
  }

  // Column mapping
  const mapped = {};
  const need = (field, name, required) => {
    if (!name) return;
    const i = col.get(norm(name));
    if (i === undefined) {
      if (required) err(`Kolom "${name}" (${field}) ontbreekt in de kopregel.`, records[headerIdx].line);
      else warn(`Kolom "${name}" (${field}) ontbreekt in de kopregel.`, records[headerIdx].line);
      return;
    }
    mapped[field] = i;
  };
  for (const [field, name] of Object.entries(profile.columns)) need(field, name, field === 'entryDate' || (field === 'bankRef' && profile.key === 'bankRef') || field === 'balanceAfter');
  if (profile.amount.mode === 'debitCredit') {
    need('debit', profile.amount.debit, true);
    need('credit', profile.amount.credit, true);
  } else {
    need('amount', profile.amount.column, true);
  }
  if (profile.ownAccount?.source === 'column') need('ownAccount', profile.ownAccount.column, true);
  if (profile.currencyColumn) need('currency', profile.currencyColumn, true);
  if (profile.order === 'auto' && mapped.balanceAfter === undefined && !issues.some((i) => i.level === 'error')) {
    err('Het profiel bepaalt de volgorde via de saldoketen, maar er is geen saldokolom.');
  }
  if (issues.some((i) => i.level === 'error')) return result;

  // Metadata: own account, snapshot balance, filter
  const md = profile.metadata ?? {};
  const metaValue = (k) => (md[k] ? emptyToNull(result.meta[md[k]]) : null);
  let ownAccount = null;
  if (profile.ownAccount?.source === 'metadata') {
    ownAccount = metaValue('accountNumber') ? normalizeIban(metaValue('accountNumber')) : null;
    if (!ownAccount) err(`Eigen rekeningnummer ("${md.accountNumber}") ontbreekt in de metadata.`);
  } else if (profile.ownAccount?.source === 'fixed') {
    ownAccount = normalizeIban(profile.ownAccount.value);
    if (!ownAccount) err('Het profiel heeft geen vast eigen rekeningnummer.');
  }
  if (profile.detect?.fileNamePattern && profile.detect.fileNameIbanGroup) {
    const m = new RegExp(profile.detect.fileNamePattern, 'i').exec(fileName ?? '');
    if (m) {
      const fromName = normalizeIban(m[profile.detect.fileNameIbanGroup]);
      if (ownAccount && fromName !== ownAccount) {
        err(`Het IBAN in de bestandsnaam (${fromName}) verschilt van het rekeningnummer in het bestand (${ownAccount}).`);
      }
    } else {
      warn('De bestandsnaam volgt niet het verwachte patroon; het IBAN kon niet uit de naam gecontroleerd worden.');
    }
  }
  if (md.filterActive) {
    const f = metaValue('filterActive');
    if (f !== null && !(md.filterInactiveValues ?? []).map(norm).includes(norm(f))) {
      err(`Deze export werd gemaakt met een actieve filter ("${md.filterActive}: ${f}"). Dan ontbreken er bewegingen en klopt de saldoketen niet. Exporteer opnieuw zonder filter.`);
    }
  }
  const numbers = { decimal: profile.decimal, thousands: profile.thousands };
  try {
    const bal = metaValue('balance');
    const at = metaValue('balanceAt');
    if (bal !== null) {
      const dt = at ? parseDateTime(at, profile.dateFormat) : null;
      result.snapshot = { balance: parseAmount(bal, numbers), at: dt ? `${dt.date}${dt.time ? `T${dt.time}` : ''}` : null };
    }
  } catch (e) {
    err(`Metadata: ${e.message}`);
  }
  result.account = {
    number: ownAccount,
    holderName: metaValue('holderName'),
    accountLabel: metaValue('accountLabel'),
  };

  // Movement rows
  const dataRecords = records.slice(headerIdx + 1).filter((r) => !isEmptyRecord(r));
  const rows = [];
  const cardTypes = new Set((profile.cardPayment?.bankTypes ?? []).map(norm));
  dataRecords.forEach((r, filePosition) => {
    const get = (field) => (mapped[field] === undefined ? null : emptyToNull(r.fields[mapped[field]]));
    const raw = (field) => (mapped[field] === undefined ? '' : (r.fields[mapped[field]] ?? ''));
    try {
      const entry = parseDateTime(get('entryDate'), profile.dateFormat);
      if (!entry) throw new NotationError('Boekingsdatum ontbreekt');
      const value = parseDateTime(get('valueDate'), profile.dateFormat);
      let amount;
      if (profile.amount.mode === 'debitCredit') {
        const d = parseAmount(get('debit'), numbers);
        const c = parseAmount(get('credit'), numbers);
        if (d === null && c === null) throw new NotationError('Bedrag ontbreekt');
        // Debit column may hold positive or negative numbers: always an outflow.
        amount = add(c === null ? 0 : c < 0 ? negate(c) : c, d === null ? 0 : d > 0 ? negate(d) : d);
      } else {
        amount = parseAmount(get('amount'), numbers);
        if (amount === null) throw new NotationError('Bedrag ontbreekt');
      }
      const balanceAfter = mapped.balanceAfter === undefined ? null : parseAmount(get('balanceAfter'), numbers);
      if (mapped.balanceAfter !== undefined && balanceAfter === null) throw new NotationError('Saldo na beweging ontbreekt');
      const intOrNull = (field, label) => {
        const v = get(field);
        if (v === null) return null;
        if (!/^\d+$/.test(v)) throw new NotationError(`Ongeldig ${label} "${v}"`);
        return Number(v);
      };
      const commText = raw('communication').replace(/\r\n|\r/g, '\n').trim();
      const structured = detectStructured(commText);
      const bankType = get('bankType');
      const cpAccount = get('counterpartyAccount') ? normalizeIban(get('counterpartyAccount')) : '';
      const counterparty = {
        account: cpAccount,
        isIban: /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cpAccount),
        bic: get('counterpartyBic') ?? '',
        name: get('counterpartyName') ?? '',
        street: get('counterpartyStreet'),
        postcode: get('counterpartyPostcode'),
        city: get('counterpartyCity'),
        country: get('counterpartyCountry'),
      };
      let card = null;
      if (profile.cardPayment?.parser === 'crelan') {
        if ((bankType && cardTypes.has(norm(bankType))) || looksLikeCrelanCard(cpAccount, commText)) {
          card = parseCrelanCard(raw('counterpartyName'), commText);
          if (card.merchant) counterparty.name = card.merchant;
          if (!counterparty.city && card.city) counterparty.city = card.city;
        }
      } else if (bankType && cardTypes.has(norm(bankType))) {
        card = parseCardCommunication(commText);
        if (!counterparty.name && card.merchant) counterparty.name = card.merchant;
        if (!counterparty.city && card.city) counterparty.city = card.city;
      }
      const costsText = get('costs');
      let costs = null;
      if (costsText !== null) {
        let costsAmount = null;
        try {
          costsAmount = parseAmount(costsText, numbers);
        } catch {
          warn(`Kosten "${costsText}" niet als bedrag herkend; als tekst bewaard.`, r.line);
        }
        costs = { text: costsText, amount: costsAmount };
      }
      const accountCurrency = profile.currency ?? 'EUR';
      const currency = mapped.currency === undefined ? accountCurrency : (get('currency') ?? accountCurrency).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new NotationError(`Ongeldige munt "${currency}"`);
      const bankRef = get('bankRef');
      if (profile.key === 'bankRef' && !bankRef) throw new NotationError(`Referentie ("${profile.columns.bankRef}") ontbreekt`);
      rows.push({
        line: r.line,
        filePosition,
        bankRef,
        entryDate: entry.date,
        valueDate: value?.date ?? null,
        statementYear: intOrNull('statementYear', 'jaar uittreksel'),
        statementNumber: intOrNull('statementNumber', 'nummer uittreksel'),
        bankType,
        amount,
        balanceAfter,
        counterparty,
        communication: { structured: structured?.structured ?? null, structuredValid: structured?.structuredValid ?? null, text: commText },
        card,
        costs,
        exchangeRate: get('exchangeRate'),
        ownAccount: mapped.ownAccount === undefined ? null : normalizeIban(get('ownAccount')),
        ...(currency !== accountCurrency ? { currency, foreignCurrency: true } : {}),
      });
    } catch (e) {
      err(e.message, r.line);
    }
  });

  if (profile.ownAccount?.source === 'column') {
    const missing = rows.filter((r) => !r.ownAccount);
    const set = new Set(rows.map((r) => r.ownAccount).filter(Boolean));
    if (missing.length) {
      err(`Eigen rekeningnummer ("${profile.ownAccount.column}") ontbreekt op ${missing.length} rij(en), o.a. regel ${missing[0].line}.`);
    } else if (set.size > 1) {
      err(`Het bestand bevat bewegingen van meer dan één eigen rekening (${[...set].join(', ')}). Exporteer per rekening een apart bestand.`);
    } else if (set.size === 1) {
      result.account.number = [...set][0];
    }
  }
  for (const r of rows) {
    if (r.foreignCurrency) warn(`Beweging in andere munt (${r.currency}): niet omgerekend; staat bij "Nakijken".`, r.line);
  }

  if (profile.order === 'auto') {
    if (issues.some((i) => i.level === 'error')) return result;
    const dir = detectDirection(rows);
    if (!dir) {
      err('De saldoketen sluit in geen enkele richting (niet van boven naar onder en niet van onder naar boven). Het bestand is onvolledig of gefilterd.');
      return result;
    }
    if (dir === 'ambiguous') warn('De volgorde kon niet eenduidig uit de saldoketen afgeleid worden; oudste beweging bovenaan aangenomen.');
    result.detectedOrder = dir === 'newest-first' ? 'newest-first' : 'oldest-first';
    result.rows = result.detectedOrder === 'newest-first' ? rows.reverse() : rows;
    return result;
  }
  result.rows = profile.order === 'newest-first' ? rows.reverse() : rows;
  return result;
}

/** Does `list` (oldest first) form a closed balance chain? Rows in another currency are not linked. */
export function chainCloses(list) {
  for (let i = 1; i < list.length; i++) {
    if (list[i].foreignCurrency) continue;
    if (add(list[i - 1].balanceAfter, list[i].amount) !== list[i].balanceAfter) return false;
  }
  return true;
}

/**
 * Direction of the rows in the file, from the balance chain.
 * @returns 'oldest-first' | 'newest-first' | 'ambiguous' | null (closes in neither direction)
 */
export function detectDirection(rows) {
  if (rows.length <= 1) return 'oldest-first';
  const forward = chainCloses(rows);
  const backward = chainCloses([...rows].reverse());
  if (forward && backward) return 'ambiguous';
  if (forward) return 'oldest-first';
  if (backward) return 'newest-first';
  return null;
}
