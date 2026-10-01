// CODA version 2 record layouts (Febelfin "Coded statement of account").
// Positions are 1-based and inclusive, exactly as written in the
// specification, so they can be checked line by line against the document.
//
// Cross-checked against two independent open-source implementations
// (acsone/pycoda and bn3t/coda-rs). The official PDF could not be fetched
// from the build environment; fields where the implementations disagree or
// where the meaning is not certain are marked "TODO verify spec".

export const LINE_LENGTH = 128;

/** Read a fixed-position field: 1-based, inclusive positions. */
export function field(line, from, to) {
  return line.slice(from - 1, to);
}

export const HEADER_0 = {
  recordId: [1, 1], // '0'
  zeros: [2, 5], // '0000'
  creationDate: [6, 11], // DDMMYY
  bankId: [12, 14],
  applicationCode: [15, 16], // '05'
  duplicate: [17, 17], // 'D' when the file is a duplicate, else blank
  fileReference: [25, 34],
  addresseeName: [35, 60],
  bic: [61, 71],
  companyId: [72, 82], // identification number of the Belgium-based account holder
  separateApplication: [84, 88],
  transactionReference: [89, 104],
  relatedReference: [105, 120],
  version: [128, 128], // '2'
};

export const OLD_BALANCE_1 = {
  recordId: [1, 1], // '1'
  accountStructure: [2, 2], // 0 Belgian BBAN, 1 foreign BBAN, 2 Belgian IBAN, 3 foreign IBAN
  paperStatementNumber: [3, 5],
  accountField: [6, 42], // account number + currency, layout depends on accountStructure
  sign: [43, 43], // 0 credit, 1 debit
  balance: [44, 58], // 15 digits, 3 decimals
  balanceDate: [59, 64], // DDMMYY
  holderName: [65, 90],
  description: [91, 125],
  codaSequenceNumber: [126, 128],
};

// Account field layouts, positions relative to the full line (record 1).
// Record 8 uses the same layout shifted one position to the left.
export const ACCOUNT_LAYOUT = {
  0: { number: [6, 17], currency: [19, 21], country: [23, 24] }, // Belgian BBAN (12 digits)
  1: { number: [6, 39], currency: [40, 42] }, // foreign BBAN
  2: { number: [6, 21], currency: [40, 42] }, // Belgian IBAN (16 chars)
  3: { number: [6, 39], currency: [40, 42] }, // foreign IBAN (up to 34 chars)
};

export const MOVEMENT_21 = {
  recordId: [1, 2], // '21'
  sequence: [3, 6], // continuous sequence number
  detail: [7, 10], // detail number
  bankReference: [11, 31],
  sign: [32, 32], // 0 credit, 1 debit
  amount: [33, 47], // 15 digits, 3 decimals
  valueDate: [48, 53], // DDMMYY, 000000 if unknown
  txType: [54, 54],
  txFamily: [55, 56],
  txTransaction: [57, 58],
  txCategory: [59, 61],
  communicationStructured: [62, 62], // 0 free, 1 structured
  communication: [63, 115], // 53 chars
  // when structured: [63,65] = type code (e.g. 101), [66,77] = 12 digits
  communicationType: [63, 65],
  structuredDigits: [66, 77],
  entryDate: [116, 121], // DDMMYY
  paperStatementNumber: [122, 124],
  globalisationCode: [125, 125],
  nextCode: [126, 126], // 1 = a 2.x record follows for this movement
  linkCode: [128, 128], // 1 = a 3.x information record follows
};

export const MOVEMENT_22 = {
  recordId: [1, 2], // '22'
  sequence: [3, 6],
  detail: [7, 10],
  communication: [11, 63], // 53 chars, continuation
  customerReference: [64, 98],
  counterpartyBic: [99, 109],
  rTransactionType: [113, 113],
  isoReasonReturnCode: [114, 117],
  categoryPurpose: [118, 121],
  purpose: [122, 125],
  nextCode: [126, 126],
  linkCode: [128, 128],
};

export const MOVEMENT_23 = {
  recordId: [1, 2], // '23'
  sequence: [3, 6],
  detail: [7, 10],
  counterpartyAccountField: [11, 47], // IBAN [11,44] + currency [45,47], or BBAN [11,22] + blank + currency [24,26]
  counterpartyIban: [11, 44],
  counterpartyIbanCurrency: [45, 47],
  counterpartyBban: [11, 22],
  counterpartyBbanCurrency: [24, 26],
  counterpartyName: [48, 82],
  communication: [83, 125], // 43 chars, continuation
  nextCode: [126, 126],
  linkCode: [128, 128],
};

export const INFORMATION_31 = {
  recordId: [1, 2], // '31'
  sequence: [3, 6],
  detail: [7, 10],
  bankReference: [11, 31],
  txType: [32, 32],
  txFamily: [33, 34],
  txTransaction: [35, 36],
  txCategory: [37, 39],
  communicationStructured: [40, 40],
  communication: [41, 113], // 73 chars
  nextCode: [126, 126],
  linkCode: [128, 128],
};

export const INFORMATION_32 = {
  recordId: [1, 2], // '32'
  sequence: [3, 6],
  detail: [7, 10],
  // TODO verify spec: coda-rs reads 105 chars [11,115], pycoda reads 90 chars [11,100].
  // Reading [11,115] is a superset; trailing blanks are trimmed.
  communication: [11, 115],
  nextCode: [126, 126],
  linkCode: [128, 128],
};

export const INFORMATION_33 = {
  recordId: [1, 2], // '33'
  sequence: [3, 6],
  detail: [7, 10],
  communication: [11, 100], // 90 chars
  nextCode: [126, 126],
  linkCode: [128, 128],
};

export const FREE_COMMUNICATION_4 = {
  recordId: [1, 1], // '4'
  sequence: [3, 6],
  detail: [7, 10],
  text: [33, 112], // 80 chars
  linkCode: [128, 128],
};

export const NEW_BALANCE_8 = {
  recordId: [1, 1], // '8'
  paperStatementNumber: [2, 4],
  accountField: [5, 41], // same layout as record 1 [6,42], shifted by -1
  sign: [42, 42],
  balance: [43, 57],
  balanceDate: [58, 63],
  linkCode: [128, 128],
};

export const TRAILER_9 = {
  recordId: [1, 1], // '9'
  recordCount: [17, 22],
  debitTotal: [23, 37],
  creditTotal: [38, 52],
  multipleFileCode: [128, 128], // 1 = last file, 2 = another file follows
};

// Transaction "type" (first digit of the transaction code, record 2.1 pos 54).
// 0 = simple amount without detailed data
// 1 = amount totalised by the customer   (followed by details of type 5)
// 2 = amount totalised by the bank       (followed by details of type 6/7)
// 3 = simple amount with detailed data   (followed by details of type 8)
// 5..9 = detail lines of a globalisation; these must NOT be counted in the balance.
// TODO verify spec: exact mapping 5..9 to their parents and meaning of type 4.
export const DETAIL_TX_TYPES = new Set(['5', '6', '7', '8', '9']);
export const BOOKED_TX_TYPES = new Set(['0', '1', '2', '3']);
