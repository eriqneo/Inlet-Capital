import { memberService } from '../../services/memberService.js';
import { loanService } from '../../services/loanService.js';
import { savingsService } from '../../services/savingsService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate, initDateMask, parseInputDate, formatToInputDate } from '../../core/utils.js';
import { openCamera } from '../../components/Camera.js';
import { navigate } from '../../core/router.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderMemberProfile = async (params) => {
  const { id } = params;
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="card text-center" style="padding:60px;">
      <div class="spinner" style="margin: 0 auto 16px;"></div>
      <p class="text-muted">Loading member profile...</p>
    </div>
  `;

  (async () => {
  let member;
  try {
    member = await memberService.getByRegNo(id);
  } catch (err) {
    container.innerHTML = `<div class="card text-center"><h2>Member Not Found</h2><button class="btn btn-primary" onclick="window.location.hash = '#/members'">Back to List</button></div>`;
    return;
  }

  const legacyRegNo = member.reg_no || member.regNo;

  // Fetch live data from PocketBase
  let memberLoans = [], memberSavings = [];
  try { memberLoans = await loanService.getByMember(member.id); } catch(e) { console.warn('[MemberProfile] Loans:', e.message); }
  try { memberSavings = await savingsService.getByMember(member.id); } catch(e) { console.warn('[MemberProfile] Savings:', e.message); }

  // Calculate totals from PB data
  const totalBorrowed = memberLoans.reduce((sum, l) => sum + (l.amount_applied || 0), 0);
  const calculateSavingsBalance = () => memberSavings.filter(s => !s.is_reversed).reduce((sum, s) => {
    const amount = Number(s.amount) || 0;
    return s.type === 'deposit' ? sum + amount : sum - amount;
  }, 0);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
  const toDateInputValue = (dateValue) => {
    if (!dateValue) return '';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  };
  const totalSavings = calculateSavingsBalance();

  let loanPage = 1, savingsPage = 1;
  const pageSize = 10;

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/members'">← Back</button>
        <h1 class="text-xl">Member Profile</h1>
      </div>
      <div style="display: flex; gap: 12px;">
        <button class="btn btn-outline btn-sm" id="edit-profile-btn">Edit Profile</button>
        <button class="btn btn-secondary btn-sm" onclick="window.location.hash = '#/loans/new?memberId=${legacyRegNo}'">+ Apply for Loan</button>
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
              <div class="form-group"><label class="form-label">Full Name</label><input type="text" name="full_name" class="form-control" value="${member.full_name || ''}" required /></div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group"><label class="form-label">ID Number</label><input type="text" name="id_number" class="form-control" value="${member.id_number || ''}" required /></div>
                <div class="form-group"><label class="form-label">Date of Birth</label><input type="text" id="edit-dob-input" name="dob" class="form-control" value="${member.dob ? formatToInputDate(member.dob) : ''}" placeholder="dd/mm/yyyy" /></div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group"><label class="form-label">Marital Status</label>
                  <select name="maritalStatus" class="form-control">
                    ${['Single','Married','Divorced','Widowed'].map(s => `<option value="${s}" ${member.maritalStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group"><label class="form-label">No. of Children</label><input type="number" name="childrenCount" class="form-control" value="${member.childrenCount || 0}" /></div>
              </div>
              <div class="form-group"><label class="form-label">Phone</label><input type="tel" name="phone_number" class="form-control" value="${member.phone_number || ''}" required /></div>
              <div class="form-group"><label class="form-label">Residence</label><input type="text" name="address" class="form-control" value="${member.address || member.residence || ''}" required /></div>
              <div class="form-group"><label class="form-label">Account Status</label>
                <select name="status" class="form-control">
                  ${['active','inactive','suspended'].map(s => `<option value="${s}" ${member.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('')}
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
              <div class="form-group"><label class="form-label">Next of Kin Name</label><input type="text" name="nok_name" class="form-control" value="${member.nok_name || ''}" required /></div>
              <div class="form-group"><label class="form-label">Next of Kin Phone</label><input type="tel" name="nok_phone" class="form-control" value="${member.nok_phone || ''}" required /></div>
              <div class="form-group"><label class="form-label">Relationship</label><input type="text" name="nok_relationship" class="form-control" value="${member.nok_relationship || ''}" required /></div>
            </div>
          </div>
          <div style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px; padding-top: 16px; border-top: 1px solid var(--border-color);">
            <button type="button" id="cancel-modal-btn" class="btn btn-outline">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>

    <div id="savings-transaction-modal" class="modal" style="display: none; position: fixed; z-index: 1002; left: 0; top: 0; width: 100%; height: 100%; background: rgba(15,37,69,0.48); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 620px; max-height: 92vh; overflow-y: auto; position: relative; padding: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--border-color);">
          <div>
            <h2 class="text-lg" id="savings-modal-title">Savings Transaction</h2>
            <p class="text-xs text-muted" id="savings-modal-subtitle" style="margin-top: 4px;">Member savings history record</p>
          </div>
          <button type="button" id="close-savings-modal-btn" aria-label="Close transaction modal" style="background: transparent; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        <div id="savings-modal-body" style="padding: 24px;"></div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 300px 1fr; gap: 24px;">
      <!-- Sidebar -->
      <div>
        <div class="card text-center" style="margin-bottom: 24px;">
          <div style="width: 120px; height: 120px; background: var(--bg-light); border-radius: 50%; margin: 0 auto 16px; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 4px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            ${member.passportPhoto ? `<img src="${member.passportPhoto}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span style="font-size: 48px;">👤</span>`}
          </div>
          <h2 style="font-size: 1.25rem;">${member.full_name}</h2>
          <p class="text-muted text-sm">${member.reg_no}</p>
          <div style="margin-top: 12px;"><span class="badge ${member.status === 'active' ? 'badge-success' : 'badge-danger'}">${member.status.toUpperCase()}</span></div>
        </div>
        <div class="card" style="font-size: 0.875rem;">
          <h3 style="font-size: 1rem; margin-bottom: 12px;">Financial Summary</h3>
          <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span class="text-muted">Total Savings:</span>
            <span class="font-semibold text-success" id="member-total-savings">KES ${totalSavings.toLocaleString()}</span>
          </div>
          <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span class="text-muted">Total Loans:</span>
            <span class="font-semibold text-primary">KES ${totalBorrowed.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <!-- Main Content -->
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
                  <p style="margin-bottom: 8px;"><strong>ID Number:</strong> ${member.id_number || 'N/A'}</p>
                  <p style="margin-bottom: 8px;"><strong>Phone:</strong> ${member.phone_number || 'N/A'}</p>
                  <p style="margin-bottom: 8px;"><strong>Residence:</strong> ${member.address || member.residence || 'N/A'}</p>
                  <p style="margin-bottom: 8px;"><strong>Date of Birth:</strong> ${member.dob ? formatDate(member.dob) : 'N/A'}</p>
                  <p style="margin-bottom: 8px;"><strong>Marital Status:</strong> ${member.maritalStatus || 'Single'}</p>
                  <p style="margin-bottom: 8px;"><strong>No. of Children:</strong> ${member.childrenCount || 0}</p>
                </div>
                <div>
                  <h4 class="text-sm text-muted" style="margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 6px;">Registration & NOK Info</h4>
                  <p style="margin-bottom: 8px;"><strong>Registration Date:</strong> ${member.registration_date ? formatDate(member.registration_date) : 'N/A'}</p>
                  <p style="margin-bottom: 8px;"><strong>Fee Paid:</strong> KES ${(member.registration_fee || 0).toLocaleString()}</p>
                  <p style="margin-bottom: 8px; margin-top: 16px;"><strong>Next of Kin:</strong> ${member.nok_name || 'N/A'} (${member.nok_relationship || 'N/A'})</p>
                  <p style="margin-bottom: 8px;"><strong>NOK Phone:</strong> <a href="tel:${member.nok_phone || ''}" style="color: var(--primary); font-weight: 500;">${member.nok_phone || 'N/A'}</a></p>
                </div>
              </div>
            </div>
            <div id="loans-tab" style="display: none;">
              <div class="table-responsive">
                <table class="table">
                  <thead><tr><th>Loan No</th><th>Amount</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
                  <tbody id="member-loans-body"></tbody>
                </table>
              </div>
              <div id="member-loans-pagination"></div>
            </div>
            <div id="savings-tab" style="display: none;">
              <div class="table-responsive">
                <table class="table">
                  <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Ref</th><th>Remarks</th><th>Actions</th></tr></thead>
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
      .tab-btn { flex: 1; padding: 16px; background: transparent; border: none; font-family: 'Inter', sans-serif; font-weight: 600; cursor: pointer; color: var(--text-muted); border-bottom: 2px solid transparent; }
      .tab-btn.active { color: var(--primary); border-bottom-color: var(--secondary); background: rgba(27, 61, 114, 0.02); }
      .icon-action-btn { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--border-color); background: #fff; color: var(--primary); cursor: pointer; font-size: 0.9rem; margin-right: 4px; transition: all 0.18s ease; }
      .icon-action-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 12px rgba(15, 37, 69, 0.08); border-color: var(--primary); }
      .icon-action-btn.danger { color: var(--danger); }
      .icon-action-btn.danger:hover { border-color: var(--danger); background: rgba(239, 68, 68, 0.06); }
      .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
      .detail-tile { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; background: var(--bg-light); }
      .detail-label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0; margin-bottom: 4px; }
      .detail-value { font-size: 0.92rem; font-weight: 600; color: var(--text-main); overflow-wrap: anywhere; }
    </style>
  `;

  // --- Loans table ---
  const updateLoansUI = () => {
    const start = (loanPage - 1) * pageSize;
    const paginated = memberLoans.slice(start, start + pageSize);
    const tbody = container.querySelector('#member-loans-body');
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="5" class="text-center text-muted">No loan history found.</td></tr>' : paginated.map(l => `
      <tr>
        <td><strong>${l.loan_no}</strong></td>
        <td>KES ${(l.amount_applied || 0).toLocaleString()}</td>
        <td><span class="badge ${l.status === 'disbursed' || l.status === 'completed' ? 'badge-success' : (l.status === 'approved' || l.status === 'partial_approved') ? 'badge-primary' : l.status === 'pending' ? 'badge-warning' : 'badge-danger'}" style="${l.status === 'approved' || l.status === 'partial_approved' ? 'background:#0d9488;color:white;' : ''}">${l.status.toUpperCase()}</span></td>
        <td>${formatDate(l.application_date)}</td>
        <td><button class="btn btn-outline btn-xs" onclick="window.location.hash = '#/loans/${l.loan_no}'">View</button></td>
      </tr>`).join('');
    const pag = container.querySelector('#member-loans-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(memberLoans.length, pageSize, loanPage, (p) => { loanPage = p; updateLoansUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  // --- Savings table ---
  const formatSavingsReference = (saving) => {
    const type = saving.type || 'deposit';
    const method = saving.payment_method || (type === 'withdrawal' ? 'cash' : 'mpesa');
    const reference = String(saving.reference || '');
    const methodLabel = method === 'mpesa' ? 'M-Pesa' : (method === 'bank' ? 'Bank' : (method === 'card' ? 'Card' : 'Cash'));
    const direction = type === 'withdrawal' ? 'Sent via' : 'Received via';
    const refPart = reference && reference !== 'N/A' && reference !== 'CASH' && !reference.startsWith('SAVE-D-') ? `: ${reference}` : '';
    return `${direction} ${methodLabel}${refPart}`;
  };

  const formatSavingsMethod = (method) => method === 'mpesa' ? 'M-Pesa' : (method === 'bank' ? 'Bank' : (method === 'card' ? 'Card' : 'Cash'));

  const updateSavingsSummary = () => {
    const totalSavingsEl = container.querySelector('#member-total-savings');
    if (totalSavingsEl) totalSavingsEl.textContent = `KES ${calculateSavingsBalance().toLocaleString()}`;
  };

  const savingsModal = container.querySelector('#savings-transaction-modal');
  const savingsModalTitle = container.querySelector('#savings-modal-title');
  const savingsModalSubtitle = container.querySelector('#savings-modal-subtitle');
  const savingsModalBody = container.querySelector('#savings-modal-body');
  const toggleSavingsModal = (show) => { savingsModal.style.display = show ? 'flex' : 'none'; };
  const findSavingById = (recordId) => memberSavings.find(s => s.id === recordId);

  const openSavingsView = (saving) => {
    const amount = Number(saving.amount) || 0;
    const method = saving.payment_method || (saving.type === 'withdrawal' ? 'cash' : 'mpesa');
    savingsModalTitle.textContent = 'View Savings Transaction';
    savingsModalSubtitle.textContent = `${saving.type === 'withdrawal' ? 'Withdrawal' : 'Deposit'} record for ${member.full_name}`;
    savingsModalBody.innerHTML = `
      <div class="detail-grid">
        <div class="detail-tile"><div class="detail-label">Date</div><div class="detail-value">${formatDate(saving.date)}</div></div>
        <div class="detail-tile"><div class="detail-label">Type</div><div class="detail-value">${escapeHtml((saving.type || '').toUpperCase())}</div></div>
        <div class="detail-tile"><div class="detail-label">Amount</div><div class="detail-value">KES ${amount.toLocaleString()}</div></div>
        <div class="detail-tile"><div class="detail-label">Payment Method</div><div class="detail-value">${formatSavingsMethod(method)}</div></div>
        <div class="detail-tile"><div class="detail-label">Reference</div><div class="detail-value">${escapeHtml(formatSavingsReference(saving))}</div></div>
        <div class="detail-tile"><div class="detail-label">Recorded By</div><div class="detail-value">${escapeHtml(saving.expand?.recorded_by?.name || saving.expand?.recorded_by?.email || 'System')}</div></div>
      </div>
      <div class="detail-tile" style="margin-top: 14px;">
        <div class="detail-label">Remarks</div>
        <div class="detail-value">${escapeHtml(saving.remarks || 'No remarks added.')}</div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px;">
        <button type="button" class="btn btn-outline" id="view-edit-saving-btn" data-id="${saving.id}">Edit</button>
        <button type="button" class="btn btn-primary" id="view-close-saving-btn">Done</button>
      </div>
    `;
    savingsModalBody.querySelector('#view-close-saving-btn').onclick = () => toggleSavingsModal(false);
    savingsModalBody.querySelector('#view-edit-saving-btn').onclick = () => openSavingsEdit(saving);
    toggleSavingsModal(true);
  };

  const openSavingsEdit = (saving) => {
    const method = saving.payment_method || (saving.type === 'withdrawal' ? 'cash' : 'mpesa');
    const isCash = method === 'cash';
    savingsModalTitle.textContent = 'Edit Savings Transaction';
    savingsModalSubtitle.textContent = 'Changes here update the saved PocketBase record.';
    savingsModalBody.innerHTML = `
      <form id="savings-transaction-edit-form">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          <div class="form-group">
            <label class="form-label">Transaction Type</label>
            <select name="type" id="edit-saving-type" class="form-control" required>
              <option value="deposit" ${saving.type === 'deposit' ? 'selected' : ''}>Deposit</option>
              <option value="withdrawal" ${saving.type === 'withdrawal' ? 'selected' : ''}>Withdrawal</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Amount (KES)</label>
            <input type="number" name="amount" class="form-control" min="1" step="1" value="${Number(saving.amount) || 0}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Transaction Date</label>
            <input type="date" name="date" class="form-control" value="${toDateInputValue(saving.date)}" required />
          </div>
          <div class="form-group">
            <label class="form-label" id="edit-saving-method-label">${saving.type === 'withdrawal' ? 'Payment Sent Via' : 'Payment Received Via'}</label>
            <select name="payment_method" id="edit-saving-method" class="form-control" required>
              <option value="mpesa" ${method === 'mpesa' ? 'selected' : ''}>M-Pesa</option>
              <option value="cash" ${method === 'cash' ? 'selected' : ''}>Cash</option>
              <option value="bank" ${method === 'bank' ? 'selected' : ''}>Bank</option>
            </select>
          </div>
        </div>
        <div class="form-group" id="edit-saving-ref-group" style="${isCash ? 'display: none;' : ''}">
          <label class="form-label">Transaction Reference</label>
          <input type="text" name="reference" id="edit-saving-reference" class="form-control" value="${escapeHtml(saving.reference === 'CASH' ? '' : (saving.reference || ''))}" placeholder="e.g. QWE123RTY4" ${isCash ? '' : 'required'} />
        </div>
        <div class="form-group">
          <label class="form-label">Remarks</label>
          <textarea name="remarks" class="form-control" rows="3" placeholder="Add notes about this transaction">${escapeHtml(saving.remarks || '')}</textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border-color);">
          <button type="button" class="btn btn-outline" id="cancel-saving-edit-btn">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Transaction</button>
        </div>
      </form>
    `;

    const editSavingsForm = savingsModalBody.querySelector('#savings-transaction-edit-form');
    const editType = savingsModalBody.querySelector('#edit-saving-type');
    const editMethod = savingsModalBody.querySelector('#edit-saving-method');
    const editMethodLabel = savingsModalBody.querySelector('#edit-saving-method-label');
    const editRefGroup = savingsModalBody.querySelector('#edit-saving-ref-group');
    const editRefInput = savingsModalBody.querySelector('#edit-saving-reference');
    const updateEditPaymentFields = () => {
      editMethodLabel.textContent = editType.value === 'withdrawal' ? 'Payment Sent Via' : 'Payment Received Via';
      if (editMethod.value === 'cash') {
        editRefGroup.style.display = 'none';
        editRefInput.removeAttribute('required');
        editRefInput.value = '';
      } else {
        editRefGroup.style.display = 'block';
        editRefInput.setAttribute('required', 'true');
        editRefInput.placeholder = editMethod.value === 'mpesa' ? 'e.g. QWE123RTY4' : 'e.g. Bank transfer / cheque reference';
      }
    };

    editType.onchange = updateEditPaymentFields;
    editMethod.onchange = updateEditPaymentFields;
    savingsModalBody.querySelector('#cancel-saving-edit-btn').onclick = () => toggleSavingsModal(false);
    editSavingsForm.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(editSavingsForm);
      const data = Object.fromEntries(formData.entries());
      const paymentMethod = data.payment_method || 'mpesa';
      const payload = {
        type: data.type,
        amount: Number(data.amount) || 0,
        date: new Date(data.date).toISOString(),
        payment_method: paymentMethod,
        reference: paymentMethod === 'cash' ? 'CASH' : (data.reference || ''),
        remarks: data.remarks || ''
      };
      const restoreButton = setButtonLoading(editSavingsForm.querySelector('button[type="submit"]'), 'Saving...');
      try {
        await savingsService.update(saving.id, payload);
        if (window.notify) window.notify.success('Savings transaction updated.');
        toggleSavingsModal(false);
        await fetchAndRenderSavings();
      } catch (err) {
        if (window.notify) window.notify.error('Failed to update transaction: ' + (err.message || 'Please try again.'));
        restoreButton();
      }
    };
    updateEditPaymentFields();
    toggleSavingsModal(true);
  };

  const deleteSaving = async (saving) => {
    const confirmed = window.confirmDialog ? await window.confirmDialog({
      title: 'Delete Savings Transaction',
      message: `This will permanently delete the ${saving.type} of KES ${(Number(saving.amount) || 0).toLocaleString()} from ${formatDate(saving.date)}. This affects the member balance and cannot be undone.`,
      confirmText: 'Delete Transaction',
      cancelText: 'Keep Record',
      type: 'danger'
    }) : confirm('Delete this savings transaction permanently?');
    if (!confirmed) return;

    try {
      await savingsService.delete(saving.id);
      if (window.notify) window.notify.success('Savings transaction deleted.');
      await fetchAndRenderSavings();
    } catch (err) {
      if (window.notify) window.notify.error('Failed to delete transaction: ' + (err.message || 'Please try again.'));
    }
  };

  const updateSavingsUI = () => {
    const start = (savingsPage - 1) * pageSize;
    const paginated = memberSavings.slice(start, start + pageSize);
    const tbody = container.querySelector('#member-savings-body');
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="6" class="text-center text-muted">No savings history found.</td></tr>' : paginated.map(s => `
      <tr>
        <td>${formatDate(s.date)}</td>
        <td><span class="badge" style="background: ${s.type === 'deposit' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type.toUpperCase()}</span></td>
        <td class="font-semibold" style="color: ${s.type === 'deposit' ? 'var(--success)' : 'var(--danger)'}">${s.type === 'deposit' ? '+' : '-'}${s.amount.toLocaleString()}</td>
        <td class="text-xs text-muted">${escapeHtml(formatSavingsReference(s))}</td>
        <td class="text-xs text-muted">${escapeHtml(s.remarks || '-')}</td>
        <td style="white-space: nowrap;">
          <button type="button" class="icon-action-btn savings-action" data-action="view" data-id="${s.id}" title="View transaction" aria-label="View transaction">⊙</button>
          <button type="button" class="icon-action-btn savings-action" data-action="edit" data-id="${s.id}" title="Edit transaction" aria-label="Edit transaction">✎</button>
          <button type="button" class="icon-action-btn danger savings-action" data-action="delete" data-id="${s.id}" title="Delete transaction" aria-label="Delete transaction">×</button>
        </td>
      </tr>`).join('');
    const pag = container.querySelector('#member-savings-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(memberSavings.length, pageSize, savingsPage, (p) => { savingsPage = p; updateSavingsUI(); });
    if (ctrl) pag.appendChild(ctrl);
    updateSavingsSummary();
  };

  updateLoansUI();
  updateSavingsUI();

  container.querySelector('#member-savings-body').onclick = async (e) => {
    const actionButton = e.target.closest('.savings-action');
    if (!actionButton) return;
    const saving = findSavingById(actionButton.dataset.id);
    if (!saving) {
      if (window.notify) window.notify.error('Transaction record not found. Refreshing savings history...');
      await fetchAndRenderSavings();
      return;
    }

    if (actionButton.dataset.action === 'view') openSavingsView(saving);
    if (actionButton.dataset.action === 'edit') openSavingsEdit(saving);
    if (actionButton.dataset.action === 'delete') await deleteSaving(saving);
  };

  container.querySelector('#close-savings-modal-btn').onclick = () => toggleSavingsModal(false);
  savingsModal.onclick = (e) => {
    if (e.target === savingsModal) toggleSavingsModal(false);
  };

  // Tab switching
  const tabs = container.querySelectorAll('.tab-btn');
  const contents = { overview: container.querySelector('#overview-tab'), loans: container.querySelector('#loans-tab'), savings: container.querySelector('#savings-tab') };
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(contents).forEach(c => c.style.display = 'none');
      contents[tab.dataset.tab].style.display = 'block';
    };
  });

  // Edit Profile Modal
  const modal = container.querySelector('#edit-profile-modal');
  const editForm = container.querySelector('#edit-member-form');
  const toggleModal = (show) => { modal.style.display = show ? 'flex' : 'none'; };

  container.querySelector('#edit-profile-btn').onclick = () => { toggleModal(true); initDateMask(container.querySelector('#edit-dob-input')); };
  container.querySelector('#close-modal-btn').onclick = () => toggleModal(false);
  container.querySelector('#cancel-modal-btn').onclick = () => toggleModal(false);

  container.querySelector('#edit-photo-btn').onclick = () => {
    openCamera((dataUrl) => {
      container.querySelector('#edit-photo-preview').innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`;
      container.querySelector('#edit-photo-data').value = dataUrl;
    });
  };

  editForm.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(editForm);
    const updatedData = Object.fromEntries(formData.entries());
    const updatedMember = { ...member, ...updatedData, dob: updatedData.dob ? parseInputDate(updatedData.dob) : member.dob };
    const restoreButton = setButtonLoading(editForm.querySelector('button[type="submit"]'), 'Saving...');
    try {
      await memberService.update(member.id, updatedMember);
      if (window.notify) window.notify.success('Profile updated successfully!');
      toggleModal(false);
      navigate(`#/members/${legacyRegNo}`);
    } catch (err) {
      if (window.notify) window.notify.error('Error updating profile: ' + err.message);
      restoreButton();
    }
  };

  // Real-time updates
  const fetchAndRenderLoans = async () => {
    try { 
      memberLoans = await loanService.getByMember(member.id); 
      const loansTabBtn = container.querySelector('[data-tab="loans"]');
      if (loansTabBtn) loansTabBtn.textContent = `Loans History (${memberLoans.length})`;
      updateLoansUI();
    } catch(e) { console.warn('[MemberProfile] Loans refresh:', e.message); }
  };

  const fetchAndRenderSavings = async () => {
    try { 
      memberSavings = await savingsService.getByMember(member.id);
      const savingsTabBtn = container.querySelector('[data-tab="savings"]');
      if (savingsTabBtn) savingsTabBtn.textContent = `Savings History (${memberSavings.length})`;
      updateSavingsSummary();
      updateSavingsUI();
    } catch(e) { console.warn('[MemberProfile] Savings refresh:', e.message); }
  };

  container.__subscriptionPromise = Promise.all([
    loanService.subscribeToChanges(fetchAndRenderLoans),
    savingsService.subscribeToChanges(fetchAndRenderSavings)
  ]);

  })();
  return container;
};
