// Pure CODA v2 parser: no DOM, no I/O. Input: bytes (Uint8Array/ArrayBuffer)
// or a string. Output: statements with merged movements plus a list of issues.
// Balance and trailer checks are done in core/checks/balance.js.

import { decodeCodaBytes } from './decode.js';
import { isValidStructured, formatStructured } from './structured.js';
import { parseDigitsToMilli, negate } from '../money.js';
import {
  LINE_LENGTH,
  field,
  HEADER_0,
  OLD_BALANCE_1,
  ACCOUNT_LAYOUT,
  MOVEMENT_21,
  MOVEMENT_22,
  MOVEMENT_23,
  INFORMATION_31,
  INFORMATION_32,
  INFORMATION_33,
  FREE_COMMUNICATION_4,
  NEW_BALANCE_8,
  TRAILER_9,
  DETAIL_TX_TYPES,
  BOOKED_TX_TYPES,
} from './records.js';

class LineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const get = (line, layout, name) => field(line, layout[name][0], layout[name][1]);
const trimmed = (line, layout, name) => collapse(get(line, layout, name));
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** DDMMYY -> 'YYYY-MM-DD'. Returns null for 000000 when allowZero. */
export function parseCodaDate(ddmmyy, { allowZero = false } = {}) {
  if (allowZero && (ddmmyy === '000000' || ddmmyy.trim() === '')) return null;
  if (!/^\d{6}$/.test(ddmmyy)) throw new LineError('DATE', `Ongeldige datum "${ddmmyy}"`);
  const dd = Number(ddmmyy.slice(0, 2));
  const mm = Number(ddmmyy.slice(2, 4));
  const yy = Number(ddmmyy.slice(4, 6));
  // CODA uses 2-digit years. Pivot: 80-99 => 19xx, 00-79 => 20xx.
  const yyyy = yy >= 80 ? 1900 + yy : 2000 + yy;
  const daysInMonth = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  if (mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth) {
    throw new LineError('DATE', `Ongeldige datum "${ddmmyy}"`);
  }
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function parseSign(ch) {
  if (ch === '0') return 1; // credit
  if (ch === '1') return -1; // debit
  throw new LineError('SIGN', `Ongeldig teken "${ch}" (verwacht 0 = credit of 1 = debet)`);
}

function parseAmount(digits, signChar) {
  if (!/^\d{15}$/.test(digits)) throw new LineError('AMOUNT', `Ongeldig bedrag "${digits}"`);
  const milli = parseDigitsToMilli(digits);
  return parseSign(signChar) < 0 ? negate(milli) : milli;
}

function parseInt10(s, label) {
  if (!/^\d+$/.test(s)) throw new LineError('NUMBER', `Ongeldig ${label} "${s}"`);
  return Number(s);
}

export function normalizeIban(s) {
  return String(s || '').replace(/\s+/g, '').toUpperCase();
}

/** Parse the account field of record 1 (shift 0) or record 8 (shift -1). */
function parseAccount(line, structure, shift) {
  const layout = ACCOUNT_LAYOUT[structure];
  if (!layout) throw new LineError('ACCOUNT', `Onbekende rekeningstructuur "${structure}"`);
  const f = ([a, b]) => line.slice(a - 1 + shift, b + shift);
  const number = normalizeIban(f(layout.number));
  const currency = f(layout.currency).trim();
  const isIban = structure === '2' || structure === '3';
  return { structure, number, currency, isIban, country: layout.country ? f(layout.country).trim() : null };
}

/** Split text into logical CODA lines. */
function splitLines(text) {
  let lines = text.split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  // Some banks deliver files without line breaks: one long string of 128-char records.
  if (lines.length === 1 && lines[0].length > LINE_LENGTH && lines[0].length % LINE_LENGTH === 0) {
    const one = lines[0];
    lines = [];
    for (let i = 0; i < one.length; i += LINE_LENGTH) lines.push(one.slice(i, i + LINE_LENGTH));
  }
  return lines;
}

function emptyStatement(lineNo) {
  return {
    lineFrom: lineNo,
    lineTo: lineNo,
    header: null,
    account: null,
    paperStatementNumber: null,
    codaSequenceNumber: null,
    oldBalance: null,
    oldBalanceDate: null,
    holderName: '',
    description: '',
    newBalance: null,
    newBalanceDate: null,
    newBalancePaperStatementNumber: null,
    movements: [],
    information: [], // information records that could not be linked to a movement
    freeCommunications: [],
    trailer: null,
    counts: { records: 0, freeCommunicationRecords: 0 },
  };
}

/**
 * Parse a CODA file.
 * @returns {{ encoding: string, statements: object[], issues: {level:'error'|'warning', code:string, message:string, line?:number}[] }}
 */
export function parseCoda(input) {
  const { text, encoding } = decodeCodaBytes(input);
  const issues = [];
  const statements = [];
  const err = (code, message, line) => issues.push({ level: 'error', code, message, line });
  const warn = (code, message, line) => issues.push({ level: 'warning', code, message, line });

  const lines = splitLines(text);
  if (lines.length === 0) {
    err('EMPTY', 'Het bestand is leeg.');
    return { encoding, statements, issues };
  }

  let st = null; // current statement
  let movement = null; // last 2.1 movement in current statement
  let info = null; // last 3.1 information record in current statement
  let free = null; // last record 4

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = lines[i];
    if (line.length > LINE_LENGTH) {
      if (line.slice(LINE_LENGTH).trim() === '') {
        line = line.slice(0, LINE_LENGTH);
      } else {
        err('LINE_LENGTH', `Regel is ${line.length} tekens lang, verwacht ${LINE_LENGTH}.`, lineNo);
        continue;
      }
    }
    if (line.trim() === '') {
      warn('BLANK_LINE', 'Lege regel overgeslagen.', lineNo);
      continue;
    }
    line = line.padEnd(LINE_LENGTH, ' ');
    const rec = line[0];

    try {
      if (rec !== '0' && !st) {
        throw new LineError('NO_HEADER', `Record ${rec} zonder voorafgaand headerrecord 0.`);
      }
      if (st && st.trailer && rec !== '0') {
        throw new LineError('AFTER_TRAILER', `Record ${rec} na trailerrecord 9 zonder nieuw headerrecord 0.`);
      }
      if (rec !== '0' && rec !== '9') st.lineTo = lineNo;

      switch (rec) {
        case '0': {
          if (st && !st.trailer) {
            err('MISSING_TRAILER', 'Uittreksel zonder trailerrecord 9.', lineNo - 1);
          }
          st = emptyStatement(lineNo);
          statements.push(st);
          movement = info = free = null;
          const version = get(line, HEADER_0, 'version');
          st.header = {
            creationDate: parseCodaDate(get(line, HEADER_0, 'creationDate')),
            bankId: get(line, HEADER_0, 'bankId').trim(),
            applicationCode: get(line, HEADER_0, 'applicationCode'),
            duplicate: get(line, HEADER_0, 'duplicate') === 'D',
            fileReference: trimmed(line, HEADER_0, 'fileReference'),
            addresseeName: trimmed(line, HEADER_0, 'addresseeName'),
            bic: trimmed(line, HEADER_0, 'bic'),
            companyId: trimmed(line, HEADER_0, 'companyId'),
            separateApplication: trimmed(line, HEADER_0, 'separateApplication'),
            version,
          };
          if (get(line, HEADER_0, 'zeros') !== '0000') {
            throw new LineError('HEADER', 'Headerrecord 0: posities 2-5 moeten "0000" zijn.');
          }
          if (version !== '2') {
            throw new LineError('VERSION', `CODA-versie "${version}" wordt niet ondersteund (enkel versie 2).`);
          }
          if (st.header.applicationCode !== '05') {
            warn('APP_CODE', `Onverwachte applicatiecode "${st.header.applicationCode}" (verwacht 05).`, lineNo);
          }
          break;
        }
        case '1': {
          if (st.account) throw new LineError('DUP_RECORD_1', 'Tweede record 1 binnen hetzelfde uittreksel.');
          const structure = get(line, OLD_BALANCE_1, 'accountStructure');
          st.account = parseAccount(line, structure, 0);
          if (!st.account.number) throw new LineError('ACCOUNT', 'Rekeningnummer ontbreekt in record 1.');
          st.paperStatementNumber = parseInt10(get(line, OLD_BALANCE_1, 'paperStatementNumber'), 'uittrekselnummer');
          st.codaSequenceNumber = get(line, OLD_BALANCE_1, 'codaSequenceNumber').trim();
          st.oldBalance = parseAmount(get(line, OLD_BALANCE_1, 'balance'), get(line, OLD_BALANCE_1, 'sign'));
          st.oldBalanceDate = parseCodaDate(get(line, OLD_BALANCE_1, 'balanceDate'));
          st.holderName = trimmed(line, OLD_BALANCE_1, 'holderName');
          st.description = trimmed(line, OLD_BALANCE_1, 'description');
          st.counts.records++;
          break;
        }
        case '2': {
          if (!st.account) throw new LineError('ORDER', 'Bewegingsrecord vóór record 1.');
          const kind = line[1];
          const sequence = parseInt10(field(line, 3, 6), 'volgnummer');
          const detail = parseInt10(field(line, 7, 10), 'detailnummer');
          st.counts.records++;
          if (kind === '1') {
            movement = parseMovement21(line, sequence, detail, lineNo, warn);
            st.movements.push(movement);
            info = null;
          } else if (kind === '2' || kind === '3') {
            if (!movement || movement.sequence !== sequence || movement.detail !== detail) {
              throw new LineError(
                'ORPHAN_2X',
                `Record 2${kind} (volgnr ${sequence}, detail ${detail}) hoort niet bij een voorafgaand record 21.`,
              );
            }
            if (movement._seen.has(kind)) throw new LineError('DUP_2X', `Record 2${kind} komt dubbel voor.`);
            movement._seen.add(kind);
            movement.lines.push(lineNo);
            if (kind === '2') applyMovement22(movement, line);
            else applyMovement23(movement, line);
          } else {
            throw new LineError('RECORD_TYPE', `Onbekend recordtype 2${kind}.`);
          }
          break;
        }
        case '3': {
          if (!st.account) throw new LineError('ORDER', 'Informatierecord vóór record 1.');
          const kind = line[1];
          const sequence = parseInt10(field(line, 3, 6), 'volgnummer');
          const detail = parseInt10(field(line, 7, 10), 'detailnummer');
          st.counts.records++;
          if (kind === '1') {
            info = {
              sequence,
              detail,
              bankReference: trimmed(line, INFORMATION_31, 'bankReference'),
              txCode: {
                type: get(line, INFORMATION_31, 'txType'),
                family: get(line, INFORMATION_31, 'txFamily'),
                transaction: get(line, INFORMATION_31, 'txTransaction'),
                category: get(line, INFORMATION_31, 'txCategory'),
              },
              structured: get(line, INFORMATION_31, 'communicationStructured') === '1',
              _raw: get(line, INFORMATION_31, 'communication'),
              text: '',
              lines: [lineNo],
            };
            info.text = collapse(info._raw);
            // Link to the movement with the same sequence + detail number.
            const target = [...st.movements].reverse().find((m) => m.sequence === sequence && m.detail === detail);
            if (target) {
              target.information.push(info);
            } else {
              st.information.push(info);
              warn(
                'ORPHAN_31',
                `Informatierecord 31 (volgnr ${sequence}, detail ${detail}) zonder bijhorende beweging; apart bewaard.`,
                lineNo,
              );
            }
          } else if (kind === '2' || kind === '3') {
            if (!info || info.sequence !== sequence || info.detail !== detail) {
              throw new LineError(
                'ORPHAN_3X',
                `Record 3${kind} (volgnr ${sequence}, detail ${detail}) hoort niet bij een voorafgaand record 31.`,
              );
            }
            const layout = kind === '2' ? INFORMATION_32 : INFORMATION_33;
            info._raw += get(line, layout, 'communication');
            info.text = collapse(info._raw);
            info.lines.push(lineNo);
          } else {
            throw new LineError('RECORD_TYPE', `Onbekend recordtype 3${kind}.`);
          }
          break;
        }
        case '4': {
          if (!st.account) throw new LineError('ORDER', 'Record 4 vóór record 1.');
          const sequence = parseInt10(get(line, FREE_COMMUNICATION_4, 'sequence'), 'volgnummer');
          const detail = parseInt10(get(line, FREE_COMMUNICATION_4, 'detail'), 'detailnummer');
          st.counts.records++;
          st.counts.freeCommunicationRecords++;
          const textPart = get(line, FREE_COMMUNICATION_4, 'text');
          if (free && free.sequence === sequence && free.detail === detail) {
            free._raw += textPart;
          } else {
            free = { sequence, detail, _raw: textPart, text: '' };
            st.freeCommunications.push(free);
          }
          free.text = collapse(free._raw);
          break;
        }
        case '8': {
          if (!st.account) throw new LineError('ORDER', 'Record 8 vóór record 1.');
          if (st.newBalance !== null) throw new LineError('DUP_RECORD_8', 'Tweede record 8 binnen hetzelfde uittreksel.');
          const acc = parseAccount(line, st.account.structure, -1);
          if (acc.number !== st.account.number) {
            throw new LineError(
              'ACCOUNT_MISMATCH',
              `Rekening in record 8 (${acc.number}) verschilt van record 1 (${st.account.number}).`,
            );
          }
          st.newBalancePaperStatementNumber = parseInt10(get(line, NEW_BALANCE_8, 'paperStatementNumber'), 'uittrekselnummer');
          if (st.newBalancePaperStatementNumber !== st.paperStatementNumber) {
            warn(
              'STATEMENT_NUMBER_MISMATCH',
              `Uittrekselnummer in record 8 (${st.newBalancePaperStatementNumber}) verschilt van record 1 (${st.paperStatementNumber}).`,
              lineNo,
            );
          }
          st.newBalance = parseAmount(get(line, NEW_BALANCE_8, 'balance'), get(line, NEW_BALANCE_8, 'sign'));
          st.newBalanceDate = parseCodaDate(get(line, NEW_BALANCE_8, 'balanceDate'));
          st.counts.records++;
          break;
        }
        case '9': {
          if (!st.account) throw new LineError('ORDER', 'Trailerrecord 9 zonder record 1.');
          if (st.newBalance === null) err('MISSING_RECORD_8', 'Uittreksel zonder record 8 (nieuw saldo).', lineNo);
          const digits = (name, n) => {
            const v = get(line, TRAILER_9, name);
            if (!new RegExp(`^\\d{${n}}$`).test(v)) throw new LineError('TRAILER', `Ongeldig veld in trailer: "${v}"`);
            return v;
          };
          st.trailer = {
            recordCount: Number(digits('recordCount', 6)),
            debitTotal: parseDigitsToMilli(digits('debitTotal', 15)),
            creditTotal: parseDigitsToMilli(digits('creditTotal', 15)),
            multipleFileCode: get(line, TRAILER_9, 'multipleFileCode'),
          };
          st.lineTo = lineNo;
          movement = info = free = null;
          break;
        }
        default:
          throw new LineError('RECORD_TYPE', `Onbekend recordtype "${rec}".`);
      }
    } catch (e) {
      if (e instanceof LineError) err(e.code, e.message, lineNo);
      else err('PARSE', e.message, lineNo);
    }
  }

  if (st && !st.trailer) err('MISSING_TRAILER', 'Het bestand eindigt zonder trailerrecord 9.', lines.length);
  for (const s of statements) {
    if (!s.account) err('MISSING_RECORD_1', `Uittreksel (regel ${s.lineFrom}) zonder record 1 (oud saldo).`, s.lineFrom);
    for (const m of s.movements) {
      if (m.nextCode === '1') {
        warn('NEXT_CODE', `Beweging volgnr ${m.sequence}: record 21 kondigt een vervolgrecord aan dat ontbreekt.`, m.line);
      }
      finalizeMovement(m);
    }
    for (const inf of s.information) delete inf._raw;
    for (const f of s.freeCommunications) delete f._raw;
  }

  return { encoding, statements, issues };
}

