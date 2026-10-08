import { financialCents, getFinancialTimestamp, selectFinancialRecords } from './financialRecords.js';
import { normalizeLoanSchedules } from './loanInstallments.js';

export const getNairobiDay = (date = new Date()) => {
  const timestamp = getFinancialTimestamp(date);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid repayment calendar date');
  return Math.floor((timestamp + 10800000) / 86400000);
};

export const getScheduleRemaining = schedule => Math.max(0,
  financialCents(schedule?.amount, 'Installment') - financialCents(schedule?.paid, 'Installment payment')) / 100;
export const isSchedulePaid = schedule => getScheduleRemaining(schedule) <= 0;
export const isScheduleInArrears = (schedule, referenceDate = new Date()) => (
  !isSchedulePaid(schedule) && getNairobiDay(schedule.due_date) < getNairobiDay(referenceDate)
);
export const getScheduleArrearsAmount = (schedule, referenceDate = new Date()) => (
  isScheduleInArrears(schedule, referenceDate) ? getScheduleRemaining(schedule) : 0
);
export const getDaysInArrears = (schedule, referenceDate = new Date()) => (
  isScheduleInArrears(schedule, referenceDate) ? getNairobiDay(referenceDate) - getNairobiDay(schedule.due_date) : 0
);
export const getArrearsTotal = (schedules = [], referenceDate = new Date()) => (
  normalizeLoanSchedules(schedules).reduce((sum, schedule) => sum + financialCents(getScheduleArrearsAmount(schedule, referenceDate)), 0) / 100
);

const relationId = value => typeof value === 'string' ? value : value?.id || '';
export const buildEffectiveSchedulePaidMap = ({ schedules = [], repayments = [], settlements = [],
  referenceDate = new Date(), useRecordedPaid = false } = {}) => {
  const paidByLoan = new Map();
  const add = (row, amount) => {
    const id = relationId(row.loan);
    const total = (paidByLoan.get(id) || 0) + amount;
    if (!Number.isSafeInteger(total)) throw new Error('Contract payment total exceeds the supported monetary range');
    if (id) paidByLoan.set(id, total);
  };
  selectFinancialRecords(repayments, { cutoff: referenceDate }).forEach(row => {
    const amount = financialCents(row.amount, 'Receipt');
    const fine = financialCents(row.fine_amount, 'Collected fine');
    if (amount <= 0 || fine > amount) throw new Error(`Invalid contractual receipt on ${row.id || 'repayment'}`);
    add(row, amount - fine);
  });
  selectFinancialRecords(settlements, { cutoff: referenceDate, fields: ['effective_date', 'date', 'created'] })
    .forEach(row => {
      const amount = financialCents(row.amount, 'Balance-off');
      if (amount <= 0) throw new Error(`Invalid balance-off on ${row.id || 'settlement'}`);
      add(row, amount);
    });
  const paidMap = new Map();
  normalizeLoanSchedules(schedules).forEach(schedule => {
    const loan = relationId(schedule.loan);
    const amount = financialCents(schedule.amount);
    const available = paidByLoan.get(loan) || 0;
    const paid = Math.min(amount, available);
    paidByLoan.set(loan, available - paid);
    const recorded = useRecordedPaid ? financialCents(schedule.paid, 'Recorded installment payment') : 0;
    paidMap.set(schedule.id, Math.min(amount, Math.max(paid, recorded)) / 100);
  });
  return paidMap;
};

export const applyEffectiveSchedulePayments = (schedules = [], paidMap = new Map()) => (
  normalizeLoanSchedules(schedules).map(schedule => {
    const amount = financialCents(schedule.amount);
    const paid = Math.min(amount, financialCents(paidMap.get(schedule.id) || 0));
    return { ...schedule, paid: paid / 100, status: paid >= amount ? 'paid' : (paid > 0 ? 'partial' : 'pending') };
  })
);
