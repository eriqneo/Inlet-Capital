import test from 'node:test';
import assert from 'node:assert/strict';
import { isRecoveredLoan } from '../src/core/debtRecovery.js';
import { buildDebtManagementRows, getDebtReportDate, summarizeDebtManagement } from '../src/core/debtManagement.js';

const loan = { id: 'loan1', status: 'completed', disbursement_date: '2026-01-01T09:00:00+03:00',
  approved_amount: 15000, interest_amount: 3000, total_liability: 18000, period: 3 };
const schedules = [2, 3, 4].map((month, index) => ({ id: `s${index}`, loan: loan.id, installment_no: index + 1,
  due_date: `2026-0${month}-01T09:00:00+03:00`, amount: 6000, paid: 0, status: 'pending' }));
const payment = { loan: loan.id, amount: 19000, fine_amount: 1000, date: '2026-04-01T09:00:00+03:00' };
const context = { repayments: [payment], schedules, referenceDate: '2026-05-01T12:00:00+03:00', penaltyAmount: 500 };

test('RL includes a loan paid directly from DRU without a renewal', () => {
  assert.equal(isRecoveredLoan(loan, context), true);
  assert.equal(isRecoveredLoan({ ...loan, status: 'disbursed' }, context), true);
});

test('ordinary completed, partly paid, and outstanding-fine loans are not recovered', () => {
  assert.equal(isRecoveredLoan(loan, { ...context, repayments: [{ ...payment, date: '2026-03-31' }] }), false);
  assert.equal(isRecoveredLoan(loan, { ...context, repayments: [{ ...payment, amount: 18000, fine_amount: 0 }] }), false);
  assert.equal(isRecoveredLoan(loan, { ...context, repayments: [{ ...payment, amount: 1500, fine_amount: 1000 }] }), false);
  assert.equal(isRecoveredLoan(loan, { ...context, repayments: [] }), false);
  assert.equal(isRecoveredLoan(loan, { ...context, repayments: [{ ...payment, amount: 18999.99 }] }), false);
});

test('written off and unverifiable records do not count as recovered', () => {
  assert.equal(isRecoveredLoan({ ...loan, status: 'written_off' }, context), false);
  assert.equal(isRecoveredLoan({ ...loan, written_off_at: '2026-04-01' }, context), false);
  assert.equal(isRecoveredLoan(loan, { ...context, schedules: [] }), false);
  assert.equal(isRecoveredLoan(loan, { ...context, repayments: [{ ...payment, is_reversed: true }] }), false);
  assert.equal(isRecoveredLoan(loan, { ...context, repayments: [{ ...payment, date: '' }] }), false);
  assert.equal(isRecoveredLoan(loan, { ...context, repayments: [{ ...payment, date: '2027-01-01' }] }), false);
});

test('renewed DRU loans count only after principal, interest and carried fines are settled', () => {
  const renewed = { ...loan, renewal_date: '2026-04-01', renewal_summary: { renewal_id: 'r1' } };
  const renewedSchedules = schedules.map((row, index) => ({ ...row, due_date: `2026-0${index + 5}-01`, carried_fine: index === 0 ? 1000 : 0 }));
  assert.equal(isRecoveredLoan(renewed, { ...context, schedules: renewedSchedules,
    repayments: [{ ...payment, date: '2026-04-02' }] }), true);
  assert.equal(isRecoveredLoan(renewed, { ...context, schedules: renewedSchedules,
    repayments: [{ ...payment, amount: 18500, fine_amount: 500, date: '2026-04-02' }] }), false);
});

test('debt report shares categories and totals overlapping DU/DRU once', () => {
  const overdue = { ...loan, id: 'loan2', status: 'disbursed' };
  const allSchedules = [...schedules, ...schedules.map(row => ({ ...row, id: `${row.id}b`, loan: overdue.id }))];
  const rows = buildDebtManagementRows({ ...context, loans: [loan, overdue], schedules: allSchedules });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].categories, ['rl']);
  assert.deepEqual(rows[1].categories, ['dru', 'du']);
  const totals = summarizeDebtManagement(rows);
  assert.equal(totals.count, 2);
  assert.equal(totals.dru, 1);
  assert.equal(totals.du, 1);
  assert.equal(totals.rl, 1);
  assert.equal(totals.olb, 19500);
  assert.equal(totals.arrears, 18000);
  assert.equal(totals.fines, 1500);
  assert.equal(totals.recovered, 19000);
  assert.equal(getDebtReportDate(rows[1], { category: 'dru' }).toISOString().slice(0, 10), '2026-04-01');
  assert.equal(getDebtReportDate(rows[1], { category: 'du' }).toISOString().slice(0, 10), '2026-04-02');
  assert.equal(getDebtReportDate(rows[0], { category: 'rl' }).toISOString().slice(0, 10), '2026-04-01');
  assert.equal(getDebtReportDate(rows[0], { basis: 'disbursement' }), loan.disbursement_date);
  assert.equal(summarizeDebtManagement([]).olb, 0);
});

test('debt arrears apply partial payments to the oldest installments', () => {
  const overdue = { ...loan, status: 'disbursed' };
  const rows = buildDebtManagementRows({ ...context, loans: [overdue],
    repayments: [{ ...payment, amount: 7000, fine_amount: 1000 }] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].categories, ['du']);
  assert.equal(rows[0].arrears, 12000);
  assert.equal(rows[0].collected, 7000);
});