function parseMovement21(line, sequence, detail, lineNo, warn) {
  const txType = get(line, MOVEMENT_21, 'txType');
  const structured = get(line, MOVEMENT_21, 'communicationStructured');
  if (structured !== '0' && structured !== '1') {
    throw new LineError('COMM_FLAG', `Ongeldige mededelingscode "${structured}".`);
  }
  const m = {
    sequence,
    detail,
    bankReference: trimmed(line, MOVEMENT_21, 'bankReference'),
    amount: parseAmount(get(line, MOVEMENT_21, 'amount'), get(line, MOVEMENT_21, 'sign')),
    valueDate: parseCodaDate(get(line, MOVEMENT_21, 'valueDate'), { allowZero: true }),
    entryDate: parseCodaDate(get(line, MOVEMENT_21, 'entryDate')),
    txCode: {
      type: txType,
      family: get(line, MOVEMENT_21, 'txFamily'),
      transaction: get(line, MOVEMENT_21, 'txTransaction'),
      category: get(line, MOVEMENT_21, 'txCategory'),
    },
    isDetail: DETAIL_TX_TYPES.has(txType),
    paperStatementNumber: get(line, MOVEMENT_21, 'paperStatementNumber').trim(),
    globalisationCode: get(line, MOVEMENT_21, 'globalisationCode'),
    nextCode: get(line, MOVEMENT_21, 'nextCode'),
    linkCode: get(line, MOVEMENT_21, 'linkCode'),
    communication: { structured: null, structuredType: null, structuredValid: null, text: '' },
    customerReference: '',
    counterparty: { account: '', isIban: false, currency: '', bic: '', name: '' },
    purpose: { categoryPurpose: '', purpose: '', rTransactionType: '', isoReasonReturnCode: '' },
    information: [],
    line: lineNo,
    lines: [lineNo],
    _seen: new Set(),
    _comm: [],
  };
  if (!DETAIL_TX_TYPES.has(txType) && !BOOKED_TX_TYPES.has(txType)) {
    // TODO verify spec: meaning of type 4.
    warn('TX_TYPE', `Onbekend transactietype "${txType}" bij volgnr ${sequence}; als gewone beweging behandeld.`, lineNo);
  }
  if (structured === '1') {
    const type = get(line, MOVEMENT_21, 'communicationType');
    m.communication.structuredType = type;
    // 101 = Belgian structured reference (+++xxx/xxxx/xxxxx+++).
    // TODO verify spec: 102 is treated identically to 101.
    if (type === '101' || type === '102') {
      const digits = get(line, MOVEMENT_21, 'structuredDigits');
      if (/^\d{12}$/.test(digits)) {
        m.communication.structured = formatStructured(digits);
        m.communication.structuredValid = isValidStructured(digits);
        m._comm.push(line.slice(MOVEMENT_21.structuredDigits[1], MOVEMENT_21.communication[1]));
      } else {
        m._comm.push(field(line, 66, 115));
      }
    } else {
      // Other structured formats (e.g. ISO RF reference, SEPA details): keep the text.
      m._comm.push(field(line, 66, 115));
    }
  } else {
    m._comm.push(get(line, MOVEMENT_21, 'communication'));
  }
  return m;
}

