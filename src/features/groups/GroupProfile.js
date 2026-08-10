import { groupService } from '../../services/groupService.js';
import { memberService } from '../../services/memberService.js';
import { loanService } from '../../services/loanService.js';
import { savingsService } from '../../services/savingsService.js';
import { groupSummaryService } from '../../services/groupSummaryService.js';
import { authService } from '../../services/authService.js';
import { navigate } from '../../core/router.js';
import { formatDate, formatMoney, formatPercent } from '../../core/utils.js';
import { renderPagination } from '../../components/Pagination.js';
import { pb } from '../../services/api.js';
import { dataCache } from '../../services/dataCache.js';
import { setButtonLoading } from '../../core/uiState.js';
import { withReturnTo } from '../../core/navigation.js';
import { getArrearsTotal, isScheduleInArrears } from '../../core/loanScheduleMetrics.js';
import { getOfficerScopeCacheKey } from '../../core/officerScope.js';
import { getSettlementContractAmount } from '../../core/repaymentAllocation.js';
import { calculateGroupSavingsPerformance } from '../../core/groupSavingsPerformance.js';

export const renderGroupProfile = async (params) => {
  const { id } = params;
  const container = document.createElement('div');

  // Loading state
  container.innerHTML = `
    <div class="card text-center" style="padding:60px;">
      <div class="spinner" style="margin: 0 auto 16px;"></div>
      <p class="text-muted">Loading group profile...</p>
    </div>
  `;

  (async () => {
  let group;
  const officerScopeKey = getOfficerScopeCacheKey();
  try {
    group = await dataCache.getLocalFirst(
      `groups:profile:${officerScopeKey}:${id}:v1`,
      () => groupService.getById(id),
      null,
      { minRefreshInterval: 30 * 1000 }
    );
  } catch (err) {
    container.innerHTML = `<div class="card text-center"><h2>Group Not Found</h2><button class="btn btn-primary" onclick="window.location.hash = '#/groups'">Back to List</button></div>`;
    return;
  }

  const groupProfileRoute = `#/groups/${id}`;
  const canManageRecords = authService.hasRole('super_admin', 'admin');
  const canManageLifecycle = authService.hasRole('super_admin');
  if (String(group.status || '').toLowerCase() === 'suspended') {
    container.innerHTML = `
      <div class="card text-center" style="max-width: 560px; margin: 40px auto; border-top: 4px solid var(--warning);">
        <h2 style="margin-bottom: 8px;">Group Suspended</h2>
        <p class="text-muted" style="margin-bottom: 20px;">${group.name || 'This group'} is hidden from normal operations until an admin revives it from Reports &gt; Lifecycle.</p>
        <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
          <button class="btn btn-outline" onclick="window.location.hash = '#/groups'">Back to Groups</button>
          ${canManageRecords ? `<button class="btn btn-primary" onclick="window.location.hash = '#/reports?tab=lifecycle'">Open Lifecycle Report</button>` : ''}
        </div>
      </div>
    `;
    return;
  }
  let quickSummary = null;
  try {
    quickSummary = await groupSummaryService.getByGroup(id);
  } catch (err) {
    console.warn('[GroupProfile] Summary unavailable:', err.message);
  }

  const renderQuickShell = (summary) => {
    const totalSavings = Number(summary?.total_savings) || Number(group.total_savings) || 0;
    const outstandingLoan = Number(summary?.outstanding_loan) || 0;
    const memberCount = Number(summary?.member_count) || Number(group.member_count) || 0;
    const totalArrears = Number(summary?.total_arrears) || 0;
    const membersInArrears = Number(summary?.members_in_arrears) || 0;
    const inactiveMembers = Number(summary?.inactive_members) || 0;
    container.innerHTML = `
      <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 16px;">
          <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/groups'">← Back</button>
          <h1 class="text-xl">${group.name}</h1>
        </div>
        <div style="display: flex; gap: 12px;">
          ${canManageRecords ? `<button class="btn btn-outline btn-sm" disabled>+ Add Member</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="window.location.hash = '${withReturnTo(`#/loans/new?groupId=${id}`, groupProfileRoute)}'">Apply for Group Loan</button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <div class="card" style="padding: 16px; border-left: 3px solid var(--success);"><div class="text-xs text-muted">Total Savings</div><div class="text-lg font-semibold text-success">KES ${formatMoney(totalSavings)}</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid var(--danger);"><div class="text-xs text-muted">Outstanding Loan</div><div class="text-lg font-semibold text-danger">KES ${formatMoney(outstandingLoan)}</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid var(--secondary);"><div class="text-xs text-muted">Total Repayments</div><div class="text-lg font-semibold" style="color: var(--secondary);">Syncing...</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid var(--primary);"><div class="text-xs text-muted">This Month Collections Expected</div><div class="text-lg font-semibold" style="color: var(--primary);">Syncing...</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid var(--warning);"><div class="text-xs text-muted">Total Fees</div><div class="text-lg font-semibold" style="color: var(--warning);">Syncing...</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid var(--primary);"><div class="text-xs text-muted">Total Members</div><div class="text-lg font-semibold text-primary">${memberCount}</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid ${totalArrears > 0 ? 'var(--danger)' : 'var(--border-color)'};"><div class="text-xs text-muted">Total Arrears</div><div class="text-lg font-semibold" style="color: ${totalArrears > 0 ? 'var(--danger)' : 'inherit'};">KES ${formatMoney(totalArrears)}</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid var(--warning);"><div class="text-xs text-muted">Portfolio at Risk (PAR)</div><div class="text-lg font-semibold" style="color: var(--warning);">Syncing...</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid ${membersInArrears > 0 ? 'var(--warning)' : 'var(--border-color)'};"><div class="text-xs text-muted">Members in Arrears</div><div class="text-lg font-semibold" style="color: ${membersInArrears > 0 ? 'var(--warning)' : 'inherit'};">${membersInArrears}</div></div>
        <div class="card" style="padding: 16px; border-left: 3px solid ${inactiveMembers > 0 ? 'var(--danger)' : 'var(--border-color)'};"><div class="text-xs text-muted">Inactive Members</div><div class="text-lg font-semibold" style="color: ${inactiveMembers > 0 ? 'var(--danger)' : 'inherit'};">${inactiveMembers} <span class="text-xs text-muted" style="font-weight:normal;">(>90 days)</span></div></div>
      </div>

      <div class="card text-center" style="padding: 36px;">
        <div class="spinner" style="margin: 0 auto 14px;"></div>
        <div class="font-semibold">Preparing detailed tables...</div>
        <p class="text-sm text-muted" style="margin-top: 6px;">KPIs are shown from the group summary while members, table banking, and savings sync in the background.</p>
      </div>
    `;
  };

  renderQuickShell(quickSummary);

  const scopedGroupRecordFilter = `group="${id}" || member.group="${id}"`;
  let currentStartDate = null, currentEndDate = null;
  const calculateSavingsTotal = (records) => records
    .filter(s => !s.is_reversed)
    .reduce((sum, s) => {
      const amount = Number(s.amount) || 0;
      return s.type === 'deposit' ? sum + amount : sum - amount;
    }, 0);
  const calculateSavingsMovement = (records) => records
    .filter(s => !s.is_reversed)
    .reduce((totals, s) => {
      const amount = Number(s.amount) || 0;
      if (s.type === 'deposit') totals.deposits += amount;
      if (s.type === 'withdrawal') totals.withdrawals += amount;
      return totals;
    }, { deposits: 0, withdrawals: 0 });
  const isDisbursedLoanForBalance = (loan) => Boolean(loan?.disbursement_date)
    && ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan.status);
  const isCollectibleLoan = (loan) => loan?.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan?.status) && loan?.disbursement_date);
  const getLoanLiability = (loan) => {
    const storedLiability = Number(loan?.total_liability) || 0;
    if (storedLiability > 0) return storedLiability;
    const principal = Number(loan?.approved_amount || loan?.amount_applied) || 0;
    return principal + (Number(loan?.interest_amount) || 0);
  };
  const calculateLoanBalance = (loan, repayments, settlements = []) => {
    if (!isDisbursedLoanForBalance(loan)) return 0;
    const liability = getLoanLiability(loan);
    const paid = repayments
      .filter(r => r.loan === loan.id)
      .reduce((repaymentSum, r) => repaymentSum + (Number(r.amount) || 0), 0)
      + settlements
        .filter(s => s.loan === loan.id && s.status !== 'reversed')
        .reduce((settlementSum, s) => settlementSum + getSettlementContractAmount(s), 0);
    return Math.max(0, liability - paid);
  };
  const calculateActiveLoanPortfolio = (loans) => loans
    .filter(isCollectibleLoan)
    .reduce((sum, loan) => sum + getLoanLiability(loan), 0);
  const getParHealth = (parRate) => parRate >= 16
    ? { label: 'High Risk', color: 'var(--danger)', accent: 'var(--danger)' }
    : parRate >= 11
      ? { label: 'Needs Attention', color: 'var(--warning)', accent: 'var(--warning)' }
      : parRate >= 6
        ? { label: 'Good', color: 'var(--primary)', accent: 'var(--primary)' }
        : { label: 'Excellent', color: 'var(--success)', accent: 'var(--success)' };
  const calculateOutstandingLoanBalance = (loans, repayments, settlements = []) => loans
    .filter(isDisbursedLoanForBalance)
    .reduce((sum, loan) => sum + calculateLoanBalance(loan, repayments, settlements), 0);
  const calculateRepaymentsTotal = (repayments) => repayments
    .reduce((sum, repayment) => sum + (Number(repayment.amount) || 0), 0);
  const getRegistrationFeeDate = (member) => member.registration_fee_details?.date
    || member.registration_fee_details?.captured_at
    || member.registration_date
    || member.created;
  const getProcessingFeeDate = (loan) => loan.processing_fee_details?.date
    || loan.processing_fee_details?.captured_at
    || loan.application_date
    || loan.created;
  const isDateWithinCurrentFilter = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    if (currentStartDate && date < currentStartDate) return false;
    if (currentEndDate && date > currentEndDate) return false;
    return true;
  };
  const calculateFeesTotal = (members, loans) => {
    const memberIds = new Set(members.map(member => member.id).filter(Boolean));
    const registrationFees = members
      .filter(member => isDateWithinCurrentFilter(getRegistrationFeeDate(member)))
      .reduce((sum, member) => sum + (Number(member.registration_fee) || 0), 0);
    const processingFees = loans
      .filter(loan => loan.member && memberIds.has(loan.member))
      .filter(loan => loan.processing_fee_paid && isDateWithinCurrentFilter(getProcessingFeeDate(loan)))
      .reduce((sum, loan) => sum + (Number(loan.processing_fee) || 0), 0);
    return registrationFees + processingFees;
  };
  const buildEffectiveSchedulePaidMap = (schedules, repayments, settlements = []) => {
    const schedulesByLoan = new Map();
    schedules.forEach(schedule => {
      if (!schedule.loan) return;
      if (!schedulesByLoan.has(schedule.loan)) schedulesByLoan.set(schedule.loan, []);
      schedulesByLoan.get(schedule.loan).push(schedule);
    });
    schedulesByLoan.forEach(loanSchedules => {
      loanSchedules.sort((a, b) => {
        const installmentDiff = (Number(a.installment_no) || 0) - (Number(b.installment_no) || 0);
        if (installmentDiff !== 0) return installmentDiff;
        return new Date(a.due_date || 0) - new Date(b.due_date || 0);
      });
    });

    const repaymentsByLoan = new Map();
    [
      ...repayments,
      ...settlements
        .filter(settlement => settlement.status !== 'reversed')
        .map(settlement => ({
          ...settlement,
          amount: getSettlementContractAmount(settlement),
          date: settlement.effective_date || settlement.created
        }))
    ].forEach(repayment => {
      if (!repayment.loan) return;
      if (!repaymentsByLoan.has(repayment.loan)) repaymentsByLoan.set(repayment.loan, []);
      repaymentsByLoan.get(repayment.loan).push(repayment);
    });
    repaymentsByLoan.forEach(loanRepayments => {
      loanRepayments.sort((a, b) => new Date(a.date || a.created || 0) - new Date(b.date || b.created || 0));
    });

    const paidMap = new Map();
    schedulesByLoan.forEach((loanSchedules, loanId) => {
      const allocated = new Map(loanSchedules.map(schedule => [schedule.id, 0]));
      (repaymentsByLoan.get(loanId) || []).forEach(repayment => {
        let remainingPayment = Number(repayment.amount) || 0;
        for (const schedule of loanSchedules) {
          if (remainingPayment <= 0) break;
          const scheduleAmount = Number(schedule.amount) || 0;
          const currentPaid = allocated.get(schedule.id) || 0;
          const openAmount = Math.max(0, scheduleAmount - currentPaid);
          if (openAmount <= 0) continue;
          const applied = Math.min(openAmount, remainingPayment);
          allocated.set(schedule.id, currentPaid + applied);
          remainingPayment -= applied;
        }
      });
      loanSchedules.forEach(schedule => {
        const recordedPaid = Number(schedule.paid) || 0;
        const allocatedPaid = allocated.get(schedule.id) || 0;
        paidMap.set(schedule.id, Math.min(Number(schedule.amount) || 0, Math.max(recordedPaid, allocatedPaid)));
      });
    });
    return paidMap;
  };
  const getMemberGroupJoinedDate = (member) => member.group_joined_at
    || member.updated
    || member.registration_date
    || member.created
    || '';
  const sortMembersByGroupJoinedAsc = (members) => [...members].sort((a, b) => {
    const aTime = new Date(getMemberGroupJoinedDate(a)).getTime();
    const bTime = new Date(getMemberGroupJoinedDate(b)).getTime();
    const safeATime = Number.isNaN(aTime) ? 0 : aTime;
    const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
    if (safeATime !== safeBTime) return safeATime - safeBTime;
    return String(a.full_name || '').localeCompare(String(b.full_name || ''));
  });
  const calculateThisMonthCollectionsExpected = (loans, schedules, repayments, settlements = []) => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);
    const activeLoanIds = new Set(loans.filter(isCollectibleLoan).map(loan => loan.id));
    const effectivePaidMap = buildEffectiveSchedulePaidMap(schedules, repayments, settlements);
    return schedules
      .filter(schedule => activeLoanIds.has(schedule.loan))
      .filter(schedule => {
        const dueDate = new Date(schedule.due_date);
        return !Number.isNaN(dueDate.getTime()) && dueDate >= monthStart && dueDate <= monthEnd;
      })
      .reduce((sum, schedule) => {
        const amount = Number(schedule.amount) || 0;
        const paid = effectivePaidMap.get(schedule.id) ?? Math.min(amount, Math.max(0, Number(schedule.paid) || 0));
        return sum + Math.max(0, amount - paid);
      }, 0);
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));

  // Fetch group data in cached batches. This avoids a per-member/per-loan network waterfall.
  let allGroupMembers = [], groupLoans = [], groupSavings = [], allRepayments = [], allSchedules = [], allBalanceOffs = [];
  try {
    allGroupMembers = await dataCache.getLocalFirst(
      `groups:profile:${officerScopeKey}:${id}:members:v3`,
      async () => sortMembersByGroupJoinedAsc(await pb.collection('members').getFullList({
        filter: `group="${id}" && status!="closed"`,
        sort: 'group_joined_at,created',
        expand: 'group'
      })),
      null,
      { minRefreshInterval: 20 * 1000 }
    );
  } catch (e) { console.warn('[GroupProfile] Batch profile fetch:', e.message); }

  try {
    [groupLoans, groupSavings] = await Promise.all([
      dataCache.getLocalFirst(
        `groups:profile:${officerScopeKey}:${id}:loans:v3`,
        () => pb.collection('loans').getFullList({
          filter: scopedGroupRecordFilter,
          sort: '-application_date',
          expand: 'member,member.group,group,processed_by'
        }),
        null,
        { minRefreshInterval: 10 * 1000 }
      ),
      dataCache.getLocalFirst(
        `groups:profile:${officerScopeKey}:${id}:savings:v3`,
        () => pb.collection('savings').getFullList({
          filter: scopedGroupRecordFilter,
          sort: '-date',
          expand: 'member,member.group,group,recorded_by'
        }),
        null,
        { minRefreshInterval: 10 * 1000 }
      )
    ]);
  } catch (e) { console.warn('[GroupProfile] Batch loans/savings fetch:', e.message); }

  const isSuspendedMember = (member) => String(member?.status || '').toLowerCase() === 'suspended';
  const activeGroupMembers = allGroupMembers.filter(member => !isSuspendedMember(member));
  const activeGroupMemberIds = new Set(activeGroupMembers.map(member => member.id));
  const isActiveMemberFinancialRecord = (record) => !record.member || activeGroupMemberIds.has(record.member);
  const financialGroupLoans = groupLoans.filter(isActiveMemberFinancialRecord);
  const financialGroupSavings = groupSavings.filter(isActiveMemberFinancialRecord);

  const activeLoansForProfile = financialGroupLoans.filter(l => isCollectibleLoan(l) || ['completed', 'closed'].includes(l.status));
  const activeLoanIds = new Set(activeLoansForProfile.map(l => l.id));

  if (activeLoanIds.size > 0) {
    try {
      [allRepayments, allSchedules, allBalanceOffs] = await Promise.all([
        dataCache.getLocalFirst(
          `groups:profile:${id}:repayments:v2`,
          () => pb.collection('loan_repayments').getFullList({
            filter: `loan.group="${id}" || loan.member.group="${id}"`,
            sort: '-date'
          }),
          null,
          { minRefreshInterval: 10 * 1000 }
        ),
        dataCache.getLocalFirst(
          `groups:profile:${id}:schedule:v2`,
          () => pb.collection('loan_schedule').getFullList({
            filter: `loan.group="${id}" || loan.member.group="${id}"`,
            sort: 'installment_no'
          }),
          null,
          { minRefreshInterval: 10 * 1000 }
        ),
        dataCache.getLocalFirst(
          `groups:profile:${id}:balanceoffs:v1`,
          () => loanService.getBalanceOffsFullList({
            filter: `loan.group="${id}" || loan.member.group="${id}"`,
            expand: ''
          }),
          null,
          { minRefreshInterval: 10 * 1000 }
        )
      ]);
    } catch (e) { console.warn('[GroupProfile] Batch repayment/schedule fetch:', e.message); }
  }

  // For each member, fetch their savings/loans for the enriched table
  let totalGroupArrears = 0;
  let membersInArrearsCount = 0;
  let inactiveMembersCount = 0;
  const enrichedMembers = sortMembersByGroupJoinedAsc(allGroupMembers).map((m) => {
    const mSavings = groupSavings.filter(s => s.member === m.id);
    const mLoans = groupLoans.filter(l => l.member === m.id);

    const totalSavings = calculateSavingsTotal(mSavings);

    const activeLoans = mLoans.filter(isCollectibleLoan);
    const memberLoanIds = new Set(activeLoans.map(l => l.id));
    const overdue = allSchedules.filter(s => memberLoanIds.has(s.loan) && isScheduleInArrears(s));
    const totalArrears = getArrearsTotal(overdue);

    const olBalance = calculateOutstandingLoanBalance(mLoans, allRepayments, allBalanceOffs);
    const lastSavingsDate = mSavings.length > 0 ? new Date(Math.max(...mSavings.map(s => new Date(s.date)))) : null;
    const isActive = lastSavingsDate && (new Date() - lastSavingsDate <= 90 * 24 * 60 * 60 * 1000);

    return { ...m, totalSavings, olBalance, totalArrears, isActive, lastSavingsDate };
  });

  // Aggregate group savings
  const activeEnrichedMembers = enrichedMembers.filter(member => !isSuspendedMember(member));
  const totalMemberSavings = activeEnrichedMembers.reduce((sum, m) => sum + m.totalSavings, 0);
  const groupAccountSavings = calculateSavingsTotal(financialGroupSavings.filter(s => !s.member));
  let totalGroupSavings = totalMemberSavings + groupAccountSavings;
  const initialSavingsMovement = calculateSavingsMovement(financialGroupSavings);

  // Group-level loan arrears
  const activeGroupLoans = financialGroupLoans.filter(l => !l.member && isCollectibleLoan(l));
  const activeGroupLoanIds = new Set(activeGroupLoans.map(gl => gl.id));
  const groupLevelArrears = allSchedules
    .filter(s => activeGroupLoanIds.has(s.loan) && isScheduleInArrears(s))
    .reduce((sum, s) => sum + getArrearsTotal([s]), 0);
  totalGroupArrears += groupLevelArrears;

  // Calculate totals from enrichedMembers
  for (const m of activeEnrichedMembers) {
    totalGroupArrears += m.totalArrears;
    if (m.totalArrears > 0) membersInArrearsCount++;
    if (!m.isActive) inactiveMembersCount++;
  }
  let totalOutstandingLoan = calculateOutstandingLoanBalance(financialGroupLoans, allRepayments, allBalanceOffs);
  const thisMonthCollectionsExpected = calculateThisMonthCollectionsExpected(financialGroupLoans, allSchedules, allRepayments, allBalanceOffs);
  const activeLoanPortfolio = calculateActiveLoanPortfolio(financialGroupLoans);
  const groupParRateNumber = activeLoanPortfolio > 0 ? (totalGroupArrears / activeLoanPortfolio) * 100 : 0;
  const groupParHealth = getParHealth(groupParRateNumber);
  const savingsPerformance = calculateGroupSavingsPerformance({
    group,
    members: activeEnrichedMembers,
    savings: financialGroupSavings
  });
  const autoPerformanceRating = savingsPerformance.rating;
  const performanceLabels = {
    0: 'No Savings History',
    1: 'Very Poor',
    2: 'Poor',
    3: 'Fair',
    4: 'Very Good',
    5: 'Excellent'
  };
  const performanceColor = autoPerformanceRating === 5
    ? 'var(--success)'
    : autoPerformanceRating >= 3
      ? 'var(--warning)'
      : autoPerformanceRating > 0
        ? 'var(--danger)'
        : 'var(--text-muted)';
  const computedSummarySnapshot = {
    member_count: activeGroupMembers.length,
    total_savings: totalGroupSavings,
    outstanding_loan: totalOutstandingLoan,
    total_arrears: totalGroupArrears,
    members_in_arrears: membersInArrearsCount,
    inactive_members: inactiveMembersCount
  };

  // All unassigned members for add-member modal. Load only when the modal is opened.
  let unassignedMembers = [];
  let unassignedMembersLoaded = false;
  const loadUnassignedMembers = async () => {
    if (unassignedMembersLoaded) return unassignedMembers;
    try {
      unassignedMembers = await dataCache.getLocalFirst(
        `members:unassigned:${officerScopeKey}:v2`,
        async () => (await memberService.list({ page: 1, perPage: 10000, filter: `group=""||group=null`, sort: 'full_name' })).items,
        null,
        { minRefreshInterval: 20 * 1000 }
      );
      unassignedMembersLoaded = true;
    } catch(e) {
      console.warn('[GroupProfile] Unassigned members fetch:', e.message);
      unassignedMembers = [];
    }
    return unassignedMembers;
  };

  const allFinancialLoansSorted = groupLoans.sort((a, b) => new Date(b.application_date) - new Date(a.application_date));
  const allFinancialSavingsSorted = groupSavings.sort((a, b) => new Date(b.date) - new Date(a.date));
  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/groups'">← Back</button>
        <h1 class="text-xl">${group.name}</h1>
      </div>
      <div style="display: flex; gap: 12px;">
        ${canManageRecords ? `<button class="btn btn-outline btn-sm" id="add-member-btn">+ Add Member</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="window.location.hash = '${withReturnTo(`#/loans/new?groupId=${id}`, groupProfileRoute)}'">Apply for Group Loan</button>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 300px; gap: 24px;">
      <div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <div class="card" style="padding: 16px; border-left: 3px solid var(--success);">
            <div class="text-xs text-muted">Total Savings</div>
            <div class="text-lg font-semibold text-success" id="group-total-savings-kpi">KES ${formatMoney(totalGroupSavings)}</div>
            <div class="text-xs" id="group-savings-movement-kpi" style="margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap;">
              <span style="color: var(--success); font-weight: 700;">DEP ${formatMoney(initialSavingsMovement.deposits)}</span>
              <span style="color: var(--danger); font-weight: 700;">WIT ${formatMoney(initialSavingsMovement.withdrawals)}</span>
            </div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--danger);">
            <div class="text-xs text-muted">Outstanding Loan</div>
            <div class="text-lg font-semibold text-danger" id="group-outstanding-loan-kpi">KES ${formatMoney(totalOutstandingLoan)}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--secondary);">
            <div class="text-xs text-muted">Total Repayments</div>
            <div class="text-lg font-semibold" id="group-total-repayments-kpi" style="color: var(--secondary);">KES ${formatMoney(calculateRepaymentsTotal(allRepayments))}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--primary);">
            <div class="text-xs text-muted">This Month Collections Expected</div>
            <div class="text-lg font-semibold" id="group-this-month-expected-kpi" style="color: var(--primary);">KES ${formatMoney(thisMonthCollectionsExpected)}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--warning);">
            <div class="text-xs text-muted">Total Fees</div>
            <div class="text-lg font-semibold" id="group-total-fees-kpi" style="color: var(--warning);">KES ${formatMoney(calculateFeesTotal(allGroupMembers, groupLoans))}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--primary);">
            <div class="text-xs text-muted">Total Members</div>
            <div class="text-lg font-semibold text-primary" id="group-total-members-kpi">${allGroupMembers.length}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid ${totalGroupArrears > 0 ? 'var(--danger)' : 'var(--border-color)'};">
            <div class="text-xs text-muted">Total Arrears</div>
            <div class="text-lg font-semibold" id="group-total-arrears-kpi" style="color: ${totalGroupArrears > 0 ? 'var(--danger)' : 'inherit'};">KES ${formatMoney(totalGroupArrears)}</div>
          </div>
          <div class="card" id="group-par-card" style="padding: 16px; border-left: 3px solid ${groupParHealth.accent};">
            <div class="text-xs text-muted">Portfolio at Risk (PAR)</div>
            <div class="text-lg font-semibold" id="group-par-kpi" style="color: ${groupParHealth.color};">${formatPercent(groupParRateNumber)}</div>
            <div class="text-xs" id="group-par-health" style="margin-top: 4px; color: ${groupParHealth.color}; font-weight: 700;">${groupParHealth.label}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid ${membersInArrearsCount > 0 ? 'var(--warning)' : 'var(--border-color)'};">
            <div class="text-xs text-muted">Members in Arrears</div>
            <div class="text-lg font-semibold" id="group-arrears-kpi" style="color: ${membersInArrearsCount > 0 ? 'var(--warning)' : 'inherit'};">${membersInArrearsCount}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid ${inactiveMembersCount > 0 ? 'var(--danger)' : 'var(--border-color)'};">
            <div class="text-xs text-muted">Inactive Members</div>
            <div class="text-lg font-semibold" id="group-inactive-members-kpi" style="color: ${inactiveMembersCount > 0 ? 'var(--danger)' : 'inherit'};">${inactiveMembersCount} <span class="text-xs text-muted" style="font-weight:normal;">(>90 days)</span></div>
          </div>
        </div>

        <div class="card group-filter-card" style="margin-bottom: 24px; padding: 16px;">
          <div style="display: grid; grid-template-columns: minmax(180px, 1.2fr) minmax(180px, 1fr) minmax(160px, 0.8fr) auto auto; gap: 12px; align-items: end;">
            <div class="form-group" style="margin: 0;">
              <label class="form-label">Search Member</label>
              <input type="search" id="group-member-search" class="form-control" placeholder="Name, reg no, phone" />
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label">Account Scope</label>
              <select id="group-account-scope" class="form-control">
                <option value="all">All Members + Group Accounts</option>
                <option value="members">All Members</option>
                <option value="groups">Group Acc (Account)</option>
              </select>
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label">From</label>
              <input type="date" id="global-date-start" class="form-control" />
            </div>
            <div class="form-group" style="margin: 0;">
              <label class="form-label">To</label>
              <input type="date" id="global-date-end" class="form-control" />
            </div>
            <button class="btn btn-outline btn-sm" id="clear-date-filter-btn" style="height: 38px;">Clear</button>
          </div>
          <div id="group-filter-summary" class="text-xs text-muted" style="margin-top: 10px;"></div>
        </div>

        <div class="card" style="padding: 0;">
          <div style="display: flex; border-bottom: 1px solid var(--border-color);">
            <button class="tab-btn active" data-tab="members">Members (${allGroupMembers.length})</button>
            <button class="tab-btn" data-tab="loans">Table Banking</button>
            <button class="tab-btn" data-tab="savings">Savings</button>
          </div>
          <div id="tab-content" style="padding: 24px;">
            <div id="members-tab">
              <div style="padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; gap: 8px;">
                <button class="btn btn-sm btn-primary" id="filter-all-btn" style="font-size: 0.75rem; padding: 6px 16px; border-radius: 20px;">Total Members</button>
                <button class="btn btn-sm btn-outline" id="filter-arrears-btn" style="font-size: 0.75rem; padding: 6px 16px; border-radius: 20px;">Members in Arrears</button>
                <button class="btn btn-sm btn-outline" id="filter-inactive-btn" style="font-size: 0.75rem; padding: 6px 16px; border-radius: 20px;">Inactive Members</button>
              </div>
              <div class="table-responsive">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Name</th><th>Phone</th><th>A.Savings <span title="Accumulated Savings" style="cursor:help;">ⓘ</span></th>
                      <th>OL Balance</th><th>Arrears</th><th>In Arrears</th><th>Status</th><th>Last Saved</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody id="members-table-body"></tbody>
                </table>
              </div>
            </div>
            <div id="loans-tab" style="display: none;">
              <div class="table-responsive">
                <table class="table">
                  <thead><tr><th>Loan No</th><th>Owner</th><th>OLB</th><th>Status</th><th>Date</th><th>Remarks</th><th>Action</th></tr></thead>
                  <tbody id="group-loans-body"></tbody>
                </table>
              </div>
              <div id="group-loans-pagination"></div>
            </div>
            <div id="savings-tab" style="display: none;">
              <div class="table-responsive">
                <table class="table">
                  <thead><tr><th>Date</th><th>Owner</th><th>Type</th><th>Amount</th><th>Ref</th><th>Remarks</th></tr></thead>
                  <tbody id="group-savings-body"></tbody>
                </table>
              </div>
              <div id="group-savings-pagination"></div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <h3 style="font-size: 1rem; margin-bottom: 16px;">Group Info</h3>
          <div style="margin-bottom: 12px;"><div class="text-xs text-muted">Meeting Day</div><div>${group.meeting_day || '-'}</div></div>
          <div style="margin-bottom: 12px;"><div class="text-xs text-muted">Location</div><div>${group.location || '-'}</div></div>
          <div style="margin-bottom: 12px;"><div class="text-xs text-muted">Registration Date</div><div>${group.registration_date ? formatDate(group.registration_date) : '-'}</div></div>
          <div style="margin-bottom: 12px;"><div class="text-xs text-muted">Phone</div><div>${group.phone || '-'}</div></div>
          <div style="margin-bottom: 12px;"><div class="text-xs text-muted">Performance Savings Rating</div><div id="group-rating-container" style="margin-top: 4px;"></div></div>
        </div>
      </div>
    </div>

    <div id="add-member-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 500px;">
        <h3 style="margin-bottom: 16px;">Add Member to Group</h3>
        <p class="text-sm text-muted" style="margin-bottom: 24px;">Search for a registered individual to join ${group.name}.</p>
        <div class="form-group">
          <label class="form-label">Search Member</label>
          <input type="search" id="add-member-search" class="form-control" placeholder="Type name, reg no, phone, or ID" autocomplete="off" />
          <input type="hidden" id="member-select" value="" />
          <div id="member-search-results" class="member-picker-results" style="margin-top: 10px;"></div>
          <div id="selected-member-summary" class="text-xs text-muted" style="margin-top: 10px;"></div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px;">
          <button class="btn btn-outline" id="close-modal-btn">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-btn" disabled>Add to Group</button>
        </div>
      </div>
    </div>

    <style>
      .tab-btn { flex: 1; padding: 16px; background: transparent; border: none; font-family: 'Inter', sans-serif; font-weight: 600; cursor: pointer; color: var(--text-muted); border-bottom: 2px solid transparent; }
      .tab-btn.active { color: var(--primary); border-bottom-color: var(--secondary); background: rgba(27, 61, 114, 0.02); }
      .member-picker-results { max-height: 280px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: white; }
      .member-picker-option { width: 100%; display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px; background: white; border: none; border-bottom: 1px solid var(--border-color); text-align: left; cursor: pointer; }
      .member-picker-option:last-child { border-bottom: none; }
      .member-picker-option:hover, .member-picker-option.selected { background: rgba(27, 61, 114, 0.06); }
      .member-picker-empty { padding: 18px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
      .group-member-suspended { background: rgba(245, 158, 11, 0.055); }
      .group-member-suspended-identity { text-decoration: line-through; text-decoration-thickness: 1px; text-decoration-color: var(--warning); opacity: 0.75; }
      @media (max-width: 900px) {
        .group-filter-card > div { grid-template-columns: 1fr !important; }
      }
    </style>
  `;

  // Tab switching
  const tabs = container.querySelectorAll('.tab-btn');
  const contents = { members: container.querySelector('#members-tab'), loans: container.querySelector('#loans-tab'), savings: container.querySelector('#savings-tab') };
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(contents).forEach(c => c.style.display = 'none');
      contents[tab.dataset.tab].style.display = 'block';
    };
  });

  // Modal logic
  const modal = container.querySelector('#add-member-modal');
  const addMemberSearch = container.querySelector('#add-member-search');
  const memberSelectInput = container.querySelector('#member-select');
  const memberSearchResults = container.querySelector('#member-search-results');
  const selectedMemberSummary = container.querySelector('#selected-member-summary');
  const confirmAddBtn = container.querySelector('#confirm-add-btn');

  const normalizeSearch = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const memberSearchText = (member) => normalizeSearch([
    member.full_name,
    member.reg_no,
    member.phone_number,
    member.phone,
    member.id_number
  ].filter(Boolean).join(' '));
  const fuzzyMatches = (needle, haystack) => {
    if (!needle) return true;
    let haystackIndex = 0;
    for (const char of needle) {
      haystackIndex = haystack.indexOf(char, haystackIndex);
      if (haystackIndex === -1) return false;
      haystackIndex += 1;
    }
    return true;
  };
  const rankMemberSearchResult = (member, query) => {
    if (!query) return 1;
    const name = normalizeSearch(member.full_name);
    const regNo = normalizeSearch(member.reg_no);
    const phone = normalizeSearch(member.phone_number || member.phone);
    const idNumber = normalizeSearch(member.id_number);
    const haystack = memberSearchText(member);
    const queryParts = query.split(' ').filter(Boolean);
    if (regNo === query || phone === query || idNumber === query) return 100;
    if (name === query) return 95;
    if (regNo.startsWith(query) || phone.startsWith(query) || idNumber.startsWith(query)) return 85;
    if (name.startsWith(query)) return 80;
    if (queryParts.every(part => haystack.includes(part))) return 65;
    if (fuzzyMatches(query.replace(/\s/g, ''), haystack.replace(/\s/g, ''))) return 35;
    return 0;
  };
  const renderMemberSearchResults = () => {
    const query = normalizeSearch(addMemberSearch.value);
    const selectedId = memberSelectInput.value;
    if (!unassignedMembersLoaded) {
      memberSearchResults.innerHTML = `<div class="member-picker-empty">Loading available members...</div>`;
      return;
    }
    const matches = unassignedMembers
      .map(member => ({ member, score: rankMemberSearchResult(member, query) }))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score || String(a.member.full_name || '').localeCompare(String(b.member.full_name || '')))
      .slice(0, 8)
      .map(result => result.member);

    if (unassignedMembers.length === 0) {
      memberSearchResults.innerHTML = `<div class="member-picker-empty">No unassigned members are available.</div>`;
      return;
    }
    if (matches.length === 0) {
      memberSearchResults.innerHTML = `<div class="member-picker-empty">No matching unassigned members found.</div>`;
      return;
    }

    memberSearchResults.innerHTML = matches.map(member => `
      <button type="button" class="member-picker-option ${member.id === selectedId ? 'selected' : ''}" data-member-id="${member.id}">
        <span>
          <span class="font-semibold">${escapeHtml(member.full_name || 'Unnamed member')}</span>
          <span class="text-xs text-muted" style="display:block; margin-top: 2px;">${escapeHtml(member.reg_no || '-')} · ${escapeHtml(member.phone_number || member.phone || 'No phone')}</span>
        </span>
        <span class="badge badge-primary" style="font-size: 0.65rem;">Select</span>
      </button>
    `).join('');
  };
  const selectMemberForGroup = (memberId) => {
    const member = unassignedMembers.find(m => m.id === memberId);
    memberSelectInput.value = member?.id || '';
    confirmAddBtn.disabled = !member;
    selectedMemberSummary.textContent = member
      ? `Selected: ${member.full_name || 'Unnamed member'} (${member.reg_no || 'No reg no'})`
      : '';
    renderMemberSearchResults();
  };
  const resetAddMemberPicker = () => {
    addMemberSearch.value = '';
    selectMemberForGroup('');
    renderMemberSearchResults();
  };

  const addMemberBtn = container.querySelector('#add-member-btn');
  if (addMemberBtn) addMemberBtn.onclick = async () => {
    resetAddMemberPicker();
    modal.style.display = 'flex';
    setTimeout(() => addMemberSearch.focus(), 0);
    await loadUnassignedMembers();
    renderMemberSearchResults();
  };
  container.querySelector('#close-modal-btn').onclick = () => modal.style.display = 'none';
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };
  addMemberSearch.oninput = () => {
    selectMemberForGroup('');
    renderMemberSearchResults();
  };
  memberSearchResults.onclick = (e) => {
    const option = e.target.closest('.member-picker-option');
    if (!option) return;
    selectMemberForGroup(option.dataset.memberId);
  };
  renderMemberSearchResults();

  container.querySelector('#confirm-add-btn').onclick = async () => {
    const btn = confirmAddBtn;
    const memberId = container.querySelector('#member-select').value;
    if (!memberId) {
      if (window.notify) window.notify.error('Select a member before adding to the group.');
      return;
    }
    const restoreButton = setButtonLoading(btn, 'Adding...');
    try {
      await memberService.update(memberId, { group: id, group_joined_at: new Date().toISOString() });
      group.member_count = (group.member_count || 0) + 1;
      await groupService.update(group.id, { member_count: group.member_count });
      await Promise.all([
        dataCache.invalidate('members:unassigned:v2'),
        dataCache.invalidatePrefix(`groups:profile:${id}:`)
      ]);
      modal.style.display = 'none';
      if (window.notify) window.notify.success('Member added successfully!');
      navigate(`#/groups/${id}?refresh=${Date.now()}`);
    } catch (err) {
      if (window.notify) window.notify.error('Error adding member: ' + err.message);
      restoreButton();
    }
  };

  const memberSearchInput = container.querySelector('#group-member-search');
  const accountScopeSelect = container.querySelector('#group-account-scope');
  const dateStartInput = container.querySelector('#global-date-start');
  const dateEndInput = container.querySelector('#global-date-end');
  const filterSummary = container.querySelector('#group-filter-summary');
  let currentMemberStatusFilter = 'all';
  let loanPage = 1, savingsPage = 1;
  const pageSize = 10;

  const getOwnerName = (record) => {
    if (record.member) return record.expand?.member?.full_name || 'Member';
    return group.name;
  };

  const getLoanRemarks = (loan) => loan.remarks || loan.purpose || '';

  const formatSavingsReference = (saving) => {
    const type = saving.type || 'deposit';
    const method = saving.payment_method || (type === 'withdrawal' ? 'cash' : 'mpesa');
    const reference = String(saving.reference || '');
    const methodLabel = method === 'mpesa' ? 'M-Pesa' : (method === 'bank' ? 'Bank' : (method === 'card' ? 'Card' : 'Cash'));
    const direction = type === 'withdrawal' ? 'Sent via' : 'Received via';
    const refPart = reference && reference !== 'N/A' && reference !== 'CASH' && !reference.startsWith('SAVE-D-') ? `: ${reference}` : '';
    return `${direction} ${methodLabel}${refPart}`;
  };

  const getFilteredMembers = () => {
    const query = (memberSearchInput?.value || '').trim().toLowerCase();
    const scope = accountScopeSelect?.value || 'all';
    return enrichedMembers.filter(m => {
      if (scope === 'groups') return false;
      if (currentStartDate || currentEndDate) {
        if (!m.lastSavingsDate) return false;
        const lastSaved = new Date(m.lastSavingsDate);
        if (Number.isNaN(lastSaved.getTime())) return false;
        if (currentStartDate && lastSaved < currentStartDate) return false;
        if (currentEndDate && lastSaved > currentEndDate) return false;
      }
      if (currentMemberStatusFilter === 'arrears' && getMemberArrears(m) <= 0) return false;
      if (currentMemberStatusFilter === 'inactive' && m.isActive) return false;
      if (!query) return true;
      return [m.full_name, m.reg_no, m.phone_number, m.phone]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query));
    });
  };
  const getFeeKpiMembers = () => {
    const query = (memberSearchInput?.value || '').trim().toLowerCase();
    const scope = accountScopeSelect?.value || 'all';
    if (scope === 'groups') return [];
    return enrichedMembers.filter(m => {
      if (isSuspendedMember(m)) return false;
      if (currentMemberStatusFilter === 'arrears' && getMemberArrears(m) <= 0) return false;
      if (currentMemberStatusFilter === 'inactive' && m.isActive) return false;
      if (!query) return true;
      return [m.full_name, m.reg_no, m.phone_number, m.phone]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query));
    });
  };

  const scopeIncludesGroupAccount = () => {
    const scope = accountScopeSelect?.value || 'all';
    const query = (memberSearchInput?.value || '').trim();
    if (scope === 'groups') return true;
    return currentMemberStatusFilter === 'all' && !query && scope === 'all';
  };

  const getMemberLoans = (member) => groupLoans.filter(l => l.member === member.id);
  const getMemberActiveLoanIds = (member) => new Set(
    getMemberLoans(member)
      .filter(isCollectibleLoan)
      .map(l => l.id)
  );
  const getMemberArrears = (member) => {
    const memberLoanIds = getMemberActiveLoanIds(member);
    return getArrearsTotal(allSchedules.filter(s => memberLoanIds.has(s.loan)));
  };
  const getMemberOlBalance = (member) => calculateOutstandingLoanBalance(getMemberLoans(member), allRepayments, allBalanceOffs);
  const getGroupLevelArrears = () => {
    const activeGroupLoanIds = new Set(
      groupLoans
        .filter(l => !l.member && isCollectibleLoan(l))
        .map(l => l.id)
    );
    return getArrearsTotal(allSchedules.filter(s => activeGroupLoanIds.has(s.loan)));
  };

  const applyDateFilters = (records, dateField) => records.filter(r => {
    if (!currentStartDate && !currentEndDate) return true;
    const d = new Date(r[dateField]);
    if (Number.isNaN(d.getTime())) return false;
    if (currentStartDate && d < currentStartDate) return false;
    if (currentEndDate && d > currentEndDate) return false;
    return true;
  });

  const recordMatchesScope = (record) => {
    const scope = accountScopeSelect?.value || 'all';
    if (scope === 'groups') return !record.member;
    if (!record.member) return scopeIncludesGroupAccount();
    if (!activeGroupMemberIds.has(record.member)) return false;
    const allowedMemberIds = new Set(getFilteredMembers().map(m => m.id));
    return allowedMemberIds.has(record.member);
  };
  const loanMatchesCurrentScope = (loan) => {
    if (!loan) return false;
    return recordMatchesScope(loan);
  };

  const getFilteredLoans = () => applyDateFilters(allFinancialLoansSorted.filter(recordMatchesScope), 'application_date');
  const getFilteredSavings = () => applyDateFilters(allFinancialSavingsSorted.filter(recordMatchesScope), 'date');
  const getFilteredRepayments = () => {
    const loansById = new Map(groupLoans.map(loan => [loan.id, loan]));
    return applyDateFilters(
      allRepayments.filter(repayment => loanMatchesCurrentScope(loansById.get(repayment.loan))),
      'date'
    );
  };

  const updateFilteredKpis = () => {
    const filteredMembers = getFilteredMembers().filter(member => !isSuspendedMember(member));
    const filteredLoans = getFilteredLoans();
    const filteredSavings = getFilteredSavings();
    const filteredRepayments = getFilteredRepayments();
    const scopedLoansForCurrentMonthCollections = allFinancialLoansSorted.filter(recordMatchesScope);
    const feeKpiMembers = getFeeKpiMembers();
    const includeGroupAccount = scopeIncludesGroupAccount();
    const arrearsAmount = filteredMembers.reduce((sum, m) => sum + getMemberArrears(m), 0) + (includeGroupAccount ? getGroupLevelArrears() : 0);
    const arrearsCount = filteredMembers.filter(m => getMemberArrears(m) > 0).length;
    const inactiveCount = filteredMembers.filter(m => !m.isActive).length;
    const savingsTotal = calculateSavingsTotal(filteredSavings);
    const savingsMovement = calculateSavingsMovement(filteredSavings);
    const outstandingLoan = calculateOutstandingLoanBalance(filteredLoans, allRepayments, allBalanceOffs);
    const filteredActiveLoanPortfolio = calculateActiveLoanPortfolio(filteredLoans);
    const parRate = filteredActiveLoanPortfolio > 0 ? (arrearsAmount / filteredActiveLoanPortfolio) * 100 : 0;
    const parHealth = getParHealth(parRate);
    const repaymentsTotal = calculateRepaymentsTotal(filteredRepayments);
    const feesTotal = calculateFeesTotal(feeKpiMembers, groupLoans);
    const thisMonthExpected = calculateThisMonthCollectionsExpected(scopedLoansForCurrentMonthCollections, allSchedules, allRepayments, allBalanceOffs);

    container.querySelector('#group-total-savings-kpi').textContent = `KES ${formatMoney(savingsTotal)}`;
    const savingsMovementKpi = container.querySelector('#group-savings-movement-kpi');
    if (savingsMovementKpi) {
      savingsMovementKpi.innerHTML = `
        <span style="color: var(--success); font-weight: 700;">DEP ${formatMoney(savingsMovement.deposits)}</span>
        <span style="color: var(--danger); font-weight: 700;">WIT ${formatMoney(savingsMovement.withdrawals)}</span>
      `;
    }
    container.querySelector('#group-outstanding-loan-kpi').textContent = `KES ${formatMoney(outstandingLoan)}`;
    container.querySelector('#group-total-repayments-kpi').textContent = `KES ${formatMoney(repaymentsTotal)}`;
    const thisMonthExpectedKpi = container.querySelector('#group-this-month-expected-kpi');
    if (thisMonthExpectedKpi) thisMonthExpectedKpi.textContent = `KES ${formatMoney(thisMonthExpected)}`;
    container.querySelector('#group-total-fees-kpi').textContent = `KES ${formatMoney(feesTotal)}`;
    container.querySelector('#group-total-members-kpi').textContent = filteredMembers.length;
    const totalArrearsKpi = container.querySelector('#group-total-arrears-kpi');
    totalArrearsKpi.textContent = `KES ${formatMoney(arrearsAmount)}`;
    totalArrearsKpi.style.color = arrearsAmount > 0 ? 'var(--danger)' : 'inherit';
    const parCard = container.querySelector('#group-par-card');
    const parKpi = container.querySelector('#group-par-kpi');
    const parHealthEl = container.querySelector('#group-par-health');
    if (parCard) parCard.style.borderLeftColor = parHealth.accent;
    if (parKpi) {
      parKpi.textContent = formatPercent(parRate);
      parKpi.style.color = parHealth.color;
    }
    if (parHealthEl) {
      parHealthEl.textContent = parHealth.label;
      parHealthEl.style.color = parHealth.color;
    }
    container.querySelector('#group-arrears-kpi').textContent = arrearsCount;
    container.querySelector('#group-inactive-members-kpi').innerHTML = `${inactiveCount} <span class="text-xs text-muted" style="font-weight:normal;">(>90 days)</span>`;

    const scope = accountScopeSelect?.value || 'all';
    const scopeLabel = scope === 'all' ? 'all members and group accounts' : (scope === 'members' ? 'all members' : 'group account');
    const dateLabel = currentStartDate || currentEndDate
      ? `, ${dateStartInput.value || 'start'} to ${dateEndInput.value || 'today'}`
      : '';
    if (filterSummary) filterSummary.textContent = `Showing ${scopeLabel}${dateLabel}. KPIs reflect this filter.`;
  };

  const refreshFilteredViews = () => {
    loanPage = 1;
    savingsPage = 1;
    renderMembersTable();
    updateGroupLoansUI();
    updateGroupSavingsUI();
    updateFilteredKpis();
  };

  // Members table
  const renderMembersTable = () => {
    const tbody = container.querySelector('#members-table-body');
    if (!tbody) return;
    const filtered = getFilteredMembers();

    tbody.innerHTML = filtered.length === 0 ? `<tr><td colspan="9" class="text-center text-muted" style="padding: 32px;">No members found matching this filter.</td></tr>` : filtered.map(m => {
      const totalArrears = getMemberArrears(m);
      const olBalance = getMemberOlBalance(m);
      return `
      <tr class="${isSuspendedMember(m) ? 'group-member-suspended' : ''}">
        <td><div class="font-semibold ${isSuspendedMember(m) ? 'group-member-suspended-identity' : ''}">${m.full_name}</div><div class="text-xs text-muted ${isSuspendedMember(m) ? 'group-member-suspended-identity' : ''}">${m.reg_no}</div></td>
        <td>${m.phone_number || m.phone || '-'}</td>
        <td class="font-semibold text-success">${formatMoney(m.totalSavings)}</td>
        <td class="font-semibold text-primary">${formatMoney(olBalance)}</td>
        <td class="font-semibold text-danger">${formatMoney(totalArrears)}</td>
        <td><span class="badge ${totalArrears > 0 ? 'badge-warning' : 'badge-outline'}" style="font-size: 0.65rem;">${totalArrears > 0 ? 'YES' : 'NO'}</span></td>
        <td><span class="badge ${isSuspendedMember(m) ? 'badge-warning' : (m.isActive ? 'badge-success' : 'badge-danger')}">${isSuspendedMember(m) ? 'SUSPENDED' : (m.isActive ? 'ACTIVE' : 'INACTIVE')}</span>${isSuspendedMember(m) ? '<div class="text-xs text-muted" style="margin-top:4px;">Excluded from portfolio</div>' : ''}</td>
        <td><span class="text-sm ${m.isActive ? 'text-muted' : 'text-danger font-semibold'}">${m.lastSavingsDate ? formatDate(m.lastSavingsDate) : 'Never'}</span></td>
        <td><div style="display:flex; gap:6px; flex-wrap:wrap;"><button class="btn btn-outline btn-sm" onclick="window.location.hash = '${withReturnTo(`#/members/${m.reg_no}`, groupProfileRoute)}'">View</button>${isSuspendedMember(m) && canManageLifecycle ? `<button type="button" class="btn btn-primary btn-sm group-member-reinstate-btn" data-id="${m.id}" data-name="${escapeHtml(m.full_name || 'Member')}">Reinstate</button>` : ''}</div></td>
      </tr>
    `;
    }).join('');

    tbody.querySelectorAll('.group-member-reinstate-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!canManageLifecycle) return;
        const confirmed = window.confirmDialog ? await window.confirmDialog({
          title: 'Reinstate Member',
          message: `Reinstate ${btn.dataset.name}? Their financial records will return to this group's active portfolio calculations.`,
          confirmText: 'Reinstate Member',
          cancelText: 'Cancel',
          type: 'info'
        }) : confirm(`Reinstate ${btn.dataset.name}?`);
        if (!confirmed) return;
        const restoreButton = setButtonLoading(btn, 'Reinstating...');
        try {
          await memberService.revive(btn.dataset.id);
          if (window.notify) window.notify.success('Member reinstated and returned to the group portfolio.');
          navigate(`#/groups/${id}?refresh=${Date.now()}`);
        } catch (err) {
          restoreButton();
          if (window.notify) window.notify.error('Failed to reinstate member: ' + (err.message || 'Please try again.'));
        }
      };
    });
  };

  const filterBtns = { all: container.querySelector('#filter-all-btn'), arrears: container.querySelector('#filter-arrears-btn'), inactive: container.querySelector('#filter-inactive-btn') };
  const updateActiveFilterBtn = (activeKey) => {
    Object.keys(filterBtns).forEach(key => {
      filterBtns[key].classList.toggle('btn-outline', key !== activeKey);
      filterBtns[key].classList.toggle('btn-primary', key === activeKey);
    });
  };
  if (filterBtns.all) {
    filterBtns.all.onclick = () => { currentMemberStatusFilter = 'all'; updateActiveFilterBtn('all'); refreshFilteredViews(); };
    filterBtns.arrears.onclick = () => { currentMemberStatusFilter = 'arrears'; updateActiveFilterBtn('arrears'); refreshFilteredViews(); };
    filterBtns.inactive.onclick = () => { currentMemberStatusFilter = 'inactive'; updateActiveFilterBtn('inactive'); refreshFilteredViews(); };
  }

  // Historical savings attendance: one completed saving per member per eligible meeting cycle.
  const ratingContainer = container.querySelector('#group-rating-container');
  ratingContainer.innerHTML = `
    <div style="display: flex; gap: 4px; font-size: 1.25rem; color: ${performanceColor};">
      ${[1, 2, 3, 4, 5].map(i => `<span>${i <= autoPerformanceRating ? '★' : '☆'}</span>`).join('')}
    </div>
    <div class="text-xs" style="margin-top: 4px; color: ${performanceColor}; font-weight: 700;">
      ${autoPerformanceRating}/5 — ${performanceLabels[autoPerformanceRating]}
    </div>
    <div class="text-xs text-muted" style="margin-top: 4px; line-height: 1.45;">
      ${savingsPerformance.savedParticipations}/${savingsPerformance.expectedParticipations} expected member savings completed across ${savingsPerformance.meetingCycles} meeting ${savingsPerformance.meetingCycles === 1 ? 'cycle' : 'cycles'}.
      <br>${formatPercent(savingsPerformance.participationRate)} historical participation${savingsPerformance.periodStart && savingsPerformance.periodEnd ? `, ${formatDate(savingsPerformance.periodStart)} to ${formatDate(savingsPerformance.periodEnd)}` : ''}.
      Excellent requires every eligible member to have saved in every meeting cycle.
    </div>
  `;
  if (canManageRecords && group.performance_rating !== autoPerformanceRating) {
    groupService.update(group.id, { performance_rating: autoPerformanceRating })
      .catch(err => console.warn('[GroupProfile] Auto performance rating save failed:', err.message));
  }

  const updateGroupLoansUI = () => {
    const filtered = getFilteredLoans();
    const start = (loanPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    const tbody = container.querySelector('#group-loans-body');
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="7" class="text-center text-muted">No table banking records found for this filter.</td></tr>' : paginated.map(l => `
      <tr>
        <td><strong>${l.loan_no}</strong></td>
        <td><div class="font-semibold">${getOwnerName(l)}</div><div class="text-xs text-muted">${l.member ? 'Member' : 'Group account'}</div></td>
        <td class="font-semibold text-danger">${formatMoney(calculateLoanBalance(l, allRepayments, allBalanceOffs))}</td>
        <td><span class="badge ${l.status === 'disbursed' ? 'badge-success' : (l.status === 'approved' || l.status === 'partial_approved') ? 'badge-primary' : l.status === 'pending' ? 'badge-warning' : 'badge-danger'}">${l.status.toUpperCase()}</span></td>
        <td>${formatDate(l.application_date)}</td>
        <td class="text-xs text-muted">${getLoanRemarks(l) || '-'}</td>
        <td><button class="btn btn-outline btn-xs" onclick="window.location.hash = '${withReturnTo(`#/loans/${l.loan_no}`, groupProfileRoute)}'">View</button></td>
      </tr>`).join('');
    const pag = container.querySelector('#group-loans-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, loanPage, (p) => { loanPage = p; updateGroupLoansUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateGroupSavingsUI = () => {
    const filtered = getFilteredSavings();
    const start = (savingsPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    const tbody = container.querySelector('#group-savings-body');
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="6" class="text-center text-muted">No savings found for this filter.</td></tr>' : paginated.map(s => `
      <tr>
        <td>${formatDate(s.date)}</td>
        <td><div class="font-semibold">${getOwnerName(s)}</div><div class="text-xs text-muted">${s.member ? 'Member' : 'Group account'}</div></td>
        <td><span class="badge" style="background: ${s.type === 'deposit' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type.toUpperCase()}</span></td>
        <td class="font-semibold" style="color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type === 'deposit' ? '+' : '-'}${formatMoney(s.amount)}</td>
        <td class="text-xs text-muted">${formatSavingsReference(s)}</td>
        <td class="text-xs text-muted">${s.remarks || '-'}</td>
      </tr>`).join('');
    const pag = container.querySelector('#group-savings-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, savingsPage, (p) => { savingsPage = p; updateGroupSavingsUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const syncDateFilter = () => {
    currentStartDate = dateStartInput.value ? new Date(dateStartInput.value) : null;
    currentEndDate = dateEndInput.value ? new Date(dateEndInput.value) : null;
    if (currentEndDate) currentEndDate.setHours(23, 59, 59, 999);
    refreshFilteredViews();
  };

  memberSearchInput.oninput = refreshFilteredViews;
  accountScopeSelect.onchange = refreshFilteredViews;
  dateStartInput.onchange = syncDateFilter;
  dateEndInput.onchange = syncDateFilter;
  container.querySelector('#clear-date-filter-btn').onclick = () => {
    memberSearchInput.value = '';
    accountScopeSelect.value = 'all';
    dateStartInput.value = ''; dateEndInput.value = '';
    currentStartDate = null; currentEndDate = null;
    currentMemberStatusFilter = 'all';
    updateActiveFilterBtn('all');
    refreshFilteredViews();
  };

  refreshFilteredViews();
  groupSummaryService.saveSnapshot(id, computedSummarySnapshot)
    .catch(err => console.warn('[GroupProfile] Could not save group summary snapshot:', err.message));

  // Real-time updates
  const fetchAndRenderMembers = async () => {
    try {
      const freshMembers = sortMembersByGroupJoinedAsc(await pb.collection('members').getFullList({
        filter: `group="${id}" && status!="closed"`,
        sort: 'group_joined_at,created',
        expand: 'group'
      }));
      // update count in UI
      const countEl = container.querySelector('#group-total-members-kpi');
      if (countEl) countEl.textContent = freshMembers.length;
      
      const membersTabBtn = container.querySelector('[data-tab="members"]');
      if (membersTabBtn) membersTabBtn.textContent = `Members (${freshMembers.length})`;
      
      // We don't do full enrichment here for performance, but we trigger table reload
      // This is a minimal update approach for real-time
    } catch(e) { console.warn('[GroupProfile] Members refresh:', e.message); }
  };

  const fetchAndRenderLoans = async () => {
    try {
      groupLoans = await pb.collection('loans').getFullList({
        filter: scopedGroupRecordFilter,
        sort: '-application_date',
        expand: 'member,member.group,group,processed_by'
      });
      const activeLoanIds = groupLoans
        .filter(isActiveMemberFinancialRecord)
        .filter(l => isCollectibleLoan(l) || ['completed', 'closed'].includes(l.status))
        .map(l => l.id);
      allRepayments = activeLoanIds.length > 0
        ? await pb.collection('loan_repayments').getFullList({
            filter: `loan.group="${id}" || loan.member.group="${id}"`,
            sort: '-date'
          })
        : [];
      allSchedules = activeLoanIds.length > 0
        ? await pb.collection('loan_schedule').getFullList({
            filter: `loan.group="${id}" || loan.member.group="${id}"`,
            sort: 'installment_no'
          })
        : [];
      allBalanceOffs = activeLoanIds.length > 0
        ? await loanService.getBalanceOffsFullList({
            filter: `loan.group="${id}" || loan.member.group="${id}"`,
            expand: ''
          })
        : [];
      await Promise.all([
        dataCache.set(`groups:profile:${id}:loans:v3`, groupLoans),
        dataCache.set(`groups:profile:${id}:repayments:v2`, allRepayments),
        dataCache.set(`groups:profile:${id}:schedule:v2`, allSchedules),
        dataCache.set(`groups:profile:${id}:balanceoffs:v1`, allBalanceOffs)
      ]);
      totalOutstandingLoan = calculateOutstandingLoanBalance(groupLoans.filter(isActiveMemberFinancialRecord), allRepayments, allBalanceOffs);
      allFinancialLoansSorted.length = 0;
      allFinancialLoansSorted.push(...groupLoans.sort((a, b) => new Date(b.application_date) - new Date(a.application_date)));
      refreshFilteredViews();
    } catch(e) {}
  };

  const fetchAndRenderSavings = async () => {
    try {
      groupSavings = await pb.collection('savings').getFullList({
        filter: scopedGroupRecordFilter,
        sort: '-date',
        expand: 'member,member.group,group,recorded_by'
      });
      await dataCache.set(`groups:profile:${id}:savings:v3`, groupSavings);
      allFinancialSavingsSorted.length = 0;
      allFinancialSavingsSorted.push(...groupSavings.sort((a, b) => new Date(b.date) - new Date(a.date)));
      totalGroupSavings = calculateSavingsTotal(groupSavings.filter(isActiveMemberFinancialRecord));
      refreshFilteredViews();
    } catch(e) {}
  };

  container.__subscriptionPromise = Promise.all([
    memberService.subscribeToChanges(fetchAndRenderMembers),
    loanService.subscribeToChanges(fetchAndRenderLoans),
    savingsService.subscribeToChanges(fetchAndRenderSavings)
  ]);

  })();
  return container;
};
