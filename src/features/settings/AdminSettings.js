import { settingsService } from '../../services/settingsService.js';
import { expenseService } from '../../services/expenseService.js';
import { authService } from '../../services/authService.js';
import { pb } from '../../services/api.js';
import { openCamera } from '../../components/Camera.js';
import { renderPagination } from '../../components/Pagination.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderAdminSettings = async () => {
  const container = document.createElement('div');

  // State
  let settings = {};
  let timestamps = {};
  let users = [];
  let voteheads = [];
  let auditLogs = [];
  let showArchivedVoteheads = false;
  let isSettingsLoading = true;
  let isUsersLoading = true;
  let isVoteheadsLoading = true;
  let isAuditLoading = true;
  
  let auditPage = 1;
  const auditPageSize = 20;
  let auditTotal = 0;
  let auditFilter = 'all';

  const isSuperAdmin = authService.hasRole('super_admin');

  const loadSettingsData = async () => {
    isSettingsLoading = true;
    renderUI();
    try {
      const records = await settingsService.getRecords();
      settings = Object.fromEntries(records.map(r => [r.key, r.value]));
      timestamps = Object.fromEntries(records.map(r => [r.key, r.updated]));
    } catch (err) {
      console.error("Failed to load settings data", err);
      if (window.notify) window.notify.error('Failed to load settings: ' + err.message);
    } finally {
      isSettingsLoading = false;
      renderUI();
    }
  };

  const loadUsers = async () => {
    isUsersLoading = true;
    renderUI();
    try {
      users = await pb.collection('users').getFullList({ sort: '-created' });
    } catch (err) {
      console.error("Failed to load users", err);
      users = [];
      if (window.notify) window.notify.error('Failed to load users: ' + err.message);
    } finally {
      isUsersLoading = false;
      renderUI();
    }
  };

  const loadVoteheads = async () => {
    isVoteheadsLoading = true;
    renderUI();
    try {
      voteheads = await expenseService.getVoteheads({ includeArchived: true });
    } catch (err) {
      console.error("Failed to load voteheads", err);
      voteheads = [];
      if (window.notify) window.notify.error('Failed to load voteheads: ' + err.message);
    } finally {
      isVoteheadsLoading = false;
      renderUI();
    }
  };

  const loadData = async () => {
    await Promise.all([
      loadSettingsData(),
      loadUsers(),
      loadVoteheads()
    ]);
  };

  const loadAuditLogs = async () => {
    isAuditLoading = true;
    renderUI();
    try {
      let filter = '';
      if (auditFilter !== 'all') {
        filter = `action = "${auditFilter}"`;
      }
      const result = await pb.collection('audit_log').getList(auditPage, auditPageSize, {
        sort: '-created',
        expand: 'user',
        filter: filter
      });
      auditLogs = result.items;
      auditTotal = result.totalItems;
    } catch (e) {
      console.warn("Audit logs error:", e);
      auditLogs = [];
      auditTotal = 0;
    } finally {
      isAuditLoading = false;
      renderUI();
    }
  };

  const initialize = async () => {
    renderUI();
    loadSettingsData();
    loadUsers();
    loadVoteheads();
    loadAuditLogs();
  };

  const renderUI = () => {
    // Determine active tab based on current DOM if re-rendering, default to org
    let activeTab = 'org';
    const currentActiveBtn = container.querySelector('.tab-btn.active');
    if (currentActiveBtn) activeTab = currentActiveBtn.dataset.tab;

    // Filter voteheads
    const visibleVoteheads = showArchivedVoteheads ? voteheads : voteheads.filter(v => v.status !== 'archived');

    container.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h1 class="text-xl">Administration Centre</h1>
        <p class="text-muted">Manage your institution, users, and system rules.</p>
      </div>

      <!-- Tab Navigation -->
      <div class="card" style="padding: 0; margin-bottom: 24px;">
        <div style="display: flex; border-bottom: 1px solid var(--border-color); overflow-x: auto;">
          <button class="tab-btn ${activeTab === 'org' ? 'active' : ''}" data-tab="org">🏢 Organisation</button>
          <button class="tab-btn ${activeTab === 'users' ? 'active' : ''}" data-tab="users">👥 Users & Roles</button>
          <button class="tab-btn ${activeTab === 'voteheads' ? 'active' : ''}" data-tab="voteheads">📁 Voteheads</button>
          <button class="tab-btn ${activeTab === 'rates' ? 'active' : ''}" data-tab="rates">🔧 Rates & Fees</button>
          <button class="tab-btn ${activeTab === 'audit' ? 'active' : ''}" data-tab="audit">📋 Audit Trail</button>
        </div>

        <!-- Tab Content Area -->
        <div id="tab-content" style="padding: 24px;">
          
          <!-- 1. Organisation Profile -->
          <div id="org-tab" class="tab-section" style="display: ${activeTab === 'org' ? 'block' : 'none'};">
            <form id="org-form">
              ${isSettingsLoading ? `<div class="text-xs text-muted" style="margin-bottom: 16px;">Loading current organisation settings...</div>` : ''}
              <div style="display: grid; grid-template-columns: 200px 1fr; gap: 32px;">
                <div>
                  <div class="form-label">Company Logo</div>
                  <div id="org-logo-preview" style="width: 100%; height: 150px; background: var(--bg-light); border: 2px dashed var(--border-color); border-radius: 12px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 12px;">
                    ${settings.org_logo ? `<img src="${settings.org_logo}" style="width: 100%; height: 100%; object-fit: contain;" />` : `<span class="text-muted text-xs">No Logo Uploaded</span>`}
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn btn-outline btn-sm" id="camera-logo-btn" style="flex: 1;">📷 Camera</button>
                    <label class="btn btn-outline btn-sm" style="flex: 1; cursor: pointer; text-align: center;">
                      📁 File
                      <input type="file" id="file-logo-input" accept="image/*" style="display: none;" />
                    </label>
                  </div>
                  <input type="hidden" name="org_logo" id="org-logo-data" value="${settings.org_logo || ''}" />
                  ${timestamps.org_logo ? `<div class="text-xs text-muted" style="margin-top: 8px; text-align: center;">Updated: ${new Date(timestamps.org_logo).toLocaleDateString()}</div>` : ''}
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                  <div class="form-group" style="grid-column: span 2;">
                    <label class="form-label">Institution Name</label>
                    <input type="text" name="org_name" class="form-control" value="${settings.org_name || ''}" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Physical Address</label>
                    <input type="text" name="org_address" class="form-control" value="${settings.org_address || ''}" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Registration No.</label>
                    <input type="text" name="org_reg_no" class="form-control" value="${settings.org_reg_no || ''}" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Phone Number</label>
                    <input type="tel" name="org_phone" class="form-control" value="${settings.org_phone || ''}" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Email Address</label>
                    <input type="email" name="org_email" class="form-control" value="${settings.org_email || ''}" />
                  </div>
                </div>
              </div>
              <div style="display: flex; justify-content: flex-end; margin-top: 24px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                <button type="submit" class="btn btn-primary" ${isSettingsLoading ? 'disabled' : ''}>Save Organisation Details</button>
              </div>
            </form>
          </div>

          <!-- 2. Users & Roles -->
          <div id="users-tab" class="tab-section" style="display: ${activeTab === 'users' ? 'block' : 'none'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h3>System User Management</h3>
              <button class="btn btn-primary btn-sm" id="add-user-btn">+ Create User</button>
            </div>
            
            <div class="table-responsive">
              <table class="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${isUsersLoading ? `
                    <tr>
                      <td colspan="5" class="text-center text-muted" style="padding: 32px;">
                        <div class="spinner" style="margin: 0 auto 12px;"></div>
                        Loading users...
                      </td>
                    </tr>
                  ` : users.length === 0 ? `
                    <tr>
                      <td colspan="5" class="text-center text-muted" style="padding: 24px;">No users found.</td>
                    </tr>
                  ` : users.map(u => `
                    <tr>
                      <td>
                        <div class="font-semibold">${u.name || 'Unnamed'}</div>
                        <div class="text-xs text-muted">${u.email}</div>
                      </td>
                      <td>
                        <span class="badge" style="background: rgba(27,61,114,0.1); color: var(--primary);">
                          ${(u.role || 'user').toUpperCase().replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        <span class="badge ${u.status === 'suspended' ? 'badge-danger' : 'badge-success'}">
                          ${(u.status || 'active').toUpperCase()}
                        </span>
                      </td>
                      <td class="text-xs text-muted">${u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                      <td>
                        <div style="display: flex; gap: 8px;">
                          <button class="btn btn-outline btn-xs edit-user-btn" data-id="${u.id}">Edit</button>
                          ${u.status === 'suspended' 
                            ? `<button class="btn btn-outline btn-xs activate-user-btn" data-id="${u.id}" style="color: var(--success); border-color: var(--success);">Activate</button>`
                            : `<button class="btn btn-outline btn-xs suspend-user-btn" data-id="${u.id}" style="color: var(--warning); border-color: var(--warning);">Suspend</button>`
                          }
                          ${isSuperAdmin && u.id !== pb.authStore.model?.id ? `<button class="btn btn-danger btn-xs delete-user-btn" data-id="${u.id}">Delete</button>` : ''}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Add/Edit User Modal -->
          <div id="user-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; padding: 20px;">
            <div class="card" style="width: 100%; max-width: 500px;">
              <h3 id="user-modal-title" style="margin-bottom: 24px;">Create New User</h3>
              <form id="user-form">
                <input type="hidden" id="user-edit-id" value="">
                <div class="form-group">
                  <label class="form-label">Full Name</label>
                  <input type="text" name="name" class="form-control" required />
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                  <div class="form-group">
                    <label class="form-label">Email</label>
                    <input type="email" name="email" class="form-control" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Role</label>
                    <select name="role" class="form-control" required>
                      <option value="super_admin">Super Admin</option>
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="loan_officer">Loan Officer</option>
                      <option value="cashier">Cashier</option>
                      <option value="group_officer">Group Officer</option>
                      <option value="auditor">Auditor</option>
                    </select>
                  </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                  <div class="form-group">
                    <label class="form-label" id="pwd-label">Password</label>
                    <input type="password" name="password" id="pwd-input" class="form-control" minlength="8" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Confirm Password</label>
                    <input type="password" name="passwordConfirm" id="pwd-confirm" class="form-control" minlength="8" required />
                  </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                  <button type="button" class="btn btn-outline" id="close-user-modal">Cancel</button>
                  <button type="submit" class="btn btn-primary" id="user-submit-btn">Save</button>
                </div>
              </form>
            </div>
          </div>

          <!-- 3. Voteheads -->
          <div id="voteheads-tab" class="tab-section" style="display: ${activeTab === 'voteheads' ? 'block' : 'none'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h3>Expense Categories</h3>
              <div style="display: flex; gap: 12px; align-items: center;">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; cursor: pointer;">
                  <input type="checkbox" id="toggle-archived-voteheads" ${showArchivedVoteheads ? 'checked' : ''}> Show Archived
                </label>
                <button class="btn btn-primary btn-sm" id="add-votehead-btn">+ New Category</button>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
              ${isVoteheadsLoading ? `
                <div class="card text-center text-muted" style="grid-column: 1/-1;">
                  <div class="spinner" style="margin: 0 auto 12px;"></div>
                  Loading voteheads...
                </div>
              ` : visibleVoteheads.length === 0 ? '<p class="text-muted">No voteheads found.</p>' : visibleVoteheads.map(v => `
                <div class="card" style="background: var(--bg-light); border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: flex-start; opacity: ${v.status === 'archived' ? '0.6' : '1'};">
                  <div>
                    <div class="font-semibold" style="color: var(--primary);">${v.name} ${v.status === 'archived' ? '<span class="badge badge-secondary text-xs">ARCHIVED</span>' : ''}</div>
                    <div class="text-xs text-muted" style="margin-top: 4px;">${v.description || 'No description'}</div>
                  </div>
                  <div style="display: flex; gap: 4px;">
                    <button class="btn btn-outline btn-xs edit-votehead-btn" data-id="${v.id}">✏️</button>
                    ${v.status !== 'archived' 
                      ? `<button class="btn btn-outline btn-xs archive-votehead-btn" data-id="${v.id}" style="color: var(--danger); border-color: var(--danger);">🗑</button>`
                      : `<button class="btn btn-outline btn-xs restore-votehead-btn" data-id="${v.id}" style="color: var(--success); border-color: var(--success);">↺ Restore</button>`
                    }
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Votehead Modal -->
          <div id="votehead-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; padding: 20px;">
            <div class="card" style="width: 100%; max-width: 400px;">
              <h3 id="votehead-modal-title" style="margin-bottom: 24px;">Add Expense Category</h3>
              <form id="votehead-form">
                <input type="hidden" id="votehead-edit-id" value="">
                <div class="form-group">
                  <label class="form-label">Category Name</label>
                  <input type="text" name="name" class="form-control" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Description</label>
                  <textarea name="description" class="form-control" rows="2"></textarea>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                  <button type="button" class="btn btn-outline" id="close-votehead-modal">Cancel</button>
                  <button type="submit" class="btn btn-primary">Save Category</button>
                </div>
              </form>
            </div>
          </div>

          <!-- 4. Rates & Fees -->
          <div id="rates-tab" class="tab-section" style="display: ${activeTab === 'rates' ? 'block' : 'none'};">
            <form id="rates-form">
              ${isSettingsLoading ? `<div class="text-xs text-muted" style="margin-bottom: 16px;">Loading current financial settings...</div>` : ''}
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px;">
                <div class="card" style="background: var(--bg-light);">
                  <h4 style="margin-bottom: 12px;">Financial Rates</h4>
                  <div class="form-group">
                    <label class="form-label">Processing Fee (%)</label>
                    <input type="number" name="processing_fee_percent" class="form-control" value="${settings.processing_fee_percent || 8}" step="0.1" />
                    ${timestamps.processing_fee_percent ? `<div class="text-xs text-muted" style="margin-top: 4px;">Updated: ${new Date(timestamps.processing_fee_percent).toLocaleDateString()}</div>` : ''}
                  </div>
                  <div class="form-group">
                    <label class="form-label">Interest Rate (%)</label>
                    <input type="number" name="interest_rate_percent" class="form-control" value="${settings.interest_rate_percent || 20}" step="0.1" />
                    ${timestamps.interest_rate_percent ? `<div class="text-xs text-muted" style="margin-top: 4px;">Updated: ${new Date(timestamps.interest_rate_percent).toLocaleDateString()}</div>` : ''}
                  </div>
                  <div class="form-group">
                    <label class="form-label">Currency Symbol</label>
                    <input type="text" name="currency_symbol" class="form-control" value="${settings.currency_symbol || 'KES'}" />
                  </div>
                </div>
                <div class="card" style="background: var(--bg-light);">
                  <h4 style="margin-bottom: 12px;">Registration Fees</h4>
                  <div class="form-group">
                    <label class="form-label">Individual Fee</label>
                    <input type="number" name="individual_reg_fee" class="form-control" value="${settings.individual_reg_fee || 1000}" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Group Fee</label>
                    <input type="number" name="group_reg_fee" class="form-control" value="${settings.group_reg_fee || 1000}" />
                  </div>
                </div>
                <div class="card" style="background: var(--bg-light);">
                  <h4 style="margin-bottom: 12px;">Penalties</h4>
                  <div class="form-group">
                    <label class="form-label">Late Payment Penalty</label>
                    <input type="number" name="penalty_amount" class="form-control" value="${settings.penalty_amount || 500}" />
                    <div class="text-xs text-muted" style="margin-top: 4px;">Fixed amount charged for overdue payments.</div>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Grace Period (Weeks)</label>
                    <input type="number" name="penalty_grace_weeks" class="form-control" value="${settings.penalty_grace_weeks || 4}" />
                  </div>
                </div>
              </div>
              <div style="display: flex; justify-content: flex-end; margin-top: 24px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                <button type="submit" class="btn btn-primary" ${isSettingsLoading ? 'disabled' : ''}>Save Rates & Settings</button>
              </div>
            </form>
          </div>

          <!-- 5. Audit Trail -->
          <div id="audit-tab" class="tab-section" style="display: ${activeTab === 'audit' ? 'block' : 'none'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <h3>System Audit Log</h3>
              <div style="display: flex; gap: 8px;">
                <select id="audit-filter" class="form-control form-control-sm" style="width: auto;">
                  <option value="all" ${auditFilter === 'all' ? 'selected' : ''}>All Actions</option>
                  <option value="settings_update" ${auditFilter === 'settings_update' ? 'selected' : ''}>Settings Update</option>
                  <option value="user_created" ${auditFilter === 'user_created' ? 'selected' : ''}>User Created</option>
                  <option value="user_updated" ${auditFilter === 'user_updated' ? 'selected' : ''}>User Updated</option>
                  <option value="user_deleted" ${auditFilter === 'user_deleted' ? 'selected' : ''}>User Deleted</option>
                </select>
              </div>
            </div>
            <div class="table-responsive card" style="padding: 0;">
              ${isAuditLoading ? `
                <div class="text-muted text-center" style="padding: 32px;">
                  <div class="spinner" style="margin: 0 auto 12px;"></div>
                  Loading audit trail...
                </div>
              ` : auditLogs.length === 0 ? `<p class="text-muted text-center" style="padding: 20px;">No audit logs found.</p>` : `
                <table class="table" style="font-size: 0.8rem;">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${auditLogs.map(log => `
                      <tr>
                        <td class="text-nowrap">${new Date(log.created).toLocaleString()}</td>
                        <td><code>${log.expand?.user?.name || log.expand?.user?.username || log.user || 'System'}</code></td>
                        <td><span class="badge" style="background: rgba(0,0,0,0.05);">${log.action}</span></td>
                        <td>${log.details}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
              <div id="audit-pagination"></div>
            </div>
          </div>

        </div>
      </div>
      <style>
        .tab-btn { flex: 1; padding: 16px; background: transparent; border: none; font-family: 'Inter', sans-serif; font-weight: 600; cursor: pointer; color: var(--text-muted); border-bottom: 2px solid transparent; transition: all 0.2s; white-space: nowrap; }
        .tab-btn:hover { background: rgba(27, 61, 114, 0.05); }
        .tab-btn.active { color: var(--primary); border-bottom-color: var(--secondary); background: rgba(27, 61, 114, 0.02); }
      </style>
    `;

    bindEvents();
  };

  const logAudit = async (action, details) => {
    try {
      await pb.collection('audit_log').create({
        action,
        details,
        user: pb.authStore.model?.id
      });
    } catch (e) {
      console.warn("Failed to write audit log:", e);
    }
  };

  const bindEvents = () => {
    // Tab switching
    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        container.querySelectorAll('.tab-section').forEach(s => s.style.display = 'none');
        btn.classList.add('active');
        container.querySelector(`#${btn.dataset.tab}-tab`).style.display = 'block';
      };
    });

    // Org Logo
    const logoPreview = container.querySelector('#org-logo-preview');
    const logoInput = container.querySelector('#org-logo-data');
    
    container.querySelector('#camera-logo-btn').onclick = () => {
      openCamera((dataUrl) => {
        logoPreview.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: contain;" />`;
        logoInput.value = dataUrl;
      });
    };

    container.querySelector('#file-logo-input').onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          logoPreview.innerHTML = `<img src="${ev.target.result}" style="width: 100%; height: 100%; object-fit: contain;" />`;
          logoInput.value = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
    };

    // Generic Settings Save
    const handleSettingsSave = async (e, label) => {
      e.preventDefault();
      
      // If it's the rates form, ask for confirmation
      if (e.target.id === 'rates-form') {
        const confirmed = confirm("Are you sure you want to update the financial rates? This will affect all new operations.");
        if (!confirmed) return;
      }
      
      const formData = new FormData(e.target);
      const obj = Object.fromEntries(formData.entries());
      const restoreButton = setButtonLoading(e.target.querySelector('button[type="submit"]'), 'Saving...');
      
      try {
        await settingsService.saveBulk(obj);
        await logAudit('settings_update', `${label} updated via admin panel`);
        if (window.notify) window.notify.success(`${label} updated successfully!`);
        await loadData();
        renderUI();
      } catch (err) {
        if (window.notify) window.notify.error('Error: ' + err.message);
        restoreButton();
      }
    };

    container.querySelector('#org-form').onsubmit = (e) => handleSettingsSave(e, 'Organisation details');
    container.querySelector('#rates-form').onsubmit = (e) => handleSettingsSave(e, 'Rates & Fees');

    // User Modal Logic
    const userModal = container.querySelector('#user-modal');
    const userForm = container.querySelector('#user-form');
    
    container.querySelector('#add-user-btn').onclick = () => {
      userForm.reset();
      container.querySelector('#user-edit-id').value = '';
      container.querySelector('#user-modal-title').textContent = 'Create New User';
      container.querySelector('[name="email"]').readOnly = false;
      container.querySelector('#pwd-input').required = true;
      container.querySelector('#pwd-confirm').required = true;
      container.querySelector('#pwd-label').textContent = 'Password';
      userModal.style.display = 'flex';
    };

    container.querySelector('#close-user-modal').onclick = () => userModal.style.display = 'none';

    container.querySelectorAll('.edit-user-btn').forEach(btn => {
      btn.onclick = () => {
        const user = users.find(u => u.id === btn.dataset.id);
        if (!user) return;
        userForm.reset();
        container.querySelector('#user-edit-id').value = user.id;
        container.querySelector('#user-modal-title').textContent = 'Edit User';
        container.querySelector('[name="name"]').value = user.name || '';
        container.querySelector('[name="email"]').value = user.email || '';
        container.querySelector('[name="email"]').readOnly = true;
        container.querySelector('[name="role"]').value = user.role || 'user';
        
        container.querySelector('#pwd-input').required = false;
        container.querySelector('#pwd-confirm').required = false;
        container.querySelector('#pwd-label').textContent = 'New Password (leave blank to keep)';
        userModal.style.display = 'flex';
      };
    });

    userForm.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(userForm);
      const data = Object.fromEntries(formData.entries());
      const editId = container.querySelector('#user-edit-id').value;

      if (data.password || data.passwordConfirm) {
        if (data.password !== data.passwordConfirm) {
          return window.notify?.error('Passwords do not match!');
        }
      } else {
        delete data.password;
        delete data.passwordConfirm;
      }
      
      data.emailVisibility = true;
      const restoreButton = setButtonLoading(userForm.querySelector('button[type="submit"]'), editId ? 'Updating...' : 'Creating...');

      try {
        if (editId) {
          await authService.updateUser(editId, data);
          await logAudit('user_updated', `User ${data.email} updated`);
          if (window.notify) window.notify.success('User updated!');
        } else {
          await pb.collection('users').create(data);
          await logAudit('user_created', `User ${data.email} created with role ${data.role}`);
          if (window.notify) window.notify.success('User created!');
        }
        userModal.style.display = 'none';
        await loadData();
        renderUI();
      } catch (err) {
        if (window.notify) window.notify.error(err.message);
        restoreButton();
      }
    };

    container.querySelectorAll('.suspend-user-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("Are you sure you want to suspend this user?")) return;
        const restoreButton = setButtonLoading(btn, 'Suspending...');
        try {
          await authService.suspendUser(btn.dataset.id);
          await logAudit('user_suspended', `User ID ${btn.dataset.id} suspended`);
          if (window.notify) window.notify.success('User suspended');
          await loadData();
          renderUI();
        } catch (e) {
          if (window.notify) window.notify.error(e.message);
          restoreButton();
        }
      };
    });

    container.querySelectorAll('.activate-user-btn').forEach(btn => {
      btn.onclick = async () => {
        const restoreButton = setButtonLoading(btn, 'Activating...');
        try {
          await authService.activateUser(btn.dataset.id);
          await logAudit('user_activated', `User ID ${btn.dataset.id} activated`);
          if (window.notify) window.notify.success('User activated');
          await loadData();
          renderUI();
        } catch (e) {
          if (window.notify) window.notify.error(e.message);
          restoreButton();
        }
      };
    });

    container.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("WARNING: This permanently deletes the user. Proceed?")) return;
        const restoreButton = setButtonLoading(btn, 'Deleting...');
        try {
          await authService.deleteUser(btn.dataset.id);
          await logAudit('user_deleted', `User ID ${btn.dataset.id} permanently deleted`);
          if (window.notify) window.notify.success('User deleted');
          await loadData();
          renderUI();
        } catch (e) {
          if (window.notify) window.notify.error(e.message);
          restoreButton();
        }
      };
    });

    // Voteheads Logic
    const voteheadModal = container.querySelector('#votehead-modal');
    const voteheadForm = container.querySelector('#votehead-form');

    container.querySelector('#toggle-archived-voteheads').onchange = (e) => {
      showArchivedVoteheads = e.target.checked;
      renderUI();
    };

    container.querySelector('#add-votehead-btn').onclick = () => {
      voteheadForm.reset();
      container.querySelector('#votehead-edit-id').value = '';
      container.querySelector('#votehead-modal-title').textContent = 'Add Expense Category';
      voteheadModal.style.display = 'flex';
    };

    container.querySelector('#close-votehead-modal').onclick = () => voteheadModal.style.display = 'none';

    container.querySelectorAll('.edit-votehead-btn').forEach(btn => {
      btn.onclick = () => {
        const v = voteheads.find(x => x.id === btn.dataset.id);
        if (!v) return;
        voteheadForm.reset();
        container.querySelector('#votehead-edit-id').value = v.id;
        container.querySelector('#votehead-modal-title').textContent = 'Edit Expense Category';
        voteheadForm.querySelector('[name="name"]').value = v.name || '';
        voteheadForm.querySelector('[name="description"]').value = v.description || '';
        voteheadModal.style.display = 'flex';
      };
    });

    voteheadForm.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(voteheadForm);
      const data = Object.fromEntries(formData.entries());
      const editId = container.querySelector('#votehead-edit-id').value;
      const restoreButton = setButtonLoading(voteheadForm.querySelector('button[type="submit"]'), editId ? 'Updating...' : 'Creating...');

      try {
        if (editId) {
          await expenseService.updateVotehead(editId, data);
          await logAudit('votehead_updated', `Votehead ${data.name} updated`);
        } else {
          await expenseService.createVotehead(data);
          await logAudit('votehead_created', `Votehead ${data.name} created`);
        }
        if (window.notify) window.notify.success('Category saved!');
        voteheadModal.style.display = 'none';
        await loadData();
        renderUI();
      } catch (err) {
        if (window.notify) window.notify.error(err.message);
        restoreButton();
      }
    };

    container.querySelectorAll('.archive-votehead-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("Are you sure you want to archive this category? It will no longer be available for new expenses.")) return;
        const restoreButton = setButtonLoading(btn, 'Archiving...');
        try {
          await expenseService.deleteVotehead(btn.dataset.id);
          await logAudit('votehead_archived', `Votehead ID ${btn.dataset.id} archived`);
          if (window.notify) window.notify.success('Category archived');
          await loadData();
          renderUI();
        } catch (err) {
          if (window.notify) window.notify.error(err.message);
          restoreButton();
        }
      };
    });

    container.querySelectorAll('.restore-votehead-btn').forEach(btn => {
      btn.onclick = async () => {
        const restoreButton = setButtonLoading(btn, 'Restoring...');
        try {
          await expenseService.updateVotehead(btn.dataset.id, { status: 'active' });
          await logAudit('votehead_restored', `Votehead ID ${btn.dataset.id} restored`);
          if (window.notify) window.notify.success('Category restored');
          await loadData();
          renderUI();
        } catch (err) {
          if (window.notify) window.notify.error(err.message);
          restoreButton();
        }
      };
    });

    // Audit Log Filter & Pagination
    const auditFilterSelect = container.querySelector('#audit-filter');
    auditFilterSelect.onchange = async () => {
      auditFilter = auditFilterSelect.value;
      auditPage = 1;
      await loadAuditLogs();
      renderUI();
    };

    const auditPag = container.querySelector('#audit-pagination');
    if (auditPag) {
      auditPag.innerHTML = '';
      const ctrl = renderPagination(auditTotal, auditPageSize, auditPage, async (p) => { 
        auditPage = p; 
        await loadAuditLogs();
        renderUI(); 
      });
      if (ctrl) auditPag.appendChild(ctrl);
    }
  };

  initialize();
  return container;
};
