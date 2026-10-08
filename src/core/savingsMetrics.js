import { isPortfolioMember } from './memberLifecycle.js';

export const getSavingsTransactionType = (record = {}) => {
  const type = String(record.type || '').trim().toLowerCase();
  return type || 'deposit';
};

export const isActiveSavingsTransaction = (record = {}) => !record.is_reversed;
export const getSavingsTransactionDate = (record = {}) => record.date || record.created;
const relationId = value => typeof value === 'string' ? value : (value?.id || '');
const memberId = record => relationId(record.member) || record.expand?.member?.id || '';
const groupId = record => relationId(record.group) || record.expand?.group?.id || '';

const invalidRecord = (record, field) => new Error(
  `Savings total unavailable: ${field} needs review${record.id ? ` on transaction ${record.id}` : ''}.`
);

const amountInCents = record => {
  const amount = Number(record.amount);
  const cents = Math.round(amount * 100);
  if (!['number', 'string'].includes(typeof record.amount) || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(cents)
    || Math.abs(amount * 100 - cents) > 0.000001) throw invalidRecord(record, 'amount');
  return cents;
};

export const getSavingsRecords = (records = []) => {
  const byId = new Map();
  const withoutId = [];
  for (const record of records) {
    if (!record.id) withoutId.push(record);
    else {
      const previous = byId.get(record.id);
      if (previous && String(record.updated || '') === String(previous.updated || '')
        && ['amount', 'type', 'member', 'group', 'date', 'is_reversed'].some(field => {
          if (field === 'type') return getSavingsTransactionType(record) !== getSavingsTransactionType(previous);
          if (field === 'amount') return Number(record.amount) !== Number(previous.amount);
          if (field === 'member' || field === 'group') return relationId(record[field]) !== relationId(previous[field]);
          return String(record[field] || '') !== String(previous[field] || '');
        })) throw invalidRecord(record, 'conflicting revisions');
      // Overlapping query results can contain the same transaction revision.
      if (!previous || String(record.updated || '') > String(previous.updated || '')) byId.set(record.id, record);
    }
  }
  return [...byId.values(), ...withoutId].filter(isActiveSavingsTransaction);
};

const dayStart = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid savings calendar date.');
  const utc = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new Error('Invalid savings calendar date.');
  return utc.getTime() - 3 * 60 * 60 * 1000;
};

export const getSavingsDateBounds = ({ from = '', to = '' } = {}) => {
  const start = from ? dayStart(from) : null;
  const end = to ? dayStart(to) + 86400000 : null;
  if (start !== null && end !== null && start >= end) throw new Error('Savings From date must not be after To date.');
  return { start, end };
};

export const getSavingsTimestamp = record => {
  const value = getSavingsTransactionDate(record);
  if (!value) throw invalidRecord(record, 'transaction date');
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw invalidRecord(record, 'transaction date');
    return value.getTime();
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return dayStart(text);
  // PocketBase timestamps are UTC, including legacy timestamps without a suffix.
  const normalized = text.replace(' ', 'T');
  try { dayStart(normalized.slice(0, 10)); } catch { throw invalidRecord(record, 'transaction date'); }
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
  if (!Number.isFinite(timestamp)) throw invalidRecord(record, 'transaction date');
  return timestamp;
};

export const isSavingsInDateRange = (record, range = {}) => {
  const { start, end } = getSavingsDateBounds(range);
  if (start === null && end === null) return true;
  const timestamp = getSavingsTimestamp(record);
  return (start === null || timestamp >= start) && (end === null || timestamp < end);
};

// Context is supplied by authorized services; this selector never grants access.
// Group lifecycle cascade and future-date policies are deliberately unchanged.
export const selectSavingsRecords = (records = [], {
  members, groups, member: selectedMember = '', group: selectedGroup = '',
  account = 'all', officer = 'all', lifecycle = 'operational', from = '', to = ''
} = {}) => {
  getSavingsDateBounds({ from, to });
  const membersById = members && new Map(members.map(member => [member.id, member]));
  const groupsById = groups && new Map(groups.map(group => [group.id, group]));
  return getSavingsRecords(records).filter(record => {
    const mid = memberId(record);
    const gid = groupId(record);
    const member = membersById?.get(mid) || record.expand?.member;
    const group = groupsById?.get(gid) || record.expand?.group;
    if (selectedMember && mid !== selectedMember) return false;
    if (mid) {
      if (membersById && !member) throw invalidRecord(record, 'member ownership');
      if (lifecycle === 'operational' && member && !isPortfolioMember(member)) return false;
      if (account === 'groups') return false;
      const currentGroup = member ? groupId(member) : gid;
      if (selectedGroup && currentGroup !== selectedGroup) return false;
      if (account === 'individual' && currentGroup) return false;
      if (account === 'group_members' && !currentGroup) return false;
      if (officer !== 'all' && (relationId(member?.assigned_officer) || relationId(member?.registered_by)) !== officer) return false;
    } else {
      if (!gid || (groupsById && !group)) throw invalidRecord(record, 'group ownership');
      if (account !== 'all' && account !== 'groups') return false;
      if (selectedGroup && gid !== selectedGroup) return false;
      if (officer !== 'all' && (relationId(group?.assigned_officer) || relationId(group?.created_by)) !== officer) return false;
    }
    return isSavingsInDateRange(record, { from, to });
  });
};

export const getSavingsSignedAmount = (record = {}) => {
  if (!isActiveSavingsTransaction(record)) return 0;
  const type = getSavingsTransactionType(record);
  if (!['deposit', 'withdrawal'].includes(type)) throw invalidRecord(record, 'transaction type');
  const amount = amountInCents(record) / 100;
  return type === 'withdrawal' ? -amount : amount;
};

export const calculateSavingsSummary = (records = []) => {
  let deposits = 0, withdrawals = 0, count = 0;
  for (const record of getSavingsRecords(records)) {
    const signed = Math.round(getSavingsSignedAmount(record) * 100);
    if (signed < 0) withdrawals -= signed;
    else deposits += signed;
    count += 1;
    if (!Number.isSafeInteger(deposits) || !Number.isSafeInteger(withdrawals)) throw invalidRecord(record, 'total exceeds supported precision');
  }
  return { deposits: deposits / 100, withdrawals: withdrawals / 100, net: (deposits - withdrawals) / 100, count };
};

export const calculateSavingsPeriod = (records = [], range = {}) => {
  const { start, end } = getSavingsDateBounds(range);
  const active = getSavingsRecords(records);
  const opening = start === null ? [] : active.filter(record => getSavingsTimestamp(record) < start);
  const closing = end === null ? active : active.filter(record => getSavingsTimestamp(record) < end);
  return {
    ...calculateSavingsSummary(active.filter(record => isSavingsInDateRange(record, range))),
    opening: calculateSavingsSummary(opening).net,
    closing: calculateSavingsSummary(closing).net
  };
};

export const getInternalSavingsTransactionIds = (settlements = []) => new Set(settlements
  .filter(settlement => settlement.status !== 'reversed')
  .map(settlement => relationId(settlement.savings_transaction)).filter(Boolean));
