import { groupService } from '../../services/groupService.js';
import { memberService } from '../../services/memberService.js';
import { renderPagination } from '../../components/Pagination.js';

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
  `;

  const grid = container.querySelector('#groups-grid');
  const searchInput = container.querySelector('#group-search');
  let groups = [];
  let currentPage = 1;
  const pageSize = 12; // Good for a 3-column or 4-column grid

  const renderCards = (query = '') => {
    const q = query.toLowerCase().trim();
    const filtered = groups.filter(g =>
      g.name?.toLowerCase().includes(q) ||
      g.group_id?.toLowerCase().includes(q) ||
      (g.meeting_day && g.meeting_day.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="card text-center" style="grid-column: 1 / -1; padding: 60px;">
          <p class="text-muted">${query ? 'No groups found matching your search.' : 'No groups registered yet.'}</p>
          ${!query ? `<button class="btn btn-outline" style="margin-top: 16px;" onclick="window.location.hash = '#/groups/new'">Create Your First Group</button>` : ''}
        </div>
      `;
      return;
    }

    const start = (currentPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    grid.innerHTML = paginated.map(g => `
      <div class="card" style="cursor: pointer;" onclick="window.location.hash = '#/groups/${g.id}'">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
          <div>
            <h3 style="font-size: 1.125rem;">${g.name}</h3>
            <span class="text-xs text-muted">${g.group_id}</span>
          </div>
          <span class="badge ${g.status === 'active' ? 'badge-success' : 'badge-danger'}">${(g.status || 'ACTIVE').toUpperCase()}</span>
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
          <span class="font-semibold" style="color: var(--success);">KES ${(g.total_savings || 0).toLocaleString()}</span>
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

    const pagination = renderPagination(filtered.length, pageSize, currentPage, (newPage) => {
      currentPage = newPage;
      renderCards(query);
    });
    if (pagination) paginationWrapper.appendChild(pagination);
  };

  searchInput.addEventListener('input', (e) => {
    currentPage = 1;
    renderCards(e.target.value);
  });

  const fetchAndRender = async () => {
    const [groupsData, membersList] = await Promise.all([
      groupService.getAll(),
      memberService.getAll()
    ]);
    
    groups = groupsData.map(g => {
      const count = membersList.filter(m => m.group === g.id).length;
      return { ...g, dynamic_member_count: count };
    });
    
    renderCards(searchInput.value);
  };

  try {
    await fetchAndRender();
  } catch (err) {
    console.error('[GroupList] Failed to load groups:', err);
    grid.innerHTML = `
      <div class="card text-center" style="grid-column: 1/-1; padding: 60px; border-top: 3px solid var(--danger);">
        <p class="text-danger font-semibold">Failed to load groups.</p>
        <p class="text-muted text-sm">${err.message || 'Network error — check your connection.'}</p>
        <button class="btn btn-outline" style="margin-top: 16px;" onclick="window.location.reload()">Retry</button>
      </div>
    `;
  }

  // Real-time updates
  const subs = await Promise.all([
    groupService.subscribeToChanges(() => fetchAndRender()),
    memberService.subscribeToChanges(() => fetchAndRender())
  ]);
  container.__subscriptions = subs;

  return container;
};
