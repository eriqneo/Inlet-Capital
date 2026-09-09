const DAY_MS = 24 * 60 * 60 * 1000;

const MEETING_DAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

const toDate = (value) => {
  if (!value) return null;
  const normalized = typeof value === 'string' ? value.replace(' ', 'T') : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const laterDate = (...values) => values
  .map(toDate)
  .filter(Boolean)
  .sort((a, b) => b - a)[0] || null;

const firstMeetingOnOrAfter = (date, meetingDayIndex) => {
  const firstMeeting = new Date(date);
  const daysUntilMeeting = (meetingDayIndex - firstMeeting.getDay() + 7) % 7;
  firstMeeting.setDate(firstMeeting.getDate() + daysUntilMeeting);
  return firstMeeting;
};

const meetingOnOrBefore = (date, meetingDayIndex) => {
  const meeting = new Date(date);
  const daysSinceMeeting = (meeting.getDay() - meetingDayIndex + 7) % 7;
  meeting.setDate(meeting.getDate() - daysSinceMeeting);
  return meeting;
};

const WEEKLY_SAVINGS_AMOUNT = 200;

const getRating = (coverageRate, expectedAmount) => {
  if (expectedAmount === 0) return 0;
  if (coverageRate >= 100) return 5;
  if (coverageRate >= 80) return 4;
  if (coverageRate >= 60) return 3;
  if (coverageRate >= 40) return 2;
  return 1;
};

export const calculateGroupSavingsPerformance = ({
  group,
  members = [],
  savings = [],
  referenceDate = new Date(),
  periodStartDate = null,
  weeklyAmount = WEEKLY_SAVINGS_AMOUNT
} = {}) => {
  const meetingDayIndex = MEETING_DAY_INDEX[group?.meeting_day];
  const periodEnd = toDate(referenceDate);
  const groupStart = toDate(group?.registration_date || group?.created);
  const requestedPeriodStart = toDate(periodStartDate);
  const effectivePeriodStart = laterDate(groupStart, requestedPeriodStart) || groupStart;

  if (meetingDayIndex === undefined || !periodEnd || !groupStart || !effectivePeriodStart || members.length === 0) {
    return {
      rating: 0,
      participationRate: 0,
      contributionRate: 0,
      expectedParticipations: 0,
      savedParticipations: 0,
      expectedAmount: 0,
      contributedAmount: 0,
      shortfallAmount: 0,
      surplusAmount: 0,
      weeklyAmount,
      meetingCycles: 0,
      periodStart: effectivePeriodStart,
      periodEnd
    };
  }

  const latestMeeting = meetingOnOrBefore(periodEnd, meetingDayIndex);
  const firstGroupMeeting = firstMeetingOnOrAfter(effectivePeriodStart, meetingDayIndex);
  if (firstGroupMeeting > latestMeeting) {
    return {
      rating: 0,
      participationRate: 0,
      contributionRate: 0,
      expectedParticipations: 0,
      savedParticipations: 0,
      expectedAmount: 0,
      contributedAmount: 0,
      shortfallAmount: 0,
      surplusAmount: 0,
      weeklyAmount,
      meetingCycles: 0,
      periodStart: firstGroupMeeting,
      periodEnd: latestMeeting
    };
  }

  let expectedParticipations = 0;
  let earliestEligibleMeeting = null;
  const memberWindows = new Map();

  members.forEach(member => {
    const eligibleFrom = laterDate(
      groupStart,
      requestedPeriodStart,
      member.group_joined_at,
      member.registration_date,
      member.created
    );
    if (!eligibleFrom) return;

    const firstEligibleMeeting = firstMeetingOnOrAfter(eligibleFrom, meetingDayIndex);
    if (firstEligibleMeeting > latestMeeting) return;
    if (!earliestEligibleMeeting || firstEligibleMeeting < earliestEligibleMeeting) earliestEligibleMeeting = firstEligibleMeeting;

    const expectedForMember = Math.floor((latestMeeting - firstEligibleMeeting) / (7 * DAY_MS)) + 1;
    expectedParticipations += expectedForMember;
    memberWindows.set(member.id, {
      start: eligibleFrom,
      end: periodEnd
    });
  });

  const expectedAmount = expectedParticipations * (Number(weeklyAmount) || 0);
  const contributedAmount = savings.reduce((sum, record) => {
    if (!record?.member || record.is_reversed || record.type !== 'deposit') return sum;
    const window = memberWindows.get(record.member);
    if (!window) return sum;
    const amount = Number(record.amount) || 0;
    if (amount <= 0) return sum;
    const savingDate = toDate(record.date || record.created);
    if (!savingDate || savingDate < window.start || savingDate > window.end) return sum;
    return sum + amount;
  }, 0);
  const contributionRate = expectedAmount > 0
    ? Math.min(100, (contributedAmount / expectedAmount) * 100)
    : 0;
  const meetingCycles = Math.floor((latestMeeting - firstGroupMeeting) / (7 * DAY_MS)) + 1;
  const savedParticipations = Math.min(expectedParticipations, Math.floor(contributedAmount / (Number(weeklyAmount) || 1)));

  return {
    rating: getRating(contributionRate, expectedAmount),
    participationRate: contributionRate,
    contributionRate,
    expectedParticipations,
    savedParticipations,
    expectedAmount,
    contributedAmount,
    shortfallAmount: Math.max(0, expectedAmount - contributedAmount),
    surplusAmount: Math.max(0, contributedAmount - expectedAmount),
    weeklyAmount,
    meetingCycles,
    periodStart: earliestEligibleMeeting || firstGroupMeeting,
    periodEnd: latestMeeting
  };
};
