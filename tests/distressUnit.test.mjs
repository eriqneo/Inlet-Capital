import test from 'node:test';
import assert from 'node:assert/strict';
import { getLoanEndDate, isDistressUnitLoan } from '../src/core/distressUnit.js';

const baseLoan = {
  status: 'disbursed',
  disbursement_date: '2026-01-10 09:00:00.000Z',
  period: 6,
  approved_amount: 15000,
  total_liability: 18000
};

test('calculates loan end date from disbursement date and loan period', () => {
  assert.equal(getLoanEndDate(baseLoan).toISOString().slice(0, 10), '2026-07-10');
});

test('marks DU when repayment period is over and outstanding balance remains', () => {
  assert.equal(isDistressUnitLoan(baseLoan, {
    outstandingBalance: 2500,
    referenceDate: new Date('2026-07-11T12:00:00+03:00')
  }), true);
});

test('does not mark DU on the final payment day or after full settlement', () => {
  assert.equal(isDistressUnitLoan(baseLoan, {
    outstandingBalance: 2500,
    referenceDate: new Date('2026-07-10T12:00:00+03:00')
  }), false);
  assert.equal(isDistressUnitLoan(baseLoan, {
    outstandingBalance: 0,
    referenceDate: new Date('2026-07-11T12:00:00+03:00')
  }), false);
});

test('only running collectible disbursed loans can enter DU', () => {
  assert.equal(isDistressUnitLoan({ ...baseLoan, status: 'completed' }, {
    outstandingBalance: 2500,
    referenceDate: new Date('2026-07-11T12:00:00+03:00')
  }), false);
  assert.equal(isDistressUnitLoan({ ...baseLoan, disbursement_date: '' }, {
    outstandingBalance: 2500,
    referenceDate: new Date('2026-07-11T12:00:00+03:00')
  }), false);
});
