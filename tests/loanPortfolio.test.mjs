import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoanPortfolioCalculator, calculateLoanOutstandingBalance } from '../src/core/loanPortfolio.js';

const loan = { id: 'loan1', status: 'disbursed', approved_amount: 15000, amount_applied: 15000,
  interest_amount: 3000, total_liability: 18000, disbursement_date: '2026-01-01T09:00:00+03:00' };
const schedules = [{ id: 's1', loan: loan.id, installment_no: 1, amount: 3000, paid: 0,
  due_date: '2026-02-01T09:00:00+03:00' }];
const options = { loan, schedules, penaltyAmount: 500, referenceDate: new Date('2026-02-10T09:00:00+03:00') };

test('OLB includes contractual principal, interest and outstanding fine once', () => {
  assert.equal(calculateLoanOutstandingBalance(options), 18500);
  assert.equal(calculateLoanOutstandingBalance({ ...options, includeOutstandingFines: false }), 18000);
});

test('a 2000 receipt containing 500 fine reduces contract by 1500 and clears the fine', () => {
  const repayments = [{ loan: loan.id, amount: 2000, fine_amount: 500, date: '2026-02-09T09:00:00+03:00' }];
  assert.equal(calculateLoanOutstandingBalance({ ...options, repayments }), 16500);
});

test('savings settlement reduces contract; reversal does not', () => {
  const settlements = [{ loan: loan.id, amount: 2000, effective_date: '2026-02-09T09:00:00+03:00', status: 'completed' }];
  assert.equal(calculateLoanOutstandingBalance({ ...options, settlements }), 16500);
  assert.equal(calculateLoanOutstandingBalance({ ...options, settlements: [{ ...settlements[0], status: 'reversed' }] }), 18500);
});

test('waiving the schedule penalty removes only that fine, not the loan balance', () => {
  assert.equal(calculateLoanOutstandingBalance({ ...options, schedules: [{ ...schedules[0], penalty_waived: true }] }), 18000);
});

test('pending, undistributed approved, written-off and rolled-over source loans have zero operational OLB', () => {
  for (const change of [{ status: 'pending' }, { status: 'approved', disbursement_date: '' },
    { status: 'written_off' }, { renewed_to: 'renewed-loan' }]) {
    assert.equal(calculateLoanOutstandingBalance({ ...options, loan: { ...loan, ...change } }), 0);
  }
});

test('new renewal loan does not inherit the source repayment history', () => {
  const renewed = { ...loan, id: 'new-loan', renewed_from: loan.id, approved_amount: 12500,
    amount_applied: 12500, interest_amount: 2500, total_liability: 15000 };
  const calculator = createLoanPortfolioCalculator({ repayments: [{ loan: loan.id, amount: 10000 }], penaltyAmount: 500 });
  assert.equal(calculator.getOutstanding(renewed), 15000);
});

test('as-of reconstruction filters future receipts inside the shared calculator', () => {
  const repayments = [{ loan: loan.id, amount: 2000, date: '2026-03-01T09:00:00+03:00' }];
  const referenceDate = new Date('2026-02-10T09:00:00+03:00');
  const eligible = repayments.filter(record => new Date(record.date) <= referenceDate);
  assert.equal(calculateLoanOutstandingBalance({ ...options, referenceDate, repayments: eligible, useRecordedSchedulePaid: false }), 18500);
  assert.equal(calculateLoanOutstandingBalance({ ...options, referenceDate, repayments, useRecordedSchedulePaid: false }), 18500);
});

test('duplicate receipts count once and reversed receipts do not count', () => {
  const receipt = { id: 'r1', loan: loan.id, amount: 2000, date: '2026-02-09' };
  const calculator = createLoanPortfolioCalculator({ repayments: [receipt, { ...receipt }, { id: 'reversed', loan: loan.id, amount: 9000, status: 'reversed' }],
    schedules, penaltyAmount: 500, referenceDate: options.referenceDate });
  assert.equal(calculator.getOutstanding(loan), 16500);
});

test('monetary subtraction is exact to cents', () => {
  const small = { ...loan, approved_amount: 0.1, amount_applied: 0.1, interest_amount: 0.2, total_liability: 0.3 };
  assert.equal(calculateLoanOutstandingBalance({ loan: small, repayments: [{ amount: 0.1 }, { amount: 0.1 }], includeOutstandingFines: false }), 0.1);
});

test('renewed source is included before renewal and excluded after it', () => {
  const source = { ...loan, status: 'closed', renewed_to: 'new-loan' };
  const target = { ...loan, id: 'new-loan', renewal_date: '2026-03-01', disbursement_date: '2026-03-01' };
  const before = createLoanPortfolioCalculator({ loans: [source, target], asOf: new Date('2026-02-10T12:00:00+03:00') });
  const after = createLoanPortfolioCalculator({ loans: [source, target], asOf: new Date('2026-03-10T12:00:00+03:00') });
  assert.equal(before.getOutstanding(source), 18000);
  assert.equal(before.getOutstanding(target), 0);
  assert.equal(after.getOutstanding(source), 0);
  assert.equal(after.getOutstanding(target), 18000);
});

test('write-off takes effect at its own date and missing renewal context is not silently zeroed', () => {
  const closed = { ...loan, status: 'written_off', written_off_at: '2026-03-01' };
  assert.equal(calculateLoanOutstandingBalance({ loan: closed, asOf: new Date('2026-02-10T12:00:00+03:00') }), 18000);
  assert.equal(calculateLoanOutstandingBalance({ loan: closed, asOf: new Date('2026-03-10T12:00:00+03:00') }), 0);
  assert.throws(() => calculateLoanOutstandingBalance({ loan: { ...loan, renewed_to: 'missing' }, asOf: options.referenceDate }), /Renewal date unavailable/);
});

test('invalid receipt and fine inputs stop an OLB calculation', () => {
  for (const repayment of [{ amount: 'invalid' }, { amount: 100, fine_amount: 200 }, { amount: -1 }, { amount: 1.001 }]) {
    assert.throws(() => calculateLoanOutstandingBalance({ ...options, repayments: [repayment] }));
  }
});
