import { pb } from '../services/api.js';
import { dataCache } from '../services/dataCache.js';
import { authService } from '../services/authService.js';

const OFFICER_ROLES = ['loan_officer', 'group_officer', 'manager', 'admin', 'super_admin'];
const GLOBAL_OFFICER_FILTER_KEY = 'inlet_global_officer_filter';

export const canSeeAllOfficerData = () => authService.hasRole('super_admin', 'admin');
export const shouldScopeToCurrentOfficer = () => Boolean(authService.getUser()?.id) && !canSeeAllOfficerData();
export const getCurrentOfficerId = () => authService.getUser()?.id || '';
export const getGlobalOfficerFilter = () => {
  if (!canSeeAllOfficerData()) return 'all';
  return sessionStorage.getItem(GLOBAL_OFFICER_FILTER_KEY) || 'all';
};
export const setGlobalOfficerFilter = (officerId = 'all') => {
  if (!canSeeAllOfficerData()) return 'all';
  const nextValue = officerId && officerId !== 'all' ? String(officerId) : 'all';
  if (nextValue === 'all') sessionStorage.removeItem(GLOBAL_OFFICER_FILTER_KEY);
  else sessionStorage.setItem(GLOBAL_OFFICER_FILTER_KEY, nextValue);
  return nextValue;
};
export const clearGlobalOfficerFilter = () => sessionStorage.removeItem(GLOBAL_OFFICER_FILTER_KEY);
export const getOfficerDataScopeId = () => shouldScopeToCurrentOfficer()
  ? getCurrentOfficerId()
  : (getGlobalOfficerFilter() === 'all' ? '' : getGlobalOfficerFilter());
export const shouldScopeOfficerData = () => Boolean(getOfficerDataScopeId());
export const getOfficerScopeCacheKey = () => shouldScopeOfficerData() ? `officer:${getOfficerDataScopeId()}` : 'all';

// Officer selection is centralized in the application header.
export const canUseOfficerFilter = () => false;

export const getRelationId = (value) => typeof value === 'string' ? value : (value?.id || '');
export const getMemberOfficerId = (member) => getRelationId(member?.assigned_officer) || getRelationId(member?.registered_by);
export const getGroupOfficerId = (group) => getRelationId(group?.assigned_officer) || getRelationId(group?.created_by);
export const getMemberOfficerScopeFilter = (officerId = getOfficerDataScopeId()) => officerId
  ? `(assigned_officer="${officerId}" || (assigned_officer="" && registered_by="${officerId}"))`
  : '';
export const getGroupOfficerScopeFilter = (officerId = getOfficerDataScopeId()) => officerId
  ? `(assigned_officer="${officerId}" || (assigned_officer="" && created_by="${officerId}"))`
  : '';
export const getPortfolioRecordOfficerScopeFilter = (officerId = getOfficerDataScopeId()) => officerId
  ? `(member.assigned_officer="${officerId}" || (member.assigned_officer="" && member.registered_by="${officerId}") || group.assigned_officer="${officerId}" || (group.assigned_officer="" && group.created_by="${officerId}"))`
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
  if (!shouldScopeOfficerData()) return members;
  const officerId = getOfficerDataScopeId();
  return members.filter(member => getMemberOfficerId(member) === officerId);
};

export const filterGroupsForCurrentOfficer = (groups = []) => {
  if (!shouldScopeOfficerData()) return groups;
  const officerId = getOfficerDataScopeId();
  return groups.filter(group => getGroupOfficerId(group) === officerId);
};

export const filterLoansForCurrentOfficer = (loans = [], { members = [], groups = [] } = {}) => {
  if (!shouldScopeOfficerData()) return loans;
  const officerId = getOfficerDataScopeId();
  const scope = createOfficerScope({ members, groups });
  return loans.filter(loan => scope.getLoanOfficerId(loan) === officerId);
};

export const filterSavingsForCurrentOfficer = (savings = [], { members = [], groups = [] } = {}) => {
  if (!shouldScopeOfficerData()) return savings;
  const officerId = getOfficerDataScopeId();
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
    .map(([id, name]) => ({ id, name, role: users.find(user => user.id === id)?.role || '' }))
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
