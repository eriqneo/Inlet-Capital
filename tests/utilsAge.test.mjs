import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAge } from '../src/core/utils.js';

test('calculates age after birthday has passed in the reference year', () => {
  assert.equal(calculateAge('09/09/1989', new Date('2026-09-09T12:00:00+03:00')), 37);
});

test('does not add the next year before birthday has passed', () => {
  assert.equal(calculateAge('10/09/1989', new Date('2026-09-09T12:00:00+03:00')), 36);
});

test('supports stored ISO date strings and rejects invalid dates', () => {
  assert.equal(calculateAge('1989-01-15', new Date('2026-09-09T12:00:00+03:00')), 37);
  assert.equal(calculateAge('31/02/2000', new Date('2026-09-09T12:00:00+03:00')), null);
  assert.equal(calculateAge('01/01/2030', new Date('2026-09-09T12:00:00+03:00')), null);
});
