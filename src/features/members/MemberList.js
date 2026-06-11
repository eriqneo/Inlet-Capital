import { memberService } from '../../services/memberService.js';
import { renderPagination } from '../../components/Pagination.js';
import { debounce } from '../../services/dataCache.js';
import { renderTableSkeletonRows, showDelayedLoading } from '../../core/uiState.js';
import { pb } from '../../services/api.js';

export const renderMemberList = async () => {
  const container = document.createElement('div');
  
  let currentPage = 1;
  const pageSize = 10;
  let currentSearch = '';
  let totalItems = 0;
  let requestId = 0;

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Members Management</h1>
        <p class="text-muted">View and manage all registered individuals.</p>
      </div>
      <button class="btn btn-primary" onclick="window.location.hash = '#/members/new'">+ Register Member</button>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; gap: 16px;">
        <input type="text" id="member-search" class="form-control" placeholder="Search by name, ID or Phone..." style="max-width: 400px;" />
      </div>
      
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th>Member Details</th>
              <th>ID Number</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="member-table-body">
            ${renderTableSkeletonRows(5, 6)}
          </tbody>
        </table>
      </div>
      <div id="pagination-wrapper"></div>
    </div>
  `;

  const tableBody = container.querySelector('#member-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');
  const searchInput = container.querySelector('#member-search');

  const escapeFilterValue = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const relationFilter = (field, ids) => ids.map(id => `${field}="${id}"`).join(' || ');
  const inactiveCutoffMs = 90 * 24 * 60 * 60 * 1000;

  const buildSearchFilter = (term) => {
    const q = escapeFilterValue(term.trim());
    if (!q) return '';
    return `full_name~"${q}" || reg_no~"${q}" || id_number~"${q}" || phone_number~"${q}"`;
  };

  const getValidDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const getActivityStatus = (member) => {
    const dbStatus = String(member.status || 'active').toLowerCase();
    if (['suspended', 'exited'].includes(dbStatus)) {
      return { label: dbStatus.toUpperCase(), className: 'badge-danger' };
    }
    const lastSavingsDate = member.__lastSavingsDate || null;
    const isActive = lastSavingsDate && (Date.now() - lastSavingsDate.getTime() <= inactiveCutoffMs);
    return {
      label: isActive ? 'ACTIVE' : 'INACTIVE',
      className: isActive ? 'badge-success' : 'badge-danger'
    };
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
        const date = getValidDate(record.date || record.created);
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
    tableBody.innerHTML = members.length === 0 ? `
      <tr><td colspan="5" class="text-center text-muted" style="padding: 40px;">No members found.</td></tr>
    ` : members.map(m => {
      const photoUrl = memberService.getPhotoUrl(m);
      const activityStatus = getActivityStatus(m);
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
        <td>${m.id_number || m.idNo}</td>
        <td>${m.phone_number || ''}</td>
        <td>
          <span class="badge ${activityStatus.className}">${activityStatus.label}</span>
          <div class="text-xs text-muted" style="margin-top: 4px;">Last saved: ${m.__lastSavingsDate ? m.__lastSavingsDate.toLocaleDateString() : 'Never'}</div>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/members/${m.reg_no || m.regNo}'">View Profile</button>
        </td>
      </tr>
    `;
    }).join('');

    paginationWrapper.innerHTML = '';
    const pagination = renderPagination(totalItems, pageSize, currentPage, (newPage) => {
      currentPage = newPage;
      loadMembers();
    });
    if (pagination) paginationWrapper.appendChild(pagination);
  };

  const loadMembers = async () => {
    const thisRequest = ++requestId;
    const cancelLoading = showDelayedLoading(() => {
      if (thisRequest !== requestId) return;
      tableBody.innerHTML = renderTableSkeletonRows(5, 6);
      paginationWrapper.innerHTML = '';
    });

    try {
      const query = {
        page: currentPage,
        perPage: pageSize,
        filter: buildSearchFilter(currentSearch),
        sort: '-created'
      };
      const result = await memberService.listCached(query, freshResult => {
        if (thisRequest !== requestId) return;
        enrichMembersWithActivity(freshResult.items).then(enrichedItems => {
          if (thisRequest !== requestId) return;
          cancelLoading();
          totalItems = freshResult.totalItems;
          renderRows(enrichedItems);
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
          <td colspan="5" class="text-center text-danger" style="padding: 40px;">
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
