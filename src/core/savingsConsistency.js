const DAY_MS = 86400000;
const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NAIROBI_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit'
});
export const WEEKLY_SAVINGS_AMOUNT = 200;

// Use Nairobi calendar days, independent of the officer's browser timezone.
export const savingsDay = (value) => {
  if (!value) return null;
  let text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? date.getTime() / DAY_MS : null;
  }
  if (typeof value === 'string') {
    text = text.replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += 'Z';
  }
  const date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const parts = NAIROBI_DATE_FORMAT.formatToParts(date);
  const part = type => parts.find(item => item.type === type).value;
  return Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day'))) / DAY_MS;
};

const dayKey = day => new Date(day * DAY_MS).toISOString().slice(0, 10);
const cents = amount => Math.round(Number(amount) * 100);

export const calculateSavingsConsistency = ({ member, group, savings = [], referenceDate = new Date() } = {}) => {
  if (!member?.group) return { applicable: false, status: 'exempt', weeks: [] };
  const asOf = savingsDay(referenceDate);
  const memberStart = savingsDay(member.group_joined_at || member.registration_date || member.created);
  const groupStart = savingsDay(group?.registration_date || group?.created);
  const meetingDay = WEEK_DAYS.indexOf(group?.meeting_day);
  if (asOf === null || memberStart === null || meetingDay < 0) {
    return { applicable: true, status: 'unavailable', weeks: [] };
  }
  const start = Math.max(memberStart, groupStart ?? memberStart);
  const weekday = new Date(start * DAY_MS).getUTCDay();
  const firstDue = start + (meetingDay - weekday + 7) % 7;
  const weeklyCents = cents(WEEKLY_SAVINGS_AMOUNT);
  const weeks = [];
  // Today's meeting is not overdue: the member still has the whole day to save.
  for (let due = firstDue; due < asOf; due += 7) {
    weeks.push({ dueDate: dayKey(due), due, paidCents: 0, coveredDate: null });
  }
  const deposits = savings.filter(record => record.member === member.id && record.type === 'deposit' && !record.is_reversed)
    .map(record => ({ day: savingsDay(record.date || record.created), amount: cents(record.amount) }))
    .filter(record => record.day !== null && record.day >= start && record.day <= asOf && Number.isFinite(record.amount) && record.amount > 0)
    .sort((a, b) => a.day - b.day);
  let position = 0;
  let totalCents = 0;
  // Oldest obligations receive contributions first; surplus covers future weeks.
  for (const deposit of deposits) {
    totalCents += deposit.amount;
    let remaining = deposit.amount;
    while (remaining > 0 && position < weeks.length) {
      const week = weeks[position];
      const allocated = Math.min(remaining, weeklyCents - week.paidCents);
      week.paidCents += allocated;
      remaining -= allocated;
      if (week.paidCents === weeklyCents) {
        week.coveredDate = dayKey(deposit.day);
        week.status = deposit.day <= week.due ? 'on_time' : 'late';
        position += 1;
      }
    }
  }
  for (const week of weeks) {
    week.status ||= week.paidCents > 0 ? 'partial' : 'missed';
    week.paid = week.paidCents / 100;
    week.shortfall = (weeklyCents - week.paidCents) / 100;
    delete week.paidCents;
    delete week.due;
  }
  const onTimeWeeks = weeks.filter(week => week.status === 'on_time').length;
  const lateWeeks = weeks.filter(week => week.status === 'late').length;
  const expectedCents = weeks.length * weeklyCents;
  const shortfall = Math.max(0, expectedCents - totalCents) / 100;
  return {
    applicable: true,
    status: !weeks.length ? 'not_due' : shortfall > 0 ? 'behind' : lateWeeks > 0 ? 'caught_up' : 'consistent',
    weeklyAmount: WEEKLY_SAVINGS_AMOUNT,
    periodStart: dayKey(start), asOf: dayKey(asOf), meetingDay: group.meeting_day,
    expected: expectedCents / 100, deposited: totalCents / 100, shortfall,
    advance: Math.max(0, totalCents - expectedCents) / 100,
    expectedWeeks: weeks.length, coveredWeeks: onTimeWeeks + lateWeeks, onTimeWeeks, lateWeeks,
    outstandingWeeks: weeks.length - onTimeWeeks - lateWeeks,
    onTimeRate: weeks.length ? onTimeWeeks / weeks.length * 100 : null,
    coverageRate: weeks.length ? Math.min(100, totalCents / expectedCents * 100) : null,
    requiresReview: shortfall > 0 || lateWeeks > 0,
    weeks
  };
};
