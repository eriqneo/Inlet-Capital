import { getById, getAll, put, remove } from '../../core/db.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate, initDateMask, parseInputDate, formatToInputDate } from '../../core/utils.js';
import { openCamera } from '../../components/Camera.js';
import { navigate } from '../../core/router.js';

export const renderMemberProfile = async (params) => {
  const { id } = params;
  const member = await getById('members', id);

  if (!member) {
    const el = document.createElement('div');
    el.innerHTML = `<div class="card text-center"><h2>Member Not Found</h2><button class="btn btn-primary" onclick="window.location.hash = '#/members'">Back to List</button></div>`;
    return el;
  }

  // Fetch real history data
  const allLoans = await getAll('loans');
  const allSavings = await getAll('savings');
  
  const memberLoans = allLoans.filter(l => l.memberId === member.regNo).sort((a,b) => new Date(b.applicationDate) - new Date(a.applicationDate));
  const memberSavings = allSavings.filter(s => s.memberId === member.regNo).sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalBorrowed = memberLoans.reduce((sum, l) => sum + l.amountApplied, 0);
  const totalSavings = memberSavings.reduce((sum, s) => sum + s.amount, 0);

  let loanPage = 1;
  let savingsPage = 1;
  const pageSize = 10;

  const container = document.createElement('div');
  
  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/members'">← Back</button>
        <h1 class="text-xl">Member Profile</h1>
      </div>
      <div style="display: flex; gap: 12px;">
        <button class="btn btn-outline btn-sm" id="edit-profile-btn">Edit Profile</button>
        <button class="btn btn-secondary btn-sm" onclick="window.location.hash = '#/loans/new?memberId=${member.regNo}'">+ Apply for Loan</button>
      </div>
    </div>

    <!-- Edit Profile Modal -->
    <div id="edit-profile-modal" class="modal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); align-items: center; justify-content: center;">
      <div class="card" style="width: 90%; max-width: 800px; max-height: 90vh; overflow-y: auto; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <h2 class="text-lg">Edit Member Profile</h2>
          <button id="close-modal-btn" style="background: transparent; border: none; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        <form id="edit-member-form">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
            <div>
              <h4 class="text-sm text-muted" style="margin-bottom: 12px; border-bottom: 1px solid var(--bg-light);">Personal Details</h4>
              <div class="form-group">
                <label class="form-label">Full Name</label>
                <input type="text" name="fullName" class="form-control" value="${member.fullName}" required />
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group">
                  <label class="form-label">ID Number</label>
                  <input type="text" name="idNo" class="form-control" value="${member.idNo}" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Date of Birth</label>
                  <input type="text" id="edit-dob-input" name="dob" class="form-control" value="${formatToInputDate(member.dob)}" placeholder="dd/mm/yyyy" required />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group">
                  <label class="form-label">Marital Status</label>
                  <select name="maritalStatus" class="form-control">
                    <option value="Single" ${member.maritalStatus === 'Single' ? 'selected' : ''}>Single</option>
                    <option value="Married" ${member.maritalStatus === 'Married' ? 'selected' : ''}>Married</option>
                    <option value="Divorced" ${member.maritalStatus === 'Divorced' ? 'selected' : ''}>Divorced</option>
                    <option value="Widowed" ${member.maritalStatus === 'Widowed' ? 'selected' : ''}>Widowed</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">No. of Children</label>
                  <input type="number" name="childrenCount" class="form-control" value="${member.childrenCount || 0}" />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Phone</label>
                <input type="tel" name="phone" class="form-control" value="${member.phone}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Residence</label>
                <input type="text" name="residence" class="form-control" value="${member.residence}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Account Status</label>
                <select name="status" class="form-control">
                  <option value="active" ${member.status === 'active' ? 'selected' : ''}>Active</option>
                  <option value="inactive" ${member.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                  <option value="suspended" ${member.status === 'suspended' ? 'selected' : ''}>Suspended</option>
                </select>
              </div>
            </div>
            <div>
              <h4 class="text-sm text-muted" style="margin-bottom: 12px; border-bottom: 1px solid var(--bg-light);">Photos & Next of Kin</h4>
              <div class="form-group" style="text-align: center;">
                <div id="edit-photo-preview" style="width: 100px; height: 100px; border-radius: 50%; border: 2px solid var(--border-color); margin: 0 auto 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--bg-light);">
                  ${member.passportPhoto ? `<img src="${member.passportPhoto}" style="width: 100%; height: 100%; object-fit: cover;" />` : '<span>👤</span>'}
                </div>
                <button type="button" id="edit-photo-btn" class="btn btn-outline btn-xs">Change Photo</button>
                <input type="hidden" name="passportPhoto" id="edit-photo-data" value="${member.passportPhoto || ''}" />
              </div>
              <div class="form-group">
                <label class="form-label">Next of Kin Name</label>
                <input type="text" name="nokName" class="form-control" value="${member.nokName}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Next of Kin Phone</label>
                <input type="tel" name="nokPhone" class="form-control" value="${member.nokPhone}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Relationship</label>
                <input type="text" name="nokRelationship" class="form-control" value="${member.nokRelationship}" required />
              </div>
            </div>
          </div>
          <div style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px; padding-top: 16px; border-top: 1px solid var(--border-color);">
            <button type="button" id="cancel-modal-btn" class="btn btn-outline">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Loan Modal -->
    <div id="edit-loan-modal" class="modal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); align-items: center; justify-content: center;">
      <div class="card" style="width: 90%; max-width: 500px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <h2 class="text-lg">Edit Loan</h2>
          <button id="close-loan-modal-btn" style="background: transparent; border: none; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        <form id="edit-loan-form">
          <input type="hidden" name="loanNo" id="edit-loan-no" />
          <div class="form-group">
            <label class="form-label">Amount Applied (KES)</label>
            <input type="number" name="amountApplied" id="edit-loan-amount" class="form-control" required />
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select name="status" id="edit-loan-status" class="form-control" required>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="partial_approved">Partial Approved</option>
              <option value="disbursed">Disbursed</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Application Date</label>
            <input type="date" name="applicationDate" id="edit-loan-date" class="form-control" required />
          </div>
          <div style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px; padding-top: 16px; border-top: 1px solid var(--border-color);">
            <button type="button" id="cancel-loan-modal-btn" class="btn btn-outline">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Savings Modal -->
    <div id="edit-savings-modal" class="modal" style="display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); align-items: center; justify-content: center;">
      <div class="card" style="width: 90%; max-width: 500px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <h2 class="text-lg">Edit Savings Record</h2>
          <button id="close-savings-modal-btn" style="background: transparent; border: none; font-size: 24px; cursor: pointer;">&times;</button>
        </div>
        <form id="edit-savings-form">
          <input type="hidden" name="id" id="edit-savings-id" />
          <div class="form-group">
            <label class="form-label">Amount (KES)</label>
            <input type="number" name="amount" id="edit-savings-amount" class="form-control" required />
          </div>
          <div class="form-group">
            <label class="form-label">Transaction Type</label>
            <select name="type" id="edit-savings-type" class="form-control" required>
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Date</label>
            <input type="date" name="date" id="edit-savings-date" class="form-control" required />
          </div>
          <div class="form-group">
            <label class="form-label">Reference</label>
            <input type="text" name="reference" id="edit-savings-ref" class="form-control" />
          </div>
          <div style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px; padding-top: 16px; border-top: 1px solid var(--border-color);">
            <button type="button" id="cancel-savings-modal-btn" class="btn btn-outline">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 300px 1fr; gap: 24px;">
      <!-- Sidebar Info -->
      <div>
        <div class="card text-center" style="margin-bottom: 24px;">
          <div style="width: 120px; height: 120px; background: var(--bg-light); border-radius: 50%; margin: 0 auto 16px; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            ${member.passportPhoto ? `<img src="${member.passportPhoto}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span style="font-size: 48px;">👤</span>`}
          </div>
          <h2 style="font-size: 1.25rem;">${member.fullName}</h2>
          <p class="text-muted text-sm">${member.regNo}</p>
          <div style="margin-top: 12px;">
            <span class="badge ${member.status === 'active' ? 'badge-success' : 'badge-danger'}">${member.status.toUpperCase()}</span>
          </div>
        </div>

        <div class="card" style="font-size: 0.875rem;">
          <h3 style="font-size: 1rem; margin-bottom: 12px;">Financial Summary</h3>
          <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span class="text-muted">Total Savings:</span> 
            <span class="font-semibold text-success">KES ${totalSavings.toLocaleString()}</span>
          </div>
          <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span class="text-muted">Total Loans:</span> 
            <span class="font-semibold text-primary">KES ${totalBorrowed.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <!-- Main Profile Content -->
      <div>
        <div class="card" style="padding: 0;">
          <div style="display: flex; border-bottom: 1px solid var(--border-color);">
            <button class="tab-btn active" data-tab="overview">Overview</button>
            <button class="tab-btn" data-tab="loans">Loans History (${memberLoans.length})</button>
            <button class="tab-btn" data-tab="savings">Savings History (${memberSavings.length})</button>
          </div>
          
          <div id="tab-content" style="padding: 24px;">
            <div id="overview-tab">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
                <div>
                  <h4 class="text-sm text-muted" style="margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">Personal Details</h4>
                  <p style="margin-bottom: 8px;"><strong>ID Number:</strong> ${member.idNo}</p>
                  <p style="margin-bottom: 8px;"><strong>Phone:</strong> ${member.phone}</p>
                  <p style="margin-bottom: 8px;"><strong>Residence:</strong> ${member.residence}</p>
                  <p style="margin-bottom: 8px;"><strong>Date of Birth:</strong> ${formatDate(member.dob)}</p>
                  <p style="margin-bottom: 8px;"><strong>Marital Status:</strong> ${member.maritalStatus || 'Single'}</p>
                  <p style="margin-bottom: 8px;"><strong>No. of Children:</strong> ${member.childrenCount || 0}</p>
                </div>
                <div>
                  <h4 class="text-sm text-muted" style="margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">Registration & NOK Info</h4>
                  <p style="margin-bottom: 8px;"><strong>Registration Date:</strong> ${formatDate(member.registrationDate)}</p>
                  <p style="margin-bottom: 8px;"><strong>Fee Paid:</strong> KES ${member.registrationFee.toLocaleString()}</p>
                  <p style="margin-bottom: 8px; margin-top: 16px;"><strong>Next of Kin:</strong> ${member.nokName} (${member.nokRelationship})</p>
                  <p style="margin-bottom: 8px;"><strong>NOK Phone:</strong> <a href="tel:${member.nokPhone}" style="color: var(--primary); font-weight: 500;">${member.nokPhone}</a></p>
                </div>
              </div>
            </div>

            <div id="loans-tab" style="display: none;">
              <div class="table-responsive">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Loan No</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody id="member-loans-body"></tbody>
                </table>
              </div>
              <div id="member-loans-pagination"></div>
            </div>

            <div id="savings-tab" style="display: none;">
              <div class="table-responsive">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Ref</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody id="member-savings-body"></tbody>
                </table>
              </div>
              <div id="member-savings-pagination"></div>
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
      }
      .tab-btn.active {
        color: var(--primary);
        border-bottom-color: var(--secondary);
        background: rgba(27, 61, 114, 0.02);
      }
    </style>
  `;

  const updateLoansUI = () => {
    const start = (loanPage - 1) * pageSize;
    const paginated = memberLoans.slice(start, start + pageSize);
    const tbody = container.querySelector('#member-loans-body');
    
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="5" class="text-center text-muted">No loan history found.</td></tr>' : paginated.map(l => `
      <tr>
        <td><strong>${l.loanNo}</strong></td>
        <td>KES ${l.amountApplied.toLocaleString()}</td>
        <td>
          <span class="badge ${
            l.status === 'disbursed' ? 'badge-success' :
            l.status === 'completed' ? 'badge-success' :
            (l.status === 'approved' || l.status === 'partial_approved') ? 'badge-primary' :
            l.status === 'pending' ? 'badge-warning' :
            'badge-danger'
          }" style="${
            l.status === 'approved' || l.status === 'partial_approved' ? 'background: #0d9488; color: white;' : ''
          }">
            ${l.status === 'disbursed' ? 'DISBURSED' :
              l.status === 'approved' ? 'APPROVED' :
              l.status === 'partial_approved' ? 'PARTIAL APPROVED' :
              l.status.toUpperCase()}
          </span>
        </td>
        <td>${formatDate(l.applicationDate)}</td>
        <td>
          <div style="display:flex; gap:4px;">
            <button class="btn btn-outline btn-xs" onclick="window.location.hash = '#/loans/${l.loanNo}'">View</button>
            <button class="btn btn-primary btn-xs edit-loan-btn" data-id="${l.loanNo}">Edit</button>
            <button class="btn btn-danger btn-xs delete-loan-btn" data-id="${l.loanNo}">Delete</button>
          </div>
        </td>
      </tr>`).join('');

    const pag = container.querySelector('#member-loans-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(memberLoans.length, pageSize, loanPage, (p) => { loanPage = p; updateLoansUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateSavingsUI = () => {
    const start = (savingsPage - 1) * pageSize;
    const paginated = memberSavings.slice(start, start + pageSize);
    const tbody = container.querySelector('#member-savings-body');
    
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No savings history found.</td></tr>' : paginated.map(s => `
      <tr>
        <td>${formatDate(s.date)}</td>
        <td><span class="badge" style="background: ${s.type === 'deposit' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type.toUpperCase()}</span></td>
        <td class="font-semibold" style="color: ${s.amount > 0 ? 'var(--success)' : 'var(--danger)'}">${s.amount > 0 ? '+' : ''}${s.amount.toLocaleString()}</td>
        <td class="text-xs text-muted">${s.reference || '-'}</td>
        <td>
          <div style="display:flex; gap:4px;">
            <button class="btn btn-primary btn-xs edit-savings-btn" data-id="${s.id}">Edit</button>
            <button class="btn btn-danger btn-xs delete-savings-btn" data-id="${s.id}">Delete</button>
          </div>
        </td>
      </tr>`).join('');

    const pag = container.querySelector('#member-savings-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(memberSavings.length, pageSize, savingsPage, (p) => { savingsPage = p; updateSavingsUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  updateLoansUI();
  updateSavingsUI();

  // Tab switching logic
  const tabs = container.querySelectorAll('.tab-btn');
  const contents = {
    overview: container.querySelector('#overview-tab'),
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

  // Modal Logic
  const editBtn = container.querySelector('#edit-profile-btn');
  const modal = container.querySelector('#edit-profile-modal');
  const closeBtn = container.querySelector('#close-modal-btn');
  const cancelBtn = container.querySelector('#cancel-modal-btn');
  const editForm = container.querySelector('#edit-member-form');
  const editPhotoBtn = container.querySelector('#edit-photo-btn');
  const photoPreview = container.querySelector('#edit-photo-preview');
  const photoInput = container.querySelector('#edit-photo-data');

  const toggleModal = (show) => {
    modal.style.display = show ? 'flex' : 'none';
  };

  editBtn.onclick = () => {
    toggleModal(true);
    initDateMask(container.querySelector('#edit-dob-input'));
  };
  closeBtn.onclick = () => toggleModal(false);
  cancelBtn.onclick = () => toggleModal(false);

  editPhotoBtn.onclick = () => {
    openCamera((dataUrl) => {
      photoPreview.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`;
      photoInput.value = dataUrl;
    });
  };

  editForm.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(editForm);
    const updatedData = Object.fromEntries(formData.entries());
    
    const updatedMember = {
      ...member,
      ...updatedData,
      dob: parseInputDate(updatedData.dob),
      lastUpdated: new Date().toISOString()
    };

    try {
      await put('members', updatedMember);
      notify.success('Profile updated successfully!');
      toggleModal(false);
      // Re-render the profile page
      const newProfile = await renderMemberProfile(params);
      container.innerHTML = '';
      container.appendChild(newProfile);
    } catch (err) {
      notify.error('Error updating profile: ' + err.message);
    }
  };

  // --- Edit & Delete functionality for Loans & Savings ---
  container.addEventListener('click', async (e) => {
    // Delete Loan
    if (e.target.classList.contains('delete-loan-btn')) {
      const id = e.target.dataset.id;
      if (confirm('Are you sure you want to delete this loan? This action cannot be undone.')) {
        try {
          await remove('loans', id);
          notify.success('Loan deleted successfully');
          const newProfile = await renderMemberProfile(params);
          container.innerHTML = '';
          container.appendChild(newProfile);
        } catch (err) {
          notify.error('Error deleting loan: ' + err.message);
        }
      }
    }

    // Edit Loan
    if (e.target.classList.contains('edit-loan-btn')) {
      const id = e.target.dataset.id;
      const loan = memberLoans.find(l => l.loanNo === id);
      if (loan) {
        container.querySelector('#edit-loan-no').value = loan.loanNo;
        container.querySelector('#edit-loan-amount').value = loan.amountApplied;
        container.querySelector('#edit-loan-status').value = loan.status;
        container.querySelector('#edit-loan-date').value = loan.applicationDate.split('T')[0];
        container.querySelector('#edit-loan-modal').style.display = 'flex';
      }
    }

    // Delete Savings
    if (e.target.classList.contains('delete-savings-btn')) {
      const id = parseInt(e.target.dataset.id);
      if (confirm('Are you sure you want to delete this savings record? This action cannot be undone.')) {
        try {
          await remove('savings', id);
          notify.success('Savings record deleted');
          const newProfile = await renderMemberProfile(params);
          container.innerHTML = '';
          container.appendChild(newProfile);
        } catch (err) {
          notify.error('Error deleting savings: ' + err.message);
        }
      }
    }

    // Edit Savings
    if (e.target.classList.contains('edit-savings-btn')) {
      const id = parseInt(e.target.dataset.id);
      const savings = memberSavings.find(s => s.id === id);
      if (savings) {
        container.querySelector('#edit-savings-id').value = savings.id;
        container.querySelector('#edit-savings-amount').value = Math.abs(savings.amount);
        container.querySelector('#edit-savings-type').value = savings.amount > 0 ? 'deposit' : 'withdrawal';
        container.querySelector('#edit-savings-date').value = savings.date.split('T')[0];
        container.querySelector('#edit-savings-ref').value = savings.reference || '';
        container.querySelector('#edit-savings-modal').style.display = 'flex';
      }
    }
  });

  // Modal Closers
  container.querySelector('#close-loan-modal-btn').onclick = () => container.querySelector('#edit-loan-modal').style.display = 'none';
  container.querySelector('#cancel-loan-modal-btn').onclick = () => container.querySelector('#edit-loan-modal').style.display = 'none';

  container.querySelector('#close-savings-modal-btn').onclick = () => container.querySelector('#edit-savings-modal').style.display = 'none';
  container.querySelector('#cancel-savings-modal-btn').onclick = () => container.querySelector('#edit-savings-modal').style.display = 'none';

  // Submit Edit Loan
  container.querySelector('#edit-loan-form').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    const loan = memberLoans.find(l => l.loanNo === data.loanNo);
    if (loan) {
      loan.amountApplied = parseFloat(data.amountApplied);
      loan.status = data.status;
      loan.applicationDate = data.applicationDate;
      try {
        await put('loans', loan);
        notify.success('Loan updated');
        const newProfile = await renderMemberProfile(params);
        container.innerHTML = '';
        container.appendChild(newProfile);
      } catch (err) {
        notify.error('Error updating loan: ' + err.message);
      }
    }
  };

  // Submit Edit Savings
  container.querySelector('#edit-savings-form').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    const savings = memberSavings.find(s => s.id === parseInt(data.id));
    if (savings) {
      const amount = parseFloat(data.amount);
      savings.amount = data.type === 'deposit' ? Math.abs(amount) : -Math.abs(amount);
      savings.type = data.type;
      savings.date = data.date;
      savings.reference = data.reference;
      try {
        await put('savings', savings);
        notify.success('Savings updated');
        const newProfile = await renderMemberProfile(params);
        container.innerHTML = '';
        container.appendChild(newProfile);
      } catch (err) {
        notify.error('Error updating savings: ' + err.message);
      }
    }
  };

  return container;
};
