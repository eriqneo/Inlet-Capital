import { financialCents, getFinancialTimestamp, selectFinancialRecords } from './financialRecords.js';

const relationId = value => typeof value === 'string' ? value : value?.id || '';
const amountValue = value => {
  const amount = Number(value);
  if (value === null || value === undefined || value === '' || !['number', 'string'].includes(typeof value)
    || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error('Installment requires a valid non-negative amount');
  }
  return amount;
};

export const splitLoanInstallments = (liability, period) => {
  const total = financialCents(liability, 'Scheduled liability');
  if (!Number.isSafeInteger(period) || period < 1 || period > 1200) throw new Error('Invalid repayment period');
  return Array.from({ length: period }, (_, index) => (
    Math.round(total * ((index + 1) / period)) - Math.round(total * (index / period))
  ) / 100);
};

export const normalizeLoanSchedules = (schedules = []) => {
  const installments = new Map();
  selectFinancialRecords(schedules, { fields: [] }).forEach((schedule, index) => {
    const loan = relationId(schedule.loan);
    const number = Number(schedule.installment_no);
    const key = loan && Number.isInteger(number) && number > 0 ? `${loan}:${number}` : `row:${schedule.id || index}`;
    const prior = installments.get(key);
    if (prior) {
      const time = getFinancialTimestamp(schedule.updated || schedule.created) || 0;
      const priorTime = getFinancialTimestamp(prior.updated || prior.created) || 0;
      if (time === priorTime && (Number(schedule.amount) !== Number(prior.amount)
        || getFinancialTimestamp(schedule.due_date) !== getFinancialTimestamp(prior.due_date)
        || Boolean(schedule.penalty_waived) !== Boolean(prior.penalty_waived))) {
        throw new Error(`Conflicting repayment installment ${key}`);
      }
      if (time < priorTime || (time === priorTime && String(schedule.id) < String(prior.id))) return;
    }
    installments.set(key, schedule);
  });
  const ordered = [...installments.values()].sort((a, b) => relationId(a.loan).localeCompare(relationId(b.loan))
    || (Number(a.installment_no) || 0) - (Number(b.installment_no) || 0)
    || getFinancialTimestamp(a.due_date) - getFinancialTimestamp(b.due_date));
  const totals = new Map();
  // Conserve legacy recurring-decimal schedule totals by rounding cumulative amounts.
  return ordered.map((schedule, index) => {
    const key = relationId(schedule.loan) || `anonymous:${index}`;
    const previous = totals.get(key) || 0;
    const next = previous + amountValue(schedule.amount) * 100;
    if (!Number.isSafeInteger(Math.round(next))) throw new Error('Scheduled total exceeds the supported monetary range');
    totals.set(key, next);
    const amount = (Math.round(next) - Math.round(previous)) / 100;
    if (amount > 0 && !Number.isFinite(getFinancialTimestamp(schedule.due_date))) throw new Error(`Installment due date unavailable on ${schedule.id || 'schedule'}`);
    const paid = Math.min(amount, Math.round(amountValue(schedule.paid ?? 0) * 100) / 100);
    return { ...schedule, amount, paid };
  });
};
