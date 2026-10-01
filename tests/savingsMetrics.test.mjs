import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSavingsSummary,
  getSavingsSignedAmount,
  getSavingsTransactionType
} from '../src/core/savingsMetrics.js';

test('savings summary uses deposits less withdrawals and excludes reversals', () => {
  const result = calculateSavingsSummary([
    { type: 'deposit', amount: 1000 },
    { type: 'withdrawal', amount: 250 },
    { type: 'deposit', amount: 500, is_reversed: true }
  ]);

  assert.deepEqual(result, { deposits: 1000, withdrawals: 250, net: 750, count: 2 });
});

test('legacy transactions with a blank type remain deposits everywhere', () => {
  const legacy = { amount: '400' };
  assert.equal(getSavingsTransactionType(legacy), 'deposit');
  assert.equal(getSavingsSignedAmount(legacy), 400);
  assert.deepEqual(calculateSavingsSummary([legacy]), {
    deposits: 400,
    withdrawals: 0,
    net: 400,
    count: 1
  });
});

test('invalid amounts do not corrupt the savings total', () => {
  assert.deepEqual(calculateSavingsSummary([
    { type: 'deposit', amount: 'not-a-number' },
    { type: 'withdrawal', amount: null }
  ]), { deposits: 0, withdrawals: 0, net: 0, count: 2 });
});
