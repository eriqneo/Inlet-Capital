import { memberService } from '../../services/memberService.js';
import { renderPagination } from '../../components/Pagination.js';
import { debounce } from '../../services/dataCache.js';
import { renderTableSkeletonRows, showDelayedLoading } from '../../core/uiState.js';
import { pb } from '../../services/api.js';
import { getMemberActivityStatus, getValidActivityDate } from '../../core/memberActivity.js';

export const renderMemberList = async () => {
  const container = document.createElement('div');
  
  let currentPage = 1;
  const pageSize = 10;
  let currentSearch = '';
  let statusFilter = 'all';
  let alphaSort = 'default';
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
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; gap: 16px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
        <input type="text" id="member-search" class="form-control" placeholder="Search by name, ID or Phone..." style="max-width: 400px;" />
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <select id="member-alpha-sort" class="form-control" style="width: 145px; padding: 6px 8px; font-size: 0.75rem;">
            <option value="default">Latest</option>
            <option value="az">Name A-Z</option>
            <option value="za">Name Z-A</option>
          </select>
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
              <th>ID Number</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="member-table-body">
            ${renderTableSkeletonRows(5, 5)}
          </tbody>
        </table>
      </div>
      <div id="pagination-wrapper"></div>
    </div>
  `;

  const tableBody = container.querySelector('#member-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');
  const searchInput = container.querySelector('#member-search');
  const alphaSortSelect = container.querySelector('#member-alpha-sort');
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
          <div class="text-xs text-muted" style="margin-top: 4px;">${m.group ? `Last saved: ${m.__lastSavingsDate ? m.__lastSavingsDate.toLocaleDateString() : 'Never'}` : 'Savings rule: Individual'}</div>
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

  const loadMembers = async () => {
    const thisRequest = ++requestId;
    const cancelLoading = showDelayedLoading(() => {
      if (thisRequest !== requestId) return;
      tableBody.innerHTML = renderTableSkeletonRows(5, 5);
      paginationWrapper.innerHTML = '';
    });

    try {
      const filter = buildSearchFilter(currentSearch);
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
  alphaSortSelect.onchange = () => {
    alphaSort = alphaSortSelect.value;
    currentPage = 1;
    loadMembers();
  };
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
