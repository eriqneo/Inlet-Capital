import { getById, getAll, add, put } from '../../core/db.js';
import { navigate } from '../../core/router.js';
import { formatDate } from '../../core/utils.js';
import { getSession } from '../../core/auth.js';

export const renderGroupProfile = async (params) => {
  const { id } = params;
  const group = await getById('groups', id);
  
  if (!group) {
    const el = document.createElement('div');
    el.innerHTML = `<div class="card text-center"><h2>Group Not Found</h2><button class="btn btn-primary" onclick="window.location.hash = '#/groups'">Back to List</button></div>`;
    return el;
  }

  // Get all data for calculations
  const [allMembers, allSavings, allLoans, allRepayments, allSchedules] = await Promise.all([
    getAll('members'),
    getAll('savings'),
    getAll('loans'),
    getAll('loan_repayments'),
    getAll('loan_schedule')
  ]);
  
  const groupMembers = allMembers.filter(m => m.groupId === id);

  // Calculate aggregated stats
  let totalGroupArrears = 0;
  let membersInArrearsCount = 0;
  let inactiveMembersCount = 0;

  const enrichedMembers = groupMembers.map(m => {
    const mSavings = allSavings.filter(s => s.memberId === m.regNo);
    const totalSavings = mSavings.reduce((sum, s) => sum + s.amount, 0);
    
    const mLoans = allLoans.filter(l => l.memberId === m.regNo && (['disbursed', 'completed', 'closed'].includes(l.status)));
    const totalLiability = mLoans.reduce((sum, l) => sum + (l.totalLiability || l.amountApplied * 1.1), 0);
    const totalRepaid = allRepayments.filter(r => r.memberId === m.regNo && mLoans.some(ml => ml.loanNo === r.loanNo)).reduce((sum, r) => sum + r.amount, 0);
    const olBalance = Math.max(0, totalLiability - totalRepaid);
    
    const mSchedules = allSchedules.filter(s => mLoans.some(ml => ml.loanNo === s.loanId) && s.status !== 'paid' && new Date(s.dueDate) < new Date());
    const totalArrears = mSchedules.reduce((sum, s) => sum + s.amount, 0);
    
    const lastSavingsDate = mSavings.length > 0 ? new Date(Math.max(...mSavings.map(s => new Date(s.date)))) : null;
    const isActive = lastSavingsDate && (new Date() - lastSavingsDate <= 90 * 24 * 60 * 60 * 1000);

    totalGroupArrears += totalArrears;
    if (totalArrears > 0) membersInArrearsCount++;
    if (!isActive) inactiveMembersCount++;

    return {
      ...m,
      totalSavings,
      olBalance,
      totalArrears,
      isActive,
      lastSavingsDate
    };
  });

  // Aggregate member savings + group account savings
  const totalMemberSavings = enrichedMembers.reduce((sum, m) => sum + m.totalSavings, 0);
  const groupAccountSavings = allSavings.filter(s => s.groupId === id && !s.memberId).reduce((sum, s) => sum + s.amount, 0);
  const totalGroupSavings = totalMemberSavings + groupAccountSavings;

  // Aggregate group-level loan arrears
  const groupLoans = allLoans.filter(l => l.groupId === id && !l.memberId && (['disbursed', 'completed', 'closed'].includes(l.status)));
  const groupSchedules = allSchedules.filter(s => groupLoans.some(gl => gl.loanNo === s.loanId) && s.status !== 'paid' && new Date(s.dueDate) < new Date());
  const groupLevelArrears = groupSchedules.reduce((sum, s) => sum + s.amount, 0);
  totalGroupArrears += groupLevelArrears;

  const container = document.createElement('div');
  
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
      <!-- Main Content -->
      <div>
        <!-- Stats Row -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <div class="card" style="padding: 16px; border-left: 3px solid var(--success);">
            <div class="text-xs text-muted">Total Savings</div>
            <div class="text-lg font-semibold text-success">KES ${totalGroupSavings.toLocaleString()}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--danger);">
            <div class="text-xs text-muted">Outstanding Loan</div>
            <div class="text-lg font-semibold text-danger">KES ${(group.outstandingLoan || 0).toLocaleString()}</div>
          </div>
          <div class="card" style="padding: 16px; border-left: 3px solid var(--primary);">
            <div class="text-xs text-muted">Total Members</div>
            <div class="text-lg font-semibold text-primary">${groupMembers.length}</div>
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

        <!-- Tabs -->
        <div class="card" style="padding: 0;">
          <div style="display: flex; border-bottom: 1px solid var(--border-color);">
            <button class="tab-btn active" data-tab="members">Members (${groupMembers.length})</button>
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
                      <th>Name</th>
                      <th>Phone</th>
                      <th>A.Savings <span title="Accumulated Savings" style="cursor:help;">ⓘ</span></th>
                      <th>OL Balance</th>
                      <th>Arrears</th>
                      <th>In Arrears</th>
                      <th>Status</th>
                      <th>Last Saved</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody id="members-table-body">
                  </tbody>
                </table>
              </div>
            </div>
            <div id="loans-tab" style="display: none;">
              <p class="text-muted text-center">No group loans yet.</p>
            </div>
            <div id="savings-tab" style="display: none;">
              <p class="text-muted text-center">No group savings recorded yet.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Group Details Sidebar -->
      <div>
        <div class="card">
          <h3 style="font-size: 1rem; margin-bottom: 16px;">Group Info</h3>
          <div style="margin-bottom: 12px;">
            <div class="text-xs text-muted">Meeting Day</div>
            <div>${group.meetingDay}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div class="text-xs text-muted">Location</div>
            <div>${group.location}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div class="text-xs text-muted">Registration Date</div>
            <div>${formatDate(group.registrationDate)}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div class="text-xs text-muted">Phone</div>
            <div>${group.phone}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div class="text-xs text-muted">Performance Rating</div>
            <div id="group-rating-container" style="margin-top: 4px;"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Member Modal Overlay -->
    <div id="add-member-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 500px;">
        <h3 style="margin-bottom: 16px;">Add Member to Group</h3>
        <p class="text-sm text-muted" style="margin-bottom: 24px;">Select a registered individual to join ${group.name}.</p>
        
        <div class="form-group">
          <label class="form-label">Search Member</label>
          <select id="member-select" class="form-control">
            <option value="">Select a member...</option>
            ${allMembers.filter(m => !m.groupId).map(m => `
              <option value="${m.regNo}">${m.fullName} (${m.regNo})</option>
            `).join('')}
          </select>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px;">
          <button class="btn btn-outline" id="close-modal-btn">Cancel</button>
          <button class="btn btn-primary" id="confirm-add-btn">Add to Group</button>
        </div>
      </div>
    </div>

    <style>
      .tab-btn {
        flex: 1;
        padding: 16px;
        background: transparent;
        border: none;
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        cursor: pointer;
        color: var(--text-muted);
        border-bottom: 2px solid transparent;
      }
      .tab-btn.active {
        color: var(--primary);
        border-bottom-color: var(--secondary);
        background: rgba(27, 61, 114, 0.02);
      }
    </style>
  `;

  // Tab switching logic
  const tabs = container.querySelectorAll('.tab-btn');
  const contents = {
    members: container.querySelector('#members-tab'),
    loans: container.querySelector('#loans-tab'),
    savings: container.querySelector('#savings-tab')
  };

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
  const addBtn = container.querySelector('#add-member-btn');
  const closeBtn = container.querySelector('#close-modal-btn');
  const confirmBtn = container.querySelector('#confirm-add-btn');
  const memberSelect = container.querySelector('#member-select');

  addBtn.onclick = () => modal.style.display = 'flex';
  closeBtn.onclick = () => modal.style.display = 'none';

  confirmBtn.onclick = async () => {
    const memberId = memberSelect.value;
    if (!memberId) return;

    const member = await getById('members', memberId);
    if (member) {
      member.groupId = id;
      await put('members', member);
      
      // Update group member count
      group.memberCount = (group.memberCount || 0) + 1;
      await put('groups', group);
      
      modal.style.display = 'none';
      notify.success('Member added successfully!');
      navigate(`#/groups/${id}`); // Refresh
    }
  };

  // Table filtering logic
  const renderMembersTable = (filter = 'all') => {
    const tbody = container.querySelector('#members-table-body');
    if (!tbody) return;

    let filteredMembers = enrichedMembers;
    if (filter === 'arrears') {
      filteredMembers = enrichedMembers.filter(m => m.totalArrears > 0);
    } else if (filter === 'inactive') {
      filteredMembers = enrichedMembers.filter(m => !m.isActive);
    }

    tbody.innerHTML = filteredMembers.length === 0 ? `
      <tr><td colspan="9" class="text-center text-muted" style="padding: 32px;">No members found matching this filter.</td></tr>
    ` : filteredMembers.map(m => `
      <tr>
        <td>
          <div class="font-semibold">${m.fullName}</div>
          <div class="text-xs text-muted">${m.regNo}</div>
        </td>
        <td>${m.phone}</td>
        <td class="font-semibold text-success">KES ${m.totalSavings.toLocaleString()}</td>
        <td class="font-semibold text-primary">KES ${m.olBalance.toLocaleString()}</td>
        <td class="font-semibold text-danger">KES ${m.totalArrears.toLocaleString()}</td>
        <td>
          <span class="badge ${m.totalArrears > 0 ? 'badge-warning' : 'badge-outline'}" style="font-size: 0.65rem;">
            ${m.totalArrears > 0 ? 'YES' : 'NO'}
          </span>
        </td>
        <td>
          <span class="badge ${m.isActive ? 'badge-success' : 'badge-danger'}">
            ${m.isActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </td>
        <td>
          <span class="text-sm ${m.isActive ? 'text-muted' : 'text-danger font-semibold'}">
            ${m.lastSavingsDate ? formatDate(m.lastSavingsDate) : 'Never'}
          </span>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/members/${m.regNo}'">View</button>
        </td>
      </tr>
    `).join('');
  };

  const filterBtns = {
    all: container.querySelector('#filter-all-btn'),
    arrears: container.querySelector('#filter-arrears-btn'),
    inactive: container.querySelector('#filter-inactive-btn')
  };

  const updateActiveFilterBtn = (activeKey) => {
    Object.keys(filterBtns).forEach(key => {
      if (key === activeKey) {
        filterBtns[key].classList.remove('btn-outline');
        filterBtns[key].classList.add('btn-primary');
      } else {
        filterBtns[key].classList.add('btn-outline');
        filterBtns[key].classList.remove('btn-primary');
      }
    });
  };

  if (filterBtns.all) {
    filterBtns.all.onclick = () => { updateActiveFilterBtn('all'); renderMembersTable('all'); };
    filterBtns.arrears.onclick = () => { updateActiveFilterBtn('arrears'); renderMembersTable('arrears'); };
    filterBtns.inactive.onclick = () => { updateActiveFilterBtn('inactive'); renderMembersTable('inactive'); };
    renderMembersTable('all'); // initial render
  }

  // Rating Logic
  const session = getSession();
  const isAdmin = session && session.role === 'admin';
  const ratingContainer = container.querySelector('#group-rating-container');

  const ratingLabels = {
    1: 'Very Poor',
    2: 'Poor',
    3: 'Fair',
    4: 'Very Good',
    5: 'Excellent'
  };

  // Initialize DOM structure once
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
    const ratingValue = group.rating || 0;
    const activeRating = currentHover > 0 ? currentHover : ratingValue;

    stars.forEach(star => {
      const val = parseInt(star.dataset.val);
      const isFilled = val <= activeRating;
      star.style.color = isFilled ? 'var(--primary)' : 'var(--secondary)';
      star.textContent = isFilled ? '★' : '☆';
    });

    let labelHtml = '';
    if (ratingValue > 0) {
      labelHtml = `<div class="text-xs" style="margin-top: 4px; color: var(--text-color); font-weight: 500;">${ratingValue}/5 — ${ratingLabels[ratingValue]}</div>`;
    } else {
      labelHtml = `<div class="text-xs text-muted" style="margin-top: 4px; font-style: italic;">Not yet rated</div>`;
    }
    
    if (isAdmin && ratingValue === 0 && currentHover === 0) {
      labelHtml += `<div class="text-xs text-muted" style="margin-top: 2px;">(Click to rate)</div>`;
    }
    labelWrapper.innerHTML = labelHtml;
  };

  if (isAdmin) {
    stars.forEach(star => {
      const val = parseInt(star.dataset.val);
      star.onmouseenter = () => updateRatingUI(val);
      star.onmouseleave = () => updateRatingUI(0);
      star.onclick = async () => {
        group.rating = val;
        try {
          await put('groups', group);
          notify.success('Group rating updated!');
          updateRatingUI(0);
        } catch (err) {
          notify.error('Error saving rating');
        }
      };
    });
  }

  updateRatingUI();

  return container;
};