function applyMovement22(m, line) {
  m._comm.push(get(line, MOVEMENT_22, 'communication'));
  m.customerReference = trimmed(line, MOVEMENT_22, 'customerReference');
  m.counterparty.bic = trimmed(line, MOVEMENT_22, 'counterpartyBic');
  m.purpose = {
    categoryPurpose: trimmed(line, MOVEMENT_22, 'categoryPurpose'),
    purpose: trimmed(line, MOVEMENT_22, 'purpose'),
    rTransactionType: trimmed(line, MOVEMENT_22, 'rTransactionType'),
    isoReasonReturnCode: trimmed(line, MOVEMENT_22, 'isoReasonReturnCode'),
  };
  m.nextCode = get(line, MOVEMENT_22, 'nextCode');
  m.linkCode = get(line, MOVEMENT_22, 'linkCode');
}

function applyMovement23(m, line) {
  const bban = get(line, MOVEMENT_23, 'counterpartyBban');
  // A Belgian BBAN is 12 digits followed by a blank at position 23; otherwise IBAN.
  if (/^\d{12}$/.test(bban) && line[22] === ' ') {
    m.counterparty.account = bban;
    m.counterparty.isIban = false;
    m.counterparty.currency = trimmed(line, MOVEMENT_23, 'counterpartyBbanCurrency');
  } else {
    m.counterparty.account = normalizeIban(get(line, MOVEMENT_23, 'counterpartyIban'));
    m.counterparty.isIban = m.counterparty.account !== '';
    m.counterparty.currency = trimmed(line, MOVEMENT_23, 'counterpartyIbanCurrency');
  }
  m.counterparty.name = trimmed(line, MOVEMENT_23, 'counterpartyName');
  m._comm.push(get(line, MOVEMENT_23, 'communication'));
  m.nextCode = get(line, MOVEMENT_23, 'nextCode');
  m.linkCode = get(line, MOVEMENT_23, 'linkCode');
}

function finalizeMovement(m) {
  // Communication is wrapped at fixed widths across 21/22/23, so the raw
  // segments are concatenated without separator and whitespace collapsed.
  m.communication.text = collapse(m._comm.join(''));
  for (const inf of m.information) delete inf._raw;
  delete m._comm;
  delete m._seen;
}
