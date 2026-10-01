// Belgian structured communication ("gestructureerde mededeling"):
// 12 digits, displayed as +++123/4567/89012+++. The last two digits are a
// check: (first 10 digits) mod 97, where a remainder of 0 becomes 97.

export function structuredCheckDigits(first10) {
  if (!/^\d{10}$/.test(first10)) return null;
  // 10 digits fit easily in a safe integer.
  const r = Number(first10) % 97;
  return r === 0 ? 97 : r;
}

export function isValidStructured(digits12) {
  if (!/^\d{12}$/.test(digits12)) return false;
  return structuredCheckDigits(digits12.slice(0, 10)) === Number(digits12.slice(10));
}

export function formatStructured(digits12) {
  return `+++${digits12.slice(0, 3)}/${digits12.slice(3, 7)}/${digits12.slice(7, 12)}+++`;
}

/** Accepts "+++123/4567/89012+++", "***123/4567/89012***" or 12 digits. */
export function parseStructuredInput(text) {
  const digits = String(text).replace(/[+*/\s]/g, '');
  return /^\d{12}$/.test(digits) ? digits : null;
}
