import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLoanFinalDueDate,
  getRepaymentScheduleDueDate
} from '../src/core/repaymentSchedule.js';

const dateOnly = value => value.toISOString().slice(0, 10);

test('normal loans start one month after disbursement', () => {
  const loan = {
    type: 'business',
    disbursement_date: '2026-01-12T12:00:00+03:00',
    period: 6
  };

  assert.equal(dateOnly(getRepaymentScheduleDueDate(loan, 1)), '2026-02-12');
  assert.equal(dateOnly(getLoanFinalDueDate(loan)), '2026-07-12');
});

test('farming loans use the agreed grace period before installment one', () => {
  const loan = {
    type: 'farming',
    grace_period_months: 3,
    disbursement_date: '2026-01-12T12:00:00+03:00',
    period: 6
  };

  assert.equal(dateOnly(getRepaymentScheduleDueDate(loan, 1)), '2026-04-12');
  assert.equal(dateOnly(getLoanFinalDueDate(loan)), '2026-09-12');
});
