import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLoanRepaymentBehavior } from '../src/core/loanRepaymentBehavior.js';

const schedules = [
  { id: 's1', installment_no: 1, due_date: '2026-05-12', amount: 3000 },
  { id: 's2', installment_no: 2, due_date: '2026-06-12', amount: 3000 },
  { id: 's3', installment_no: 3, due_date: '2026-07-12', amount: 3000 }
];

test('rates on-time monthly repayments as excellent', () => {
  const result = calculateLoanRepaymentBehavior({
    schedules,
    repayments: [
      { amount: 3000, date: '2026-05-12' },
      { amount: 3000, date: '2026-06-10' },
      { amount: 3000, date: '2026-07-12' }
    ],
    referenceDate: '2026-07-31'
  });

  assert.equal(result.dueMonths, 3);
  assert.equal(result.onTimeMonths, 3);
  assert.equal(result.lateMonths, 0);
  assert.equal(result.missedMonths, 0);
  assert.equal(result.score, 100);
  assert.equal(result.rating, 'Excellent');
});

test('does not rate a fully paid but late loan as excellent', () => {
  const result = calculateLoanRepaymentBehavior({
    schedules,
    repayments: [
      { amount: 3000, date: '2026-05-25' },
      { amount: 3000, date: '2026-06-25' },
      { amount: 3000, date: '2026-07-25' }
    ],
    referenceDate: '2026-07-31'
  });

  assert.equal(result.paidRate, 100);
  assert.equal(result.onTimeMonths, 0);
  assert.equal(result.lateMonths, 3);
  assert.equal(result.score, 50);
  assert.equal(result.rating, 'Watchlist');
});

test('flags missed monthly obligations when due installments are unpaid', () => {
  const result = calculateLoanRepaymentBehavior({
    schedules,
    repayments: [
      { amount: 3000, date: '2026-05-12' }
    ],
    referenceDate: '2026-07-31'
  });

  assert.equal(result.expectedDue, 9000);
  assert.equal(result.paidAgainstDue, 3000);
  assert.equal(result.onTimeMonths, 1);
  assert.equal(result.missedMonths, 2);
  assert.equal(result.rating, 'Poor');
});

test('returns new loan state when no installment is due yet', () => {
  const result = calculateLoanRepaymentBehavior({
    schedules,
    repayments: [],
    referenceDate: '2026-04-30'
  });

  assert.equal(result.dueMonths, 0);
  assert.equal(result.score, null);
  assert.equal(result.rating, 'New Loan');
});
