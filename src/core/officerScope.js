import { pb } from '../services/api.js';
import { dataCache } from '../services/dataCache.js';
import { authService } from '../services/authService.js';

const OFFICER_ROLES = ['loan_officer', 'group_officer', 'manager', 'admin', 'super_admin'];

export const canSeeAllOfficerData = () => authService.hasRole('super_admin', 'admin');
export const shouldScopeToCurrentOfficer = () => Boolean(authService.getUser()?.id) && !canSeeAllOfficerData();
export const getCurrentOfficerId = () => authService.getUser()?.id || '';
export const getOfficerScopeCacheKey = () => canSeeAllOfficerData() ? 'all' : `officer:${getCurrentOfficerId() || 'none'}`;

export const canUseOfficerFilter = () => canSeeAllOfficerData();

export const getRelationId = (value) => typeof value === 'string' ? value : (value?.id || '');
export const getMemberOfficerId = (member) => getRelationId(member?.assigned_officer) || getRelationId(member?.registered_by);
export const getGroupOfficerId = (group) => getRelationId(group?.assigned_officer) || getRelationId(group?.created_by);
export const getMemberOfficerScopeFilter = (officerId = getCurrentOfficerId()) => officerId
  ? `(assigned_officer="${officerId}" || registered_by="${officerId}")`
  : '';
export const getGroupOfficerScopeFilter = (officerId = getCurrentOfficerId()) => officerId
  ? `(assigned_officer="${officerId}" || created_by="${officerId}")`
  : '';

export const paginateScopedItems = (items, { page = 1, perPage = 50 } = {}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safePerPage = Math.max(1, Number(perPage) || 50);
  const start = (safePage - 1) * safePerPage;
  const totalItems = items.length;
  return {
    page: safePage,
    perPage: safePerPage,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / safePerPage)),
    items: items.slice(start, start + safePerPage)
  };
};

export const createOfficerScope = ({ members = [], groups = [] } = {}) => {
  const membersById = new Map(members.map(member => [member.id, member]));
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const getLoanOfficerId = (loan) => {
    const memberId = getRelationId(loan?.member) || loan?.expand?.member?.id || '';
    const groupId = getRelationId(loan?.group) || loan?.expand?.group?.id || '';
    if (memberId) return getMemberOfficerId(membersById.get(memberId) || loan?.expand?.member) || getRelationId(loan?.processed_by);
    if (groupId) return getGroupOfficerId(groupsById.get(groupId) || loan?.expand?.group) || getRelationId(loan?.processed_by);
    return getRelationId(loan?.processed_by);
  };
  const getSavingOfficerId = (saving) => {
    const memberId = getRelationId(saving?.member) || saving?.expand?.member?.id || '';
    const groupId = getRelationId(saving?.group) || saving?.expand?.group?.id || '';
    if (memberId) return getMemberOfficerId(membersById.get(memberId) || saving?.expand?.member);
    if (groupId) return getGroupOfficerId(groupsById.get(groupId) || saving?.expand?.group);
    return '';
  };
  return { membersById, groupsById, getLoanOfficerId, getSavingOfficerId };
};

export const matchesOfficer = (officerId, selectedOfficerId) => (
  selectedOfficerId === 'all' || officerId === selectedOfficerId
);

export const filterMembersForCurrentOfficer = (members = []) => {
  if (!shouldScopeToCurrentOfficer()) return members;
  const officerId = getCurrentOfficerId();
  return members.filter(member => getMemberOfficerId(member) === officerId);
};

export const filterGroupsForCurrentOfficer = (groups = []) => {
  if (!shouldScopeToCurrentOfficer()) return groups;
  const officerId = getCurrentOfficerId();
  return groups.filter(group => getGroupOfficerId(group) === officerId);
};

export const filterLoansForCurrentOfficer = (loans = [], { members = [], groups = [] } = {}) => {
  if (!shouldScopeToCurrentOfficer()) return loans;
  const officerId = getCurrentOfficerId();
  const scope = createOfficerScope({ members, groups });
  return loans.filter(loan => scope.getLoanOfficerId(loan) === officerId);
};

export const filterSavingsForCurrentOfficer = (savings = [], { members = [], groups = [] } = {}) => {
  if (!shouldScopeToCurrentOfficer()) return savings;
  const officerId = getCurrentOfficerId();
  const scope = createOfficerScope({ members, groups });
  return savings.filter(saving => scope.getSavingOfficerId(saving) === officerId);
};

export const loadOfficerOptions = async ({ members = [], groups = [], loans = [] } = {}) => {
  const users = await dataCache.get('users:officer-filter:v1', () => pb.collection('users').getFullList({
    filter: OFFICER_ROLES.map(role => `role="${role}"`).join(' || '),
    sort: 'name,email'
  })).catch(err => {
    console.warn('[OfficerFilter] User list unavailable; using assigned record IDs:', err.message);
    return [];
  });
  const labels = new Map(users.map(user => [
    user.id,
    user.name || user.email || user.username || 'Loan Officer'
  ]));
  const addFallback = (id) => {
    if (id && !labels.has(id)) labels.set(id, `Officer ${String(id).slice(0, 6)}`);
  };
  members.forEach(member => addFallback(getMemberOfficerId(member)));
  groups.forEach(group => addFallback(getGroupOfficerId(group)));
  loans.forEach(loan => addFallback(getRelationId(loan.processed_by)));
  return [...labels.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
};

export const populateOfficerSelect = (select, options, selected = 'all') => {
  if (!select) return;
  select.innerHTML = '<option value="all">All Loan Officers</option>' + options.map(option => {
    const safeId = String(option.id).replace(/"/g, '&quot;');
    const safeName = String(option.name).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
    return `<option value="${safeId}">${safeName}</option>`;
  }).join('');
  select.value = options.some(option => option.id === selected) ? selected : 'all';
};
