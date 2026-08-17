import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, normalizeEmail } from '../server/lib/normalize.js';

test('normalizes valid domains and addresses', () => {
  assert.equal(normalizeDomain(' Example.COM. '), 'example.com');
  assert.equal(normalizeEmail(' Alice.Tag@Example.COM '), 'alice.tag@example.com');
});

test('rejects malformed addresses', () => {
  assert.equal(normalizeEmail('missing-at.example.com'), null);
  assert.equal(normalizeEmail('a@localhost'), null);
  assert.equal(normalizeEmail('a@@example.com'), null);
});
