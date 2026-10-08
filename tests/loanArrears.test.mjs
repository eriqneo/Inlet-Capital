import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoanArrearsCalculator } from '../src/core/loanArrears.js';
import { normalizeLoanSchedules, splitLoanInstallments } from '../src/core/loanInstallments.js';
import { getNairobiDay, getDaysInArrears, isScheduleInArrears } from '../src/core/loanScheduleMetrics.js';
import { formatDate } from '../src/core/utils.js';
import { buildDebtRecoveryRenewal } from '../src/core/debtRecovery.js';

const loan = { id: 'l1', status: 'disbursed', disbursement_date: '2026-01-01',
  approved_amount: 15000, amount_applied: 15000, interest_amount: 3000, total_liability: 18000 };
const schedules = [1, 2, 3, 4, 5, 6].map(number => ({ id: `s${number}`, loan: 'l1', installment_no: number,
  amount: 3000, paid: 3000, status: 'paid', due_date: `2026-0${number + 1}-01` }));
const referenceDate = new Date('2026-04-10T12:00:00+03:00');
const calc = options => createLoanArrearsCalculator({ loans: [loan], schedules, referenceDate, ...options });

test('stale recorded paid/status cannot hide overdue balances', () => {
  const summary = calc().summarize();
  assert.equal(summary.total, 9000);
  assert.equal(summary.loanCount, 1);
  assert.equal(summary.installmentCount, 3);
  assert.equal(summary.buckets.par90.loanCount, 1);
  assert.equal(summary.buckets.par30.loanCount, 0);
  assert.equal(summary.buckets.par90.olb, 18000);
  assert.equal(summary.buckets.par90.rate, 100);
});

test('partial receipts allocate contract only, settlements reduce arrears once', () => {
  const receipt = { id: 'r1', loan: 'l1', amount: 3500, fine_amount: 500, date: '2026-02-01' };
  const balanceoff = { id: 'b1', loan: 'l1', amount: 1500, effective_date: '2026-03-02' };
  const result = calc({ repayments: [receipt, { ...receipt }, { id: 'r2', loan: 'l1', amount: 9000, status: 'reversed' }],
    settlements: [balanceoff, { ...balanceoff }, { id: 'b2', loan: 'l1', amount: 9000, status: 'reversed' }] }).summarize();
  assert.equal(result.total, 4500);
  assert.equal(result.installmentCount, 2);
  assert.equal(result.buckets.par60.loanCount, 1);
});

test('future repayments and settlements cannot reduce a historical position', () => {
  const options = { repayments: [{ id: 'r1', loan: 'l1', amount: 9000, date: '2026-05-01' }],
    settlements: [{ id: 'b1', loan: 'l1', amount: 9000, effective_date: '2026-05-01' }] };
  assert.equal(calc(options).summarize().total, 9000);
  assert.equal(calc({ ...options, referenceDate: new Date('2026-05-02T12:00:00+03:00') }).summarize().total, 0);
});

test('Nairobi due day is not overdue until the following day, on any device', () => {
  const row = { amount: 3000, paid: 1000, due_date: '2026-04-10' };
  assert.equal(isScheduleInArrears(row, new Date('2026-04-10T20:59:59Z')), false);
  assert.equal(getDaysInArrears(row, new Date('2026-04-10T21:00:00Z')), 1);
  assert.equal(getNairobiDay('2026-04-10'), getNairobiDay('2026-04-09T21:00:00Z'));
  assert.equal(getNairobiDay('2026-04-09 21:00:00.000Z'), getNairobiDay('2026-04-10'));
  assert.equal(formatDate('2026-04-09 21:00:00.000Z'), '10/04/2026');
  assert.equal(formatDate('2026-04-10'), '10/04/2026');
  assert.equal(formatDate('2026-02-30'), '\u2014');
});

