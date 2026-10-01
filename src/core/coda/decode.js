// Decode raw CODA bytes to text. CODA files are traditionally Latin-1 /
// Windows-1252; some banks deliver UTF-8. Strategy: strict UTF-8 first (a
// Windows-1252 file with accented characters is almost never valid UTF-8),
// fall back to Windows-1252.

// Windows-1252 differs from Latin-1 only in 0x80-0x9F. Decoded by hand so the
// result is identical in every runtime (some TextDecoder builds treat
// "windows-1252" as plain Latin-1).
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

export function decodeWindows1252(bytes) {
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    const codes = new Array(end - i);
    for (let j = i; j < end; j++) {
      const b = bytes[j];
      codes[j - i] = b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b;
    }
    out += String.fromCharCode(...codes);
  }
  return out;
}

export function decodeCodaBytes(input) {
  if (typeof input === 'string') return { text: input, encoding: 'text' };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let start = 0;
  // UTF-8 byte order mark
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = bytes.subarray(start);
  let asciiOnly = true;
  for (let i = 0; i < body.length; i++) {
    if (body[i] > 0x7f) {
      asciiOnly = false;
      break;
    }
  }
  if (asciiOnly) return { text: decodeWindows1252(body), encoding: 'ascii' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: decodeWindows1252(body), encoding: 'windows-1252' };
  }
}
