const toDate = value => new Date(typeof value === 'string' ? value.replace(' ', 'T') : value);

const startOfLocalDay = (date = new Date()) => {
  const value = toDate(date);
  if (Number.isNaN(value.getTime())) return null;
  value.setHours(0, 0, 0, 0);
  return value;
};

const endOfLocalDay = (date = new Date()) => {
  const value = toDate(date);
  if (Number.isNaN(value.getTime())) return null;
  value.setHours(23, 59, 59, 999);
  return value;
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
  const orderedSchedules = sortSchedules(schedules).map(schedule => ({
    schedule,
    amount: Number(schedule.amount) || 0,
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
    let remainingPayment = getContractSettlementAmount(repayment);
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
      const recordedPaid = Number(item.schedule.paid) || 0;
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
      paid: item.paid,
      remainingPrincipal: Math.max(0, item.amount - item.paid),
      completedAt: item.completedAt,
      penaltyGenerated,
      penaltyAmount: (penaltyGenerated ? penaltyAmount : 0) + Math.max(0, Number(item.schedule.carried_fine) || 0)
    };
  });

  const generatedFineTotal = scheduleStates.reduce((sum, item) => sum + item.penaltyAmount, 0);
  const fineCollected = repayments.reduce((sum, repayment) => sum + (Number(repayment.fine_amount) || 0), 0);
  const principalPaid = [
    ...repayments,
    ...settlements
      .filter(settlement => settlement?.status !== 'reversed')
      .map(settlement => ({ ...settlement, settlement_kind: 'balance_off' }))
  ].reduce((sum, repayment) => sum + getContractSettlementAmount(repayment), 0);

  return {
    scheduleStates,
    generatedFineTotal,
    fineCollected,
    outstandingFine: Math.max(0, generatedFineTotal - fineCollected),
    principalPaid
  };
};
