import { financialCents, getFinancialTimestamp, selectFinancialRecords } from './financialRecords.js';
import { normalizeLoanSchedules } from './loanInstallments.js';

const toDate = value => new Date(getFinancialTimestamp(value));

const startOfLocalDay = (date = new Date()) => {
  const value = toDate(date);
  if (Number.isNaN(value.getTime())) return null;
  return new Date(Math.floor((value.getTime() + 10800000) / 86400000) * 86400000 - 10800000);
};

const endOfLocalDay = (date = new Date()) => {
  const value = toDate(date);
  if (Number.isNaN(value.getTime())) return null;
  return new Date(startOfLocalDay(value).getTime() + 86400000 - 1);
};

const sortSchedules = (schedules = []) => schedules.slice().sort((a, b) => {
  const installmentDiff = (Number(a.installment_no) || 0) - (Number(b.installment_no) || 0);
  if (installmentDiff !== 0) return installmentDiff;
  return toDate(a.due_date || 0) - toDate(b.due_date || 0);
});

const sortRepayments = (repayments = []) => repayments.slice().sort((a, b) => (
  toDate(a.date || a.created || 0) - toDate(b.date || b.created || 0)
));

const getContractPaymentDate = (record) => record?.date || record?.effective_date || record?.created || new Date();

export const getRepaymentPrincipalAmount = (repayment) => Math.max(
  0,
  (Number(repayment?.amount) || 0) - (Number(repayment?.fine_amount) || 0)
);

export const getContractSettlementAmount = (record) => {
  if (record?.settlement_kind === 'balance_off') return Math.max(0, Number(record.amount) || 0);
  return getRepaymentPrincipalAmount(record);
};

export const calculateLoanPenaltyState = ({
  schedules = [],
  repayments = [],
  settlements = [],
  penaltyAmount = 0,
  referenceDate = new Date(),
  useRecordedSchedulePaid = true
} = {}) => {
  repayments = selectFinancialRecords(repayments, { cutoff: referenceDate });
  settlements = selectFinancialRecords(settlements, { cutoff: referenceDate, fields: ['effective_date', 'date', 'created'] });
  schedules = normalizeLoanSchedules(schedules);
  const penaltyCents = financialCents(penaltyAmount, 'Penalty');
  schedules.forEach(schedule => {
    if (Number(schedule.amount) > 0 && !Number.isFinite(getFinancialTimestamp(schedule.due_date))) throw new Error(`Installment due date unavailable on ${schedule.id || 'schedule'}`);
  });
  const orderedSchedules = sortSchedules(schedules).map(schedule => ({
    schedule,
    amount: financialCents(schedule.amount, 'Installment'),
    paid: 0,
    completedAt: null
  }));

  sortRepayments([
    ...repayments,
    ...settlements
      .filter(settlement => settlement?.status !== 'reversed')
      .map(settlement => ({
        ...settlement,
        date: settlement.effective_date || settlement.date || settlement.created,
        settlement_kind: 'balance_off'
      }))
  ]).forEach(repayment => {
    let remainingPayment = financialCents(getContractSettlementAmount(repayment), 'Contract receipt');
    const paidAt = toDate(getContractPaymentDate(repayment));

    for (const item of orderedSchedules) {
      if (remainingPayment <= 0) break;
      const openAmount = Math.max(0, item.amount - item.paid);
      if (openAmount <= 0) continue;
      const applied = Math.min(openAmount, remainingPayment);
      item.paid += applied;
      remainingPayment -= applied;
      if (item.paid >= item.amount && !item.completedAt) item.completedAt = paidAt;
    }
  });

  if (useRecordedSchedulePaid) {
    orderedSchedules.forEach(item => {
      const recordedPaid = financialCents(item.schedule.paid, 'Recorded installment payment');
      if (recordedPaid > item.paid) item.paid = Math.min(item.amount, recordedPaid);
    });
  }

  const today = startOfLocalDay(referenceDate);
  const scheduleStates = orderedSchedules.map(item => {
    const dueStart = startOfLocalDay(item.schedule.due_date);
    const dueEnd = endOfLocalDay(item.schedule.due_date);
    const dueDatePassed = Boolean(dueStart && today && dueStart < today);
    const completedLate = Boolean(item.completedAt && dueEnd && item.completedAt > dueEnd);
    const stillUnpaidAfterDue = item.paid < item.amount && dueDatePassed;
    const penaltyGenerated = Boolean(
      !item.schedule.penalty_waived
      && penaltyAmount > 0
      && dueDatePassed
      && (completedLate || stillUnpaidAfterDue)
    );

    return {
      schedule: item.schedule,
      paid: item.paid / 100,
      remainingPrincipal: Math.max(0, item.amount - item.paid) / 100,
      completedAt: item.completedAt,
      penaltyGenerated,
      penaltyAmount: ((penaltyGenerated ? penaltyCents : 0) + financialCents(item.schedule.carried_fine, 'Carried fine')) / 100
    };
  });

  const generatedFineTotal = scheduleStates.reduce((sum, item) => sum + financialCents(item.penaltyAmount), 0) / 100;
  const fineCollected = repayments.reduce((sum, repayment) => sum + financialCents(repayment.fine_amount, 'Collected fine'), 0) / 100;
  const principalPaid = [
    ...repayments,
    ...settlements
      .filter(settlement => settlement?.status !== 'reversed')
      .map(settlement => ({ ...settlement, settlement_kind: 'balance_off' }))
  ].reduce((sum, repayment) => sum + financialCents(getContractSettlementAmount(repayment)), 0) / 100;

  return {
    scheduleStates,
    generatedFineTotal,
    fineCollected,
    outstandingFine: Math.max(0, financialCents(generatedFineTotal) - financialCents(fineCollected)) / 100,
    principalPaid
  };
};
