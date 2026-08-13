import { calculateLoanPenaltyState } from './loanPenalty.js';
import { getLoanLiabilityAmount, getRepaymentContractAmount, getSettlementContractAmount } from './repaymentAllocation.js';

export const isDisbursedLoanRecord = (loan) => Boolean(loan?.disbursement_date)
  && ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan?.status);

export const isCollectibleLoanRecord = (loan) => Boolean(loan?.disbursement_date)
  && ['disbursed', 'approved', 'partial_approved'].includes(loan?.status);

export const isWrittenOffLoanRecord = (loan) => loan?.status === 'written_off';

export const calculateLoanOutstandingBalance = ({
  loan,
  repayments = [],
  settlements = [],
  schedules = [],
  penaltyAmount = 0,
  includeOutstandingFines = true,
  referenceDate = new Date(),
  useRecordedSchedulePaid = true
} = {}) => {
  if (!loan || !isDisbursedLoanRecord(loan)) return 0;
  if (isWrittenOffLoanRecord(loan)) return 0;
  const liability = getLoanLiabilityAmount(loan);
  const contractPaid = repayments.reduce(
    (sum, repayment) => sum + getRepaymentContractAmount(repayment),
    0
  ) + settlements.reduce((sum, settlement) => sum + getSettlementContractAmount(settlement), 0);
  const contractBalance = Math.max(0, liability - contractPaid);
  if (!includeOutstandingFines) return contractBalance;

  const penaltyState = calculateLoanPenaltyState({
    schedules,
    repayments,
    settlements,
    penaltyAmount,
    referenceDate,
    useRecordedSchedulePaid
  });
  return Math.max(0, contractBalance + penaltyState.outstandingFine);
};

export const createLoanPortfolioCalculator = ({
  repayments = [],
  settlements = [],
  schedules = [],
  penaltyAmount = 0,
  includeOutstandingFines = true,
  referenceDate = new Date(),
  useRecordedSchedulePaid = true
} = {}) => {
  const repaymentsByLoan = new Map();
  repayments.forEach(repayment => {
    const loanId = typeof repayment?.loan === 'string' ? repayment.loan : repayment?.loan?.id;
    if (!loanId) return;
    if (!repaymentsByLoan.has(loanId)) repaymentsByLoan.set(loanId, []);
    repaymentsByLoan.get(loanId).push(repayment);
  });
  const settlementsByLoan = new Map();
  settlements.forEach(settlement => {
    const loanId = typeof settlement?.loan === 'string' ? settlement.loan : settlement?.loan?.id;
    if (!loanId || settlement?.status === 'reversed') return;
    if (!settlementsByLoan.has(loanId)) settlementsByLoan.set(loanId, []);
    settlementsByLoan.get(loanId).push(settlement);
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
    getSettlements: loanId => settlementsByLoan.get(loanId) || [],
    getSchedules: loanId => schedulesByLoan.get(loanId) || [],
    getOutstanding: loan => calculateLoanOutstandingBalance({
      loan,
      repayments: repaymentsByLoan.get(loan?.id) || [],
      settlements: settlementsByLoan.get(loan?.id) || [],
      schedules: schedulesByLoan.get(loan?.id) || [],
      penaltyAmount,
      includeOutstandingFines,
      referenceDate,
      useRecordedSchedulePaid
    })
  };
};
