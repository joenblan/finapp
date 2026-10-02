// DEFLATE decompression (RFC 1950 zlib wrapper + RFC 1951), synchronous and
// without dependencies: PDF streams with /FlateDecode are read in the browser
// and in Node with the same code.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

export class InflateError extends Error {}

/** Canonical Huffman table: { counts[len], symbols[] } */
function huffman(lengths) {
  const counts = new Uint16Array(16);
  for (const l of lengths) counts[l]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((l, s) => {
    if (l) symbols[offs[l]++] = s;
  });
  return { counts, symbols };
}

let FIXED = null;
function fixedTables() {
  if (!FIXED) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144);
    l.fill(9, 144, 256);
    l.fill(7, 256, 280);
    l.fill(8, 280, 288);
    FIXED = { lit: huffman(l), dist: huffman(new Uint8Array(30).fill(5)) };
  }
  return FIXED;
}

/** Raw DEFLATE data -> Uint8Array */
export function inflateRaw(input) {
  let pos = 0;
  let bit = 0;
  let nbits = 0;
  let out = new Uint8Array(Math.max(1024, input.length * 4));
  let n = 0;
  const need = (k) => {
    while (nbits < k) {
      if (pos >= input.length) throw new InflateError('Onverwacht einde van gecomprimeerde gegevens.');
      bit |= input[pos++] << nbits;
      nbits += 8;
    }
  };
  const bits = (k) => {
    if (!k) return 0;
    need(k);
    const v = bit & ((1 << k) - 1);
    bit >>>= k;
    nbits -= k;
    return v;
  };
  const ensure = (k) => {
    if (n + k <= out.length) return;
    let size = out.length * 2;
    while (size < n + k) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(out.subarray(0, n));
    out = bigger;
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - first < count) return h.symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new InflateError('Ongeldige Huffman-code.');
  };
  for (let last = 0; !last; ) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bit = 0;
      nbits = 0;
      if (pos + 4 > input.length) throw new InflateError('Onverwacht einde van gecomprimeerde gegevens.');
      const len = input[pos] | (input[pos + 1] << 8);
      const nlen = input[pos + 2] | (input[pos + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new InflateError('Ongeldig ongecomprimeerd blok.');
      pos += 4;
      if (pos + len > input.length) throw new InflateError('Onverwacht einde van gecomprimeerde gegevens.');
      ensure(len);
      out.set(input.subarray(pos, pos + len), n);
      n += len;
      pos += len;
      continue;
    }
    let lit;
    let dist;
    if (type === 1) ({ lit, dist } = fixedTables());
    else if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
      const clh = huffman(cl);
      const lengths = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist; ) {
        const sym = decode(clh);
        if (sym < 16) lengths[i++] = sym;
        else {
          let rep;
          let val = 0;
          if (sym === 16) {
            if (!i) throw new InflateError('Ongeldige codelengtes.');
            val = lengths[i - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > lengths.length) throw new InflateError('Ongeldige codelengtes.');
          lengths.fill(val, i, i + rep);
          i += rep;
        }
      }
      lit = huffman(lengths.subarray(0, hlit));
      dist = huffman(lengths.subarray(hlit));
    } else throw new InflateError('Ongeldig bloktype.');
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[n++] = sym;
      } else if (sym === 256) break;
      else {
        const li = sym - 257;
        if (li >= 29) throw new InflateError('Ongeldige lengtecode.');
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        if (di >= 30) throw new InflateError('Ongeldige afstandscode.');
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (d > n) throw new InflateError('Afstand te groot.');
        ensure(len);
        for (let k = 0; k < len; k++, n++) out[n] = out[n - d];
      }
    }
  }
  return out.slice(0, n);
}

/** zlib-wrapped data (as in PDF /FlateDecode). */
export function inflate(input) {
  if (input.length < 2) throw new InflateError('Gecomprimeerde gegevens te kort.');
  const cmf = input[0];
  const flg = input[1];
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0) throw new InflateError('Geen zlib-gegevens.');
  if (flg & 0x20) throw new InflateError('Voorgedefinieerd woordenboek niet ondersteund.');
  return inflateRaw(input.subarray(2));
}
