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
