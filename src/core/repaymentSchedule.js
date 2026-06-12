const toValidDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getRepaymentScheduleAnchorDate = (loan) => (
  toValidDate(loan?.application_date)
  || toValidDate(loan?.disbursement_date)
  || toValidDate(loan?.created)
  || new Date()
);

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
