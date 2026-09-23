export const getValidActivityDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isValidSavingsDeposit = (saving) => saving?.type === 'deposit'
  && saving?.is_reversed !== true
  && String(saving?.is_reversed || '').toLowerCase() !== 'true';

export const getLatestSavingsDate = (savings = []) => savings
  .filter(isValidSavingsDeposit)
  .map(saving => getValidActivityDate(saving.date || saving.created))
  .filter(Boolean)
  .sort((a, b) => b - a)[0] || null;

export const getMemberGroupStartDate = (member) => getValidActivityDate(
  member?.group_joined_at || member?.registration_date || member?.created
);

export const isGroupedMemberActive = (lastSavingsDate, referenceDate = new Date()) => {
  const lastDeposit = getValidActivityDate(lastSavingsDate);
  const reference = getValidActivityDate(referenceDate);
  if (!lastDeposit || !reference) return false;

  const cutoff = new Date(reference);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - 3);
  lastDeposit.setHours(0, 0, 0, 0);
  return lastDeposit >= cutoff;
};

export const getMemberActivityStatus = (member, lastSavingsDate, referenceDate = new Date()) => {
  const dbStatus = String(member?.status || 'active').toLowerCase();
  if (['suspended', 'closed', 'exited'].includes(dbStatus)) {
    return { label: dbStatus.toUpperCase(), className: 'badge-danger', isActive: false };
  }

  if (!member?.group) {
    return { label: 'ACTIVE', className: 'badge-success', isActive: true };
  }

  const lastDeposit = getValidActivityDate(lastSavingsDate);
  const groupStart = getMemberGroupStartDate(member);
  const activityDate = [lastDeposit, groupStart]
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;
  const isActive = isGroupedMemberActive(activityDate, referenceDate);
  return {
    label: isActive ? 'ACTIVE' : 'INACTIVE',
    className: isActive ? 'badge-success' : 'badge-danger',
    isActive,
    isOnboardingGrace: isActive && !lastDeposit
  };
};
