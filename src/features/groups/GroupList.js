import { groupService } from '../../services/groupService.js';
import { renderPagination } from '../../components/Pagination.js';
import { debounce } from '../../services/dataCache.js';
import { pb } from '../../services/api.js';
import { setButtonLoading, showDelayedLoading } from '../../core/uiState.js';
import { authService } from '../../services/authService.js';

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
      .group-delete-btn {
        width: 32px;
        height: 32px;
        border: 1px solid rgba(239, 68, 68, 0.24);
        border-radius: 8px;
        background: rgba(239, 68, 68, 0.08);
        color: var(--danger);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }
      .group-delete-btn:hover {
        background: rgba(239, 68, 68, 0.14);
        border-color: rgba(239, 68, 68, 0.42);
        transform: translateY(-1px);
      }
      .group-delete-btn:disabled {
        cursor: wait;
        opacity: 0.7;
        transform: none;
      }
    </style>
  `;

  const grid = container.querySelector('#groups-grid');
  const searchInput = container.querySelector('#group-search');
  let groups = [];
  let currentPage = 1;
  let currentSearch = '';
  let totalItems = 0;
  let requestId = 0;
  const pageSize = 12; // Good for a 3-column or 4-column grid
  const canDeleteGroups = authService.hasRole('super_admin', 'admin');

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
      <div class="card" style="cursor: pointer;" onclick="window.location.hash = '#/groups/${g.id}'">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
          <div>
            <h3 style="font-size: 1.125rem;">${g.name}</h3>
            <span class="text-xs text-muted">${g.group_id}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge ${g.status === 'active' ? 'badge-success' : 'badge-danger'}">${(g.status || 'ACTIVE').toUpperCase()}</span>
            ${canDeleteGroups ? `
              <button type="button" class="group-delete-btn" data-id="${g.id}" data-name="${escapeHtml(g.name || 'this group')}" aria-label="Delete group" title="Delete group">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <path d="M8 6V4h8v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M6 6l1 15h10l1-15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
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
          <span class="font-semibold" style="color: var(--success);">KES ${(g.realtime_savings || 0).toLocaleString()}</span>
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

  grid.addEventListener('click', async (event) => {
    const deleteBtn = event.target.closest('.group-delete-btn');
    if (!deleteBtn) return;
    event.preventDefault();
    event.stopPropagation();

    if (!canDeleteGroups) {
      if (window.notify) window.notify.error('Only admins can delete groups.');
      return;
    }

    const groupId = deleteBtn.dataset.id;
    const groupName = deleteBtn.dataset.name || 'this group';
    const confirmed = window.confirmDialog ? await window.confirmDialog({
      title: 'Delete Group',
      message: `This will permanently remove ${groupName}. If members, savings, loans, or reports still reference this group, PocketBase may block the deletion to protect records.`,
      confirmText: 'Delete Group',
      cancelText: 'Cancel',
      type: 'danger'
    }) : confirm(`Delete ${groupName}? This cannot be undone.`);

    if (!confirmed) return;

    const restoreButton = setButtonLoading(deleteBtn, '...');
    try {
      await groupService.delete(groupId);
      groups = groups.filter(group => group.id !== groupId);
      totalItems = Math.max(0, totalItems - 1);
      if (window.notify) window.notify.success('Group deleted successfully.');
      renderCards();
      await loadGroups();
    } catch (err) {
      console.error('[GroupList] Delete group failed:', err);
      const message = err.status === 400 || err.status === 409
        ? 'PocketBase blocked deletion because this group is still linked to members or financial records.'
        : (err.message || 'Please try again.');
      if (window.notify) window.notify.error('Failed to delete group: ' + message);
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
      const query = {
        page: currentPage,
        perPage: pageSize,
        filter: buildSearchFilter(currentSearch),
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
