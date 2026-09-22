import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDebtRecoveryRenewal, getRecoveryAgeDays, isDebtRecoveryLoan } from '../src/core/debtRecovery.js';
import { calculateLoanOutstandingBalance } from '../src/core/loanPortfolio.js';
import { calculateLoanPenaltyState } from '../src/core/loanPenalty.js';
import { isDistressUnitLoan } from '../src/core/distressUnit.js';

const loan = { id: 'loan1', status: 'disbursed', disbursement_date: '2026-01-01T09:00:00+03:00',
  approved_amount: 15000, total_liability: 18000, interest_amount: 3000, period: 6 };
const referenceDate = new Date('2026-04-01T09:00:00+03:00');
const schedules = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, installment_no: i + 1,
  amount: 3000, paid: 0, due_date: `2026-${String(i + 2).padStart(2, '0')}-01T09:00:00+03:00` }));
const options = { loan, schedules, referenceDate, period: 6, penaltyAmount: 500 };

test('DRU starts at 90 Nairobi calendar days, including loans whose term has not ended', () => {
  assert.equal(getRecoveryAgeDays(loan, referenceDate), 90);
  assert.equal(isDebtRecoveryLoan(loan, { referenceDate }), true);
  assert.equal(isDebtRecoveryLoan(loan, { referenceDate: '2026-03-31T20:59:59Z' }), false);
  assert.equal(isDebtRecoveryLoan(loan, { referenceDate: '2026-03-31T21:00:00Z' }), true);
});

test('farming-loan DRU timing starts after the agreed first repayment date', () => {
  const farmingLoan = {
    ...loan,
    type: 'farming',
    grace_period_months: 3,
    disbursement_date: '2026-01-12T12:00:00+03:00'
  };

  assert.equal(getRecoveryAgeDays(farmingLoan, '2026-04-12T12:00:00+03:00'), 0);
  assert.equal(isDebtRecoveryLoan(farmingLoan, { referenceDate: '2026-07-10T12:00:00+03:00' }), false);
  assert.equal(isDebtRecoveryLoan(farmingLoan, { referenceDate: '2026-07-11T12:00:00+03:00' }), true);
});

test('any positive receipt, savings settlement, or recorded schedule payment excludes DRU', () => {
  for (const payments of [
    { repayments: [{ amount: 1 }] },
    { repayments: [{ amount: 500, fine_amount: 500 }] },
    { settlements: [{ amount: 1, status: 'completed' }] },
    { schedules: [{ paid: 1 }] }
  ]) assert.equal(isDebtRecoveryLoan(loan, { ...payments, referenceDate }), false);
  assert.equal(isDebtRecoveryLoan(loan, { referenceDate, settlements: [{ amount: 1, status: 'reversed' }] }), true);
});

test('non-disbursed, settled and invalid-date loans cannot enter DRU', () => {
  for (const change of [{ status: 'pending' }, { status: 'written_off' }, { status: 'completed' },
    { disbursement_date: '' }, { disbursement_date: 'invalid' }, { total_liability: 0 }]) {
    assert.equal(isDebtRecoveryLoan({ ...loan, ...change }, { referenceDate }), false);
  }
});

test('DRU renewal uses current OLB as the base and resets debt-unit eligibility', () => {
  const quote = buildDebtRecoveryRenewal(options);
  assert.equal(quote.sourceUnit, 'dru');
  assert.equal(quote.renewalBase, 19000);
  assert.equal(quote.principal, 19000);
  assert.equal(quote.interest, 3800);
  assert.equal(quote.fines, 1000);
  assert.equal(quote.totalPayable, 22800);
  assert.equal(quote.installments[0].due_date.slice(0, 10), '2026-05-01');
  assert.equal(quote.installments.at(-1).due_date.slice(0, 10), '2026-10-01');
  const renewed = { ...loan, renewal_date: quote.renewalDate, approved_amount: quote.renewalBase,
    interest_rate: quote.interestRate, interest_amount: quote.interest, total_liability: quote.liability };
  assert.equal(isDebtRecoveryLoan(renewed, { referenceDate }), false);
  assert.equal(isDistressUnitLoan(renewed, { outstandingBalance: quote.liability, referenceDate }), false);
  assert.equal(calculateLoanOutstandingBalance({ loan: renewed, schedules: quote.installments, referenceDate, penaltyAmount: 500 }), 22800);
  const repayments = [{ amount: 2000, fine_amount: 0, date: referenceDate.toISOString() }];
  assert.equal(calculateLoanOutstandingBalance({ loan: renewed, schedules: quote.installments, referenceDate, repayments, penaltyAmount: 500 }), 20800);
  assert.equal(calculateLoanPenaltyState({ schedules: quote.installments, referenceDate, repayments, penaltyAmount: 500 }).outstandingFine, 0);
});

test('DU renewal uses the current OLB after partial payments', () => {
  const quote = buildDebtRecoveryRenewal({
    loan,
    schedules,
    repayments: [
      { amount: 3000, fine_amount: 0, date: '2026-02-01T09:00:00+03:00' },
      { amount: 3000, fine_amount: 0, date: '2026-03-01T09:00:00+03:00' }
    ],
    referenceDate: '2026-07-02T09:00:00+03:00',
    period: 8,
    penaltyAmount: 500
  });

  assert.equal(quote.sourceUnit, 'du');
  assert.equal(quote.renewalBase, 14000);
  assert.equal(quote.interest, 2800);
  assert.equal(quote.liability, 16800);
  assert.equal(quote.installments.length, 8);
  assert.equal(quote.installments.reduce((sum, s) => sum + Math.round(s.amount * 100), 0), 1680000);
});

test('renewal uses the standard 20 percent rate against the current OLB', () => {
  const quote = buildDebtRecoveryRenewal({
    loan: { ...loan, interest_rate: 10, interest_amount: 1500, total_liability: 16500 },
    schedules: schedules.map(row => ({ ...row, amount: 2750 })),
    referenceDate,
    period: 6,
    penaltyAmount: 500
  });

  assert.equal(quote.renewalBase, 17500);
  assert.equal(quote.interestRate, 20);
  assert.equal(quote.interest, 3500);
  assert.equal(quote.liability, 21000);
});

test('renewal validates period, payment eligibility and complete source schedule', () => {
  for (const period of [0, -1, 1.5, 121, NaN]) assert.throws(() => buildDebtRecoveryRenewal({ ...options, period }));
  assert.throws(() => buildDebtRecoveryRenewal({ ...options, repayments: [{ amount: 1 }] }));
  assert.throws(() => buildDebtRecoveryRenewal({ ...options, schedules: [] }));
});

test('installments total exactly to cents and retain month-end date', () => {
  const quote = buildDebtRecoveryRenewal({ ...options, period: 7, referenceDate: '2026-08-31T09:00:00Z' });
  assert.equal(quote.installments.reduce((sum, s) => sum + Math.round(s.amount * 100), 0), Math.round(quote.liability * 100));
  assert.equal(quote.installments[0].due_date.slice(0, 10), '2026-09-30');
  assert.equal(quote.installments[1].due_date.slice(0, 10), '2026-10-31');
});
