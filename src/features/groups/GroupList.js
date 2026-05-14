import { getAll } from '../../core/db.js';
import { navigate } from '../../core/router.js';

export const renderGroupList = async () => {
  const container = document.createElement('div');
  const groups = await getAll('groups');

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Groups Management</h1>
        <p class="text-muted">Manage table banking groups and joint entities.</p>
      </div>
      <button class="btn btn-primary" onclick="window.location.hash = '#/groups/new'">+ Register Group</button>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
      ${groups.length === 0 ? `
        <div class="card text-center" style="grid-column: 1 / -1; padding: 60px;">
          <p class="text-muted">No groups registered yet.</p>
          <button class="btn btn-outline" style="margin-top: 16px;" onclick="window.location.hash = '#/groups/new'">Create Your First Group</button>
        </div>
      ` : groups.map(g => `
        <div class="card" style="cursor: pointer;" onclick="window.location.hash = '#/groups/${g.groupId}'">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
            <div>
              <h3 style="font-size: 1.125rem;">${g.name}</h3>
              <span class="text-xs text-muted">${g.groupId}</span>
            </div>
            <span class="badge badge-success">ACTIVE</span>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
            <div style="background: var(--bg-light); padding: 12px; border-radius: 8px;">
              <div class="text-xs text-muted">Members</div>
              <div class="font-semibold">${g.memberCount || 0}</div>
            </div>
            <div style="background: var(--bg-light); padding: 12px; border-radius: 8px;">
              <div class="text-xs text-muted">Meeting Day</div>
              <div class="font-semibold">${g.meetingDay}</div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 12px;">
            <span class="text-sm text-muted">Total Savings</span>
            <span class="font-semibold" style="color: var(--success);">KES ${(g.totalSavings || 0).toLocaleString()}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  return container;
};
