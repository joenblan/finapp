import { isValidStructured, formatStructured } from '../coda/structured.js';

// A communication that consists only of a Belgian structured reference,
// written as +++123/4567/89002+++ or ***123/4567/89002***.
const RE = /^\s*(\+{3}|\*{3})\s*(\d{3})\s*\/\s*(\d{4})\s*\/\s*(\d{5})\s*(\+{3}|\*{3})\s*$/;

export function detectStructured(text) {
  const m = RE.exec(String(text ?? ''));
  if (!m) return null;
  const digits = m[2] + m[3] + m[4];
  return { structured: formatStructured(digits), structuredValid: isValidStructured(digits) };
}
