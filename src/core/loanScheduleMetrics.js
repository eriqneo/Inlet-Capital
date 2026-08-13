import { getRepaymentContractAmount, getSettlementContractAmount } from './repaymentAllocation.js';

const startOfLocalDay = (date = new Date()) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  value.setHours(0, 0, 0, 0);
  return value;
};

export const getScheduleRemaining = (schedule) => Math.max(
  0,
  (Number(schedule?.amount) || 0) - (Number(schedule?.paid) || 0)
);

export const isSchedulePaid = (schedule) => (
  schedule?.status === 'paid' || getScheduleRemaining(schedule) <= 0
);

export const isScheduleInArrears = (schedule, referenceDate = new Date()) => {
  if (!schedule?.due_date || isSchedulePaid(schedule)) return false;
  const dueDate = startOfLocalDay(schedule.due_date);
  const today = startOfLocalDay(referenceDate);
  if (!dueDate || !today) return false;
  return dueDate < today;
};

export const getScheduleArrearsAmount = (schedule, referenceDate = new Date()) => (
  isScheduleInArrears(schedule, referenceDate) ? getScheduleRemaining(schedule) : 0
);

export const getDaysInArrears = (schedule, referenceDate = new Date()) => {
  if (!isScheduleInArrears(schedule, referenceDate)) return 0;
  const dueDate = startOfLocalDay(schedule.due_date);
  const today = startOfLocalDay(referenceDate);
  return Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));
};

export const getArrearsTotal = (schedules, referenceDate = new Date()) => (
  schedules.reduce((sum, schedule) => sum + getScheduleArrearsAmount(schedule, referenceDate), 0)
);

const getRelationId = (value) => typeof value === 'string' ? value : (value?.id || '');

export const buildEffectiveSchedulePaidMap = ({
  schedules = [],
  repayments = [],
  settlements = [],
  useRecordedPaid = false
} = {}) => {
  const schedulesByLoan = new Map();
  schedules.forEach(schedule => {
    const loanId = getRelationId(schedule?.loan);
    if (!loanId) return;
    if (!schedulesByLoan.has(loanId)) schedulesByLoan.set(loanId, []);
    schedulesByLoan.get(loanId).push(schedule);
  });
  schedulesByLoan.forEach(loanSchedules => {
    loanSchedules.sort((a, b) => {
      const installmentDiff = (Number(a.installment_no) || 0) - (Number(b.installment_no) || 0);
      if (installmentDiff !== 0) return installmentDiff;
      return new Date(a.due_date || 0) - new Date(b.due_date || 0);
    });
  });

  const contractEventsByLoan = new Map();
  const addContractEvent = (record, amount, dateValue) => {
    const loanId = getRelationId(record?.loan);
    if (!loanId || amount <= 0) return;
    if (!contractEventsByLoan.has(loanId)) contractEventsByLoan.set(loanId, []);
    contractEventsByLoan.get(loanId).push({ amount, date: new Date(dateValue || 0) });
  };

  repayments.forEach(repayment => {
    addContractEvent(
      repayment,
      getRepaymentContractAmount(repayment),
      repayment?.date || repayment?.created
    );
  });
  settlements.forEach(settlement => {
    addContractEvent(
      settlement,
      getSettlementContractAmount(settlement),
      settlement?.effective_date || settlement?.created
    );
  });
  contractEventsByLoan.forEach(events => events.sort((a, b) => a.date - b.date));

  const paidMap = new Map();
  schedulesByLoan.forEach((loanSchedules, loanId) => {
    let contractPaid = (contractEventsByLoan.get(loanId) || [])
      .reduce((sum, event) => sum + event.amount, 0);

    loanSchedules.forEach(schedule => {
      const scheduleAmount = Math.max(0, Number(schedule.amount) || 0);
      const allocatedPaid = Math.min(scheduleAmount, Math.max(0, contractPaid));
      contractPaid -= allocatedPaid;
      const recordedPaid = useRecordedPaid
        ? Math.min(scheduleAmount, Math.max(0, Number(schedule.paid) || 0))
        : 0;
      paidMap.set(schedule.id, Math.max(recordedPaid, allocatedPaid));
    });
  });

  return paidMap;
};

export const applyEffectiveSchedulePayments = (schedules = [], paidMap = new Map()) => (
  schedules.map(schedule => {
    const amount = Math.max(0, Number(schedule?.amount) || 0);
    const paid = Math.min(amount, Math.max(0, paidMap.get(schedule?.id) || 0));
    return {
      ...schedule,
      paid,
      status: amount > 0 && paid >= amount ? 'paid' : (paid > 0 ? 'partial' : 'pending')
    };
  })
);
