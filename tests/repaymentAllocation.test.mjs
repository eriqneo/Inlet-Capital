import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCollectedInterest,
  getLoanInterestAmount
} from '../src/core/repaymentAllocation.js';

const loan = {
  amount_applied: 15000,
  approved_amount: 15000,
  interest_amount: 3000,
  total_liability: 18000,
  interest_rate: 20
};

test('allocates collected interest proportionally from monthly loan repayments', () => {
  const repayments = [
    { amount: 3000, date: '2026-07-12' },
    { amount: 3000, date: '2026-08-12' },
    { amount: 3000, date: '2026-09-12' }
  ];

  assert.equal(getLoanInterestAmount(loan), 3000);
  assert.equal(calculateCollectedInterest({ loan, repayments }), 1500);
  assert.equal(
    getLoanInterestAmount(loan) - calculateCollectedInterest({ loan, repayments }),
    1500
  );
});

test('excludes fine amounts from interest allocation', () => {
  const repayments = [
    { amount: 3500, fine_amount: 500, date: '2026-07-12' }
  ];

  assert.equal(calculateCollectedInterest({ loan, repayments }), 500);
});
