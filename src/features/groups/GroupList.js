import { groupService } from '../../services/groupService.js';
import { renderPagination } from '../../components/Pagination.js';
import { debounce } from '../../services/dataCache.js';
import { pb } from '../../services/api.js';
import { setButtonLoading, showDelayedLoading } from '../../core/uiState.js';
import { authService } from '../../services/authService.js';
import { formatMoney } from '../../core/utils.js';
import { canUseOfficerFilter, loadOfficerOptions, populateOfficerSelect } from '../../core/officerScope.js';

export const renderGroupList = async () => {
  const container = document.createElement('div');

  // Paint the shell immediately so the router always has something to append
  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
      <div>
        <h1 class="text-xl">Groups Management</h1>
        <p class="text-muted">Manage table banking groups and joint entities.</p>
      </div>
      <div style="display: flex; gap: 12px; align-items: center;">
        ${canUseOfficerFilter() ? '<select id="group-officer-filter" class="form-control" style="min-width: 210px;"><option value="all">All Loan Officers</option></select>' : ''}
        <div style="position: relative; width: 300px;">
          <input type="text" id="group-search" class="form-control" placeholder="Search groups by name or ID..." style="padding-left: 36px; border-radius: 20px;" />
          <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); opacity: 0.5;">🔍</span>
        </div>
        <button class="btn btn-primary" onclick="window.location.hash = '#/groups/new'">+ Register Group</button>
      </div>
    </div>
    <div id="groups-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
      <div class="card text-center" style="grid-column: 1/-1; padding: 60px;">
        <p class="text-muted">Loading groups…</p>
      </div>
    </div>
    <style>
      .group-card-action {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }
      .group-edit-btn {
        border: 1px solid rgba(27, 61, 114, 0.24);
        background: rgba(27, 61, 114, 0.08);
        color: var(--primary);
      }
      .group-suspend-btn {
        border: 1px solid rgba(245, 158, 11, 0.28);
        background: rgba(245, 158, 11, 0.1);
        color: var(--warning);
      }
      .group-close-btn {
        border: 1px solid rgba(239, 68, 68, 0.3);
        background: rgba(239, 68, 68, 0.08);
        color: var(--danger);
      }
      .group-delete-btn {
        border: 1px solid rgba(127, 29, 29, 0.3);
        background: rgba(127, 29, 29, 0.08);
        color: #991b1b;
      }
      .group-edit-btn:hover {
        background: rgba(27, 61, 114, 0.14);
        border-color: rgba(27, 61, 114, 0.42);
        transform: translateY(-1px);
      }
      .group-suspend-btn:hover {
        background: rgba(239, 68, 68, 0.14);
        border-color: rgba(239, 68, 68, 0.42);
        color: var(--danger);
        transform: translateY(-1px);
      }
      .group-close-btn:hover {
        background: rgba(239, 68, 68, 0.16);
        border-color: rgba(239, 68, 68, 0.5);
        transform: translateY(-1px);
      }
      .group-delete-btn:hover {
        background: rgba(127, 29, 29, 0.16);
        border-color: rgba(127, 29, 29, 0.5);
        transform: translateY(-1px);
      }
      .group-card-action:disabled {
        cursor: wait;
        opacity: 0.7;
        transform: none;
      }
    </style>
  `;

  const grid = container.querySelector('#groups-grid');
  const searchInput = container.querySelector('#group-search');
  const officerFilterSelect = container.querySelector('#group-officer-filter');
  let groups = [];
  let currentPage = 1;
  let currentSearch = '';
  let officerFilter = 'all';
  let totalItems = 0;
  let requestId = 0;
  const pageSize = 12; // Good for a 3-column or 4-column grid
  const canEditGroups = authService.hasRole('super_admin', 'admin');
  const canManageLifecycle = authService.hasRole('super_admin');

  const relationFilter = (field, ids) => ids.map(id => `${field}="${id}"`).join(' || ');
  const moneyTotal = (records) => records.reduce((sum, record) => {
    const amount = Number(record.amount) || 0;
    return record.type === 'deposit' ? sum + amount : sum - amount;
  }, 0);
  const escapeFilterValue = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
  const buildSearchFilter = (term) => {
    const q = escapeFilterValue(term.trim());
    if (!q) return '';
    return `name~"${q}" || group_id~"${q}" || meeting_day~"${q}"`;
  };

  const renderCards = () => {
    if (groups.length === 0) {
      grid.innerHTML = `
        <div class="card text-center" style="grid-column: 1 / -1; padding: 60px;">
          <p class="text-muted">${currentSearch ? 'No groups found matching your search.' : 'No groups registered yet.'}</p>
          ${!currentSearch ? `<button class="btn btn-outline" style="margin-top: 16px;" onclick="window.location.hash = '#/groups/new'">Create Your First Group</button>` : ''}
        </div>
      `;
      return;
    }

    grid.innerHTML = groups.map(g => `
      <div class="card" style="cursor: pointer; opacity: ${g.status === 'suspended' ? '0.72' : '1'};" onclick="window.location.hash = '#/groups/${g.id}'">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
          <div>
            <h3 style="font-size: 1.125rem;">${g.name}</h3>
            <span class="text-xs text-muted">${g.group_id}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge ${g.status === 'active' ? 'badge-success' : g.status === 'suspended' ? 'badge-danger' : 'badge-warning'}">${(g.status || 'ACTIVE').toUpperCase()}</span>
            ${canEditGroups ? `
              <button type="button" class="group-card-action group-edit-btn" data-id="${g.id}" aria-label="Edit group" title="Edit group">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M12 20h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            ` : ''}
            ${canManageLifecycle ? `
              ${g.status !== 'suspended' ? `
                <button type="button" class="group-card-action group-suspend-btn" data-id="${g.id}" data-name="${escapeHtml(g.name || 'this group')}" aria-label="Suspend group" title="Suspend group">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
                    <path d="M8 8l8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </button>
              ` : `
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="color: var(--danger); opacity: 0.6;">
                  <path d="M12 9v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M12 17h.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                  <path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                </svg>
              `}
              <button type="button" class="group-card-action group-close-btn" data-id="${g.id}" data-name="${escapeHtml(g.name || 'this group')}" aria-label="Close group account" title="Close group account">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
              <button type="button" class="group-card-action group-delete-btn" data-id="${g.id}" data-name="${escapeHtml(g.name || 'this group')}" aria-label="Delete mistaken or duplicate group" title="Delete mistaken/duplicate group">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M9 10v8M15 10v8M6 6l1 15h10l1-15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
          <div style="background: var(--bg-light); padding: 12px; border-radius: 8px;">
            <div class="text-xs text-muted">Members</div>
            <div class="font-semibold">${g.dynamic_member_count || 0}</div>
          </div>
          <div style="background: var(--bg-light); padding: 12px; border-radius: 8px;">
            <div class="text-xs text-muted">Meeting Day</div>
            <div class="font-semibold">${g.meeting_day || '-'}</div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 12px;">
          <span class="text-sm text-muted">Total Savings</span>
          <span class="font-semibold" style="color: var(--success);">KES ${formatMoney(g.realtime_savings)}</span>
        </div>
      </div>
    `).join('');

    // Remove existing pagination if it exists
    let paginationWrapper = container.querySelector('#group-pagination-wrapper');
    if (!paginationWrapper) {
      paginationWrapper = document.createElement('div');
      paginationWrapper.id = 'group-pagination-wrapper';
      paginationWrapper.style.gridColumn = '1 / -1';
      grid.appendChild(paginationWrapper);
    } else {
      paginationWrapper.innerHTML = '';
      grid.appendChild(paginationWrapper); // move to end
    }

    const pagination = renderPagination(totalItems, pageSize, currentPage, (newPage) => {
      currentPage = newPage;
      loadGroups();
    });
    if (pagination) paginationWrapper.appendChild(pagination);
  };

  const debouncedSearch = debounce(() => {
    currentPage = 1;
    currentSearch = searchInput.value;
    loadGroups();
  }, 300);

  searchInput.addEventListener('input', debouncedSearch);
  if (officerFilterSelect) {
    officerFilterSelect.onchange = () => {
      officerFilter = officerFilterSelect.value;
      currentPage = 1;
      loadGroups();
    };
    loadOfficerOptions().then(options => populateOfficerSelect(officerFilterSelect, options, officerFilter));
  }

  grid.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('.group-edit-btn');
    if (editBtn) {
      event.preventDefault();
      event.stopPropagation();
      window.location.hash = `#/groups/${editBtn.dataset.id}/edit`;
      return;
    }

    const suspendBtn = event.target.closest('.group-suspend-btn');
    const closeBtn = event.target.closest('.group-close-btn');
    const deleteBtn = event.target.closest('.group-delete-btn');
    if (!suspendBtn && !closeBtn && !deleteBtn) return;
    event.preventDefault();
    event.stopPropagation();

    if (!canManageLifecycle) {
      if (window.notify) window.notify.error('Only super admins can manage group lifecycle.');
      return;
    }

    if (deleteBtn) {
      const groupId = deleteBtn.dataset.id;
      const groupName = deleteBtn.dataset.name || 'this group';
      const confirmed = window.confirmDialog ? await window.confirmDialog({
        title: 'Delete Group Record',
        message: `Permanently delete ${groupName}? Use this only for wrong or duplicate entries. If the group has members, loans, savings, or reports, PocketBase may block deletion to protect financial history.`,
        confirmText: 'Delete Permanently',
        cancelText: 'Cancel',
        type: 'danger'
      }) : confirm(`Delete ${groupName} permanently? Use only for wrong or duplicate entries.`);
      if (!confirmed) return;
      const restoreButton = setButtonLoading(deleteBtn, '...');
      try {
        await groupService.delete(groupId);
        if (window.notify) window.notify.success('Group record deleted.');
        await loadGroups();
      } catch (err) {
        const message = err?.status === 400
          ? 'PocketBase blocked deletion because this group may have linked records. Use Close Account instead for historical groups.'
          : (err.message || 'Please try again.');
        if (window.notify) window.notify.error('Failed to delete group: ' + message);
        restoreButton();
      }
      return;
    }

    if (closeBtn) {
      const groupId = closeBtn.dataset.id;
      const groupName = closeBtn.dataset.name || 'this group';
      const confirmed = window.confirmDialog ? await window.confirmDialog({
        title: 'Close Group Account',
        message: `Close ${groupName} permanently? Closed groups remain in historical reports but cannot be revived.`,
        confirmText: 'Close Account',
        cancelText: 'Cancel',
        type: 'danger'
      }) : confirm(`Close ${groupName} permanently? This cannot be revived.`);
      if (!confirmed) return;
      const restoreButton = setButtonLoading(closeBtn, '...');
      try {
        await groupService.close(groupId);
        if (window.notify) window.notify.success('Group account closed. Historical reports remain available.');
        await loadGroups();
      } catch (err) {
        if (window.notify) window.notify.error('Failed to close group: ' + (err.message || 'Please try again.'));
        restoreButton();
      }
      return;
    }

    const groupId = suspendBtn.dataset.id;
    const groupName = suspendBtn.dataset.name || 'this group';
    const confirmed = window.confirmDialog ? await window.confirmDialog({
      title: 'Suspend Group',
      message: `Suspend ${groupName}? The group, members, savings, loans, and reports will remain intact. Super admins can revive it later from the Lifecycle report.`,
      confirmText: 'Suspend Group',
      cancelText: 'Cancel',
      type: 'warning'
    }) : confirm(`Suspend ${groupName}? Records will remain intact.`);

    if (!confirmed) return;

    const restoreButton = setButtonLoading(suspendBtn, '...');
    try {
      await groupService.suspend(groupId);
      groups = groups.map(group => group.id === groupId ? { ...group, status: 'suspended' } : group);
      if (window.notify) window.notify.success('Group suspended. It can be revived from Reports > Lifecycle.');
      renderCards();
      await loadGroups();
    } catch (err) {
      console.error('[GroupList] Suspend group failed:', err);
      const message = err.status === 400
        ? 'PocketBase rejected the suspended status. Run the updated setup_collections script or add "suspended" to the groups status field.'
        : (err.message || 'Please try again.');
      if (window.notify) window.notify.error('Failed to suspend group: ' + message);
      restoreButton();
    }
  });

  const loadGroups = async () => {
    const thisRequest = ++requestId;
    const cancelLoading = showDelayedLoading(() => {
      if (thisRequest !== requestId) return;
      grid.innerHTML = `
        <div class="card text-center" style="grid-column: 1/-1; padding: 60px;">
          <div class="spinner" style="margin: 0 auto 16px;"></div>
          <p class="text-muted">Loading groups...</p>
        </div>
      `;
    });

    const hydrateGroupPage = async (groupResult) => {
      if (thisRequest !== requestId) return;
      cancelLoading();
      totalItems = groupResult.totalItems;
      const pageGroups = groupResult.items;
      groups = pageGroups.map(g => ({
        ...g,
        dynamic_member_count: g.dynamic_member_count ?? g.member_count ?? 0,
        realtime_savings: g.realtime_savings ?? g.total_savings ?? 0
      }));
      renderCards();

      const groupIds = pageGroups.map(g => g.id);
      let membersList = [];
      let savingsList = [];
      if (groupIds.length > 0) {
        membersList = await pb.collection('members').getFullList({
          filter: relationFilter('group', groupIds)
        });

        const memberIds = membersList.map(m => m.id);
        const savingsFilters = [`(${relationFilter('group', groupIds)})`];
        if (memberIds.length > 0) {
          savingsFilters.push(`(${relationFilter('member', memberIds)})`);
        }

        savingsList = await pb.collection('savings').getFullList({
          filter: `(${savingsFilters.join(' || ')}) && is_reversed=false`
        });
      }
      
      if (thisRequest !== requestId) return;
      groups = pageGroups.map(g => {
        const groupMembers = membersList.filter(m => m.group === g.id);
        const memberIds = new Set(groupMembers.map(m => m.id));
        
        const groupSavingsTransactions = savingsList.filter(s => s.group === g.id || memberIds.has(s.member));
        const realtime_savings = moneyTotal(groupSavingsTransactions);

        return { ...g, dynamic_member_count: groupMembers.length, realtime_savings };
      });
      
      renderCards();
    };

    try {
      const searchFilter = buildSearchFilter(currentSearch);
      const officerScopeFilter = officerFilter === 'all'
        ? ''
        : `(assigned_officer="${escapeFilterValue(officerFilter)}" || (assigned_officer="" && created_by="${escapeFilterValue(officerFilter)}"))`;
      const query = {
        page: currentPage,
        perPage: pageSize,
        filter: [searchFilter, officerScopeFilter].filter(Boolean).map(value => `(${value})`).join(' && '),
        sort: 'name'
      };
      const groupResult = await groupService.listCached(query, freshResult => {
        hydrateGroupPage(freshResult).catch(err => console.warn('[GroupList] Cached refresh hydration failed:', err));
      });
      await hydrateGroupPage(groupResult);
    } catch (err) {
      cancelLoading();
      console.error('[GroupList] Failed to load groups:', err);
      grid.innerHTML = `
        <div class="card text-center" style="grid-column: 1/-1; padding: 60px; border-top: 3px solid var(--danger);">
          <p class="text-danger font-semibold">Failed to load groups.</p>
          <p class="text-muted text-sm">${err.message || 'Network error — check your connection.'}</p>
          <button class="btn btn-outline" style="margin-top: 16px;" onclick="window.location.reload()">Retry</button>
        </div>
      `;
    }
  };

  loadGroups();

  // Debounced refresh for real-time events
  const debouncedRefresh = debounce(async () => {
    await loadGroups();
  }, 500);

  // Helper to safely invalidate cache and refresh
  const handleUpdate = () => async () => {
    debouncedRefresh();
  };

  // Real-time updates
  container.__subscriptionPromise = Promise.all([
    pb.collection('groups').subscribe('*', handleUpdate()),
    pb.collection('members').subscribe('*', handleUpdate()),
    pb.collection('savings').subscribe('*', handleUpdate())
  ]);

  return container;
};
