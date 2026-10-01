import { BUILT_IN_PROFILES } from './profiles.js';
import { DATE_FORMATS } from './notation.js';

/** Validate a user-defined profile before it is stored. Throws with a Dutch message. */
export function validateProfile(p) {
  const fail = (m) => {
    throw new Error(`Profiel ongeldig: ${m}`);
  };
  if (!p || typeof p !== 'object') fail('geen profiel');
  if (!/^[a-z0-9-]{2,40}$/.test(p.id ?? '')) fail('ongeldige id');
  if (BUILT_IN_PROFILES.some((b) => b.id === p.id)) fail('deze id is gereserveerd voor een ingebouwd profiel');
  if (!String(p.name ?? '').trim()) fail('geef het profiel een naam');
  if (![';', ',', '\t', '|'].includes(p.delimiter)) fail('ongeldig scheidingsteken');
  if (![',', '.'].includes(p.decimal)) fail('ongeldig decimaalteken');
  if (!DATE_FORMATS.includes(p.dateFormat)) fail('ongeldig datumformaat');
  if (!['newest-first', 'oldest-first'].includes(p.order)) fail('ongeldige volgorde');
  if (!p.columns?.entryDate) fail('kies de kolom met de boekingsdatum');
  if (p.amount?.mode === 'single' ? !p.amount.column : !(p.amount?.debit && p.amount?.credit)) fail('kies de bedragkolom(men)');
  if (!['metadata', 'column', 'fixed'].includes(p.ownAccount?.source)) fail('geef aan waar het eigen rekeningnummer staat');
  if (p.ownAccount.source === 'column' && !p.ownAccount.column) fail('kies de kolom met het eigen rekeningnummer');
  if (p.ownAccount.source === 'fixed' && !String(p.ownAccount.value ?? '').trim()) fail('vul het eigen rekeningnummer in');
  if (p.ownAccount.source === 'metadata' && !p.metadata?.accountNumber) fail('geef de metadatasleutel van het rekeningnummer');
  if (!['bankRef', 'fallback'].includes(p.key)) fail('ongeldige sleutel');
  if (p.key === 'bankRef' && !p.columns.bankRef) fail('kies de referentiekolom of gebruik de reservesleutel');
  if (!p.detect?.headerColumns?.length) fail('geen herkenningskolommen');
  return true;
}
