// Stable keys. A transaction key is: account | statement year | statement
// number | sequence number | detail number. The statement year is taken from
// the new balance date (record 8), because the first statement of a year has
// an old balance dated 31/12 of the previous year.

export function statementId(accountId, year, number) {
  return `${accountId}|${year}|${String(number).padStart(3, '0')}`;
}

export function transactionId(stmtId, sequence, detail) {
  return `${stmtId}|${String(sequence).padStart(4, '0')}|${String(detail).padStart(4, '0')}`;
}

export function yearOf(isoDate) {
  return Number(isoDate.slice(0, 4));
}

export function formatIban(iban) {
  return String(iban || '').replace(/(.{4})(?=.)/g, '$1 ');
}
