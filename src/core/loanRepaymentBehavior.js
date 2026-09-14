import { calculateLoanPenaltyState } from './loanPenalty.js';

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date
    ? new Date(value)
    : new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
};

const endOfLocalDay = (value) => {
  const date = toDate(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;
const roundPercent = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getRating = (score) => {
  if (score === null) {
    return {
      label: 'New Loan',
      color: 'var(--primary)',
      tone: 'Not enough repayment history yet.'
    };
  }
  if (score >= 90) {
    return {
      label: 'Excellent',
      color: 'var(--success)',
      tone: 'Client is paying the monthly schedule on time.'
    };
  }
  if (score >= 75) {
    return {
      label: 'Good',
      color: 'var(--primary)',
      tone: 'Loan is being managed well, with minor timing gaps.'
    };
  }
  if (score >= 50) {
    return {
      label: 'Watchlist',
      color: 'var(--warning)',
      tone: 'Collections are coming in, but timing discipline needs follow-up.'
    };
  }
  return {
    label: 'Poor',
    color: 'var(--danger)',
    tone: 'Monthly repayment behaviour needs urgent attention.'
  };
};

export const calculateLoanRepaymentBehavior = ({
  schedules = [],
  repayments = [],
  settlements = [],
  penaltyAmount = 0,
  referenceDate = new Date()
} = {}) => {
  const referenceEnd = endOfLocalDay(referenceDate) || new Date();
  const penaltyState = calculateLoanPenaltyState({
    schedules,
    repayments,
    settlements,
    penaltyAmount,
    referenceDate
  });

  const dueStates = penaltyState.scheduleStates
    .map(item => {
      const dueEnd = endOfLocalDay(item.schedule?.due_date);
      const amount = Math.max(0, Number(item.schedule?.amount) || item.amount || 0);
      const paid = Math.min(amount, Math.max(0, Number(item.paid) || 0));
      const completedAt = toDate(item.completedAt);
      const isFullyPaid = amount > 0 && paid >= amount;
      const isDue = Boolean(dueEnd && dueEnd <= referenceEnd);
      return {
        ...item,
        dueEnd,
        amount,
        paid,
        completedAt,
        isFullyPaid,
        isDue
      };
    })
    .filter(item => item.isDue && item.amount > 0);

  const expectedDue = roundMoney(dueStates.reduce((sum, item) => sum + item.amount, 0));
  const paidAgainstDue = roundMoney(dueStates.reduce((sum, item) => sum + item.paid, 0));
  const paidRate = expectedDue > 0 ? roundPercent(Math.min(100, (paidAgainstDue / expectedDue) * 100)) : 0;

  let onTimeMonths = 0;
  let lateMonths = 0;
  let unverifiedPaidMonths = 0;
  let missedMonths = 0;

  dueStates.forEach(item => {
    if (!item.isFullyPaid) {
      missedMonths += 1;
      return;
    }
    if (!item.completedAt) {
      unverifiedPaidMonths += 1;
      return;
    }
    if (item.completedAt <= item.dueEnd) onTimeMonths += 1;
    else lateMonths += 1;
  });

  const dueMonths = dueStates.length;
  const onTimeRate = dueMonths > 0 ? roundPercent((onTimeMonths / dueMonths) * 100) : 0;
  const score = dueMonths > 0
    ? roundPercent((paidRate * 0.5) + (onTimeRate * 0.5))
    : null;
  const rating = getRating(score);

  return {
    score,
    rating: rating.label,
    ratingColor: rating.color,
    summary: rating.tone,
    dueMonths,
    expectedDue,
    paidAgainstDue,
    paidRate,
    onTimeMonths,
    onTimeRate,
    lateMonths,
    missedMonths,
    unverifiedPaidMonths,
    scheduleStates: dueStates
  };
};
