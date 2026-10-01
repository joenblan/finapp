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

/** Communication without the card number line (the card number is never displayed). */
export function communicationForDisplay(t) {
  const text = t.communication?.text ?? '';
  if (!t.card) return text;
  return text
    .split(/\r\n|\r|\n/)
    .filter((l) => !/^\s*CARD:/i.test(l))
    .join('\n');
}