test('pending, written-off, future disbursement and rolled source contribute no arrears', () => {
  for (const change of [{ status: 'pending' }, { status: 'written_off' }, { renewed_to: 'l2' }, { disbursement_date: '2027-01-01' }]) {
    assert.equal(calc({ loans: [{ ...loan, ...change }] }).summarize().total, 0);
  }
});

test('renewal starts fresh, with historic source included only before renewal', () => {
  const source = { ...loan, status: 'closed', renewed_to: 'l2' };
  const target = { ...loan, id: 'l2', renewed_from: 'l1', disbursement_date: '2026-05-01', renewal_date: '2026-05-01' };
  const before = calc({ loans: [source, target], asOf: referenceDate }).summarize();
  const after = calc({ loans: [source, target], asOf: new Date('2026-05-02T12:00:00+03:00') }).summarize();
  assert.equal(before.total, 9000);
  assert.equal(after.total, 0);
});

test('all age buckets partition unique loans, with a common portfolio denominator', () => {
  const loans = [5, 40, 70, 110, 0].map((days, i) => ({ ...loan, id: `l${i}` }));
  const rows = loans.map((record, i) => ({ id: `x${i}`, loan: record.id, installment_no: 1, amount: 3000, paid: 0,
    due_date: new Date(referenceDate.getTime() - [5, 40, 70, 110, 0][i] * 86400000).toISOString() }));
  const summary = calc({ loans, schedules: rows }).summarize();
  assert.equal(summary.total, 12000);
  assert.equal(summary.loanCount, 4);
  assert.equal(summary.outstanding, 90000);
  for (const bucket of Object.values(summary.buckets)) {
    assert.equal(bucket.loanCount, 1); assert.equal(bucket.olb, 18000); assert.equal(bucket.rate, 20);
  }
  assert.equal(summary.gparRate, 80);
});

test('legacy fractional installments conserve totals, remain idempotent and do not mutate sources', () => {
  const raw = Array.from({ length: 6 }, (_, i) => ({ ...schedules[i], amount: 13465 / 6, paid: 13465 / 6 }));
  const normalized = normalizeLoanSchedules(raw);
  assert.equal(normalized.reduce((total, row) => total + Math.round(row.amount * 100), 0), 1346500);
  assert.deepEqual(normalizeLoanSchedules(normalized), normalized);
  assert.equal(raw[0].amount, 13465 / 6);
  assert.deepEqual(splitLoanInstallments(13465, 6), normalized.map(row => row.amount));
  assert.equal(calc({ schedules: raw }).summarize().total, 6732.5);
});

test('identical duplicate installments count once; ambiguous conflicting duplicates stop totals', () => {
  const row = { ...schedules[0], paid: 0 };
  assert.equal(calc({ schedules: [row, { ...row, id: 'duplicate' }] }).summarize().total, 3000);
  assert.throws(() => calc({ schedules: [row, { ...row, id: 'bad', amount: 3100 }] }), /Conflicting repayment installment/);
  const corrected = normalizeLoanSchedules([{ ...row, updated: '2026-01-01' }, { ...row, id: 'new', amount: 3100, updated: '2026-01-02' }]);
  assert.equal(corrected[0].amount, 3100);
});

test('invalid receipts, sub-cent payments and invalid due dates remain errors', () => {
  for (const row of [{ amount: -1 }, { amount: 1.001 }, { amount: 1, fine_amount: 2 }]) {
    assert.throws(() => calc({ repayments: [{ loan: 'l1', date: '2026-03-01', ...row }] }));
  }
  assert.throws(() => calc({ schedules: [{ ...schedules[0], due_date: '2026-02-30' }] }));
});

test('renewal fine breakdown uses the same ledger position as renewal OLB', () => {
  const renewal = buildDebtRecoveryRenewal({ loan: { ...loan, period: 6 }, schedules,
    penaltyAmount: 500, period: 6, referenceDate: new Date('2026-10-08T12:00:00+03:00') });
  assert.equal(renewal.renewalBase, 21000);
  assert.equal(renewal.fines, 3000);
});
