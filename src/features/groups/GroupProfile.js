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

  const activeLoansForProfile = groupLoans.filter(l => ['disbursed', 'completed', 'closed'].includes(l.status));
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

    const totalSavings = mSavings.filter(s => !s.is_reversed).reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);

    const activeLoans = mLoans.filter(l => ['disbursed', 'completed', 'closed'].includes(l.status));
    const totalLiability = activeLoans.reduce((sum, l) => sum + (l.total_liability || l.amount_applied * 1.1), 0);

    const memberLoanIds = new Set(activeLoans.map(l => l.id));
    const totalRepaid = allRepayments
      .filter(r => memberLoanIds.has(r.loan))
      .reduce((sum, r) => sum + r.amount, 0);
    const overdue = allSchedules.filter(s => memberLoanIds.has(s.loan) && s.status !== 'paid' && new Date(s.due_date) < new Date());
    const totalArrears = overdue.reduce((sum, s) => sum + s.amount, 0);

    const olBalance = Math.max(0, totalLiability - totalRepaid);
    const lastSavingsDate = mSavings.length > 0 ? new Date(Math.max(...mSavings.map(s => new Date(s.date)))) : null;
    const isActive = lastSavingsDate && (new Date() - lastSavingsDate <= 90 * 24 * 60 * 60 * 1000);

    return { ...m, totalSavings, olBalance, totalArrears, isActive, lastSavingsDate };
  });

  // Aggregate group savings
  const totalMemberSavings = enrichedMembers.reduce((sum, m) => sum + m.totalSavings, 0);
  const groupAccountSavings = groupSavings.filter(s => !s.member && !s.is_reversed).reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);
  const totalGroupSavings = totalMemberSavings + groupAccountSavings;

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

  // All unassigned members for add-member modal
  let unassignedMembers = [];
  try {
    unassignedMembers = await pb.collection('members').getFullList({ filter: `group=""||group=null` });
  } catch(e) { console.warn('[GroupProfile] Unassigned members fetch:', e.message); }

  const allGroupLoansSorted = groupLoans.filter(l => !l.member).sort((a, b) => new Date(b.application_date) - new Date(a.application_date));
  const groupOnlySavings = groupSavings.filter(s => !s.member).sort((a, b) => new Date(b.date) - new Date(a.date));

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
            <div class="text-lg font-semibold text-success">KES ${totalGroupSavings.toLocaleString()}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--danger);">
            <div class="text-xs text-muted">Outstanding Loan</div>
            <div class="text-lg font-semibold text-danger">KES ${(group.outstanding_loan || 0).toLocaleString()}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--primary);">
            <div class="text-xs text-muted">Total Members</div>
            <div class="text-lg font-semibold text-primary">${allGroupMembers.length}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid ${membersInArrearsCount > 0 ? 'var(--warning)' : 'var(--border-color)'};">
            <div class="text-xs text-muted">Members in Arrears</div>
            <div class="text-lg font-semibold" style="color: ${membersInArrearsCount > 0 ? 'var(--warning)' : 'inherit'};">${membersInArrearsCount} <span class="text-xs text-muted" style="font-weight:normal;">(KES ${totalGroupArrears.toLocaleString()})</span></div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid ${inactiveMembersCount > 0 ? 'var(--danger)' : 'var(--border-color)'};">
            <div class="text-xs text-muted">Inactive Members</div>
            <div class="text-lg font-semibold" style="color: ${inactiveMembersCount > 0 ? 'var(--danger)' : 'inherit'};">${inactiveMembersCount} <span class="text-xs text-muted" style="font-weight:normal;">(>90 days)</span></div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 24px; display: flex; align-items: center; gap: 16px; padding: 16px;">
          <h3 class="text-sm" style="margin: 0; min-width: max-content;">Date Filter:</h3>
          <input type="date" id="global-date-start" class="form-control" style="max-width: 200px;" />
          <span class="text-muted">to</span>
          <input type="date" id="global-date-end" class="form-control" style="max-width: 200px;" />
          <button class="btn btn-outline btn-sm" id="apply-date-filter-btn">Apply</button>
          <button class="btn btn-outline btn-sm" id="clear-date-filter-btn" style="border-color: transparent;">Clear</button>
        </div>

        <div class="card" style="padding: 0;">
          <div style="display: flex; border-bottom: 1px solid var(--border-color);">
            <button class="tab-btn active" data-tab="members">Members (${allGroupMembers.length})</button>
            <button class="tab-btn" data-tab="loans">Group Loans</button>
            <button class="tab-btn" data-tab="savings">Group Savings</button>
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
                  <thead><tr><th>Loan No</th><th>Amount</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
                  <tbody id="group-loans-body"></tbody>
                </table>
              </div>
              <div id="group-loans-pagination"></div>
            </div>
            <div id="savings-tab" style="display: none;">
              <div class="table-responsive">
                <table class="table">
                  <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Ref</th></tr></thead>
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

  // Members table
  const renderMembersTable = (filter = 'all') => {
    const tbody = container.querySelector('#members-table-body');
    if (!tbody) return;
    let filtered = enrichedMembers;
    if (filter === 'arrears') filtered = enrichedMembers.filter(m => m.totalArrears > 0);
    else if (filter === 'inactive') filtered = enrichedMembers.filter(m => !m.isActive);

    tbody.innerHTML = filtered.length === 0 ? `<tr><td colspan="9" class="text-center text-muted" style="padding: 32px;">No members found matching this filter.</td></tr>` : filtered.map(m => `
      <tr>
        <td><div class="font-semibold">${m.full_name}</div><div class="text-xs text-muted">${m.reg_no}</div></td>
        <td>${m.phone}</td>
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
    filterBtns.all.onclick = () => { updateActiveFilterBtn('all'); renderMembersTable('all'); };
    filterBtns.arrears.onclick = () => { updateActiveFilterBtn('arrears'); renderMembersTable('arrears'); };
    filterBtns.inactive.onclick = () => { updateActiveFilterBtn('inactive'); renderMembersTable('inactive'); };
    renderMembersTable('all');
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

  // Date filtering for loans & savings tabs
  const dateStartInput = container.querySelector('#global-date-start');
  const dateEndInput = container.querySelector('#global-date-end');
  let currentStartDate = null, currentEndDate = null;
  let loanPage = 1, savingsPage = 1;
  const pageSize = 10;

  const applyDateFilters = (records, dateField) => records.filter(r => {
    if (!currentStartDate && !currentEndDate) return true;
    const d = new Date(r[dateField]);
    if (currentStartDate && d < currentStartDate) return false;
    if (currentEndDate && d > currentEndDate) return false;
    return true;
  });

  const updateGroupLoansUI = () => {
    const filtered = applyDateFilters(allGroupLoansSorted, 'application_date');
    const start = (loanPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    const tbody = container.querySelector('#group-loans-body');
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="5" class="text-center text-muted">No group loans found.</td></tr>' : paginated.map(l => `
      <tr>
        <td><strong>${l.loan_no}</strong></td>
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
    const filtered = applyDateFilters(groupOnlySavings, 'date');
    const start = (savingsPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    const tbody = container.querySelector('#group-savings-body');
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No group savings found.</td></tr>' : paginated.map(s => `
      <tr>
        <td>${formatDate(s.date)}</td>
        <td><span class="badge" style="background: ${s.type === 'deposit' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type.toUpperCase()}</span></td>
        <td class="font-semibold" style="color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type === 'deposit' ? '+' : '-'}${s.amount.toLocaleString()}</td>
        <td class="text-xs text-muted">${s.reference || '-'}</td>
      </tr>`).join('');
    const pag = container.querySelector('#group-savings-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, savingsPage, (p) => { savingsPage = p; updateGroupSavingsUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  container.querySelector('#apply-date-filter-btn').onclick = () => {
    currentStartDate = dateStartInput.value ? new Date(dateStartInput.value) : null;
    currentEndDate = dateEndInput.value ? new Date(dateEndInput.value) : null;
    if (currentEndDate) currentEndDate.setHours(23, 59, 59, 999);
    loanPage = 1; savingsPage = 1;
    updateGroupLoansUI(); updateGroupSavingsUI();
  };

  container.querySelector('#clear-date-filter-btn').onclick = () => {
    dateStartInput.value = ''; dateEndInput.value = '';
    currentStartDate = null; currentEndDate = null;
    loanPage = 1; savingsPage = 1;
    updateGroupLoansUI(); updateGroupSavingsUI();
  };

  updateGroupLoansUI();
  updateGroupSavingsUI();

  // Real-time updates
  const fetchAndRenderMembers = async () => {
    try {
      const freshMembers = await pb.collection('members').getFullList({ filter: `group="${id}"`, expand: 'group' });
      // update count in UI
      const countEl = container.querySelector('.text-primary');
      if (countEl && countEl.previousElementSibling.textContent === 'Total Members') countEl.textContent = freshMembers.length;
      
      const membersTabBtn = container.querySelector('[data-tab="members"]');
      if (membersTabBtn) membersTabBtn.textContent = `Members (${freshMembers.length})`;
      
      // We don't do full enrichment here for performance, but we trigger table reload
      // This is a minimal update approach for real-time
    } catch(e) { console.warn('[GroupProfile] Members refresh:', e.message); }
  };

  const fetchAndRenderLoans = async () => {
    try {
      groupLoans = await loanService.getByGroup(id);
      allGroupLoansSorted.length = 0;
      allGroupLoansSorted.push(...groupLoans.filter(l => !l.member).sort((a, b) => new Date(b.application_date) - new Date(a.application_date)));
      updateGroupLoansUI();
    } catch(e) {}
  };

  const fetchAndRenderSavings = async () => {
    try {
      groupSavings = await savingsService.getByGroup(id);
      groupOnlySavings.length = 0;
      groupOnlySavings.push(...groupSavings.filter(s => !s.member).sort((a, b) => new Date(b.date) - new Date(a.date)));
      updateGroupSavingsUI();
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
