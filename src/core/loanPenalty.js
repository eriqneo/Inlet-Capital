const startOfLocalDay = (date = new Date()) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  value.setHours(0, 0, 0, 0);
  return value;
};

const endOfLocalDay = (date = new Date()) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  value.setHours(23, 59, 59, 999);
  return value;
};

const sortSchedules = (schedules = []) => schedules.slice().sort((a, b) => {
  const installmentDiff = (Number(a.installment_no) || 0) - (Number(b.installment_no) || 0);
  if (installmentDiff !== 0) return installmentDiff;
  return new Date(a.due_date || 0) - new Date(b.due_date || 0);
});

const sortRepayments = (repayments = []) => repayments.slice().sort((a, b) => (
  new Date(a.date || a.created || 0) - new Date(b.date || b.created || 0)
));

export const getRepaymentPrincipalAmount = (repayment) => Math.max(
  0,
  (Number(repayment?.amount) || 0) - (Number(repayment?.fine_amount) || 0)
);

export const calculateLoanPenaltyState = ({
  schedules = [],
  repayments = [],
  penaltyAmount = 0,
  referenceDate = new Date()
} = {}) => {
  const orderedSchedules = sortSchedules(schedules).map(schedule => ({
    schedule,
    amount: Number(schedule.amount) || 0,
    paid: 0,
    completedAt: null
  }));

  sortRepayments(repayments).forEach(repayment => {
    let remainingPayment = getRepaymentPrincipalAmount(repayment);
    const paidAt = new Date(repayment.date || repayment.created || new Date());

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

  orderedSchedules.forEach(item => {
    const recordedPaid = Number(item.schedule.paid) || 0;
    if (recordedPaid > item.paid) item.paid = Math.min(item.amount, recordedPaid);
  });

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
      penaltyAmount: penaltyGenerated ? penaltyAmount : 0
    };
  });

  const generatedFineTotal = scheduleStates.reduce((sum, item) => sum + item.penaltyAmount, 0);
  const fineCollected = repayments.reduce((sum, repayment) => sum + (Number(repayment.fine_amount) || 0), 0);
  const principalPaid = repayments.reduce((sum, repayment) => sum + getRepaymentPrincipalAmount(repayment), 0);

  return {
    scheduleStates,
    generatedFineTotal,
    fineCollected,
    outstandingFine: Math.max(0, generatedFineTotal - fineCollected),
    principalPaid
  };
};
