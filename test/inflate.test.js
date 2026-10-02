import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { inflate } from '../src/core/pdf/inflate.js';

let seed = 1;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

test('inflate equals zlib for text, repetitive, random and empty data, all levels', () => {
  const inputs = [
    new Uint8Array(0),
    new TextEncoder().encode('BT /F15 9 Tf 10.35 TL 297.64 703.55 Td <001e00da0113> Tj ET\n'.repeat(500)),
    Uint8Array.from({ length: 70000 }, () => Math.floor(rnd() * 256)),
    Uint8Array.from({ length: 50000 }, (_, i) => (i % 7 === 0 ? Math.floor(rnd() * 4) : 65 + (i % 13))),
  ];
  for (const data of inputs) {
    for (const level of [0, 1, 6, 9]) {
      const out = inflate(deflateSync(data, { level }));
      assert.equal(out.length, data.length);
      assert.ok(Buffer.from(out).equals(Buffer.from(data)), `level ${level}`);
    }
  }
});

test('inflate rejects garbage', () => {
  assert.throws(() => inflate(Uint8Array.from([1, 2, 3, 4])), /zlib/);
  const ok = deflateSync(Buffer.from('hallo wereld'));
  assert.throws(() => inflate(ok.subarray(0, 5)));
});
