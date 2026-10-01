// Number and date notations used in bank CSV exports. Amounts are returned as
// integers in thousandths of a euro; nothing is ever rounded.
import { assertMilli, negate } from '../money.js';

export class NotationError extends Error {}

/**
 * Parse a decimal amount such as "-87,5", "-1600", "2552,42" or "1.234,56".
 * @param opts { decimal: ',' | '.', thousands: '.' | ',' | ' ' | '' }
 * @returns milli or null when empty
 */
export function parseAmount(text, { decimal = ',', thousands = '.' } = {}) {
  let s = String(text ?? '').trim().replace(/[  ]/g, ' ');
  if (s === '') return null;
  s = s.replace(/\s*(EUR|€)\s*/gi, '');
  let negative = false;
  if (/^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  } else if (/-$/.test(s)) {
    negative = true; // trailing minus "12,50-"
    s = s.slice(0, -1).trim();
  }
  const parts = s.split(decimal);
  if (parts.length > 2) throw new NotationError(`Ongeldig bedrag "${text}"`);
  let [intPart, frac = ''] = parts;
  if (parts.length === 2 && frac === '') throw new NotationError(`Ongeldig bedrag "${text}"`);
  if (thousands && intPart.includes(thousands)) {
    // Defensive: only accept proper groups of three digits.
    const re = new RegExp(`^\\d{1,3}(${thousands === '.' ? '\\.' : thousands === ' ' ? ' ' : thousands}\\d{3})+$`);
    if (!re.test(intPart)) throw new NotationError(`Ongeldig bedrag "${text}" (duizendtalscheiding)`);
    intPart = intPart.split(thousands).join('');
  }
  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(frac)) throw new NotationError(`Ongeldig bedrag "${text}"`);
  if (frac.length > 3) {
    if (!/^0+$/.test(frac.slice(3))) throw new NotationError(`Bedrag "${text}" heeft meer dan 3 decimalen`);
    frac = frac.slice(0, 3);
  }
  const milli = assertMilli(Number(intPart) * 1000 + Number(frac.padEnd(3, '0')), 'bedrag');
  return negative ? negate(milli) : milli;
}

export const DATE_FORMATS = ['D/M/YYYY', 'YYYY-MM-DD', 'D-M-YYYY', 'D.M.YYYY', 'D/M/YY', 'M/D/YYYY'];

function isoDate(y, m, d, text) {
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth || y < 1900 || y > 2200) throw new NotationError(`Ongeldige datum "${text}"`);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parse a date (optionally followed by a time H:MM[:SS]) in the given format.
 * Leading zeros are optional. Returns { date: 'YYYY-MM-DD', time: 'HH:MM'|null } or null when empty.
 */
export function parseDateTime(text, format = 'D/M/YYYY') {
  const s = String(text ?? '').trim();
  if (s === '') return null;
  const m = /^(\S+)(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) throw new NotationError(`Ongeldige datum "${text}"`);
  const datePart = m[1];
  let y;
  let mo;
  let d;
  let parts;
  switch (format) {
    case 'D/M/YYYY':
    case 'D-M-YYYY':
    case 'D.M.YYYY':
    case 'D/M/YY': {
      const sep = format[1];
      parts = datePart.split(sep);
      const yLen = format.endsWith('YYYY') ? 4 : 2;
      if (parts.length !== 3 || !/^\d{1,2}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1]) || parts[2].length !== yLen || !/^\d+$/.test(parts[2])) {
        throw new NotationError(`Ongeldige datum "${text}" (verwacht ${format})`);
      }
      [d, mo, y] = parts.map(Number);
      if (yLen === 2) y += y >= 80 ? 1900 : 2000;
      break;
    }
    case 'M/D/YYYY': {
      parts = datePart.split('/');
      if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p)) || parts[2].length !== 4) throw new NotationError(`Ongeldige datum "${text}" (verwacht ${format})`);
      [mo, d, y] = parts.map(Number);
      break;
    }
    case 'YYYY-MM-DD': {
      if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(datePart)) throw new NotationError(`Ongeldige datum "${text}" (verwacht ${format})`);
      [y, mo, d] = datePart.split('-').map(Number);
      break;
    }
    default:
      throw new NotationError(`Onbekend datumformaat ${format}`);
  }
  const date = isoDate(y, mo, d, text);
  let time = null;
  if (m[2] !== undefined) {
    const hh = Number(m[2]);
    const mm = Number(m[3]);
    if (hh > 23 || mm > 59) throw new NotationError(`Ongeldig tijdstip in "${text}"`);
    time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return { date, time };
}

export function parseDate(text, format) {
  const r = parseDateTime(text, format);
  return r ? r.date : null;
}
