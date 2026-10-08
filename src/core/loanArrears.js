import { createLoanPortfolioCalculator } from './loanPortfolio.js';
import { financialCents, selectFinancialRecords } from './financialRecords.js';
import { applyEffectiveSchedulePayments, buildEffectiveSchedulePaidMap, getDaysInArrears,
  getScheduleRemaining, isScheduleInArrears } from './loanScheduleMetrics.js';

export const ARREARS_DEFINITION_VERSION = 'arrears-v1';

export const createLoanArrearsCalculator = ({ loans = [], schedules = [], repayments = [], settlements = [],
  referenceDate = new Date(), asOf, penaltyAmount = 0, portfolioCalculator } = {}) => {
  const cutoff = asOf || referenceDate;
  const portfolio = portfolioCalculator || createLoanPortfolioCalculator({ loans, schedules, repayments, settlements,
    referenceDate: cutoff, asOf, penaltyAmount });
  const paidMap = buildEffectiveSchedulePaidMap({ schedules, repayments, settlements, referenceDate: cutoff });
  const effectiveSchedules = applyEffectiveSchedulePayments(schedules, paidMap);
  const schedulesByLoan = new Map();
  effectiveSchedules.forEach(schedule => {
    const id = typeof schedule.loan === 'string' ? schedule.loan : schedule.loan?.id;
    const rows = schedulesByLoan.get(id) || [];
    rows.push(schedule);
    schedulesByLoan.set(id, rows);
  });
  const getSchedules = loan => schedulesByLoan.get(typeof loan === 'string' ? loan : loan?.id) || [];
  const getOverdueSchedules = loan => portfolio.getOutstanding(loan) > 0
    ? getSchedules(loan).filter(row => isScheduleInArrears(row, cutoff)) : [];
  const getArrears = loan => getOverdueSchedules(loan).reduce((sum, row) => sum + financialCents(getScheduleRemaining(row)), 0) / 100;
  const summarize = (records = loans) => {
    const selected = selectFinancialRecords(records, { fields: [] });
    const rows = selected.flatMap(loan => {
      const overdue = getOverdueSchedules(loan);
      if (!overdue.length) return [];
      const oldest = overdue.reduce((a, b) => getDaysInArrears(a, cutoff) >= getDaysInArrears(b, cutoff) ? a : b);
      const daysLate = getDaysInArrears(oldest, cutoff);
      return [{ loan, schedule: oldest, dueDate: oldest.due_date, daysLate,
        arrearsAmount: getArrears(loan), olb: portfolio.getOutstanding(loan), installmentCount: overdue.length,
        bucket: daysLate <= 30 ? 'par30' : daysLate <= 60 ? 'par60' : daysLate <= 90 ? 'par90' : 'par90Plus' }];
    });
    const buckets = Object.fromEntries(['par30', 'par60', 'par90', 'par90Plus'].map(key => [key, { olb: 0, loanCount: 0, rate: 0 }]));
    rows.forEach(row => {
      buckets[row.bucket].olb += financialCents(row.olb);
      buckets[row.bucket].loanCount++;
    });
    const outstanding = portfolio.sumOutstanding(selected);
    for (const bucket of Object.values(buckets)) {
      bucket.olb /= 100;
      bucket.rate = outstanding > 0 ? bucket.olb / outstanding * 100 : 0;
    }
    const total = rows.reduce((sum, row) => sum + financialCents(row.arrearsAmount), 0) / 100;
    const overdueOutstanding = rows.reduce((sum, row) => sum + financialCents(row.olb), 0) / 100;
    return { rows, buckets, total, loanCount: rows.length, installmentCount: rows.reduce((sum, row) => sum + row.installmentCount, 0),
      outstanding, overdueOutstanding, arrearsRatio: outstanding > 0 ? total / outstanding * 100 : 0,
      gparRate: outstanding > 0 ? overdueOutstanding / outstanding * 100 : 0 };
  };
  return { effectiveSchedules, getSchedules, getOverdueSchedules, getArrears, summarize };
};
