import { createLoanPortfolioCalculator } from './loanPortfolio.js';
import { isDebtRecoveryLoan, isRecoveredLoan } from './debtRecovery.js';
import { getLoanEndDate, isDistressUnitLoan } from './distressUnit.js';
import { calculateLoanPenaltyState } from './loanPenalty.js';
import { getArrearsTotal } from './loanScheduleMetrics.js';
import { getLoanLiabilityAmount, getRepaymentContractAmount, getSettlementContractAmount } from './repaymentAllocation.js';

const toDate = value => new Date(typeof value === 'string' ? value.replace(' ', 'T') : value);
const addDays = (value, days) => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date;
};

export const buildDebtManagementRows = ({ loans = [], repayments = [], settlements = [], schedules = [],
  penaltyAmount = 500, referenceDate = new Date() } = {}) => {
  const activeRepayments = repayments.filter(row => !row.is_reversed);
  const activeSettlements = settlements.filter(row => row.status !== 'reversed');
  const calculator = createLoanPortfolioCalculator({ repayments: activeRepayments, settlements: activeSettlements,
    schedules, penaltyAmount, referenceDate });
  return loans.flatMap(loan => {
    const paymentRecords = calculator.getRepayments(loan.id);
    const settlementRecords = calculator.getSettlements(loan.id);
    const loanSchedules = calculator.getSchedules(loan.id);
    const context = { repayments: paymentRecords, settlements: settlementRecords,
      schedules: loanSchedules, penaltyAmount, referenceDate };
    const olb = calculator.getOutstanding(loan);
    const recovered = isRecoveredLoan(loan, context);
    const categories = recovered ? ['rl'] : [
      ...(isDebtRecoveryLoan(loan, context) ? ['dru'] : []),
      ...(isDistressUnitLoan(loan, { outstandingBalance: olb, referenceDate }) ? ['du'] : [])
    ];
    if (!categories.length || loan.written_off_at) return [];
    const endDate = getLoanEndDate(loan);
    const paymentDates = [
      ...paymentRecords.filter(row => Number(row.amount) > 0).map(row => row.date || row.created),
      ...settlementRecords.filter(row => Number(row.amount) > 0).map(row => row.effective_date || row.date || row.created)
    ].map(toDate).filter(date => !Number.isNaN(date.getTime()));
    const categoryDates = {
      dru: addDays(loan.renewal_date || loan.disbursement_date, 90),
      du: endDate ? addDays(endDate, 1) : null,
      rl: paymentDates.length ? new Date(Math.max(...paymentDates.map(Number))) : null
    };
    const penalty = calculateLoanPenaltyState({ ...context, schedules: loanSchedules });
    const effectiveSchedules = penalty.scheduleStates.map(item => ({ ...item.schedule, paid: item.paid,
      status: item.remainingPrincipal > 0 ? 'pending' : 'paid' }));
    const contractPaid = paymentRecords.reduce((sum, row) => sum + getRepaymentContractAmount(row), 0)
      + settlementRecords.reduce((sum, row) => sum + getSettlementContractAmount(row), 0);
    const expected = getLoanLiabilityAmount(loan);
    const contractCollected = Math.min(expected, contractPaid);
    return [{ loan, categories, categoryDates, endDate, olb, expected, contractCollected,
      arrears: recovered ? 0 : getArrearsTotal(effectiveSchedules, referenceDate),
      fines: penalty.outstandingFine,
      collected: contractCollected + penalty.fineCollected }];
  });
};

export const getDebtReportDate = (row, { category = 'all', basis = 'activity' } = {}) => {
  if (basis === 'disbursement') return row.loan.disbursement_date;
  if (category !== 'all') return row.categoryDates[category];
  const dates = row.categories.map(key => row.categoryDates[key]).filter(Boolean);
  return dates.length ? new Date(Math.min(...dates.map(Number))) : null;
};

export const summarizeDebtManagement = (rows = []) => {
  const recoveryExpected = rows.reduce((sum, row) => sum + (Number(row.expected) || 0), 0);
  const recoveryCollected = rows.reduce((sum, row) => sum + (Number(row.contractCollected) || 0), 0);

  return {
    count: rows.length,
    dru: rows.filter(row => row.categories.includes('dru')).length,
    du: rows.filter(row => row.categories.includes('du')).length,
    rl: rows.filter(row => row.categories.includes('rl')).length,
    olb: rows.reduce((sum, row) => sum + row.olb, 0),
    arrears: rows.reduce((sum, row) => sum + row.arrears, 0),
    fines: rows.reduce((sum, row) => sum + row.fines, 0),
    recovered: rows.filter(row => row.categories.includes('rl')).reduce((sum, row) => sum + row.collected, 0),
    recoveryExpected,
    recoveryCollected,
    recoveryRate: recoveryExpected > 0 ? (recoveryCollected / recoveryExpected) * 100 : 0
  };
};
