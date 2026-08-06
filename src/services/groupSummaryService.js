import { pb } from './api.js';
import { dataCache } from './dataCache.js';
import { getArrearsTotal, isScheduleInArrears } from '../core/loanScheduleMetrics.js';
import { getSettlementContractAmount } from '../core/repaymentAllocation.js';

const summaryCacheKey = (groupId) => `group_summary:${groupId}:v1`;
const scopedGroupRecordFilter = (groupId) => `group="${groupId}" || member.group="${groupId}"`;
const scopedLoanChildFilter = (groupId) => `loan.group="${groupId}" || loan.member.group="${groupId}"`;

const calculateSavingsTotal = (records = []) => records
  .filter(record => !record.is_reversed)
  .reduce((sum, record) => {
    const amount = Number(record.amount) || 0;
    return record.type === 'deposit' ? sum + amount : sum - amount;
  }, 0);

const isDisbursedLoanForBalance = (loan) => Boolean(loan?.disbursement_date)
  && ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan.status);
const isCollectibleLoan = (loan) => loan?.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan?.status) && loan?.disbursement_date);

const getLoanLiability = (loan) => {
  const storedLiability = Number(loan.total_liability) || 0;
  if (storedLiability > 0) return storedLiability;
  const principal = Number(loan.approved_amount || loan.amount_applied) || 0;
  const interest = Number(loan.interest_amount) || 0;
  return principal + interest;
};

const calculateLoanBalance = (loan, repayments = [], settlements = []) => {
  if (!isDisbursedLoanForBalance(loan)) return 0;
  const paid = repayments
    .filter(repayment => repayment.loan === loan.id)
    .reduce((sum, repayment) => sum + (Number(repayment.amount) || 0), 0)
    + settlements
      .filter(settlement => settlement.loan === loan.id && settlement.status !== 'reversed')
      .reduce((sum, settlement) => sum + getSettlementContractAmount(settlement), 0);
  return Math.max(0, getLoanLiability(loan) - paid);
};

const buildSummaryPayload = ({ groupId, members, loans, savings, repayments, settlements, schedules }) => {
  const activeMemberCutoff = Date.now() - (90 * 24 * 60 * 60 * 1000);
  const activeGroupLoans = loans.filter(loan => !loan.member && isCollectibleLoan(loan));
  const activeGroupLoanIds = new Set(activeGroupLoans.map(loan => loan.id));
  const groupLevelArrears = getArrearsTotal(
    schedules.filter(schedule => activeGroupLoanIds.has(schedule.loan) && isScheduleInArrears(schedule))
  );

  let totalArrears = groupLevelArrears;
  let membersInArrears = 0;
  let inactiveMembers = 0;

  members.forEach(member => {
    const memberSavings = savings.filter(record => record.member === member.id);
    const memberLoans = loans.filter(loan => loan.member === member.id);
    const activeMemberLoanIds = new Set(memberLoans.filter(isCollectibleLoan).map(loan => loan.id));
    const memberArrears = getArrearsTotal(
      schedules.filter(schedule => activeMemberLoanIds.has(schedule.loan) && isScheduleInArrears(schedule))
    );
    const lastSavingsDate = memberSavings.length > 0
      ? new Date(Math.max(...memberSavings.map(record => new Date(record.date))))
      : null;
    const isActive = lastSavingsDate && lastSavingsDate.getTime() >= activeMemberCutoff;

    totalArrears += memberArrears;
    if (memberArrears > 0) membersInArrears += 1;
    if (!isActive) inactiveMembers += 1;
  });

  return {
    group: groupId,
    member_count: members.length,
    total_savings: calculateSavingsTotal(savings),
    outstanding_loan: loans
      .filter(isDisbursedLoanForBalance)
      .reduce((sum, loan) => sum + calculateLoanBalance(loan, repayments, settlements), 0),
    total_arrears: totalArrears,
    members_in_arrears: membersInArrears,
    inactive_members: inactiveMembers,
    last_calculated_at: new Date().toISOString()
  };
};

export const groupSummaryService = {
  async getByGroup(groupId, onUpdate = null) {
    return await dataCache.getLocalFirst(
      summaryCacheKey(groupId),
      async () => {
        try {
          return await pb.collection('group_summary').getFirstListItem(`group="${groupId}"`);
        } catch (err) {
          if (err.status === 404) return null;
          throw err;
        }
      },
      onUpdate,
      { minRefreshInterval: 30 * 1000 }
    );
  },

  async rebuildGroup(groupId) {
    const [members, loans, savings] = await Promise.all([
      pb.collection('members').getFullList({ filter: `group="${groupId}"`, expand: 'group' }),
      pb.collection('loans').getFullList({
        filter: scopedGroupRecordFilter(groupId),
        sort: '-application_date',
        expand: 'member,member.group,group,processed_by'
      }),
      pb.collection('savings').getFullList({
        filter: scopedGroupRecordFilter(groupId),
        sort: '-date',
        expand: 'member,member.group,group,recorded_by'
      })
    ]);

    const hasLoans = loans.some(loan => isCollectibleLoan(loan) || ['completed', 'closed'].includes(loan.status));
    const [repayments, schedules, settlements] = hasLoans
      ? await Promise.all([
          pb.collection('loan_repayments').getFullList({ filter: scopedLoanChildFilter(groupId), sort: '-date' }),
          pb.collection('loan_schedule').getFullList({ filter: scopedLoanChildFilter(groupId), sort: 'installment_no' }),
          pb.collection('loan_balance_offs').getFullList({ filter: scopedLoanChildFilter(groupId), sort: '-effective_date' }).catch(error => {
            if (error?.status === 404) return [];
            throw error;
          })
        ])
      : [[], [], []];

    const payload = buildSummaryPayload({ groupId, members, loans, savings, repayments, settlements, schedules });
    let record;
    try {
      const existing = await pb.collection('group_summary').getFirstListItem(`group="${groupId}"`);
      record = await pb.collection('group_summary').update(existing.id, payload);
    } catch (err) {
      if (err.status !== 404) throw err;
      record = await pb.collection('group_summary').create(payload);
    }

    await dataCache.set(summaryCacheKey(groupId), record);
    return record;
  },

  async saveSnapshot(groupId, summary) {
    const payload = {
      group: groupId,
      member_count: Number(summary.member_count) || 0,
      total_savings: Number(summary.total_savings) || 0,
      outstanding_loan: Number(summary.outstanding_loan) || 0,
      total_arrears: Number(summary.total_arrears) || 0,
      members_in_arrears: Number(summary.members_in_arrears) || 0,
      inactive_members: Number(summary.inactive_members) || 0,
      last_calculated_at: new Date().toISOString()
    };

    let record;
    try {
      const existing = await pb.collection('group_summary').getFirstListItem(`group="${groupId}"`);
      record = await pb.collection('group_summary').update(existing.id, payload);
    } catch (err) {
      if (err.status !== 404) throw err;
      record = await pb.collection('group_summary').create(payload);
    }

    await dataCache.set(summaryCacheKey(groupId), record);
    return record;
  },

  async invalidate(groupId = '') {
    if (groupId) await dataCache.invalidate(summaryCacheKey(groupId));
    await dataCache.invalidatePrefix('group_summary:');
  }
};
