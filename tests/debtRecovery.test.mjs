import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDebtRecoveryRenewal, getRecoveryAgeDays, isDebtRecoveryLoan } from '../src/core/debtRecovery.js';
import { calculateLoanOutstandingBalance } from '../src/core/loanPortfolio.js';
import { calculateLoanPenaltyState } from '../src/core/loanPenalty.js';

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

test('DRU renewal replaces interest at 20 percent, carries fines once, and resets eligibility', () => {
  const quote = buildDebtRecoveryRenewal(options);
  assert.equal(quote.sourceUnit, 'dru');
  assert.equal(quote.principal, 15000);
  assert.equal(quote.interest, 3000);
  assert.equal(quote.fines, 1000);
  assert.equal(quote.totalPayable, 19000);
  assert.equal(quote.installments[0].due_date.slice(0, 10), '2026-05-01');
  assert.equal(quote.installments.at(-1).due_date.slice(0, 10), '2026-10-01');
  const renewed = { ...loan, renewal_date: quote.renewalDate, total_liability: quote.liability };
  assert.equal(isDebtRecoveryLoan(renewed, { referenceDate }), false);
  assert.equal(calculateLoanOutstandingBalance({ loan: renewed, schedules: quote.installments, referenceDate, penaltyAmount: 500 }), 19000);
  // Receipt of 2,000 includes 1,000 carried fine, leaving 1,000 to the contract.
  const repayments = [{ amount: 2000, fine_amount: 1000, date: referenceDate.toISOString() }];
  assert.equal(calculateLoanOutstandingBalance({ loan: renewed, schedules: quote.installments, referenceDate, repayments, penaltyAmount: 500 }), 17000);
  assert.equal(calculateLoanPenaltyState({ schedules: quote.installments, referenceDate, repayments, penaltyAmount: 500 }).outstandingFine, 0);
});

test('DU renewal starts from unpaid principal after partial payments', () => {
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
  assert.equal(quote.principal, 10000);
  assert.equal(quote.interest, 2000);
  assert.equal(quote.liability, 12000);
  assert.equal(quote.installments.length, 8);
  assert.equal(quote.installments.reduce((sum, s) => sum + Math.round(s.amount * 100), 0), 1200000);
});

test('renewal uses the loan interest rate, including special offers', () => {
  const quote = buildDebtRecoveryRenewal({
    loan: { ...loan, interest_rate: 10, interest_amount: 1500, total_liability: 16500 },
    schedules: schedules.map(row => ({ ...row, amount: 2750 })),
    referenceDate,
    period: 6,
    penaltyAmount: 500
  });

  assert.equal(quote.principal, 15000);
  assert.equal(quote.interestRate, 10);
  assert.equal(quote.interest, 1500);
  assert.equal(quote.liability, 16500);
});

test('renewal validates period, payment eligibility and complete source schedule', () => {
  for (const period of [0, -1, 1.5, 121, NaN]) assert.throws(() => buildDebtRecoveryRenewal({ ...options, period }));
  assert.throws(() => buildDebtRecoveryRenewal({ ...options, repayments: [{ amount: 1 }] }));
  assert.throws(() => buildDebtRecoveryRenewal({ ...options, schedules: [] }));
});

test('installments total exactly to cents and retain month-end date', () => {
  const quote = buildDebtRecoveryRenewal({ ...options, period: 7, referenceDate: '2026-08-31T09:00:00Z' });
  assert.equal(quote.installments.reduce((sum, s) => sum + Math.round(s.amount * 100), 0), 1800000);
  assert.equal(quote.installments[0].due_date.slice(0, 10), '2026-09-30');
  assert.equal(quote.installments[1].due_date.slice(0, 10), '2026-10-31');
});
