// Builds SYNTHETIC CODA v2 files for tests and samples. All IBANs, names and
// references are fictitious. Lines are composed field by field from the
// specification's field lengths (independently of the parser's slice
// positions), and every line is asserted to be exactly 128 characters.

const pad = (s, n) => {
  const v = String(s ?? '');
  if (v.length > n) throw new Error(`Field too long (${v.length} > ${n}): "${v}"`);
  return v.padEnd(n, ' ');
};
const num = (v, n) => {
  const s = String(v);
  if (!/^\d+$/.test(s) || s.length > n) throw new Error(`Invalid numeric field "${s}" (${n})`);
  return s.padStart(n, '0');
};
const amt = (milli) => num(Math.abs(milli), 15);
const sign = (milli) => (milli < 0 ? '1' : '0');

/** 'YYYY-MM-DD' -> 'DDMMYY' */
export function ddmmyy(iso) {
  if (iso === null) return '000000';
  const [y, m, d] = iso.split('-');
  return `${d}${m}${y.slice(2)}`;
}

function line(...parts) {
  const l = parts.join('');
  if (l.length !== 128) throw new Error(`Line length ${l.length} != 128: "${l}"`);
  return l;
}

/** Compute a valid Belgian IBAN from a 10-digit base (BBAN check digits added). */
export function belgianIban(base10) {
  const r = Number(base10) % 97;
  const bban = base10 + String(r === 0 ? 97 : r).padStart(2, '0');
  // IBAN check digits: move "BE00" to the end, letters -> numbers (B=11, E=14).
  const rearranged = bban + '111400';
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  const check = String(98 - rem).padStart(2, '0');
  return `BE${check}${bban}`;
}

export function structuredDigits(base10) {
  const r = Number(base10) % 97;
  return base10 + String(r === 0 ? 97 : r).padStart(2, '0');
}

export function headerRecord({ creationDate, bankId = '999', duplicate = false, fileReference = 'TESTREF', addressee = 'FICTIEF PERSOON', bic = 'TESTBEBB', companyId = '', version = '2' }) {
  return line(
    '0', // 1
    '0000', // 2-5
    ddmmyy(creationDate), // 6-11
    num(bankId, 3), // 12-14
    '05', // 15-16
    duplicate ? 'D' : ' ', // 17
    pad('', 7), // 18-24
    pad(fileReference, 10), // 25-34
    pad(addressee, 26), // 35-60
    pad(bic, 11), // 61-71
    pad(companyId, 11), // 72-82
    ' ', // 83
    pad('', 5), // 84-88 separate application
    pad('', 16), // 89-104 transaction reference
    pad('', 16), // 105-120 related reference
    pad('', 7), // 121-127
    version, // 128
  );
}

function accountField(iban, currency) {
  // Structure 2: Belgian IBAN in 16 positions, blanks, currency at 40-42 (37 chars total)
  return pad(iban, 34) + pad(currency, 3);
}

export function oldBalanceRecord({ iban, currency = 'EUR', statementNumber, balance, date, holder = 'FICTIEF PERSOON', description = 'ZICHTREKENING', codaSeq }) {
  return line(
    '1', // 1
    '2', // 2 Belgian IBAN
    num(statementNumber, 3), // 3-5
    accountField(iban, currency), // 6-42
    sign(balance), // 43
    amt(balance), // 44-58
    ddmmyy(date), // 59-64
    pad(holder, 26), // 65-90
    pad(description, 35), // 91-125
    num(codaSeq ?? statementNumber, 3), // 126-128
  );
}

