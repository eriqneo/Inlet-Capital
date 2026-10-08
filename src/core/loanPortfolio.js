import { calculateLoanPenaltyState } from './loanPenalty.js';
import { getLoanLiabilityAmount } from './repaymentAllocation.js';
import { financialCents, getFinancialTimestamp, selectFinancialRecords } from './financialRecords.js';
import { normalizeLoanSchedules } from './loanInstallments.js';

export const OLB_DEFINITION_VERSION = 'olb-v1';

export const getLoanAtCutoff = (loan, { asOf, loans = [] } = {}) => {
  if (!loan || !asOf) return loan;
  const cutoff = getFinancialTimestamp(asOf);
  const disbursedAt = getFinancialTimestamp(loan.disbursement_date);
  if (!Number.isFinite(cutoff)) throw new Error('Invalid OLB cutoff');
  if (!Number.isFinite(disbursedAt) || disbursedAt > cutoff) return null;
  let result = loan;
  if (loan.status === 'written_off') {
    const writtenOffAt = getFinancialTimestamp(loan.written_off_at);
    if (!Number.isFinite(writtenOffAt)) throw new Error(`Write-off date unavailable for ${loan.loan_no || loan.id}`);
    if (writtenOffAt <= cutoff) return null;
    result = { ...result, status: 'disbursed' };
  }
  if (loan.renewed_to) {
    const targetId = typeof loan.renewed_to === 'string' ? loan.renewed_to : loan.renewed_to.id;
    const target = loans.find(item => item.id === targetId) || loan.expand?.renewed_to;
    const renewalDate = getFinancialTimestamp(target?.renewal_date || target?.disbursement_date);
    if (!Number.isFinite(renewalDate)) throw new Error(`Renewal date unavailable for ${loan.loan_no || loan.id}`);
    if (renewalDate <= cutoff) return null;
    result = { ...result, status: 'disbursed', renewed_to: '' };
  }
  return result;
};

export const isDisbursedLoanRecord = (loan) => Boolean(loan?.disbursement_date)
  && ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan?.status);

export const isCollectibleLoanRecord = (loan) => Boolean(loan?.disbursement_date)
  && ['disbursed', 'approved', 'partial_approved'].includes(loan?.status);

export const isWrittenOffLoanRecord = (loan) => loan?.status === 'written_off';

export const calculateLoanBalanceBreakdown = ({
  loan,
  repayments = [],
  settlements = [],
  schedules = [],
  penaltyAmount = 0,
  includeOutstandingFines = true,
  referenceDate = new Date(),
  useRecordedSchedulePaid = false,
  asOf,
  loans = []
} = {}) => {
  const empty = { liability: 0, contractPaid: 0, contractBalance: 0, outstandingFine: 0, outstanding: 0 };
  loan = getLoanAtCutoff(loan, { asOf, loans });
  if (!loan || !isDisbursedLoanRecord(loan) || isWrittenOffLoanRecord(loan) || loan.renewed_to) return empty;
  const cutoff = asOf || referenceDate;
  const disbursedAt = getFinancialTimestamp(loan.disbursement_date);
  if (!Number.isFinite(disbursedAt)) throw new Error(`Invalid disbursement date on ${loan.id || 'loan'}`);
  if (disbursedAt > getFinancialTimestamp(cutoff)) return empty;
  for (const field of ['approved_amount', 'amount_applied', 'interest_amount', 'total_liability']) financialCents(loan[field], `Loan ${field}`);
  repayments = selectFinancialRecords(repayments, { cutoff });
  settlements = selectFinancialRecords(settlements, { cutoff, fields: ['effective_date', 'date', 'created'] });
  const liability = financialCents(getLoanLiabilityAmount(loan), 'Loan liability');
  if (liability <= 0) throw new Error(`Disbursed liability unavailable for ${loan.loan_no || loan.id}`);
  const contractPaid = repayments.reduce((sum, repayment) => {
    const amount = financialCents(repayment.amount, 'Receipt');
    if (amount <= 0) throw new Error(`Receipt amount unavailable on ${repayment.id || 'repayment'}`);
    const fine = financialCents(repayment.fine_amount, 'Collected fine');
    if (fine > amount) throw new Error(`Fine exceeds receipt on ${repayment.id || 'repayment'}`);
    return sum + amount - fine;
  }, 0) + settlements.reduce((sum, settlement) => {
    const amount = financialCents(settlement.amount, 'Balance-off');
    if (amount <= 0) throw new Error(`Balance-off amount unavailable on ${settlement.id || 'settlement'}`);
    return sum + amount;
  }, 0);
  const contractBalance = Math.max(0, liability - contractPaid);
  if (!Number.isSafeInteger(contractPaid)) throw new Error('Contract payment total exceeds the supported monetary range');

  const penaltyState = calculateLoanPenaltyState({
    schedules,
    repayments,
    settlements,
    penaltyAmount,
    referenceDate: cutoff,
    useRecordedSchedulePaid
  });
  const fine = includeOutstandingFines ? financialCents(penaltyState.outstandingFine) : 0;
  return { liability: liability / 100, contractPaid: contractPaid / 100, contractBalance: contractBalance / 100,
    outstandingFine: fine / 100, outstanding: (contractBalance + fine) / 100 };
};

