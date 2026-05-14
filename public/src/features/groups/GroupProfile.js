import { getById, getAll, add, put } from '../../core/db.js';
import { navigate } from '../../core/router.js';

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
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
          <div class="card" style="padding: 16px;">
            <div class="text-xs text-muted">Total Savings</div>
            <div class="text-lg font-semibold" style="color: var(--success);">KES ${(group.totalSavings || 0).toLocaleString()}</div>
          </div>
          <div class="card" style="padding: 16px;">
            <div class="text-xs text-muted">Outstanding Loan</div>
            <div class="text-lg font-semibold" style="color: var(--danger);">KES ${(group.outstandingLoan || 0).toLocaleString()}</div>
          </div>
          <div class="card" style="padding: 16px;">
            <div class="text-xs text-muted">Arrears</div>
            <div class="text-lg font-semibold" style="color: var(--warning);">KES 0</div>
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
              <div class="table-responsive">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>A.Savings <span title="Accumulated Savings" style="cursor:help;">ⓘ</span></th>
                      <th>OL Balance</th>
                      <th>Arrears</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${groupMembers.length === 0 ? `
                      <tr><td colspan="7" class="text-center text-muted">No members in this group yet.</td></tr>
                    ` : groupMembers.map(m => {
                      const mSavings = allSavings.filter(s => s.memberId === m.regNo);
                      const totalSavings = mSavings.reduce((sum, s) => sum + s.amount, 0);
                      
                      const mLoans = allLoans.filter(l => l.memberId === m.regNo && (l.status === 'approved' || l.status === 'closed'));
                      const totalLiability = mLoans.reduce((sum, l) => sum + (l.totalLiability || l.amountApplied * 1.1), 0); // Fallback to simple interest if totalLiability not set
                      const totalRepaid = allRepayments.filter(r => r.memberId === m.regNo && mLoans.some(ml => ml.loanNo === r.loanNo)).reduce((sum, r) => sum + r.amount, 0);
                      const olBalance = Math.max(0, totalLiability - totalRepaid);
                      
                      const mSchedules = allSchedules.filter(s => mLoans.some(ml => ml.loanNo === s.loanId) && s.status !== 'paid' && new Date(s.dueDate) < new Date());
                      const totalArrears = mSchedules.reduce((sum, s) => sum + s.amount, 0);
                      
                      const lastSavingsDate = mSavings.length > 0 ? new Date(Math.max(...mSavings.map(s => new Date(s.date)))) : null;
                      const isActive = lastSavingsDate && (new Date() - lastSavingsDate <= 90 * 24 * 60 * 60 * 1000);

                      return `
                      <tr>
                        <td>
                          <div class="font-semibold">${m.fullName}</div>
                          <div class="text-xs text-muted">${m.regNo}</div>
                        </td>
                        <td>${m.phone}</td>
                        <td class="font-semibold text-success">KES ${totalSavings.toLocaleString()}</td>
                        <td class="font-semibold text-primary">KES ${olBalance.toLocaleString()}</td>
                        <td class="font-semibold text-danger">KES ${totalArrears.toLocaleString()}</td>
                        <td>
                          <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">
                            ${isActive ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                        <td>
                          <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/members/${m.regNo}'">View</button>
                        </td>
                      </tr>`;
                    }).join('')}
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
            <div>${new Date(group.registrationDate).toLocaleDateString()}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div class="text-xs text-muted">Phone</div>
            <div>${group.phone}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div class="text-xs text-muted">Performance Rating</div>
            <div style="color: var(--warning);">⭐⭐⭐⭐⭐ (Excellent)</div>
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

  return container;
};
