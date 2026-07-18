import { calculateLoanPenaltyState } from './loanPenalty.js';
import { getLoanLiabilityAmount, getRepaymentContractAmount } from './repaymentAllocation.js';

export const isDisbursedLoanRecord = (loan) => Boolean(loan?.disbursement_date)
  && ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan?.status);

export const calculateLoanOutstandingBalance = ({
  loan,
  repayments = [],
  schedules = [],
  penaltyAmount = 0,
  includeOutstandingFines = true
} = {}) => {
  if (!loan || !isDisbursedLoanRecord(loan)) return 0;
  const liability = getLoanLiabilityAmount(loan);
  const contractPaid = repayments.reduce(
    (sum, repayment) => sum + getRepaymentContractAmount(repayment),
    0
  );
  const contractBalance = Math.max(0, liability - contractPaid);
  if (!includeOutstandingFines) return contractBalance;

  const penaltyState = calculateLoanPenaltyState({ schedules, repayments, penaltyAmount });
  return Math.max(0, contractBalance + penaltyState.outstandingFine);
};

export const createLoanPortfolioCalculator = ({
  repayments = [],
  schedules = [],
  penaltyAmount = 0,
  includeOutstandingFines = true
} = {}) => {
  const repaymentsByLoan = new Map();
  repayments.forEach(repayment => {
    const loanId = typeof repayment?.loan === 'string' ? repayment.loan : repayment?.loan?.id;
    if (!loanId) return;
    if (!repaymentsByLoan.has(loanId)) repaymentsByLoan.set(loanId, []);
    repaymentsByLoan.get(loanId).push(repayment);
  });
  const schedulesByLoan = new Map();
  schedules.forEach(schedule => {
    const loanId = typeof schedule?.loan === 'string' ? schedule.loan : schedule?.loan?.id;
    if (!loanId) return;
    if (!schedulesByLoan.has(loanId)) schedulesByLoan.set(loanId, []);
    schedulesByLoan.get(loanId).push(schedule);
  });

  return {
    getRepayments: loanId => repaymentsByLoan.get(loanId) || [],
    getSchedules: loanId => schedulesByLoan.get(loanId) || [],
    getOutstanding: loan => calculateLoanOutstandingBalance({
      loan,
      repayments: repaymentsByLoan.get(loan?.id) || [],
      schedules: schedulesByLoan.get(loan?.id) || [],
      penaltyAmount,
      includeOutstandingFines
    })
  };
};
