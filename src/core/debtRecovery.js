import { calculateLoanOutstandingBalance, isCollectibleLoanRecord, isDisbursedLoanRecord } from './loanPortfolio.js';
import { calculateLoanPenaltyState } from './loanPenalty.js';
import { isDistressUnitLoan } from './distressUnit.js';
import { addMonthsPreservingDay, getLoanGracePeriodMonths, getRepaymentScheduleDueDate } from './repaymentSchedule.js';
import { allocateRepayment, getLoanLiabilityAmount, getLoanPrincipalAmount,
  getRepaymentContractAmount, getSettlementContractAmount } from './repaymentAllocation.js';

const money = value => Math.round((Number(value) || 0) * 100) / 100;
// Use the institution's calendar day, independent of browser/server timezone.
const businessDay = value => {
  const date = new Date(typeof value === 'string' ? value.replace(' ', 'T') : value);
  return Number.isNaN(date.getTime()) ? NaN : Math.floor((date.getTime() + 3 * 3600000) / 86400000);
};

export const getRecoveryAgeDays = (loan, referenceDate = new Date()) => {
  const recoveryStart = getLoanGracePeriodMonths(loan) > 0
    ? getRepaymentScheduleDueDate(loan, 1)
    : (loan?.renewal_date || loan?.disbursement_date);
  return businessDay(referenceDate) - businessDay(recoveryStart);
};

export const isDebtRecoveryLoan = (loan, {
  repayments = [], settlements = [], schedules = [], referenceDate = new Date()
} = {}) => {
  if (!isCollectibleLoanRecord(loan) || getRecoveryAgeDays(loan, referenceDate) < 90) return false;
  if (!Number.isFinite(getRecoveryAgeDays(loan, referenceDate))) return false;
  if (!(Number(loan.total_liability) > 0)) return false;
  if (repayments.some(record => !record.is_reversed && Number(record.amount) > 0)) return false;
  if (settlements.some(record => record.status !== 'reversed' && Number(record.amount) > 0)) return false;
  // Legacy schedules can contain payments that have no matching receipt yet.
  return !schedules.some(record => Number(record.paid) > 0);
};

export const isRecoveredLoan = (loan, {
  repayments = [], settlements = [], schedules = [], penaltyAmount = 500, referenceDate = new Date()
} = {}) => {
  if (!isDisbursedLoanRecord(loan) || loan.written_off_at) return false;
  const liability = getLoanLiabilityAmount(loan);
  if (!(liability > 0) || !Number.isFinite(businessDay(loan.disbursement_date))) return false;
  const payments = repayments.filter(row => !row.is_reversed && Number(row.amount) > 0);
  const balanceOffs = settlements.filter(row => row.status !== 'reversed' && Number(row.amount) > 0);
  const paymentDays = [...payments.map(row => businessDay(row.date || row.created)),
    ...balanceOffs.map(row => businessDay(row.effective_date || row.date || row.created))];
  if (!paymentDays.length || paymentDays.some(day => !Number.isFinite(day) || day > businessDay(referenceDate))) return false;

  const renewedFromRecovery = Boolean(loan.renewal_summary?.renewal_id)
    && Number.isFinite(businessDay(loan.renewal_date));
  const firstPaymentDay = Math.min(...paymentDays);
  const paidDirectlyFromRecovery = firstPaymentDay - businessDay(loan.disbursement_date) >= 90;
  if (!renewedFromRecovery && !paidDirectlyFromRecovery) return false;

  // A completed status or zero cached balance alone is not proof of recovery.
  const contractPaid = payments.reduce((sum, row) => sum + getRepaymentContractAmount(row), 0)
    + balanceOffs.reduce((sum, row) => sum + getSettlementContractAmount(row), 0);
  if (money(contractPaid) < money(liability)) return false;
  const period = Number(loan.period);
  if (!Number.isInteger(period) || period < 1) return false;
  const installmentNumbers = new Set(schedules.map(row => Number(row.installment_no)));
  if (schedules.length !== period || schedules.some(row => !Number.isFinite(businessDay(row.due_date)))
    || !Array.from({ length: period }, (_, index) => index + 1).every(number => installmentNumbers.has(number))) return false;
  return money(calculateLoanOutstandingBalance({ loan, repayments: payments, settlements: balanceOffs,
    schedules, penaltyAmount, referenceDate })) === 0;
};

