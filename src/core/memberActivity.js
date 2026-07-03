const INACTIVE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export const getValidActivityDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getLatestSavingsDate = (savings = []) => savings
  .map(saving => getValidActivityDate(saving.date || saving.created))
  .filter(Boolean)
  .sort((a, b) => b - a)[0] || null;

export const isGroupedMemberActive = (lastSavingsDate, referenceDate = new Date()) => (
  Boolean(lastSavingsDate)
  && referenceDate.getTime() - lastSavingsDate.getTime() <= INACTIVE_AFTER_MS
);

export const getMemberActivityStatus = (member, lastSavingsDate, referenceDate = new Date()) => {
  const dbStatus = String(member?.status || 'active').toLowerCase();
  if (['suspended', 'closed', 'exited'].includes(dbStatus)) {
    return { label: dbStatus.toUpperCase(), className: 'badge-danger', isActive: false };
  }

  if (!member?.group) {
    return { label: 'ACTIVE', className: 'badge-success', isActive: true };
  }

  const isActive = isGroupedMemberActive(lastSavingsDate, referenceDate);
  return {
    label: isActive ? 'ACTIVE' : 'INACTIVE',
    className: isActive ? 'badge-success' : 'badge-danger',
    isActive
  };
};
