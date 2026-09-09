import { addMonthsPreservingDay } from './repaymentSchedule.js';
import { isCollectibleLoanRecord } from './loanPortfolio.js';

const toValidDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (value) => {
  const date = toValidDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

export const getLoanEndDate = (loan) => {
  const disbursementDate = toValidDate(loan?.renewal_date || loan?.disbursement_date);
  const period = Number(loan?.period) || 0;
  if (!disbursementDate || period <= 0) return null;
  return addMonthsPreservingDay(disbursementDate, period);
};

export const isDistressUnitLoan = (loan, {
  outstandingBalance = 0,
  referenceDate = new Date()
} = {}) => {
  if (!isCollectibleLoanRecord(loan)) return false;
  const endDate = startOfDay(getLoanEndDate(loan));
  const today = startOfDay(referenceDate);
  if (!endDate || !today) return false;
  return endDate < today && Number(outstandingBalance) > 0.01;
};
