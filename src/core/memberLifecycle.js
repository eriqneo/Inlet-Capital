const getRelationId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.id || '';
};

export const isPortfolioMember = (member) => {
  const status = String(member?.status || 'active').toLowerCase();
  return !['suspended', 'closed', 'exited'].includes(status);
};

export const getPortfolioMemberIds = (members = []) => new Set(
  members.filter(isPortfolioMember).map(member => member.id).filter(Boolean)
);

export const isPortfolioFinancialRecord = (record, portfolioMemberIds) => {
  const memberId = getRelationId(record?.member) || record?.expand?.member?.id || '';
  return !memberId || portfolioMemberIds.has(memberId);
};

export const filterPortfolioFinancialRecords = (records = [], portfolioMemberIds) => (
  records.filter(record => isPortfolioFinancialRecord(record, portfolioMemberIds))
);