export const calculateLoanOutstandingBalance = options => calculateLoanBalanceBreakdown(options).outstanding;

export const createLoanPortfolioCalculator = ({
  repayments = [],
  settlements = [],
  schedules = [],
  penaltyAmount = 0,
  includeOutstandingFines = true,
  referenceDate = new Date(),
  useRecordedSchedulePaid = false,
  asOf,
  loans = []
} = {}) => {
  const repaymentsByLoan = new Map();
  selectFinancialRecords(repayments, { cutoff: asOf || referenceDate }).forEach(repayment => {
    const loanId = typeof repayment?.loan === 'string' ? repayment.loan : repayment?.loan?.id;
    if (!loanId) return;
    if (!repaymentsByLoan.has(loanId)) repaymentsByLoan.set(loanId, []);
    repaymentsByLoan.get(loanId).push(repayment);
  });
  const settlementsByLoan = new Map();
  selectFinancialRecords(settlements, { cutoff: asOf || referenceDate, fields: ['effective_date', 'date', 'created'] }).forEach(settlement => {
    const loanId = typeof settlement?.loan === 'string' ? settlement.loan : settlement?.loan?.id;
    if (!loanId || settlement?.status === 'reversed') return;
    if (!settlementsByLoan.has(loanId)) settlementsByLoan.set(loanId, []);
    settlementsByLoan.get(loanId).push(settlement);
  });
  const schedulesByLoan = new Map();
  normalizeLoanSchedules(schedules).forEach(schedule => {
    const loanId = typeof schedule?.loan === 'string' ? schedule.loan : schedule?.loan?.id;
    if (!loanId) return;
    if (!schedulesByLoan.has(loanId)) schedulesByLoan.set(loanId, []);
    schedulesByLoan.get(loanId).push(schedule);
  });

  const balances = new WeakMap();
  const getBalance = loan => {
    if (loan && balances.has(loan)) return balances.get(loan);
    const balance = Object.freeze(calculateLoanBalanceBreakdown({
    loan, repayments: repaymentsByLoan.get(loan?.id) || [], settlements: settlementsByLoan.get(loan?.id) || [],
    schedules: schedulesByLoan.get(loan?.id) || [], penaltyAmount, includeOutstandingFines,
    referenceDate, useRecordedSchedulePaid, asOf, loans
    }));
    if (loan) balances.set(loan, balance);
    return balance;
  };
  return {
    getRepayments: loanId => repaymentsByLoan.get(loanId) || [],
    getSettlements: loanId => settlementsByLoan.get(loanId) || [],
    getSchedules: loanId => schedulesByLoan.get(loanId) || [],
    getBalance,
    getOutstanding: loan => getBalance(loan).outstanding,
    sumOutstanding: records => selectFinancialRecords(records, { fields: [] }).reduce((sum, loan) => sum + financialCents(getBalance(loan).outstanding), 0) / 100
  };
};
