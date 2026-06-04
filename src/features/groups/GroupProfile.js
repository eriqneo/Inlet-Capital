import { groupService } from '../../services/groupService.js';
import { memberService } from '../../services/memberService.js';
import { loanService } from '../../services/loanService.js';
import { savingsService } from '../../services/savingsService.js';
import { authService } from '../../services/authService.js';
import { navigate } from '../../core/router.js';
import { formatDate } from '../../core/utils.js';
import { renderPagination } from '../../components/Pagination.js';
import { pb } from '../../services/api.js';
import { setButtonLoading } from '../../core/uiState.js';

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
  try {
    group = await groupService.getById(id);
  } catch (err) {
    container.innerHTML = `<div class="card text-center"><h2>Group Not Found</h2><button class="btn btn-primary" onclick="window.location.hash = '#/groups'">Back to List</button></div>`;
    return;
  }

  const relationFilter = (field, ids) => ids.map(itemId => `${field}="${itemId}"`).join(' || ');
  const calculateSavingsTotal = (records) => records
    .filter(s => !s.is_reversed)
    .reduce((sum, s) => {
      const amount = Number(s.amount) || 0;
      return s.type === 'deposit' ? sum + amount : sum - amount;
    }, 0);
  const isOutstandingLoanStatus = (status) => ['disbursed', 'approved', 'partial_approved'].includes(status);
  const calculateOutstandingLoanBalance = (loans, repayments) => loans
    .filter(l => isOutstandingLoanStatus(l.status))
    .reduce((sum, loan) => {
      const principal = Number(loan.approved_amount || loan.amount_applied) || 0;
      const liability = Number(loan.total_liability) || (principal + (Number(loan.interest_amount) || 0));
      const paid = repayments
        .filter(r => r.loan === loan.id)
        .reduce((repaymentSum, r) => repaymentSum + (Number(r.amount) || 0), 0);
      return sum + Math.max(0, liability - paid);
    }, 0);

  // Fetch live group data in batches. This avoids a per-member/per-loan network waterfall.
  let allGroupMembers = [], groupLoans = [], groupSavings = [], allRepayments = [], allSchedules = [];
  try {
    allGroupMembers = await pb.collection('members').getFullList({ filter: `group="${id}"`, expand: 'group' });
  } catch (e) { console.warn('[GroupProfile] Batch profile fetch:', e.message); }

  const memberIds = allGroupMembers.map(m => m.id);
  const memberLoanFilter = memberIds.length > 0 ? ` || ${relationFilter('member', memberIds)}` : '';
  const memberSavingsFilter = memberIds.length > 0 ? ` || ${relationFilter('member', memberIds)}` : '';

  try {
    [groupLoans, groupSavings] = await Promise.all([
      pb.collection('loans').getFullList({
        filter: `group="${id}"${memberLoanFilter}`,
        sort: '-application_date',
        expand: 'member,group,processed_by'
      }),
      pb.collection('savings').getFullList({
        filter: `group="${id}"${memberSavingsFilter}`,
        sort: '-date',
        expand: 'member,group,recorded_by'
      })
    ]);
  } catch (e) { console.warn('[GroupProfile] Batch loans/savings fetch:', e.message); }

  const activeLoansForProfile = groupLoans.filter(l => ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(l.status));
  const activeLoanIds = new Set(activeLoansForProfile.map(l => l.id));

  if (activeLoanIds.size > 0) {
    try {
      [allRepayments, allSchedules] = await Promise.all([
        pb.collection('loan_repayments').getFullList({
          filter: Array.from(activeLoanIds).map(loanId => `loan="${loanId}"`).join(' || '),
          sort: '-date'
        }),
        pb.collection('loan_schedule').getFullList({
          filter: Array.from(activeLoanIds).map(loanId => `loan="${loanId}"`).join(' || '),
          sort: 'installment_no'
        })
      ]);
    } catch (e) { console.warn('[GroupProfile] Batch repayment/schedule fetch:', e.message); }
  }

  // For each member, fetch their savings/loans for the enriched table
  let totalGroupArrears = 0;
  let membersInArrearsCount = 0;
  let inactiveMembersCount = 0;

  const enrichedMembers = allGroupMembers.map((m) => {
    const mSavings = groupSavings.filter(s => s.member === m.id);
    const mLoans = groupLoans.filter(l => l.member === m.id);

    const totalSavings = calculateSavingsTotal(mSavings);

    const activeLoans = mLoans.filter(l => ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(l.status));
    const memberLoanIds = new Set(activeLoans.map(l => l.id));
    const overdue = allSchedules.filter(s => memberLoanIds.has(s.loan) && s.status !== 'paid' && new Date(s.due_date) < new Date());
    const totalArrears = overdue.reduce((sum, s) => sum + s.amount, 0);

    const olBalance = calculateOutstandingLoanBalance(mLoans, allRepayments);
    const lastSavingsDate = mSavings.length > 0 ? new Date(Math.max(...mSavings.map(s => new Date(s.date)))) : null;
    const isActive = lastSavingsDate && (new Date() - lastSavingsDate <= 90 * 24 * 60 * 60 * 1000);

    return { ...m, totalSavings, olBalance, totalArrears, isActive, lastSavingsDate };
  });

  // Aggregate group savings
  const totalMemberSavings = enrichedMembers.reduce((sum, m) => sum + m.totalSavings, 0);
  const groupAccountSavings = calculateSavingsTotal(groupSavings.filter(s => !s.member));
  let totalGroupSavings = totalMemberSavings + groupAccountSavings;

  // Group-level loan arrears
  const activeGroupLoans = groupLoans.filter(l => !l.member && ['disbursed', 'completed', 'closed'].includes(l.status));
  const activeGroupLoanIds = new Set(activeGroupLoans.map(gl => gl.id));
  const groupLevelArrears = allSchedules
    .filter(s => activeGroupLoanIds.has(s.loan) && s.status !== 'paid' && new Date(s.due_date) < new Date())
    .reduce((sum, s) => sum + s.amount, 0);
  totalGroupArrears += groupLevelArrears;

  // Calculate totals from enrichedMembers
  for (const m of enrichedMembers) {
    totalGroupArrears += m.totalArrears;
    if (m.totalArrears > 0) membersInArrearsCount++;
    if (!m.isActive) inactiveMembersCount++;
  }
  let totalOutstandingLoan = calculateOutstandingLoanBalance(groupLoans, allRepayments);

  // All unassigned members for add-member modal
  let unassignedMembers = [];
  try {
    unassignedMembers = await pb.collection('members').getFullList({ filter: `group=""||group=null` });
  } catch(e) { console.warn('[GroupProfile] Unassigned members fetch:', e.message); }

  const allFinancialLoansSorted = groupLoans.sort((a, b) => new Date(b.application_date) - new Date(a.application_date));
  const allFinancialSavingsSorted = groupSavings.sort((a, b) => new Date(b.date) - new Date(a.date));

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/groups'">← Back</button>
        <h1 class="text-xl">${group.name}</h1>
      </div>
      <div style="display: flex; gap: 12px;">
        <button class="btn btn-outline btn-sm" id="add-member-btn">+ Add Member</button>
        <button class="btn btn-secondary btn-sm" onclick="window.location.hash = '#/loans/new?groupId=${id}'">Apply for Group Loan</button>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 300px; gap: 24px;">
      <div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <div class="card" style="padding: 16px; border-left: 3px solid var(--success);">
            <div class="text-xs text-muted">Total Savings</div>
            <div class="text-lg font-semibold text-success" id="group-total-savings-kpi">KES ${totalGroupSavings.toLocaleString()}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--danger);">
            <div class="text-xs text-muted">Outstanding Loan</div>
            <div class="text-lg font-semibold text-danger" id="group-outstanding-loan-kpi">KES ${totalOutstandingLoan.toLocaleString()}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--primary);">
            <div class="text-xs text-muted">Total Members</div>
            <div class="text-lg font-semibold text-primary" id="group-total-members-kpi">${allGroupMembers.length}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid ${membersInArrearsCount > 0 ? 'var(--warning)' : 'var(--border-color)'};">
            <div class="text-xs text-muted">Members in Arrears</div>
            <div class="text-lg font-semibold" id="group-arrears-kpi" style="color: ${membersInArrearsCount > 0 ? 'var(--warning)' : 'inherit'};">${membersInArrearsCount} <span class="text-xs text-muted" style="font-weight:normal;">(KES ${totalGroupArrears.toLocaleString()})</span></div>
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
                <option value="groups">All Groups</option>
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
            <button class="tab-btn" data-tab="loans">Loans</button>
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
                  <thead><tr><th>Loan No</th><th>Owner</th><th>Amount</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
                  <tbody id="group-loans-body"></tbody>
                </table>
              </div>
              <div id="group-loans-pagination"></div>
            </div>
            <div id="savings-tab" style="display: none;">
              <div class="table-responsive">
                <table class="table">
                  <thead><tr><th>Date</th><th>Owner</th><th>Type</th><th>Amount</th><th>Ref</th></tr></thead>
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
          <div style="margin-bottom: 12px;"><div class="text-xs text-muted">Performance Rating</div><div id="group-rating-container" style="margin-top: 4px;"></div></div>
        </div>
      </div>
    </div>

    <div id="add-member-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 500px;">
        <h3 style="margin-bottom: 16px;">Add Member to Group</h3>
        <p class="text-sm text-muted" style="margin-bottom: 24px;">Select a registered individual to join ${group.name}.</p>
        <div class="form-group">
          <label class="form-label">Search Member</label>
          <select id="member-select" class="form-control">
            <option value="">Select a member...</option>
            ${unassignedMembers.map(m => `<option value="${m.id}">${m.full_name} (${m.reg_no})</option>`).join('')}
          </select>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px;">
          <button class="btn btn-outline" id="close-modal-btn">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-btn">Add to Group</button>
        </div>
      </div>
    </div>

    <style>
      .tab-btn { flex: 1; padding: 16px; background: transparent; border: none; font-family: 'Inter', sans-serif; font-weight: 600; cursor: pointer; color: var(--text-muted); border-bottom: 2px solid transparent; }
      .tab-btn.active { color: var(--primary); border-bottom-color: var(--secondary); background: rgba(27, 61, 114, 0.02); }
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
  container.querySelector('#add-member-btn').onclick = () => modal.style.display = 'flex';
  container.querySelector('#close-modal-btn').onclick = () => modal.style.display = 'none';

  container.querySelector('#confirm-add-btn').onclick = async () => {
    const btn = container.querySelector('#confirm-add-btn');
    const memberId = container.querySelector('#member-select').value;
    if (!memberId) return;
    const restoreButton = setButtonLoading(btn, 'Adding...');
    try {
      await memberService.update(memberId, { group: id });
      group.member_count = (group.member_count || 0) + 1;
      await groupService.update(group.id, { member_count: group.member_count });
      modal.style.display = 'none';
      if (window.notify) window.notify.success('Member added successfully!');
      navigate(`#/groups/${id}`);
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
  let currentStartDate = null, currentEndDate = null;
  let loanPage = 1, savingsPage = 1;
  const pageSize = 10;

  const getOwnerName = (record) => {
    if (record.member) return record.expand?.member?.full_name || 'Member';
    return group.name;
  };

  const getFilteredMembers = () => {
    const query = (memberSearchInput?.value || '').trim().toLowerCase();
    const scope = accountScopeSelect?.value || 'all';
    return enrichedMembers.filter(m => {
      if (scope === 'groups') return false;
      if (currentMemberStatusFilter === 'arrears' && m.totalArrears <= 0) return false;
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
    const allowedMemberIds = new Set(getFilteredMembers().map(m => m.id));
    return allowedMemberIds.has(record.member);
  };

  const getFilteredLoans = () => applyDateFilters(allFinancialLoansSorted.filter(recordMatchesScope), 'application_date');
  const getFilteredSavings = () => applyDateFilters(allFinancialSavingsSorted.filter(recordMatchesScope), 'date');

  const updateFilteredKpis = () => {
    const filteredMembers = getFilteredMembers();
    const filteredLoans = getFilteredLoans();
    const filteredSavings = getFilteredSavings();
    const includeGroupAccount = scopeIncludesGroupAccount();
    const arrearsAmount = filteredMembers.reduce((sum, m) => sum + (Number(m.totalArrears) || 0), 0) + (includeGroupAccount ? groupLevelArrears : 0);
    const arrearsCount = filteredMembers.filter(m => m.totalArrears > 0).length;
    const inactiveCount = filteredMembers.filter(m => !m.isActive).length;
    const savingsTotal = calculateSavingsTotal(filteredSavings);
    const outstandingLoan = calculateOutstandingLoanBalance(filteredLoans, allRepayments);

    container.querySelector('#group-total-savings-kpi').textContent = `KES ${savingsTotal.toLocaleString()}`;
    container.querySelector('#group-outstanding-loan-kpi').textContent = `KES ${outstandingLoan.toLocaleString()}`;
    container.querySelector('#group-total-members-kpi').textContent = filteredMembers.length;
    container.querySelector('#group-arrears-kpi').innerHTML = `${arrearsCount} <span class="text-xs text-muted" style="font-weight:normal;">(KES ${arrearsAmount.toLocaleString()})</span>`;
    container.querySelector('#group-inactive-members-kpi').innerHTML = `${inactiveCount} <span class="text-xs text-muted" style="font-weight:normal;">(>90 days)</span>`;

    const scope = accountScopeSelect?.value || 'all';
    const scopeLabel = scope === 'all' ? 'all members and group accounts' : (scope === 'members' ? 'all members' : 'all groups');
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

    tbody.innerHTML = filtered.length === 0 ? `<tr><td colspan="9" class="text-center text-muted" style="padding: 32px;">No members found matching this filter.</td></tr>` : filtered.map(m => `
      <tr>
        <td><div class="font-semibold">${m.full_name}</div><div class="text-xs text-muted">${m.reg_no}</div></td>
        <td>${m.phone_number || m.phone || '-'}</td>
        <td class="font-semibold text-success">KES ${m.totalSavings.toLocaleString()}</td>
        <td class="font-semibold text-primary">KES ${m.olBalance.toLocaleString()}</td>
        <td class="font-semibold text-danger">KES ${m.totalArrears.toLocaleString()}</td>
        <td><span class="badge ${m.totalArrears > 0 ? 'badge-warning' : 'badge-outline'}" style="font-size: 0.65rem;">${m.totalArrears > 0 ? 'YES' : 'NO'}</span></td>
        <td><span class="badge ${m.isActive ? 'badge-success' : 'badge-danger'}">${m.isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
        <td><span class="text-sm ${m.isActive ? 'text-muted' : 'text-danger font-semibold'}">${m.lastSavingsDate ? formatDate(m.lastSavingsDate) : 'Never'}</span></td>
        <td><button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/members/${m.reg_no}'">View</button></td>
      </tr>
    `).join('');
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

  // Rating logic
  const user = authService.getUser();
  const isAdmin = user && user.role === 'admin';
  const ratingContainer = container.querySelector('#group-rating-container');
  const ratingLabels = { 1: 'Very Poor', 2: 'Poor', 3: 'Fair', 4: 'Very Good', 5: 'Excellent' };

  ratingContainer.innerHTML = `
    <div id="stars-wrapper" style="display: flex; gap: 4px; font-size: 1.25rem;">
      ${[1, 2, 3, 4, 5].map(i => `<span class="rating-star" data-val="${i}" style="transition: color 0.2s; cursor: ${isAdmin ? 'pointer' : 'default'};"></span>`).join('')}
    </div>
    <div id="rating-label-wrapper"></div>
  `;

  const starsWrapper = ratingContainer.querySelector('#stars-wrapper');
  const labelWrapper = ratingContainer.querySelector('#rating-label-wrapper');
  const stars = starsWrapper.querySelectorAll('.rating-star');

  const updateRatingUI = (currentHover = 0) => {
    const ratingValue = group.performance_rating || 0;
    const activeRating = currentHover > 0 ? currentHover : ratingValue;
    stars.forEach(star => {
      const val = parseInt(star.dataset.val);
      star.style.color = val <= activeRating ? 'var(--primary)' : 'var(--secondary)';
      star.textContent = val <= activeRating ? '★' : '☆';
    });
    let labelHtml = ratingValue > 0
      ? `<div class="text-xs" style="margin-top: 4px; color: var(--text-color); font-weight: 500;">${ratingValue}/5 — ${ratingLabels[ratingValue]}</div>`
      : `<div class="text-xs text-muted" style="margin-top: 4px; font-style: italic;">Not yet rated</div>`;
    if (isAdmin && ratingValue === 0 && currentHover === 0) labelHtml += `<div class="text-xs text-muted" style="margin-top: 2px;">(Click to rate)</div>`;
    labelWrapper.innerHTML = labelHtml;
  };

  if (isAdmin) {
    stars.forEach(star => {
      const val = parseInt(star.dataset.val);
      star.onmouseenter = () => updateRatingUI(val);
      star.onmouseleave = () => updateRatingUI(0);
      star.onclick = async () => {
        group.performance_rating = val;
        starsWrapper.style.pointerEvents = 'none';
        labelWrapper.innerHTML = `<div class="text-xs text-muted" style="margin-top: 4px;">Saving rating...</div>`;
        try { await groupService.update(group.id, { performance_rating: val }); if (window.notify) window.notify.success('Group rating updated!'); updateRatingUI(0); }
        catch (err) { if (window.notify) window.notify.error('Error saving rating'); updateRatingUI(0); }
        finally { starsWrapper.style.pointerEvents = 'auto'; }
      };
    });
  }
  updateRatingUI();

  const updateGroupLoansUI = () => {
    const filtered = getFilteredLoans();
    const start = (loanPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    const tbody = container.querySelector('#group-loans-body');
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="6" class="text-center text-muted">No loans found for this filter.</td></tr>' : paginated.map(l => `
      <tr>
        <td><strong>${l.loan_no}</strong></td>
        <td><div class="font-semibold">${getOwnerName(l)}</div><div class="text-xs text-muted">${l.member ? 'Member' : 'Group account'}</div></td>
        <td>KES ${(l.amount_applied || 0).toLocaleString()}</td>
        <td><span class="badge ${l.status === 'disbursed' ? 'badge-success' : (l.status === 'approved' || l.status === 'partial_approved') ? 'badge-primary' : l.status === 'pending' ? 'badge-warning' : 'badge-danger'}">${l.status.toUpperCase()}</span></td>
        <td>${formatDate(l.application_date)}</td>
        <td><button class="btn btn-outline btn-xs" onclick="window.location.hash = '#/loans/${l.loan_no}'">View</button></td>
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
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="5" class="text-center text-muted">No savings found for this filter.</td></tr>' : paginated.map(s => `
      <tr>
        <td>${formatDate(s.date)}</td>
        <td><div class="font-semibold">${getOwnerName(s)}</div><div class="text-xs text-muted">${s.member ? 'Member' : 'Group account'}</div></td>
        <td><span class="badge" style="background: ${s.type === 'deposit' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type.toUpperCase()}</span></td>
        <td class="font-semibold" style="color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type === 'deposit' ? '+' : '-'}${s.amount.toLocaleString()}</td>
        <td class="text-xs text-muted">${s.reference || '-'}</td>
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

  // Real-time updates
  const fetchAndRenderMembers = async () => {
    try {
      const freshMembers = await pb.collection('members').getFullList({ filter: `group="${id}"`, expand: 'group' });
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
      const memberIds = allGroupMembers.map(m => m.id);
      const memberLoanFilter = memberIds.length > 0 ? ` || ${relationFilter('member', memberIds)}` : '';
      groupLoans = await pb.collection('loans').getFullList({
        filter: `group="${id}"${memberLoanFilter}`,
        sort: '-application_date',
        expand: 'member,group,processed_by'
      });
      const loanIds = groupLoans.map(l => l.id);
      allRepayments = loanIds.length > 0
        ? await pb.collection('loan_repayments').getFullList({
            filter: loanIds.map(loanId => `loan="${loanId}"`).join(' || '),
            sort: '-date'
          })
        : [];
      totalOutstandingLoan = calculateOutstandingLoanBalance(groupLoans, allRepayments);
      allFinancialLoansSorted.length = 0;
      allFinancialLoansSorted.push(...groupLoans.sort((a, b) => new Date(b.application_date) - new Date(a.application_date)));
      refreshFilteredViews();
    } catch(e) {}
  };

  const fetchAndRenderSavings = async () => {
    try {
      const memberIds = allGroupMembers.map(m => m.id);
      const memberSavingsFilter = memberIds.length > 0 ? ` || ${relationFilter('member', memberIds)}` : '';
      groupSavings = await pb.collection('savings').getFullList({
        filter: `group="${id}"${memberSavingsFilter}`,
        sort: '-date',
        expand: 'member,group,recorded_by'
      });
      allFinancialSavingsSorted.length = 0;
      allFinancialSavingsSorted.push(...groupSavings.sort((a, b) => new Date(b.date) - new Date(a.date)));
      totalGroupSavings = calculateSavingsTotal(groupSavings);
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