export const buildDebtRecoveryRenewal = ({ loan, repayments = [], settlements = [], schedules = [],
  penaltyAmount = 500, period, referenceDate = new Date() }) => {
  const outstandingBalance = calculateLoanOutstandingBalance({
    loan, repayments, settlements, schedules, penaltyAmount, referenceDate
  });
  const isDebtRecovery = isDebtRecoveryLoan(loan, { repayments, settlements, schedules, referenceDate });
  const isDistress = isDistressUnitLoan(loan, { outstandingBalance, referenceDate });
  if (!isDebtRecovery && !isDistress) {
    throw new Error('Only D.R.U or D.U loans can be renewed.');
  }
  if (!Number.isInteger(period) || period < 1 || period > 120) {
    throw new Error('Enter a loan period between 1 and 120 whole months.');
  }
  if (!schedules.length || schedules.length !== Number(loan.period)) {
    throw new Error('Repair the existing repayment schedule before renewing this loan.');
  }
  const installmentNumbers = new Set(schedules.map(row => Number(row.installment_no)));
  if (schedules.some(row => !Number.isFinite(businessDay(row.due_date)) || !(Number(row.amount) > 0))
    || !Array.from({ length: schedules.length }, (_, index) => index + 1).every(number => installmentNumbers.has(number))) {
    throw new Error('Repair invalid or duplicate installments before renewing this loan.');
  }
  let priorContractPaid = 0;
  let principalPaid = 0;
  [
    ...repayments.filter(row => !row.is_reversed).map(row => ({
      date: row.date || row.created,
      amount: row.amount,
      fine_amount: row.fine_amount
    })),
    ...settlements.filter(row => row.status !== 'reversed').map(row => ({
      date: row.effective_date || row.date || row.created,
      amount: getSettlementContractAmount(row),
      fine_amount: 0
    }))
  ]
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
    .forEach(row => {
      const allocation = allocateRepayment({
        loan,
        repaymentAmount: row.amount,
        fineAmount: row.fine_amount,
        priorContractPaid
      });
      priorContractPaid += allocation.contractAmount;
      principalPaid += allocation.principalAmount;
    });
  const principal = money(Math.max(0, getLoanPrincipalAmount(loan) - principalPaid));
  if (principal <= 0) throw new Error('This loan has no valid outstanding principal to renew.');
  const configuredRate = Number(loan.interest_rate);
  const interestRate = Number.isFinite(configuredRate) && configuredRate >= 0 ? configuredRate : 20;
  const interest = money(principal * interestRate / 100);
  // Normalize calendar days so a UTC server and a Nairobi browser quote the same fines.
  const calendarDate = value => new Date(businessDay(value) * 86400000 + 12 * 3600000).toISOString();
  const fines = money(calculateLoanPenaltyState({
    schedules: schedules.map(row => ({ ...row, due_date: calendarDate(row.due_date) })),
    repayments, settlements, penaltyAmount, referenceDate: calendarDate(referenceDate)
  }).outstandingFine);
  const renewedLiability = money(principal + interest);
  const renewalDate = new Date((businessDay(referenceDate) * 86400000) - 3 * 3600000).toISOString();
  const renewalDay = new Date(businessDay(referenceDate) * 86400000).toISOString().slice(0, 10);
  const monthlyCents = Math.floor(Math.round(renewedLiability * 100) / period);
  const installments = Array.from({ length: period }, (_, index) => ({
    loan: loan.id,
    installment_no: index + 1,
    due_date: addMonthsPreservingDay(`${renewalDay}T12:00:00Z`, index + 1).toISOString(),
    amount: (index === period - 1 ? Math.round(renewedLiability * 100) - monthlyCents * (period - 1) : monthlyCents) / 100,
    paid: 0,
    status: 'pending',
    penalty_waived: false,
    carried_fine: index === 0 ? fines : 0
  }));
  // Bind confirmation to the exact terms and balances the approver reviewed.
  const fingerprint = JSON.stringify({ updated: loan.updated, renewalDate, period, principal, interest, fines,
    schedules: schedules.map(s => [s.id, s.updated, s.amount, s.paid, s.due_date, s.penalty_waived, s.carried_fine]) });
  return { principal, interestRate, interest, fines, liability: renewedLiability,
    totalPayable: money(renewedLiability + fines), sourceUnit: isDebtRecovery ? 'dru' : 'du',
    period, renewalDate, installments, fingerprint };
};