export function movementRecords(m) {
  const {
    seq,
    detail = 0,
    bankRef = `REF${num(seq, 4)}`,
    amount,
    valueDate,
    entryDate,
    txType = '0',
    family = '01',
    transaction = '01',
    category = '000',
    structured = null, // 12 digits
    communication = '',
    statementNumber,
    globalisation = '0',
    counterparty = null, // { iban, name, bic, currency }
    customerRef = '',
    info = null, // { text }
  } = m;
  const hasCounterparty = !!counterparty;
  const comm = structured ? '' : communication;
  const c1 = comm.slice(0, 53);
  const c2 = comm.slice(53, 106);
  const c3 = comm.slice(106, 149);
  if (comm.length > 149) throw new Error('communication too long for builder');
  const need22 = hasCounterparty || c2 !== '' || customerRef !== '';
  const need23 = hasCounterparty || c3 !== '';
  const lines = [];
  const commField = structured ? '101' + structured + pad('', 38) : pad(c1, 53);
  lines.push(
    line(
      '21', // 1-2
      num(seq, 4), // 3-6
      num(detail, 4), // 7-10
      pad(bankRef, 21), // 11-31
      sign(amount), // 32
      amt(amount), // 33-47
      ddmmyy(valueDate ?? entryDate), // 48-53
      txType + family + transaction + category, // 54-61
      structured ? '1' : '0', // 62
      commField, // 63-115
      ddmmyy(entryDate), // 116-121
      num(statementNumber, 3), // 122-124
      globalisation, // 125
      need22 || need23 ? '1' : '0', // 126 next code
      ' ', // 127
      info && !need22 && !need23 ? '1' : '0', // 128 link code
    ),
  );
  if (need22 || need23) {
    lines.push(
      line(
        '22',
        num(seq, 4),
        num(detail, 4),
        pad(c2, 53), // 11-63
        pad(customerRef, 35), // 64-98
        pad(counterparty?.bic ?? '', 11), // 99-109
        pad('', 3), // 110-112
        ' ', // 113
        pad('', 4), // 114-117
        pad('', 4), // 118-121
        pad('', 4), // 122-125
        need23 ? '1' : '0', // 126
        ' ',
        info && !need23 ? '1' : '0', // 128
      ),
    );
  }
  if (need23) {
    lines.push(
      line(
        '23',
        num(seq, 4),
        num(detail, 4),
        pad(counterparty?.iban ?? '', 34) + pad(counterparty?.currency ?? (counterparty ? 'EUR' : ''), 3), // 11-47
        pad(counterparty?.name ?? '', 35), // 48-82
        pad(c3, 43), // 83-125
        '0', // 126
        ' ',
        info ? '1' : '0', // 128
      ),
    );
  }
  if (info) {
    const t = info.text;
    lines.push(
      line(
        '31',
        num(seq, 4),
        num(detail, 4),
        pad(bankRef, 21), // 11-31
        txType + family + transaction + category, // 32-39
        '0', // 40
        pad(t.slice(0, 73), 73), // 41-113
        pad('', 12), // 114-125
        t.length > 73 ? '1' : '0', // 126
        ' ',
        '0',
      ),
    );
    if (t.length > 73) {
      lines.push(line('32', num(seq, 4), num(detail, 4), pad(t.slice(73, 178), 105), pad('', 10), '0', ' ', '0'));
    }
  }
  return lines;
}

export function freeCommunicationRecord({ seq = 1, detail = 0, text }) {
  return line('4', ' ', num(seq, 4), num(detail, 4), pad('', 22), pad(text, 80), pad('', 15), '0');
}

export function newBalanceRecord({ iban, currency = 'EUR', statementNumber, balance, date }) {
  return line(
    '8', // 1
    num(statementNumber, 3), // 2-4
    accountField(iban, currency), // 5-41
    sign(balance), // 42
    amt(balance), // 43-57
    ddmmyy(date), // 58-63
    pad('', 64), // 64-127
    '0', // 128
  );
}

export function trailerRecord({ recordCount, debitTotal, creditTotal, last = true }) {
  return line('9', pad('', 15), num(recordCount, 6), amt(debitTotal), amt(creditTotal), pad('', 75), last ? '1' : '2');
}

/**
 * Build one complete statement (records 0..9).
 * opts: { iban, statementNumber, oldBalance, oldDate, newDate, movements:[...], free:[...],
 *         creationDate, override: { newBalance, debitTotal, creditTotal, recordCount } }
 */
export function buildStatement(opts) {
  const { iban, statementNumber, oldBalance, oldDate, newDate, movements = [], free = [], override = {}, holder, description, last = true } = opts;
  const lines = [headerRecord({ creationDate: opts.creationDate ?? newDate, addressee: holder })];
  lines.push(oldBalanceRecord({ iban, statementNumber, balance: oldBalance, date: oldDate, holder, description }));
  let balance = oldBalance;
  let debit = 0;
  let credit = 0;
  for (const m of movements) {
    lines.push(...movementRecords({ statementNumber, entryDate: newDate, ...m }));
    const isDetail = ['5', '6', '7', '8', '9'].includes(m.txType ?? '0');
    if (!isDetail) {
      balance += m.amount;
      if (m.amount < 0) debit += -m.amount;
      else credit += m.amount;
    }
  }
  for (const f of free) lines.push(freeCommunicationRecord(f));
  const newBalance = override.newBalance ?? balance;
  lines.push(newBalanceRecord({ iban, statementNumber, balance: newBalance, date: newDate }));
  const recordCount = override.recordCount ?? lines.length - 1; // records 1..8 (excludes header 0)
  lines.push(
    trailerRecord({
      recordCount,
      debitTotal: override.debitTotal ?? debit,
      creditTotal: override.creditTotal ?? credit,
      last,
    }),
  );
  return { lines, newBalance };
}

export function toFileText(lines, eol = '\r\n') {
  return lines.join(eol) + eol;
}

/** Encode text to Windows-1252 bytes (only handles Latin-1 range + €). */
export function encodeWindows1252(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x20ac) out[i] = 0x80;
    else if (c <= 0xff) out[i] = c;
    else throw new Error(`Character not encodable in test helper: ${text[i]}`);
  }
  return out;
}

// Fictitious account numbers used across tests.
export const IBAN_A = belgianIban('9990000001'); // "Zichtrekening Test"
export const IBAN_B = belgianIban('9990000002'); // "Spaarrekening Test"
export const IBAN_C = belgianIban('9990000003'); // counterparty
