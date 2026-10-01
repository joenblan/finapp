// Date arithmetic on ISO dates ('YYYY-MM-DD'), in UTC, without time zones.
const DAY = 86400000;

export function toDays(iso) {
  return Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY);
}

export function fromDays(n) {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export const addDays = (iso, n) => fromDays(toDays(iso) + n);
export const diffDays = (a, b) => toDays(b) - toDays(a);

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add months; the day is `day` (default: the original day), clamped to the end of the month. */
export function addMonths(iso, n, day = null) {
  let y = Number(iso.slice(0, 4));
  let m = Number(iso.slice(5, 7)) + n;
  while (m > 12) {
    m -= 12;
    y++;
  }
  while (m < 1) {
    m += 12;
    y--;
  }
  const d = Math.min(day ?? Number(iso.slice(8, 10)), daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Day `day` of the month of iso ('laatste' or a day > month length = last day). */
export function dayOfMonth(iso, day) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const last = daysInMonth(y, m);
  const d = day === 'laatste' ? last : Math.min(Number(day), last);
  return `${iso.slice(0, 7)}-${String(d).padStart(2, '0')}`;
}

export const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
export const monthShort = (iso) => MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];
export const monthLong = (iso) => MONTHS_LONG[Number(iso.slice(5, 7)) - 1];

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
