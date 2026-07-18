import { memberService } from '../../services/memberService.js';
import { renderPagination } from '../../components/Pagination.js';
import { debounce } from '../../services/dataCache.js';
import { renderTableSkeletonRows, showDelayedLoading } from '../../core/uiState.js';
import { pb } from '../../services/api.js';
import { getMemberActivityStatus, getValidActivityDate } from '../../core/memberActivity.js';
import { authService } from '../../services/authService.js';
import { canUseOfficerFilter, loadOfficerOptions, populateOfficerSelect } from '../../core/officerScope.js';

export const renderMemberList = async () => {
  const container = document.createElement('div');
  
  let currentPage = 1;
  const pageSize = 10;
  let currentSearch = '';
  let statusFilter = 'all';
  let alphaSort = 'default';
  let totalItems = 0;
  let officerFilter = 'all';
  let requestId = 0;
  const canManageLifecycle = authService.hasRole('super_admin');
  const showOfficerFilter = canUseOfficerFilter();

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Members Management</h1>
        <p class="text-muted">View and manage all registered individuals.</p>
      </div>
      <button class="btn btn-primary" onclick="window.location.hash = '#/members/new'">+ Register Member</button>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; gap: 16px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
        <input type="text" id="member-search" class="form-control" placeholder="Search by name, ID or Phone..." style="max-width: 400px;" />
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <select id="member-alpha-sort" class="form-control" style="width: 145px; padding: 6px 8px; font-size: 0.75rem;">
            <option value="default">Latest</option>
            <option value="az">Name A-Z</option>
            <option value="za">Name Z-A</option>
          </select>
          ${showOfficerFilter ? '<select id="member-officer-filter" class="form-control" style="min-width: 210px; padding: 6px 8px; font-size: 0.75rem;"><option value="all">All Loan Officers</option></select>' : ''}
          <div id="member-status-filter" style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn btn-primary btn-sm" data-status-filter="all">All</button>
            <button type="button" class="btn btn-outline btn-sm" data-status-filter="active">Active</button>
            <button type="button" class="btn btn-outline btn-sm" data-status-filter="inactive">Inactive</button>
          </div>
          <div id="member-filter-count" class="text-xs font-semibold" style="color: var(--secondary); white-space: nowrap;">0 members</div>
        </div>
      </div>
      
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th>Member Details</th>
              <th>Group</th>
              <th>ID Number</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="member-table-body">
            ${renderTableSkeletonRows(6, 5)}
          </tbody>
        </table>
      </div>
      <div id="pagination-wrapper"></div>
    </div>
    <style>
      .member-action-group { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .member-icon-action { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--border-color); background: #fff; color: var(--primary); cursor: pointer; font-size: 0.9rem; transition: all 0.18s ease; }
      .member-icon-action:hover { transform: translateY(-1px); box-shadow: 0 6px 12px rgba(15, 37, 69, 0.08); border-color: var(--primary); }
      .member-icon-action.warning { color: var(--warning); }
      .member-icon-action.warning:hover { border-color: var(--warning); background: rgba(245, 158, 11, 0.08); }
      .member-icon-action.danger { color: var(--danger); }
      .member-icon-action.danger:hover { border-color: var(--danger); background: rgba(239, 68, 68, 0.06); }
    </style>
  `;

  const tableBody = container.querySelector('#member-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');
  const searchInput = container.querySelector('#member-search');
  const alphaSortSelect = container.querySelector('#member-alpha-sort');
  const officerFilterSelect = container.querySelector('#member-officer-filter');
  const statusFilterButtons = Array.from(container.querySelectorAll('[data-status-filter]'));
  const filterCountEl = container.querySelector('#member-filter-count');

  const escapeFilterValue = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const relationFilter = (field, ids) => ids.map(id => `${field}="${id}"`).join(' || ');
  const buildSearchFilter = (term) => {
    const q = escapeFilterValue(term.trim());
    if (!q) return '';
    return `full_name~"${q}" || reg_no~"${q}" || id_number~"${q}" || phone_number~"${q}"`;
  };

  const getActivityStatus = (member) => {
    return getMemberActivityStatus(member, member.__lastSavingsDate || null);
  };

  const enrichMembersWithActivity = async (memberRows) => {
    if (!memberRows.length) return memberRows;
    const memberIds = memberRows.map(member => member.id).filter(Boolean);
    if (!memberIds.length) return memberRows;

    try {
      const memberSavings = await pb.collection('savings').getFullList({
        filter: `(${relationFilter('member', memberIds)}) && is_reversed=false`,
        fields: 'id,member,date,created',
        sort: '-date'
      });
      const lastSavingsByMember = new Map();
      memberSavings.forEach(record => {
        const date = getValidActivityDate(record.date || record.created);
        if (!date) return;
        const current = lastSavingsByMember.get(record.member);
        if (!current || date > current) lastSavingsByMember.set(record.member, date);
      });
      return memberRows.map(member => ({
        ...member,
        __lastSavingsDate: lastSavingsByMember.get(member.id) || null
      }));
    } catch (err) {
      console.warn('[MemberList] Could not calculate member activity status:', err.message);
      return memberRows;
    }
  };

  const renderRows = (members) => {
    if (filterCountEl) {
      filterCountEl.textContent = `${totalItems.toLocaleString()} ${totalItems === 1 ? 'member' : 'members'}`;
    }
    tableBody.innerHTML = members.length === 0 ? `
      <tr><td colspan="6" class="text-center text-muted" style="padding: 40px;">No members found.</td></tr>
    ` : members.map(m => {
      const photoUrl = memberService.getPhotoUrl(m);
      const activityStatus = getActivityStatus(m);
      const groupName = m.expand?.group?.name || (m.group ? 'Group member' : 'Individual');
      const groupCode = m.expand?.group?.group_id || '';
      return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; background: var(--bg-light); border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center;">
              ${photoUrl ? `<img src="${photoUrl}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span style="font-size: 20px;">👤</span>`}
            </div>
            <div>
              <div class="font-semibold">${m.full_name || m.fullName}</div>
              <div class="text-xs text-muted">${m.reg_no || m.regNo}</div>
            </div>
          </div>
        </td>
        <td>
          <span class="badge ${m.group ? 'badge-primary' : 'badge-outline'}" style="font-size: 0.65rem;">${groupName}</span>
          ${groupCode ? `<div class="text-xs text-muted" style="margin-top: 4px;">${groupCode}</div>` : ''}
        </td>
        <td>${m.id_number || m.idNo}</td>
        <td>${m.phone_number || ''}</td>
        <td>
          <span class="badge ${activityStatus.className}">${activityStatus.label}</span>
          <div class="text-xs text-muted" style="margin-top: 4px;">${m.group ? `Last saved: ${m.__lastSavingsDate ? m.__lastSavingsDate.toLocaleDateString() : 'Never'}` : 'Savings rule: Individual'}</div>
        </td>
        <td>
          <div class="member-action-group">
            <button type="button" class="btn btn-outline btn-sm member-row-action" data-action="view" data-id="${m.id}">View Profile</button>
            ${canManageLifecycle ? `
              <button type="button" class="member-icon-action warning member-row-action" data-action="suspend" data-id="${m.id}" title="Suspend member" aria-label="Suspend member">!</button>
              <button type="button" class="member-icon-action danger member-row-action" data-action="close" data-id="${m.id}" title="Close member account" aria-label="Close member account">×</button>
              <button type="button" class="member-icon-action danger member-row-action" data-action="delete" data-id="${m.id}" title="Delete mistaken/duplicate member" aria-label="Delete mistaken or duplicate member">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M9 10v8M15 10v8M6 6l1 15h10l1-15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
    }).join('');

    tableBody.querySelectorAll('.member-row-action').forEach(btn => {
      btn.onclick = async () => {
        const member = members.find(item => item.id === btn.dataset.id);
        if (!member) return;
        if (btn.dataset.action === 'view') {
          window.location.hash = `#/members/${member.reg_no || member.regNo}`;
          return;
        }
        if (btn.dataset.action === 'suspend') await suspendMember(member);
        if (btn.dataset.action === 'close') await closeMember(member);
        if (btn.dataset.action === 'delete') await deleteMember(member);
      };
    });

    paginationWrapper.innerHTML = '';
    const pagination = renderPagination(totalItems, pageSize, currentPage, (newPage) => {
      currentPage = newPage;
      loadMembers();
    });
    if (pagination) paginationWrapper.appendChild(pagination);
  };

  const updateStatusFilterButtons = () => {
    statusFilterButtons.forEach(btn => {
      const isActive = btn.dataset.statusFilter === statusFilter;
      btn.classList.toggle('btn-primary', isActive);
      btn.classList.toggle('btn-outline', !isActive);
    });
  };

  const filterMembersByActivity = (memberRows) => {
    if (statusFilter === 'all') return memberRows;
    return memberRows.filter(member => {
      const activityStatus = getActivityStatus(member);
      return statusFilter === 'active'
        ? activityStatus.isActive
        : !activityStatus.isActive;
    });
  };

  const suspendMember = async (member) => {
    if (!canManageLifecycle) {
      if (window.notify) window.notify.error('Only super admins can suspend members.');
      return;
    }
    const confirmed = window.confirmDialog ? await window.confirmDialog({
      title: 'Suspend Member',
      message: `Suspend ${member.full_name || 'this member'}? The account will be hidden from normal operations but can be revived from Reports > Lifecycle.`,
      confirmText: 'Suspend Member',
      cancelText: 'Cancel',
      type: 'warning'
    }) : confirm(`Suspend ${member.full_name || 'this member'}?`);
    if (!confirmed) return;
    try {
      await memberService.suspend(member.id);
      if (window.notify) window.notify.success('Member suspended. It can be revived from Reports > Lifecycle.');
      loadMembers();
    } catch (err) {
      if (window.notify) window.notify.error('Failed to suspend member: ' + (err.message || 'Please try again.'));
    }
  };

  const closeMember = async (member) => {
    if (!canManageLifecycle) {
      if (window.notify) window.notify.error('Only super admins can close member accounts.');
      return;
    }
    const confirmed = window.confirmDialog ? await window.confirmDialog({
      title: 'Close Member Account',
      message: `Close ${member.full_name || 'this member'} permanently? Closed accounts remain in reports but cannot be revived.`,
      confirmText: 'Close Account',
      cancelText: 'Cancel',
      type: 'danger'
    }) : confirm(`Close ${member.full_name || 'this member'} permanently? This cannot be revived.`);
    if (!confirmed) return;
    try {
      await memberService.close(member.id);
      if (window.notify) window.notify.success('Member account closed. Historical reports remain available.');
      loadMembers();
    } catch (err) {
      if (window.notify) window.notify.error('Failed to close member: ' + (err.message || 'Please try again.'));
    }
  };

  const deleteMember = async (member) => {
    if (!canManageLifecycle) {
      if (window.notify) window.notify.error('Only super admins can delete member records.');
      return;
    }
    const confirmed = window.confirmDialog ? await window.confirmDialog({
      title: 'Delete Member Record',
      message: `Permanently delete ${member.full_name || 'this member'}? Use this only for wrong or duplicate entries. If this member has linked loans, savings, repayments, or reports, PocketBase may block deletion to protect financial history.`,
      confirmText: 'Delete Permanently',
      cancelText: 'Cancel',
      type: 'danger'
    }) : confirm(`Delete ${member.full_name || 'this member'} permanently? Use only for wrong or duplicate entries.`);
    if (!confirmed) return;
    try {
      await memberService.delete(member.id);
      if (window.notify) window.notify.success('Member record deleted.');
      loadMembers();
    } catch (err) {
      const message = err?.status === 400
        ? 'PocketBase blocked deletion because this member may have linked records. Use Close Account instead for historical accounts.'
        : (err.message || 'Please try again.');
      if (window.notify) window.notify.error('Failed to delete member: ' + message);
    }
  };

  const loadMembers = async () => {
    const thisRequest = ++requestId;
    const cancelLoading = showDelayedLoading(() => {
      if (thisRequest !== requestId) return;
      tableBody.innerHTML = renderTableSkeletonRows(6, 5);
      paginationWrapper.innerHTML = '';
    });

    try {
      const searchFilter = buildSearchFilter(currentSearch);
      const lifecycleFilter = 'status!="suspended" && status!="closed"';
      const officerScopeFilter = officerFilter === 'all'
        ? ''
        : `(assigned_officer="${escapeFilterValue(officerFilter)}" || (assigned_officer="" && registered_by="${escapeFilterValue(officerFilter)}"))`;
      const filterParts = [lifecycleFilter, searchFilter ? `(${searchFilter})` : '', officerScopeFilter].filter(Boolean);
      const filter = filterParts.join(' && ');
      const sort = alphaSort === 'az' ? 'full_name' : (alphaSort === 'za' ? '-full_name' : '-created');
      const query = { page: currentPage, perPage: pageSize, filter, sort };

      if (statusFilter !== 'all') {
        const allMatchingMembers = await pb.collection('members').getFullList({
          filter,
          sort,
          expand: 'group'
        });
        const enrichedMembers = await enrichMembersWithActivity(allMatchingMembers);
        if (thisRequest !== requestId) return;
        const filteredMembers = filterMembersByActivity(enrichedMembers);
        totalItems = filteredMembers.length;
        cancelLoading();
        renderRows(filteredMembers.slice((currentPage - 1) * pageSize, currentPage * pageSize));
        return;
      }

      const result = await memberService.listCached(query, freshResult => {
        if (thisRequest !== requestId) return;
        enrichMembersWithActivity(freshResult.items).then(enrichedItems => {
          if (thisRequest !== requestId) return;
          cancelLoading();
          totalItems = freshResult.totalItems;
          renderRows(filterMembersByActivity(enrichedItems));
        });
      });

      if (thisRequest !== requestId) return;
      totalItems = result.totalItems;
      const enrichedItems = await enrichMembersWithActivity(result.items);
      if (thisRequest !== requestId) return;
      cancelLoading();
      renderRows(enrichedItems);
    } catch (err) {
      cancelLoading();
      console.error('[MemberList] Failed to load members:', err);
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-danger" style="padding: 40px;">
            Failed to load members. ${err.message || ''}
          </td>
        </tr>
      `;
    }
  };

  // Search logic
  const debouncedSearch = debounce(() => {
    currentPage = 1;
    currentSearch = searchInput.value;
    loadMembers();
  }, 300);

  searchInput.addEventListener('input', debouncedSearch);
  alphaSortSelect.onchange = () => {
    alphaSort = alphaSortSelect.value;
    currentPage = 1;
    loadMembers();
  };
  if (officerFilterSelect) {
    officerFilterSelect.onchange = () => {
      officerFilter = officerFilterSelect.value;
      currentPage = 1;
      loadMembers();
    };
    loadOfficerOptions().then(options => populateOfficerSelect(officerFilterSelect, options, officerFilter));
  }
  statusFilterButtons.forEach(btn => {
    btn.onclick = () => {
      statusFilter = btn.dataset.statusFilter;
      currentPage = 1;
      updateStatusFilterButtons();
      loadMembers();
    };
  });

  updateStatusFilterButtons();
  loadMembers();

  // Debounced refresh for real-time events
  const debouncedRefresh = debounce(async () => {
    await loadMembers();
  }, 500);

  // Real-time updates
  container.__subscriptionPromise = memberService.subscribeToChanges(debouncedRefresh)
    .then(unsub => [unsub]);

  return container;
};
