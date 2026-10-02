// Synthetic MeDirect statements (PDF) for tests and samples. Same structure as
// the real export (jsPDF style: compressed content streams, one text block per
// piece with absolute position, Type0 font with ToUnicode, Helvetica for the
// page number), with fictitious names and IBANs.
import { deflateSync } from 'node:zlib';

const H = 841.89;
const be = (milli, sign = false) => {
  const neg = milli < 0;
  const abs = Math.abs(milli);
  const euros = String(Math.floor(abs / 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = String(Math.round((abs % 1000) / 10)).padStart(2, '0');
  return `${neg ? '-' : sign ? '+' : ''}${euros},${cents}`;
};
const dmy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/**
 * @param opts {
 *   iban, holder, type ('ZICHTREKENING'), begin (milli),
 *   movements: OLDEST FIRST [{ date, valueDate?, type, details: [lines], amount, foreign?: 'USD 6,05' }],
 *   rowsPerPage (4), splitRowAt (index in file order, newest first: the row continues on the next page),
 *   totals: override { in, out, end }, dropRow: index (file order) left out of the table
 * }
 */
export function buildMedirectPdf(opts) {
  const { iban, holder = 'JAN VOORBEELD', type = 'ZICHTREKENING', begin = 0, rowsPerPage = 4, splitRowAt = null, dropRow = null } = opts;
  let balance = begin;
  const rows = opts.movements.map((m) => {
    balance += m.amount;
    return { ...m, balance };
  });
  const totals = {
    in: rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0),
    out: -rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0),
    end: balance,
    ...(opts.totals ?? {}),
  };
  const fileRows = [...rows].reverse().filter((_, i) => i !== dropRow);

  // pages: lists of text pieces { x, top, text, lines? (multi-line block), font }
  const pages = [];
  const pageHeader = (first) => {
    const t = [];
    const put = (x, top, text, font = 'F15') => t.push({ x, top, text, font });
    put(453.5, 45.4, 'MeDirect Bank NV');
    put(453.5, 53.9, 'Sint-Lazaruslaan 4/10,');
    put(453.5, 62.4, 'B-1210 Brussel');
    put(453.5, 70.9, 'www.medirect.be');
    if (first) {
      put(297.6, 138.3, `Dhr ${holder}`);
      const labels = [['REKENINGNUMMER', iban, 232.2], ['NAAM VAN REKENING', holder, 245.3], ['KLANTNUMMER', '000000001', 258.5], ['IBAN-NUMMER', iban, 271.7], ['BIC-CODE', 'MBWMBEBBXXX', 286.3], ['TYPE REKENING', type, 298.1], ['VALUTA', 'EUR', 311.3]];
      for (const [l, v, top] of labels) {
        put(39.7, top - (l === 'BIC-CODE' ? 1.8 : 0), l);
        put(213.6, top, v);
      }
      put(372.8, 236.4, 'Voor de periode van 01-01-2021 tot');
      put(372.8, 245.3, '31-12-2031');
      const box = [['Beginsaldo', begin, 265.6], ['Uitgaand', totals.out, 284.5], ['Inkomend', totals.in, 303.3], ['Eindsaldo', totals.end, 322.2]];
      for (const [l, v, top] of box) {
        put(372.8, top, l);
        put(535 - 4.6 * be(v).length, top, be(v));
      }
    } else {
      put(41.4, 96.1, 'REKENINGNUMMER');
      put(137.8, 96.1, iban);
      put(302.2, 96.1, 'VOOR DE PERIODE');
      put(398.6, 96.1, 'Van 01-01-2021 tot 31-12-2031');
      put(41.4, 108.1, 'NAAM VAN REKENING');
      put(137.8, 108.1, holder);
      put(302.2, 108.1, 'TYPE REKENING');
      put(398.6, 108.1, type.charAt(0) + type.slice(1).toLowerCase());
    }
    const hy = first ? 417.9 : 133.8;
    for (const [x, text] of [[54.5, 'Datum'], [108.0, 'Valuta Datum'], [271.2, 'Omschrijving'], [433.4, 'Bedrag'], [494.5, 'Saldo']]) put(x, hy, text, 'F16');
    return { pieces: t, y: hy + 23.4 };
  };
  let page = null;
  const newPage = () => {
    const h = pageHeader(pages.length === 0);
    page = { pieces: h.pieces, y: h.y, count: 0 };
    pages.push(page);
  };
  newPage();
  fileRows.forEach((r, i) => {
    if (page.count >= rowsPerPage) newPage();
    const top = page.y;
    const lines = [r.type, ...r.details];
    page.pieces.push({ x: 46.7, top, text: dmy(r.date) }, { x: 115.1, top, text: dmy(r.valueDate ?? r.date) });
    const amount = be(r.amount, true);
    page.pieces.push({ x: 470 - 4.5 * amount.length, top, text: amount });
    const saldo = `EUR ${be(r.balance)}`;
    page.pieces.push({ x: 538 - 4.4 * saldo.length, top, text: saldo });
    if (r.foreign) page.pieces.push({ x: 470 - 4.5 * r.foreign.length, top: top + 9.2, text: r.foreign, font: 'F17' });
    if (splitRowAt === i) {
      page.pieces.push({ x: 182.2, top, lines: lines.slice(0, 2) });
      newPage();
      page.pieces.push({ x: 182.2, top: page.y, lines: lines.slice(2) });
      page.y += 9.2 * (lines.length - 2) + 26;
    } else {
      page.pieces.push({ x: 182.2, top, lines });
      page.y += 9.2 * lines.length + 26;
    }
    page.count++;
  });

  // font: one CID per character
  const cids = new Map();
  const cid = (ch) => {
    if (!cids.has(ch)) cids.set(ch, cids.size + 1);
    return cids.get(ch);
  };
  const hex = (text) => [...text].map((ch) => cid(ch).toString(16).padStart(4, '0')).join('');
  const contents = pages.map((p, n) => {
    const out = [];
    for (const pc of p.pieces) {
      const tl = pc.lines ? [pc.lines, 9.2] : [[pc.text], 10.35];
      out.push('BT', `/${pc.font ?? 'F15'} 8 Tf`, `${tl[1]} TL`, '0. g', `${pc.x.toFixed(4)} ${(H - pc.top).toFixed(4)} Td`);
      tl[0].forEach((line, k) => out.push(`${k ? 'T* ' : ''}<${hex(line)}> Tj`));
      out.push('ET');
    }
    // footer (Type0) and page number (Helvetica, WinAnsi literal string)
    out.push('BT', '/F15 6 Tf', `39.6850 ${(H - 772.2).toFixed(4)} Td`, `<${hex('Indien u niet akkoord gaat met de inhoud van dit rekeningafschrift, gelieve ons hiervan op de hoogte te brengen.')}> Tj`, 'ET');
    out.push('BT', '/F1 8 Tf', `498.9 ${(H - 816.4).toFixed(4)} Td`, `(Pagina ${n + 1} van ${pages.length}) Tj`, 'ET');
    return out.join('\n');
  });

  // objects
  const objs = [];
  const add = (body) => {
    objs.push(body);
    return objs.length;
  };
  const stream = (text, dict = '') => {
    const data = deflateSync(Buffer.from(text, 'latin1'));
    return { dict: `<</Length ${data.length}\n/Filter /FlateDecode${dict}>>`, data };
  };
  const pagesId = add(null); // placeholder
  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo <<\n  /Registry (Adobe)\n  /Ordering (UCS)\n  /Supplement 0\n>> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000><ffff>\nendcodespacerange\n';
  const entries = [...cids].map(([ch, c]) => `<${c.toString(16).padStart(4, '0')}><${ch.charCodeAt(0).toString(16).padStart(4, '0')}>`);
  for (let i = 0; i < entries.length; i += 100) cmap += `${Math.min(100, entries.length - i)} beginbfchar\n${entries.slice(i, i + 100).join('\n')}\nendbfchar\n`;
  cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  const toUni = add(stream(cmap));
  const descendant = add('<</Type /Font\n/Subtype /CIDFontType2\n/BaseFont /FKGroteskNeue\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>\n/DW 500>>');
  const type0 = (name) => add(`<<\n/Type /Font\n/Subtype /Type0\n/ToUnicode ${toUni} 0 R\n/BaseFont /${name}\n/Encoding /Identity-H\n/DescendantFonts [${descendant} 0 R]\n>>`);
  const f15 = type0('FKGroteskNeue');
  const f16 = type0('FKGroteskNeue');
  const f17 = type0('FKGroteskNeue');
  const helv = add('<<\n/Type /Font\n/BaseFont /Helvetica\n/Subtype /Type1\n/Encoding /WinAnsiEncoding\n/FirstChar 32\n/LastChar 255\n>>');
  const resources = add(`<<\n/ProcSet [/PDF /Text]\n/Font <<\n/F1 ${helv} 0 R\n/F15 ${f15} 0 R\n/F16 ${f16} 0 R\n/F17 ${f17} 0 R\n>>\n>>`);
  const pageIds = contents.map((c) => {
    const cs = add(stream(c));
    return add(`<</Type /Page\n/Parent ${pagesId} 0 R\n/Resources ${resources} 0 R\n/MediaBox [0 0 595.28 ${H}]\n/Contents ${cs} 0 R\n>>`);
  });
  objs[pagesId - 1] = `<</Type /Pages\n/Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')} ]\n/Count ${pageIds.length}\n>>`;
  const catalog = add(`<<\n/Type /Catalog\n/Pages ${pagesId} 0 R\n>>`);

  const chunks = [Buffer.from('%PDF-1.3\n%\xBA\xDF\xAC\xE0\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(offset);
    const head = Buffer.from(`${i + 1} 0 obj\n${typeof o === 'string' ? o : o.dict}\n`, 'latin1');
    const parts = typeof o === 'string' ? [head, Buffer.from('endobj\n')] : [head, Buffer.from('stream\n'), o.data, Buffer.from('\nendstream\nendobj\n')];
    for (const p of parts) {
      chunks.push(p);
      offset += p.length;
    }
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<<\n/Size ${objs.length + 1}\n/Root ${catalog} 0 R\n>>\nstartxref\n${offset}\n%%EOF`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}

/** A small fictitious history (oldest first). */
export const MEDIRECT_EXAMPLE = {
  iban: 'BE00000000000055',
  holder: 'JAN VOORBEELD',
  begin: 0,
  movements: [
    { date: '2026-09-05', type: 'Overschrijving tussen mijn MeDirect-rekeningen', details: ['Mededeling: Gestuurd vanuit MeDirect App', 'Van: JAN VOORBEELD', 'BE00000000000056', 'Referentie: BE855'], amount: 50_000 },
    { date: '2026-09-05', type: 'Instantoverschrijving', details: ['Mededeling: Gestuurd vanuit MeDirect App', 'Naar: Jan Voorbeeld', 'BE00000000000001'], amount: -50_000 },
    { date: '2026-09-11', type: 'Instantoverschrijving', details: ['Van: Voorbeeld Jan', 'BE00000000000001', 'Referentie: PH0000000001'], amount: 1_250_000 },
    { date: '2026-09-15', type: 'Overschrijving', details: ['Mededeling: +++090/9337/55493+++', 'Naar: ENERGIE NV', 'BE00000000000006', 'Referentie: PH0000000002'], amount: -82_150 },
    { date: '2026-09-18', type: 'Betaling met de kaart', details: ['Naar: Boekhandel Voorbeeld 16-sep.', 'Kaart: 000000******0000'], amount: -24_990 },
    { date: '2026-09-26', type: 'Betaling met de kaart', details: ['Naar: Online Winkel 24-sep.', 'Wisselkoers: 0,89', 'Marge: € 0,08', 'Kaart: 000000******0000'], amount: -5_400, foreign: 'USD 6,05' },
  ],
};
