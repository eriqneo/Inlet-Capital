import { getAll, getById, put, add } from '../../core/db.js';
import { openCamera } from '../../components/Camera.js';

export const renderAdminSettings = async () => {
  const container = document.createElement('div');
  
  // Fetch existing settings
  const settingsArray = await getAll('settings');
  const settings = Object.fromEntries(settingsArray.map(s => [s.key, s.value]));

  // Fetch users, voteheads, and audit log
  const users = await getAll('users');
  const voteheads = await getAll('voteheads');
  const auditLogs = await getAll('audit_log');
  auditLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 class="text-xl">Administration Centre</h1>
      <p class="text-muted">Manage your institution, users, and system rules.</p>
    </div>

    <!-- Tab Navigation -->
    <div class="card" style="padding: 0; margin-bottom: 24px;">
      <div style="display: flex; border-bottom: 1px solid var(--border-color);">
        <button class="tab-btn active" data-tab="org">🏢 Organisation</button>
        <button class="tab-btn" data-tab="users">👥 Users & Roles</button>
        <button class="tab-btn" data-tab="voteheads">📁 Voteheads</button>
        <button class="tab-btn" data-tab="rates">🔧 Rates & System</button>
      </div>

      <!-- Tab Content Area -->
      <div id="tab-content" style="padding: 24px;">
        
        <!-- 1. Organisation Profile -->
        <div id="org-tab">
          <form id="org-form">
            <div style="display: grid; grid-template-columns: 200px 1fr; gap: 32px;">
              <div>
                <div class="form-label">Company Logo</div>
                <div id="org-logo-preview" style="width: 100%; height: 150px; background: var(--bg-light); border: 2px dashed var(--border-color); border-radius: 12px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 12px;">
                  ${settings.org_logo ? `<img src="${settings.org_logo}" style="width: 100%; height: 100%; object-fit: contain;" />` : `<span class="text-muted text-xs">No Logo Uploaded</span>`}
                </div>
                <button type="button" class="btn btn-outline btn-sm" id="update-logo-btn" style="width: 100%;">Change Logo</button>
                <input type="hidden" name="org_logo" id="org-logo-data" value="${settings.org_logo || ''}" />
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
              <button type="submit" class="btn btn-primary">Save Organisation Details</button>
            </div>
          </form>
        </div>

        <!-- 2. Users & Roles -->
        <div id="users-tab" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3>System User Management</h3>
            <button class="btn btn-primary btn-sm" id="add-user-btn">+ Create User Account</button>
          </div>
          
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Username / ID</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="users-table-body">
                ${users.map(u => `
                  <tr>
                    <td><div class="font-semibold">${u.name}</div></td>
                    <td><code>${u.id}</code></td>
                    <td>
                      <span class="badge" style="
                        background: ${
                          u.role === 'admin' ? 'rgba(16, 185, 129, 0.1)' : 
                          u.role === 'loan_officer' ? 'rgba(37, 99, 235, 0.1)' : 'rgba(245, 158, 11, 0.1)'
                        };
                        color: ${
                          u.role === 'admin' ? 'var(--success)' : 
                          u.role === 'loan_officer' ? 'var(--primary)' : 'var(--warning)'
                        };
                      ">
                        ${u.role.toUpperCase().replace('_', ' ')}
                      </span>
                    </td>
                    <td><span class="badge badge-success">ACTIVE</span></td>
                    <td>
                      <div style="display: flex; gap: 8px;">
                        <button class="btn btn-outline btn-xs edit-user-btn" data-id="${u.id}">Edit</button>
                        ${u.id !== 'admin' ? `<button class="btn btn-outline btn-xs text-danger" style="border-color: rgba(239, 68, 68, 0.2);">Deactivate</button>` : ''}
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Add User Modal Overlay -->
        <div id="user-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; padding: 20px;">
          <div class="card" style="width: 100%; max-width: 500px;">
            <h3 id="user-modal-title" style="margin-bottom: 24px;">Create New System User</h3>
            <form id="add-user-form">
              <input type="hidden" id="user-edit-mode" value="false">
              <div class="form-group">
                <label class="form-label">Full Name</label>
                <input type="text" name="name" class="form-control" placeholder="e.g. Jane Doe" required />
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                  <label class="form-label">Username (Login ID)</label>
                  <input type="text" name="id" class="form-control" placeholder="jdoe" required />
                </div>
                <div class="form-group">
                  <label class="form-label">System Role</label>
                  <select name="role" class="form-control" required>
                    <option value="teller">Teller</option>
                    <option value="loan_officer">Loan Officer</option>
                    <option value="admin">Super Admin</option>
                    <option value="auditor">Auditor (Read-only)</option>
                  </select>
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                  <label class="form-label" id="pin-label">Login PIN (4-6 digits)</label>
                  <input type="password" name="pin" class="form-control" id="pin-input" required minlength="4" maxlength="6" />
                </div>
                <div class="form-group">
                  <label class="form-label" id="confirm-pin-label">Confirm PIN</label>
                  <input type="password" name="confirm_pin" class="form-control" id="confirm-pin-input" required minlength="4" maxlength="6" />
                </div>
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px;">
                <button type="button" class="btn btn-outline" id="close-user-modal">Cancel</button>
                <button type="submit" class="btn btn-primary" id="user-submit-btn">Create Account</button>
              </div>
            </form>
          </div>
        </div>

        <!-- 3. Voteheads -->
        <div id="voteheads-tab" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3>Expense Voteheads</h3>
            <button class="btn btn-primary btn-sm" id="add-votehead-btn">+ New Expense Category</button>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
            ${voteheads.map(v => `
              <div class="card" style="background: var(--bg-light); border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                  <div class="font-semibold" style="color: var(--primary);">${v.name}</div>
                  <div class="text-xs text-muted" style="margin-top: 4px;">${v.description}</div>
                </div>
                <button class="btn btn-outline btn-xs" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.2);">Delete</button>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Add Votehead Modal -->
        <div id="votehead-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; padding: 20px;">
          <div class="card" style="width: 100%; max-width: 400px;">
            <h3 style="margin-bottom: 24px;">Add Expense Category</h3>
            <form id="add-votehead-form">
              <div class="form-group">
                <label class="form-label">Votehead Name</label>
                <input type="text" name="name" class="form-control" placeholder="e.g. Office Rent" required />
              </div>
              <div class="form-group">
                <label class="form-label">Description</label>
                <textarea name="description" class="form-control" rows="2" placeholder="Describe what this expense covers..."></textarea>
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
                <button type="button" class="btn btn-outline" id="close-votehead-modal">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Category</button>
              </div>
            </form>
          </div>
        </div>

        <!-- 4. Rates & System (Existing logic moved here) -->
        <div id="rates-tab" style="display: none;">
          <form id="rates-form">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
              <div class="card" style="background: var(--bg-light);">
                <h4 style="margin-bottom: 12px;">Financial Rates</h4>
                <div class="form-group">
                  <label class="form-label">Processing Fee (%)</label>
                  <input type="number" name="processing_fee_percent" class="form-control" value="${settings.processing_fee_percent || 8}" step="0.1" />
                </div>
                <div class="form-group">
                  <label class="form-label">Interest Rate (%)</label>
                  <input type="number" name="interest_rate_percent" class="form-control" value="${settings.interest_rate_percent || 20}" step="0.1" />
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
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 24px; border-top: 1px solid var(--border-color); padding-top: 16px; gap: 12px;">
              <button type="button" class="btn btn-outline btn-sm" id="export-data-btn">Backup Data (JSON)</button>
              <button type="submit" class="btn btn-primary">Save Rates & Settings</button>
            </div>
          </form>

          <div style="margin-top: 40px;">
            <h4 style="margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">System Audit Log</h4>
            <div style="max-height: 300px; overflow-y: auto; background: var(--bg-light); border-radius: 8px; padding: 12px;">
              ${auditLogs.length === 0 ? `<p class="text-xs text-muted text-center">No audit logs recorded.</p>` : `
                <table class="table" style="font-size: 0.75rem;">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${auditLogs.slice(0, 50).map(log => `
                      <tr>
                        <td class="text-nowrap">${new Date(log.date).toLocaleString()}</td>
                        <td><code>${log.userId}</code></td>
                        <td><span class="badge" style="background: rgba(0,0,0,0.05);">${log.action}</span></td>
                        <td>${log.details}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>
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
        transition: all 0.2s;
      }
      .tab-btn:hover {
        background: rgba(27, 61, 114, 0.05);
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
  const sections = {
    org: container.querySelector('#org-tab'),
    users: container.querySelector('#users-tab'),
    voteheads: container.querySelector('#voteheads-tab'),
    rates: container.querySelector('#rates-tab')
  };

  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(sections).forEach(s => s.style.display = 'none');
      sections[tab.dataset.tab].style.display = 'block';
    };
  });

  // Logo Upload logic
  const updateLogoBtn = container.querySelector('#update-logo-btn');
  const logoPreview = container.querySelector('#org-logo-preview');
  const logoInput = container.querySelector('#org-logo-data');

  updateLogoBtn.onclick = () => {
    openCamera((dataUrl) => {
      logoPreview.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: contain;" />`;
      logoInput.value = dataUrl;
    });
  };

  // Generic Save Handler
  const handleSave = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    try {
      for (let [key, value] of formData.entries()) {
        const val = isNaN(value) || value === '' ? value : parseFloat(value);
        await put('settings', { key, value: val });
      }
      notify.success('Settings updated successfully!');
      
      // Log to Audit Log (Phase 4 anticipation)
      await add('audit_log', {
        action: 'settings_update',
        details: 'System settings updated via admin panel',
        date: new Date().toISOString(),
        userId: 'admin'
      });
    } catch (err) {
      notify.error('Error: ' + err.message);
    }
  };

  container.querySelector('#org-form').onsubmit = handleSave;
  container.querySelector('#rates-form').onsubmit = handleSave;

  // User Management Modal Logic
  const userModal = container.querySelector('#user-modal');
  const addUserBtn = container.querySelector('#add-user-btn');
  const closeUserBtn = container.querySelector('#close-user-modal');
  const addUserForm = container.querySelector('#add-user-form');
  const userModalTitle = container.querySelector('#user-modal-title');
  const userEditMode = container.querySelector('#user-edit-mode');
  const usernameInput = addUserForm.querySelector('[name="id"]');
  const pinInput = container.querySelector('#pin-input');
  const confirmPinInput = container.querySelector('#confirm-pin-input');
  const pinLabel = container.querySelector('#pin-label');
  const confirmPinLabel = container.querySelector('#confirm-pin-label');
  const userSubmitBtn = container.querySelector('#user-submit-btn');

  const resetUserForm = () => {
    addUserForm.reset();
    userModalTitle.textContent = 'Create New System User';
    userEditMode.value = 'false';
    usernameInput.removeAttribute('readonly');
    usernameInput.removeAttribute('disabled');
    pinInput.setAttribute('required', '');
    confirmPinInput.setAttribute('required', '');
    pinLabel.textContent = 'Login PIN (4-6 digits)';
    confirmPinLabel.textContent = 'Confirm PIN';
    userSubmitBtn.textContent = 'Create Account';
  };

  addUserBtn.onclick = () => {
    resetUserForm();
    userModal.style.display = 'flex';
  };

  closeUserBtn.onclick = () => {
    resetUserForm();
    userModal.style.display = 'none';
  };

  // Use event delegation — handles dynamically rendered rows safely
  container.querySelector('#users-table-body').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-user-btn');
    if (!editBtn) return;
    const userId = editBtn.dataset.id;
    const existing = users.find(u => u.id === userId);
    if (!existing) { notify.error('User not found.'); return; }

    resetUserForm();
    userModalTitle.textContent = 'Edit System User';
    userEditMode.value = 'true';
    userEditMode.dataset.editId = userId;
    usernameInput.value = existing.id;
    usernameInput.setAttribute('readonly', '');
    addUserForm.querySelector('[name="name"]').value = existing.name || '';
    addUserForm.querySelector('[name="role"]').value = existing.role || 'teller';

    pinInput.removeAttribute('required');
    confirmPinInput.removeAttribute('required');
    pinLabel.textContent = 'New PIN (leave blank to keep current)';
    confirmPinLabel.textContent = 'Confirm New PIN';
    userSubmitBtn.textContent = 'Update Account';

    userModal.style.display = 'flex';
  });

  addUserForm.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(addUserForm);
    const data = Object.fromEntries(formData.entries());
    const isEdit = userEditMode.value === 'true';
    const editId = userEditMode.dataset.editId;

    // PIN validation
    if (data.pin || data.confirm_pin) {
      if (data.pin !== data.confirm_pin) {
        notify.error('PINs do not match!');
        return;
      }
    } else if (!isEdit) {
      notify.error('A PIN is required for new users!');
      return;
    }

    try {
      if (!isEdit) {
        // Creating new — check uniqueness using in-memory list first
        const alreadyExists = users.find(u => u.id === data.id.trim());
        if (alreadyExists) {
          notify.error('Username already exists. Choose a different Login ID.');
          return;
        }
        data.id = data.id.trim();
        data.status = 'active';
        data.createdAt = new Date().toISOString();
      } else {
        // Editing — preserve immutable fields from the original record
        const original = users.find(u => u.id === editId);
        if (!original) { notify.error('Original user not found.'); return; }
        data.id = original.id; // enforce original id (field is readonly anyway)
        data.status = original.status;
        data.createdAt = original.createdAt;
        // Only update PIN if a new one was provided
        data.pin = data.pin ? data.pin : original.pin;
      }

      delete data.confirm_pin;

      await put('users', data);
      notify.success(isEdit ? 'User account updated successfully!' : 'User account created successfully!');
      resetUserForm();
      userModal.style.display = 'none';
      window.location.reload();
    } catch (err) {
      notify.error('Error saving user: ' + err.message);
    }
  };

  // Votehead Modal Logic
  const vModal = container.querySelector('#votehead-modal');
  const addVBtn = container.querySelector('#add-votehead-btn');
  const closeVBtn = container.querySelector('#close-votehead-modal');
  const addVForm = container.querySelector('#add-votehead-form');

  addVBtn.onclick = () => vModal.style.display = 'flex';
  closeVBtn.onclick = () => vModal.style.display = 'none';

  addVForm.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(addVForm);
    const data = Object.fromEntries(formData.entries());
    
    try {
      data.id = data.name.toLowerCase().replace(/\s+/g, '_');
      await put('voteheads', data);
      notify.success('Expense category added!');
      vModal.style.display = 'none';
      window.location.reload();
    } catch (err) {
      notify.error('Error: ' + err.message);
    }
  };

  // Backup Data Logic
  const exportBtn = container.querySelector('#export-data-btn');
  exportBtn.onclick = async () => {
    try {
      const stores = ['users', 'settings', 'members', 'groups', 'loans', 'savings', 'expenses', 'voteheads'];
      const backup = {};
      
      for (const store of stores) {
        backup[store] = await getAll(store);
      }
      
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inlet_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      notify.success('Backup file generated!');
    } catch (err) {
      notify.error('Export failed: ' + err.message);
    }
  };

  return container;
};
