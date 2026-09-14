const toValidDate = (value) => {
  if (!value) return null;
  const date = new Date(typeof value === 'string' ? value.replace(' ', 'T') : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getRepaymentScheduleAnchorDate = (loan) => (
  toValidDate(loan?.renewal_date)
  || toValidDate(loan?.disbursement_date)
  || toValidDate(loan?.application_date)
  || toValidDate(loan?.created)
  || new Date()
);

export const getLoanGracePeriodMonths = (loan) => {
  if (loan?.type !== 'farming') return 0;
  const gracePeriod = Number.parseInt(loan?.grace_period_months, 10);
  return Number.isInteger(gracePeriod) && gracePeriod > 0 ? gracePeriod : 0;
};

export const addMonthsPreservingDay = (dateInput, monthsToAdd) => {
  const source = toValidDate(dateInput) || new Date();
  const targetDay = source.getDate();
  const dueDate = new Date(source);

  dueDate.setDate(1);
  dueDate.setMonth(dueDate.getMonth() + monthsToAdd);

  const lastDayOfTargetMonth = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth() + 1,
    0
  ).getDate();

  dueDate.setDate(Math.min(targetDay, lastDayOfTargetMonth));
  return dueDate;
};

export const getRepaymentScheduleDueDate = (loan, installmentNo) => {
  const installment = Number.parseInt(installmentNo, 10);
  if (!Number.isInteger(installment) || installment < 1) return null;

  const gracePeriod = getLoanGracePeriodMonths(loan);
  const firstDueMonth = gracePeriod || 1;
  return addMonthsPreservingDay(
    getRepaymentScheduleAnchorDate(loan),
    firstDueMonth + installment - 1
  );
};

export const getLoanFinalDueDate = (loan) => {
  const period = Number.parseInt(loan?.period, 10);
  return Number.isInteger(period) && period > 0
    ? getRepaymentScheduleDueDate(loan, period)
    : null;
};
