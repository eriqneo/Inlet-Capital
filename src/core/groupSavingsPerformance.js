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

const getCycleKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRating = (participationRate, expectedParticipations) => {
  if (expectedParticipations === 0) return 0;
  if (participationRate >= 100) return 5;
  if (participationRate >= 80) return 4;
  if (participationRate >= 60) return 3;
  if (participationRate >= 40) return 2;
  return 1;
};

export const calculateGroupSavingsPerformance = ({
  group,
  members = [],
  savings = [],
  referenceDate = new Date()
} = {}) => {
  const meetingDayIndex = MEETING_DAY_INDEX[group?.meeting_day];
  const periodEnd = toDate(referenceDate);
  const groupStart = toDate(group?.registration_date || group?.created);

  if (meetingDayIndex === undefined || !periodEnd || !groupStart || members.length === 0) {
    return {
      rating: 0,
      participationRate: 0,
      expectedParticipations: 0,
      savedParticipations: 0,
      meetingCycles: 0,
      periodStart: groupStart,
      periodEnd
    };
  }

  const latestMeeting = meetingOnOrBefore(periodEnd, meetingDayIndex);
  const firstGroupMeeting = firstMeetingOnOrAfter(groupStart, meetingDayIndex);
  if (firstGroupMeeting > latestMeeting) {
    return {
      rating: 0,
      participationRate: 0,
      expectedParticipations: 0,
      savedParticipations: 0,
      meetingCycles: 0,
      periodStart: firstGroupMeeting,
      periodEnd: latestMeeting
    };
  }

  const depositsByMember = new Map();
  savings.forEach(record => {
    if (!record?.member || record.is_reversed || record.type !== 'deposit' || (Number(record.amount) || 0) <= 0) return;
    const savingDate = toDate(record.date || record.created);
    if (!savingDate || savingDate > periodEnd) return;
    if (!depositsByMember.has(record.member)) depositsByMember.set(record.member, []);
    depositsByMember.get(record.member).push(savingDate);
  });

  let expectedParticipations = 0;
  let savedParticipations = 0;
  let earliestEligibleMeeting = null;

  members.forEach(member => {
    const eligibleFrom = laterDate(
      groupStart,
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

    const completedCycles = new Set();
    (depositsByMember.get(member.id) || []).forEach(depositDate => {
      const cycleMeeting = meetingOnOrBefore(depositDate, meetingDayIndex);
      if (cycleMeeting < firstEligibleMeeting || cycleMeeting > latestMeeting) return;
      completedCycles.add(getCycleKey(cycleMeeting));
    });
    savedParticipations += Math.min(expectedForMember, completedCycles.size);
  });

  const participationRate = expectedParticipations > 0
    ? (savedParticipations / expectedParticipations) * 100
    : 0;
  const meetingCycles = Math.floor((latestMeeting - firstGroupMeeting) / (7 * DAY_MS)) + 1;

  return {
    rating: getRating(participationRate, expectedParticipations),
    participationRate,
    expectedParticipations,
    savedParticipations,
    meetingCycles,
    periodStart: earliestEligibleMeeting || firstGroupMeeting,
    periodEnd: latestMeeting
  };
};
