// Card payments (e.g. VDK "Visa Debit betaling") carry no counterparty
// fields; the communication holds:
//   line 1: merchant + postcode + city + country code   "BAKKERIJ VOORBEELD 00000 GENT BE"
//   line 2: date and time of the payment                 "29/09/2026 12:46"
//   line 3: masked card number                           "CARD: 0000 **** **** 0000"
// Best effort: fields that do not match the pattern are left null, the
// original communication is always kept unchanged.

export function parseCardCommunication(text) {
  const lines = String(text ?? '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const card = { merchantLine: lines[0] ?? null, merchant: null, postcode: null, city: null, country: null, paidAt: null, maskedCard: null };
  if (!lines.length) return card;
  const full = /^(.*\S)\s+(\d{4,5})\s+(\D.*?)\s+([A-Z]{2})$/.exec(lines[0]);
  if (full) {
    [, card.merchant, card.postcode, card.city, card.country] = full;
  } else {
    const noPostcode = /^(.*\S)\s+([A-Z]{2})$/.exec(lines[0]);
    if (noPostcode) [, card.merchant, card.country] = noPostcode;
    else card.merchant = lines[0];
  }
  for (const l of lines.slice(1)) {
    const dt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(l);
    if (dt && !card.paidAt) {
      const [, d, m, y, hh, mm] = dt;
      card.paidAt = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm}`;
      continue;
    }
    const c = /^CARD:\s*(.+)$/i.exec(l);
    if (c && !card.maskedCard) card.maskedCard = c[1].trim();
  }
  return card;
}

// Crelan card payments:
//   Tegenpartij: merchant and city separated by 2+ spaces  "CAFE VOORBEELD       Gent"
//   Rekening tegenpartij: empty
//   Mededeling: merchant, DD-MM-YYYY HH:MM, city, masked card "CAFE VOORBEELD 27-01-2025 16:38 Gent 000000******0000"
const CRELAN_TIME = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/;
const MASKED = /\d*\*{3,}\d*/;

export function looksLikeCrelanCard(counterpartyAccount, communication) {
  return !counterpartyAccount && CRELAN_TIME.test(communication ?? '') && MASKED.test(communication ?? '');
}

export function parseCrelanCard(counterpartyRaw, communication) {
  const raw = String(counterpartyRaw ?? '').trim();
  const parts = raw.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
  const card = {
    merchantLine: raw.replace(/\s+/g, ' ') || null,
    merchant: parts.length ? parts[0].replace(/\s+/g, ' ') : null,
    postcode: null,
    city: parts.length > 1 ? parts.slice(1).join(' ').replace(/\s+/g, ' ') : null,
    country: null,
    paidAt: null,
    maskedCard: null,
  };
  const t = CRELAN_TIME.exec(communication ?? '');
  if (t) {
    const [, d, m, y, hh, mm] = t;
    card.paidAt = `${y}-${m}-${d}T${hh}:${mm}`;
  }
  const c = MASKED.exec(communication ?? '');
  if (c) card.maskedCard = c[0];
  return card;
}

/** Communication without the card number (the card number is never displayed). */
export function communicationForDisplay(t) {
  const text = t.communication?.text ?? '';
  if (!t.card) return text;
  let out = text
    .split(/\r\n|\r|\n/)
    .filter((l) => !/^\s*CARD:/i.test(l))
    .join('\n');
  if (t.card.maskedCard && out.includes(t.card.maskedCard)) out = out.split(t.card.maskedCard).join('').replace(/[ \t]{2,}/g, ' ').trim();
  return out;
}
