import { encodeWindows1252 } from './coda-builder.js';

// The example from the specification, verbatim (fictitious data), as
// Windows-1252 with CRLF record endings and LF inside quoted fields.
export const EXAMPLE = [
  'Rekeningnummer;BE00 0000 0000 0001;;;;;;;;;;;;;;;;',
  'Naam;Jan Voorbeeld;;;;;;;;;;;;;;;;',
  'Soort;You Count zichtrekening;;;;;;;;;;;;;;;;',
  'Saldo;1002,2;;;;;;;;;;;;;;;;',
  'Datum saldo;1/10/2026 9:52;;;;;;;;;;;;;;;;',
  'Filter actief;Neen;;;;;;;;;;;;;;;;',
  ';;;;;;;;;;;;;;;;;',
  'Uitvoeringsdatum;Valutadatum;Jaar uittreksel;Nummer uittreksel;VDK-refertenummer;Soort beweging;Tegenpartij rekeningnummer;Tegenpartij BIC/SWIFT;Tegenpartij naam;Tegenpartij adres;Tegenpartij postnummer;Tegenpartij woonplaats;Tegenpartij land;Mededeling;Bedrag;Saldo na beweging;Wisselkoers;Kosten',
  '1/10/2026;1/10/2026;;;10000000004;Uw overschrijving;BE00 0000 0000 0002;VDSPBE91;Jan Voorbeeld;;;;;;-90;1002,2;;',
  '1/10/2026;1/10/2026;;;10000000003;Bestendige opdracht;BE00 0000 0000 0003;NICABEBBXXX;gemeenschappelijke rekening;;;;België;gemeenschappelijk;-1500;1092,2;;',
  '1/10/2026;29/09/2026;;;10000000002;Visa Debit betaling;;;;;;;;"BAKKERIJ VOORBEELD 00000 GENT BE\n29/09/2026 12:46\nCARD: 0000 **** **** 0000";-7,8;2592,2;;',
  '30/09/2026;30/09/2026;2026;3;10000000001;Overschrijving;BE00 0000 0000 0004;BBRUBEBBXXX;WERKGEVER NV;VOORBEELDSTRAAT 1;1000;BRUSSEL;;"/A/X000000 - 000000-000000 BETALING-09/2026---\nRef.opdrachtgever: 260901-000000-/A/X000000";2500;2600;;',
  ...Array(30).fill(';;;;;;;;;;;;;;;;;'),
].join('\r\n') + '\r\n';
export const EXAMPLE_BYTES = encodeWindows1252(EXAMPLE);
export const EXAMPLE_NAME = 'verwerkte_bewegingen_BE00000000000001_2026_10_01__09_52_00.csv';
