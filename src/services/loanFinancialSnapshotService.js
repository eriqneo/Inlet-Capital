import { pb } from './api.js';
import { dataCache } from './dataCache.js';
import { createLoanFinancialSnapshot } from '../core/loanFinancialSnapshot.js';
import { filterLoansForCurrentOfficer, filterMembersForCurrentOfficer, filterGroupsForCurrentOfficer, getOfficerScopeCacheKey,
  getMemberOfficerScopeFilter, getGroupOfficerScopeFilter, getLoanOfficerDataFilter } from '../core/officerScope.js';

export const loanSnapshotPrefix = 'loans:financial:snapshot:v2:';
const load = async () => {
  const [members, groups, loans, repayments, settlements, schedules, settings] = await Promise.all([
    pb.collection('members').getFullList({ filter: getMemberOfficerScopeFilter(), expand: 'group' }),
    pb.collection('groups').getFullList({ filter: getGroupOfficerScopeFilter() }),
    pb.collection('loans').getFullList({ filter: getLoanOfficerDataFilter(),
      expand: 'member,member.group,member.assigned_officer,member.registered_by,group,group.assigned_officer,group.created_by,processed_by,renewed_to' }),
    pb.collection('loan_repayments').getFullList({ filter: getLoanOfficerDataFilter(true), expand: 'loan,loan.member,loan.group' }),
    pb.collection('loan_balance_offs').getFullList({ filter: getLoanOfficerDataFilter(true) }),
    pb.collection('loan_schedule').getFullList({ filter: getLoanOfficerDataFilter(true) }),
    pb.collection('settings').getFullList()
  ]);
  const penaltySetting = settings.find(record => record.key === 'penalty_amount');
  const penaltyAmount = penaltySetting?.value === undefined || penaltySetting.value === '' ? 500 : Number(penaltySetting.value);
  if (!Number.isFinite(penaltyAmount) || penaltyAmount < 0) throw new Error('Penalty setting unavailable or invalid');
  return createLoanFinancialSnapshot({ members: filterMembersForCurrentOfficer(members), groups: filterGroupsForCurrentOfficer(groups),
    loans: filterLoansForCurrentOfficer(loans, { members, groups }), repayments, settlements, schedules, penaltyAmount });
};

export const loanFinancialSnapshotService = {
  get: onUpdate => dataCache.getLocalFirst(`${loanSnapshotPrefix}${getOfficerScopeCacheKey()}`, load, onUpdate, { minRefreshInterval: 600000 }),
  refresh: () => dataCache.refresh(`${loanSnapshotPrefix}${getOfficerScopeCacheKey()}`, load),
  invalidate: () => dataCache.invalidatePrefix(loanSnapshotPrefix)
};
