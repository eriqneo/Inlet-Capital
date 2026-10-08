import { createLoanPortfolioCalculator } from './loanPortfolio.js';
import { isDebtRecoveryLoan, isRecoveredLoan } from './debtRecovery.js';
import { getLoanEndDate, isDistressUnitLoan } from './distressUnit.js';
import { calculateLoanPenaltyState } from './loanPenalty.js';
import { createLoanArrearsCalculator } from './loanArrears.js';
import { getLoanLiabilityAmount, getRepaymentContractAmount, getSettlementContractAmount } from './repaymentAllocation.js';

const toDate = value => new Date(typeof value === 'string' ? value.replace(' ', 'T') : value);
const addDays = (value, days) => {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date;
};

const getRecordDate = (record, fields) => {
  const value = fields.map(field => record?.[field]).find(Boolean);
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getRenewalCycleStart = (loan) => {
  if (!loan?.renewal_summary?.renewal_id) return null;
  const date = toDate(loan.renewal_date || loan.renewal_summary?.renewal_date);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const buildDebtManagementRows = ({ loans = [], repayments = [], settlements = [], schedules = [],
  penaltyAmount = 500, referenceDate = new Date() } = {}) => {
  const activeRepayments = repayments.filter(row => !row.is_reversed);
  const activeSettlements = settlements.filter(row => row.status !== 'reversed');
  const calculator = createLoanPortfolioCalculator({ repayments: activeRepayments, settlements: activeSettlements,
    schedules, penaltyAmount, referenceDate });
  const arrears = createLoanArrearsCalculator({ loans, repayments: activeRepayments, settlements: activeSettlements,
    schedules, referenceDate, portfolioCalculator: calculator });
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
    const penalty = calculateLoanPenaltyState({ ...context, schedules: loanSchedules, useRecordedSchedulePaid: false });
    const contractPaid = paymentRecords.reduce((sum, row) => sum + getRepaymentContractAmount(row), 0)
      + settlementRecords.reduce((sum, row) => sum + getSettlementContractAmount(row), 0);
    const expected = getLoanLiabilityAmount(loan);
    const contractCollected = Math.min(expected, contractPaid);
    const renewalCycleStart = getRenewalCycleStart(loan);
    const recoveryPayments = renewalCycleStart
      ? paymentRecords.filter(row => {
        const paymentDate = getRecordDate(row, ['date', 'created']);
        return paymentDate && paymentDate >= renewalCycleStart;
      })
      : [];
    const recoverySettlements = renewalCycleStart
      ? settlementRecords.filter(row => {
        const settlementDate = getRecordDate(row, ['effective_date', 'date', 'created']);
        return settlementDate && settlementDate >= renewalCycleStart;
      })
      : [];
    const recoveryExpected = renewalCycleStart ? expected : 0;
    const recoveryCollected = Math.min(recoveryExpected,
      recoveryPayments.reduce((sum, row) => sum + getRepaymentContractAmount(row), 0)
      + recoverySettlements.reduce((sum, row) => sum + getSettlementContractAmount(row), 0));
    return [{ loan, categories, categoryDates, endDate, olb, expected, contractCollected,
      recoveryExpected, recoveryCollected,
      arrears: recovered ? 0 : arrears.getArrears(loan),
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
  const recoveryExpected = rows.reduce((sum, row) => sum + (Number(row.recoveryExpected) || 0), 0);
  const recoveryCollected = rows.reduce((sum, row) => sum + (Number(row.recoveryCollected) || 0), 0);

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
