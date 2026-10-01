import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidStructured, formatStructured, structuredCheckDigits, parseStructuredInput } from '../src/core/coda/structured.js';

test('structured communication mod 97 check', () => {
  assert.equal(structuredCheckDigits('1234567890'), 2); // 1234567890 mod 97 = 2
  assert.equal(isValidStructured('123456789002'), true);
  assert.equal(isValidStructured('123456789003'), false);
  assert.equal(structuredCheckDigits('0000000097'), 97); // remainder 0 => 97
  assert.equal(isValidStructured('000000009797'), true);
});

test('formatting and parsing', () => {
  assert.equal(formatStructured('123456789002'), '+++123/4567/89002+++');
  assert.equal(parseStructuredInput('+++123/4567/89002+++'), '123456789002');
  assert.equal(parseStructuredInput('***123/4567/89002***'), '123456789002');
  assert.equal(parseStructuredInput('12345'), null);
});
