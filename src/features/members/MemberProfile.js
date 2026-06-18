import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { loanService } from '../../services/loanService.js';
import { savingsService } from '../../services/savingsService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate, initDateMask, parseInputDate, formatToInputDate } from '../../core/utils.js';
import { openCamera } from '../../components/Camera.js';
import { navigate } from '../../core/router.js';
import { setButtonLoading } from '../../core/uiState.js';
import { authService } from '../../services/authService.js';
import { getReturnTo, withReturnTo } from '../../core/navigation.js';
import { getLatestSavingsDate, getMemberActivityStatus } from '../../core/memberActivity.js';

export const renderMemberProfile = async (params) => {
  const { id } = params;
  const returnTo = getReturnTo(params, '#/members');
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
    container.innerHTML = `<div class="card text-center"><h2>Member Not Found</h2><button class="btn btn-primary" onclick="window.location.hash = '${returnTo}'">Back</button></div>`;
    return;
  }

  const legacyRegNo = member.reg_no || member.regNo;
  const canRecordSavings = authService.hasRole('super_admin', 'admin', 'cashier');
  const canManageRecords = authService.hasRole('super_admin', 'admin');
  const memberDob = member.dob || member.date_of_birth || member.dateOfBirth || member.birth_date || '';
  const memberChildrenCount = member.childrenCount ?? member.children_count ?? member.children ?? member.no_of_children ?? 0;
  const memberMaritalStatus = member.maritalStatus || member.marital_status || 'Single';
  const memberPhone = member.phone_number || member.phone || '';
  const memberGroupId = member.group || '';
  const memberPhotoUrl = memberService.getPhotoUrl(member);
  const canAssignGroup = canManageRecords;

  // Fetch live data from PocketBase
  let memberLoans = [], memberSavings = [], allGroups = [];
  try { memberLoans = await loanService.getByMember(member.id); } catch(e) { console.warn('[MemberProfile] Loans:', e.message); }
  try { memberSavings = await savingsService.getByMember(member.id); } catch(e) { console.warn('[MemberProfile] Savings:', e.message); }
  try { allGroups = await groupService.getAll(); } catch(e) { console.warn('[MemberProfile] Groups:', e.message); }
  const currentGroup = member.expand?.group || allGroups.find(g => g.id === memberGroupId) || null;
  const currentGroupName = currentGroup?.name || '';

  // Calculate totals from PB data
  const calculateTotalBorrowed = () => memberLoans.reduce((sum, l) => sum + (Number(l.amount_applied) || 0), 0);
  const totalBorrowed = calculateTotalBorrowed();
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
  const lastSavingsDate = getLatestSavingsDate(memberSavings);
  const activityStatus = getMemberActivityStatus(member, lastSavingsDate);
  const displayMemberStatus = activityStatus.label;
  const displayMemberStatusClass = activityStatus.className;

  let loanPage = 1, savingsPage = 1;
  const pageSize = 10;
  const memberProfileRoute = withReturnTo(`#/members/${legacyRegNo}`, returnTo);
  const withRefresh = (route) => `${route}${route.includes('?') ? '&' : '?'}refresh=${Date.now()}`;
  const isRepayableLoan = (loan) => loan?.status === 'disbursed'
    || (['approved', 'partial_approved'].includes(loan?.status) && loan?.disbursement_date);
  const getRepaymentRoute = (loan) => withReturnTo(`#/loans/${loan.loan_no}?tab=record`, memberProfileRoute);
  const getPrimaryRepaymentLoan = () => memberLoans
    .filter(isRepayableLoan)
    .sort((a, b) => new Date(b.disbursement_date || b.application_date || b.created) - new Date(a.disbursement_date || a.application_date || a.created))[0];
  const primaryRepaymentLoan = getPrimaryRepaymentLoan();

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash = '${returnTo}'">← Back</button>
        <h1 class="text-xl">Member Profile</h1>
      </div>
      <div style="display: flex; gap: 12px;">
        ${canManageRecords ? `<button class="btn btn-outline btn-sm" id="edit-profile-btn">Edit Profile</button>` : ''}
        ${canAssignGroup ? `<button class="btn btn-outline btn-sm" id="assign-group-btn">${currentGroupName ? 'Change Group' : '+ Add to Group'}</button>` : ''}
        ${primaryRepaymentLoan ? `<button class="btn btn-outline btn-sm" onclick="window.location.hash = '${getRepaymentRoute(primaryRepaymentLoan)}'" title="Record repayment for ${escapeHtml(primaryRepaymentLoan.loan_no)}">+ Repayment</button>` : ''}
        <button class="btn btn-primary btn-sm" id="member-context-action-btn" style="display: none;">+</button>
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
                <div class="form-group"><label class="form-label">Date of Birth</label><input type="text" id="edit-dob-input" name="dob" class="form-control" value="${memberDob ? formatToInputDate(memberDob) : ''}" placeholder="dd/mm/yyyy" /></div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group"><label class="form-label">Marital Status</label>
                  <select name="maritalStatus" class="form-control">
                    ${['Single','Married','Divorced','Widowed'].map(s => `<option value="${s}" ${memberMaritalStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group"><label class="form-label">No. of Children</label><input type="number" name="childrenCount" class="form-control" value="${memberChildrenCount}" /></div>
              </div>
              <div class="form-group"><label class="form-label">Phone</label><input type="tel" name="phone_number" class="form-control" value="${memberPhone}" required /></div>
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
                  ${memberPhotoUrl ? `<img src="${memberPhotoUrl}" style="width: 100%; height: 100%; object-fit: cover;" />` : '<span>👤</span>'}
                </div>
                <button type="button" id="edit-photo-btn" class="btn btn-outline btn-xs">Change Photo</button>
                <input type="hidden" name="passportPhoto" id="edit-photo-data" value="" />
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

    <div id="assign-group-modal" class="modal" style="display: none; position: fixed; z-index: 1001; left: 0; top: 0; width: 100%; height: 100%; background: rgba(15,37,69,0.48); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 560px; max-height: 92vh; overflow-y: auto; position: relative; padding: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--border-color);">
          <div>
            <h2 class="text-lg">${currentGroupName ? 'Change Member Group' : 'Add Member to Group'}</h2>
            <p class="text-xs text-muted" style="margin-top: 4px;">Assign ${escapeHtml(member.full_name || 'this member')} to the correct group.</p>
          </div>
          <button type="button" id="close-assign-group-modal-btn" aria-label="Close group assignment modal" style="background: transparent; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        <div style="padding: 24px;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;">
            <div class="detail-tile">
              <div class="detail-label">Member</div>
              <div class="detail-value">${escapeHtml(member.full_name || '-')}</div>
            </div>
            <div class="detail-tile">
              <div class="detail-label">Current Group</div>
              <div class="detail-value">${escapeHtml(currentGroupName || 'Not assigned')}</div>
            </div>
          </div>
          ${currentGroupName ? `
            <div style="margin-bottom: 18px; padding: 14px 16px; border-radius: 8px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.24); display: flex; justify-content: space-between; align-items: center; gap: 12px;">
              <div>
                <div class="font-semibold" style="font-size: 0.9rem;">Change to Individual</div>
                <div class="text-xs text-muted" style="margin-top: 2px;">Remove this member from ${escapeHtml(currentGroupName)} and keep them as an individual client.</div>
              </div>
              <button type="button" class="btn btn-outline btn-sm" id="make-individual-btn">Make Individual</button>
            </div>
          ` : ''}
          <div class="form-group">
            <label class="form-label">Search Group</label>
            <input type="search" id="assign-group-search" class="form-control" placeholder="Type group name, ID, location, or chairperson" autocomplete="off" />
            <input type="hidden" id="assign-group-id" value="" />
            <div id="assign-group-results" class="group-picker-results" style="margin-top: 10px;"></div>
            <div id="selected-group-summary" class="text-xs text-muted" style="margin-top: 10px;"></div>
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color);">
            <button type="button" class="btn btn-outline" id="cancel-assign-group-btn">Cancel</button>
            <button type="button" class="btn btn-primary" id="confirm-assign-group-btn" disabled>${currentGroupName ? 'Update Member' : 'Add to Group'}</button>
          </div>
        </div>
      </div>
    </div>

    <div id="loan-transaction-modal" class="modal" style="display: none; position: fixed; z-index: 1002; left: 0; top: 0; width: 100%; height: 100%; background: rgba(15,37,69,0.48); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 620px; max-height: 92vh; overflow-y: auto; position: relative; padding: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--border-color);">
          <div>
            <h2 class="text-lg" id="loan-modal-title">Loan Record</h2>
            <p class="text-xs text-muted" id="loan-modal-subtitle" style="margin-top: 4px;">Member loan history record</p>
          </div>
          <button type="button" id="close-loan-modal-btn" aria-label="Close loan modal" style="background: transparent; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        <div id="loan-modal-body" style="padding: 24px;"></div>
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
            ${memberPhotoUrl ? `<img src="${memberPhotoUrl}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span style="font-size: 48px;">👤</span>`}
          </div>
          <h2 style="font-size: 1.25rem;">${member.full_name}</h2>
          <p class="text-muted text-sm">${member.reg_no}</p>
          <div style="margin-top: 12px;">
            <span class="badge ${displayMemberStatusClass}">${displayMemberStatus}</span>
            <div class="text-xs text-muted" style="margin-top: 6px;">Last saved: ${lastSavingsDate ? formatDate(lastSavingsDate) : 'Never'}</div>
          </div>
        </div>
        <div class="card" style="font-size: 0.875rem;">
          <h3 style="font-size: 1rem; margin-bottom: 12px;">Financial Summary</h3>
          <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span class="text-muted">Total Savings:</span>
            <span class="font-semibold text-success" id="member-total-savings">KES ${totalSavings.toLocaleString()}</span>
          </div>
          <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span class="text-muted">Total Loans:</span>
            <span class="font-semibold text-primary" id="member-total-loans">KES ${totalBorrowed.toLocaleString()}</span>
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
                  <p style="margin-bottom: 8px;"><strong>Phone:</strong> ${memberPhone || 'N/A'}</p>
                  <p style="margin-bottom: 8px;"><strong>Residence:</strong> ${member.address || member.residence || 'N/A'}</p>
                  <p style="margin-bottom: 8px;"><strong>Date of Birth:</strong> ${memberDob ? formatDate(memberDob) : 'N/A'}</p>
                  <p style="margin-bottom: 8px;"><strong>Marital Status:</strong> ${memberMaritalStatus}</p>
                  <p style="margin-bottom: 8px;"><strong>No. of Children:</strong> ${memberChildrenCount}</p>
                  <p style="margin-bottom: 8px;"><strong>Group:</strong> ${currentGroupName ? `<a href="#/groups/${memberGroupId}" style="color: var(--primary); font-weight: 500;">${escapeHtml(currentGroupName)}</a>` : 'Not assigned'}</p>
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
                  <thead><tr><th>Loan No</th><th>Amount</th><th>Status</th><th>Date</th><th>Securities</th><th>Remarks</th><th>Actions</th></tr></thead>
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
      .group-picker-results { max-height: 280px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: white; }
      .group-picker-option { width: 100%; display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px; background: white; border: none; border-bottom: 1px solid var(--border-color); text-align: left; cursor: pointer; }
      .group-picker-option:last-child { border-bottom: none; }
      .group-picker-option:hover, .group-picker-option.selected { background: rgba(27, 61, 114, 0.06); }
      .group-picker-empty { padding: 18px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
    </style>
  `;

  // --- Loans table ---
  const getLoanRemarks = (loan) => loan.remarks || loan.purpose || '';
  const formatSecurities = (collaterals = []) => {
    const items = collaterals
      .map(c => c?.item || c?.name || c?.description)
      .filter(Boolean);
    return items.length > 0 ? items.join(', ') : '-';
  };
  const updateLoanSummary = () => {
    const totalLoansEl = container.querySelector('#member-total-loans');
    if (totalLoansEl) totalLoansEl.textContent = `KES ${calculateTotalBorrowed().toLocaleString()}`;
  };

  const loanModal = container.querySelector('#loan-transaction-modal');
  const loanModalTitle = container.querySelector('#loan-modal-title');
  const loanModalSubtitle = container.querySelector('#loan-modal-subtitle');
  const loanModalBody = container.querySelector('#loan-modal-body');
  const toggleLoanModal = (show) => { loanModal.style.display = show ? 'flex' : 'none'; };
  const findLoanById = (recordId) => memberLoans.find(l => l.id === recordId);

  const openLoanView = (loan) => {
    loanModalTitle.textContent = 'View Loan Record';
    loanModalSubtitle.textContent = `${loan.loan_no} for ${member.full_name}`;
    loanModalBody.innerHTML = `
      <div class="detail-grid">
        <div class="detail-tile"><div class="detail-label">Loan No</div><div class="detail-value">${escapeHtml(loan.loan_no || '-')}</div></div>
        <div class="detail-tile"><div class="detail-label">Applied Amount</div><div class="detail-value">KES ${(Number(loan.amount_applied) || 0).toLocaleString()}</div></div>
        <div class="detail-tile"><div class="detail-label">Approved Amount</div><div class="detail-value">KES ${(Number(loan.approved_amount) || 0).toLocaleString()}</div></div>
        <div class="detail-tile"><div class="detail-label">Total Liability</div><div class="detail-value">KES ${(Number(loan.total_liability) || 0).toLocaleString()}</div></div>
        <div class="detail-tile"><div class="detail-label">Status</div><div class="detail-value">${escapeHtml((loan.status || '').toUpperCase())}</div></div>
        <div class="detail-tile"><div class="detail-label">Application Date</div><div class="detail-value">${formatDate(loan.application_date)}</div></div>
        <div class="detail-tile"><div class="detail-label">Disbursement Date</div><div class="detail-value">${loan.disbursement_date ? formatDate(loan.disbursement_date) : 'Not disbursed'}</div></div>
      </div>
      <div class="detail-tile" style="margin-top: 14px;">
        <div class="detail-label">Securities</div>
        <div class="detail-value">${escapeHtml(formatSecurities(loan.collaterals))}</div>
      </div>
      <div class="detail-tile" style="margin-top: 14px;">
        <div class="detail-label">Remarks</div>
        <div class="detail-value">${escapeHtml(getLoanRemarks(loan) || 'No remarks added.')}</div>
      </div>
      <div class="detail-tile" style="margin-top: 14px;">
        <div class="detail-label">Approval Comment</div>
        <div class="detail-value">${escapeHtml(loan.approval_comment || 'No approval comment added.')}</div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px;">
        <button type="button" class="btn btn-outline" id="view-open-loan-btn">Open Full Loan</button>
        ${canManageRecords ? `<button type="button" class="btn btn-outline" id="view-edit-loan-btn">Edit</button>` : ''}
        <button type="button" class="btn btn-primary" id="view-close-loan-btn">Done</button>
      </div>
    `;
    loanModalBody.querySelector('#view-open-loan-btn').onclick = () => {
      window.location.hash = withReturnTo(`#/loans/${loan.loan_no}`, memberProfileRoute);
    };
    const editLoanBtn = loanModalBody.querySelector('#view-edit-loan-btn');
    if (editLoanBtn) editLoanBtn.onclick = () => openLoanEdit(loan);
    loanModalBody.querySelector('#view-close-loan-btn').onclick = () => toggleLoanModal(false);
    toggleLoanModal(true);
  };

  const openLoanEdit = (loan) => {
    if (!canManageRecords) {
      if (window.notify) window.notify.error('Only admins can edit loan records.');
      return;
    }
    loanModalTitle.textContent = 'Edit Loan Record';
    loanModalSubtitle.textContent = 'Quick edits update the saved PocketBase loan record.';
    loanModalBody.innerHTML = `
      <form id="loan-record-edit-form">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          <div class="form-group">
            <label class="form-label">Application Date</label>
            <input type="date" name="application_date" class="form-control" value="${toDateInputValue(loan.application_date)}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Disbursement Date</label>
            <input type="date" name="disbursement_date" class="form-control" value="${toDateInputValue(loan.disbursement_date)}" />
            <div class="text-xs text-muted" style="margin-top: 6px;">Use this only after funds have actually been released.</div>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select name="status" class="form-control" required>
              ${['pending','approved','partial_approved','disbursed','completed','closed','rejected','expired'].map(status => `<option value="${status}" ${loan.status === status ? 'selected' : ''}>${status.replace('_', ' ').toUpperCase()}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Remarks</label>
          <textarea name="purpose" class="form-control" rows="3" placeholder="Add loan remarks">${escapeHtml(getLoanRemarks(loan))}</textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border-color);">
          <button type="button" class="btn btn-outline" id="cancel-loan-edit-btn">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Loan</button>
        </div>
      </form>
    `;

    const editLoanForm = loanModalBody.querySelector('#loan-record-edit-form');
    loanModalBody.querySelector('#cancel-loan-edit-btn').onclick = () => toggleLoanModal(false);
    editLoanForm.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(editLoanForm);
      const data = Object.fromEntries(formData.entries());
      const payload = {
        application_date: new Date(data.application_date).toISOString(),
        status: data.status,
        purpose: data.purpose || ''
      };
      if (data.disbursement_date) {
        payload.disbursement_date = new Date(`${data.disbursement_date}T12:00:00`).toISOString();
      }
      const restoreButton = setButtonLoading(editLoanForm.querySelector('button[type="submit"]'), 'Saving...');
      try {
        await loanService.update(loan.id, payload);
        if (window.notify) window.notify.success('Loan record updated.');
        toggleLoanModal(false);
        await fetchAndRenderLoans();
      } catch (err) {
        if (window.notify) window.notify.error('Failed to update loan: ' + (err.message || 'Please try again.'));
        restoreButton();
      }
    };
    toggleLoanModal(true);
  };

  const deleteLoan = async (loan) => {
    if (!canManageRecords) {
      if (window.notify) window.notify.error('Only admins can delete loan records.');
      return;
    }
    const confirmed = window.confirmDialog ? await window.confirmDialog({
      title: 'Delete Loan Record',
      message: `This will permanently delete loan ${loan.loan_no}. If repayments or schedules exist, PocketBase may block the deletion to protect financial history.`,
      confirmText: 'Delete Loan',
      cancelText: 'Keep Record',
      type: 'danger'
    }) : confirm(`Delete loan ${loan.loan_no} permanently?`);
    if (!confirmed) return;

    try {
      await loanService.delete(loan.id);
      if (window.notify) window.notify.success('Loan record deleted.');
      await fetchAndRenderLoans();
    } catch (err) {
      if (window.notify) window.notify.error('Failed to delete loan: ' + (err.message || 'This loan may have linked repayments or schedules.'));
    }
  };

  const updateLoansUI = () => {
    const start = (loanPage - 1) * pageSize;
    const paginated = memberLoans.slice(start, start + pageSize);
    const tbody = container.querySelector('#member-loans-body');
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="7" class="text-center text-muted">No loan history found.</td></tr>' : paginated.map(l => `
      <tr>
        <td><strong>${l.loan_no}</strong></td>
        <td>${(l.amount_applied || 0).toLocaleString()}</td>
        <td><span class="badge ${l.status === 'disbursed' || l.status === 'completed' ? 'badge-success' : (l.status === 'approved' || l.status === 'partial_approved') ? 'badge-primary' : l.status === 'pending' ? 'badge-warning' : 'badge-danger'}" style="${l.status === 'approved' || l.status === 'partial_approved' ? 'background:#0d9488;color:white;' : ''}">${l.status.toUpperCase()}</span></td>
        <td>${formatDate(l.application_date)}</td>
        <td class="text-xs text-muted">${escapeHtml(formatSecurities(l.collaterals))}</td>
        <td class="text-xs text-muted">${escapeHtml(getLoanRemarks(l) || '-')}</td>
        <td style="white-space: nowrap;">
          <button type="button" class="icon-action-btn loan-action" data-action="view" data-id="${l.id}" title="View loan" aria-label="View loan">⊙</button>
          ${isRepayableLoan(l) ? `<button type="button" class="icon-action-btn loan-action" data-action="repay" data-id="${l.id}" title="Record repayment" aria-label="Record repayment">+</button>` : ''}
          ${canManageRecords ? `
            <button type="button" class="icon-action-btn loan-action" data-action="edit" data-id="${l.id}" title="Edit loan" aria-label="Edit loan">✎</button>
            <button type="button" class="icon-action-btn danger loan-action" data-action="delete" data-id="${l.id}" title="Delete loan" aria-label="Delete loan">×</button>
          ` : ''}
        </td>
      </tr>`).join('');
    const pag = container.querySelector('#member-loans-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(memberLoans.length, pageSize, loanPage, (p) => { loanPage = p; updateLoansUI(); });
    if (ctrl) pag.appendChild(ctrl);
    updateLoanSummary();
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
        ${canManageRecords ? `<button type="button" class="btn btn-outline" id="view-edit-saving-btn" data-id="${saving.id}">Edit</button>` : ''}
        <button type="button" class="btn btn-primary" id="view-close-saving-btn">Done</button>
      </div>
    `;
    savingsModalBody.querySelector('#view-close-saving-btn').onclick = () => toggleSavingsModal(false);
    const editSavingBtn = savingsModalBody.querySelector('#view-edit-saving-btn');
    if (editSavingBtn) editSavingBtn.onclick = () => openSavingsEdit(saving);
    toggleSavingsModal(true);
  };

  const openSavingsEdit = (saving) => {
    if (!canManageRecords) {
      if (window.notify) window.notify.error('Only admins can edit savings transactions.');
      return;
    }
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
    if (!canManageRecords) {
      if (window.notify) window.notify.error('Only admins can delete savings transactions.');
      return;
    }
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
          ${canManageRecords ? `
            <button type="button" class="icon-action-btn savings-action" data-action="edit" data-id="${s.id}" title="Edit transaction" aria-label="Edit transaction">✎</button>
            <button type="button" class="icon-action-btn danger savings-action" data-action="delete" data-id="${s.id}" title="Delete transaction" aria-label="Delete transaction">×</button>
          ` : ''}
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

  container.querySelector('#member-loans-body').onclick = async (e) => {
    const actionButton = e.target.closest('.loan-action');
    if (!actionButton) return;
    const loan = findLoanById(actionButton.dataset.id);
    if (!loan) {
      if (window.notify) window.notify.error('Loan record not found. Refreshing loan history...');
      await fetchAndRenderLoans();
      return;
    }

    if (actionButton.dataset.action === 'view') openLoanView(loan);
    if (actionButton.dataset.action === 'edit') openLoanEdit(loan);
    if (actionButton.dataset.action === 'repay') window.location.hash = getRepaymentRoute(loan);
    if (actionButton.dataset.action === 'delete') await deleteLoan(loan);
  };

  container.querySelector('#close-loan-modal-btn').onclick = () => toggleLoanModal(false);
  loanModal.onclick = (e) => {
    if (e.target === loanModal) toggleLoanModal(false);
  };

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

  // Group assignment modal
  const assignGroupModal = container.querySelector('#assign-group-modal');
  const assignGroupBtn = container.querySelector('#assign-group-btn');
  const assignGroupSearch = container.querySelector('#assign-group-search');
  const assignGroupIdInput = container.querySelector('#assign-group-id');
  const assignGroupResults = container.querySelector('#assign-group-results');
  const selectedGroupSummary = container.querySelector('#selected-group-summary');
  const confirmAssignGroupBtn = container.querySelector('#confirm-assign-group-btn');
  const makeIndividualBtn = container.querySelector('#make-individual-btn');
  const INDIVIDUAL_GROUP_VALUE = '__individual__';
  const normalizeSearch = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const groupSearchText = (groupRecord) => normalizeSearch([
    groupRecord.name,
    groupRecord.group_id,
    groupRecord.location,
    groupRecord.chairperson,
    groupRecord.phone
  ].filter(Boolean).join(' '));
  const fuzzyMatches = (needle, haystack) => {
    if (!needle) return true;
    let haystackIndex = 0;
    for (const char of needle) {
      haystackIndex = haystack.indexOf(char, haystackIndex);
      if (haystackIndex === -1) return false;
      haystackIndex += 1;
    }
    return true;
  };
  const rankGroupSearchResult = (groupRecord, query) => {
    if (!query) return groupRecord.id === memberGroupId ? 0 : 1;
    const name = normalizeSearch(groupRecord.name);
    const groupId = normalizeSearch(groupRecord.group_id);
    const location = normalizeSearch(groupRecord.location);
    const haystack = groupSearchText(groupRecord);
    const queryParts = query.split(' ').filter(Boolean);
    if (groupId === query) return 100;
    if (name === query) return 95;
    if (groupId.startsWith(query)) return 85;
    if (name.startsWith(query)) return 80;
    if (location.startsWith(query)) return 65;
    if (queryParts.every(part => haystack.includes(part))) return 55;
    if (fuzzyMatches(query.replace(/\s/g, ''), haystack.replace(/\s/g, ''))) return 30;
    return 0;
  };
  const renderAssignGroupResults = () => {
    if (!assignGroupResults) return;
    const query = normalizeSearch(assignGroupSearch.value);
    const selectedId = assignGroupIdInput.value;
    const matches = allGroups
      .map(groupRecord => ({ groupRecord, score: rankGroupSearchResult(groupRecord, query) }))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score || String(a.groupRecord.name || '').localeCompare(String(b.groupRecord.name || '')))
      .slice(0, 8)
      .map(result => result.groupRecord);

    if (allGroups.length === 0) {
      assignGroupResults.innerHTML = `<div class="group-picker-empty">No groups are available.</div>`;
      return;
    }
    if (matches.length === 0) {
      assignGroupResults.innerHTML = `<div class="group-picker-empty">No matching groups found.</div>`;
      return;
    }

    assignGroupResults.innerHTML = matches.map(groupRecord => `
      <button type="button" class="group-picker-option ${groupRecord.id === selectedId ? 'selected' : ''}" data-group-id="${groupRecord.id}">
        <span>
          <span class="font-semibold">${escapeHtml(groupRecord.name || 'Unnamed group')}</span>
          <span class="text-xs text-muted" style="display:block; margin-top: 2px;">${escapeHtml(groupRecord.group_id || '-')} · ${escapeHtml(groupRecord.location || 'No location')}</span>
        </span>
        <span class="badge ${groupRecord.id === memberGroupId ? 'badge-outline' : 'badge-primary'}" style="font-size: 0.65rem;">${groupRecord.id === memberGroupId ? 'Current' : 'Select'}</span>
      </button>
    `).join('');
  };
  const selectGroupForMember = (groupId) => {
    if (groupId === INDIVIDUAL_GROUP_VALUE) {
      assignGroupIdInput.value = INDIVIDUAL_GROUP_VALUE;
      confirmAssignGroupBtn.disabled = false;
      confirmAssignGroupBtn.textContent = 'Confirm Individual';
      selectedGroupSummary.textContent = `${member.full_name || 'This member'} will be removed from ${currentGroupName || 'the current group'} and changed to an individual client.`;
      renderAssignGroupResults();
      return;
    }
    const groupRecord = allGroups.find(g => g.id === groupId);
    assignGroupIdInput.value = groupRecord?.id || '';
    const isCurrentGroup = Boolean(groupRecord && groupRecord.id === memberGroupId);
    confirmAssignGroupBtn.disabled = !groupRecord || isCurrentGroup;
    confirmAssignGroupBtn.textContent = currentGroupName ? 'Update Member' : 'Add to Group';
    selectedGroupSummary.textContent = groupRecord
      ? (isCurrentGroup
        ? `${member.full_name || 'This member'} is already assigned to ${groupRecord.name}.`
        : `Selected: ${groupRecord.name}${currentGroupName ? `, replacing ${currentGroupName}` : ''}.`)
      : '';
    renderAssignGroupResults();
  };
  const resetAssignGroupPicker = () => {
    if (!assignGroupSearch) return;
    assignGroupSearch.value = '';
    selectGroupForMember('');
    renderAssignGroupResults();
  };
  const updateGroupMemberCount = async (groupId) => {
    if (!groupId) return;
    try {
      const result = await memberService.list({ page: 1, perPage: 1, filter: `group="${groupId}"` });
      await groupService.update(groupId, { member_count: result.totalItems });
    } catch (err) {
      console.warn('[MemberProfile] Group member count sync failed:', err.message);
    }
  };

  if (assignGroupBtn) {
    assignGroupBtn.onclick = () => {
      resetAssignGroupPicker();
      assignGroupModal.style.display = 'flex';
      setTimeout(() => assignGroupSearch.focus(), 0);
    };
    container.querySelector('#close-assign-group-modal-btn').onclick = () => { assignGroupModal.style.display = 'none'; };
    container.querySelector('#cancel-assign-group-btn').onclick = () => { assignGroupModal.style.display = 'none'; };
    assignGroupModal.onclick = (e) => {
      if (e.target === assignGroupModal) assignGroupModal.style.display = 'none';
    };
    assignGroupSearch.oninput = () => {
      selectGroupForMember('');
      renderAssignGroupResults();
    };
    if (makeIndividualBtn) {
      makeIndividualBtn.onclick = () => {
        assignGroupSearch.value = '';
        selectGroupForMember(INDIVIDUAL_GROUP_VALUE);
      };
    }
    assignGroupResults.onclick = (e) => {
      const option = e.target.closest('.group-picker-option');
      if (!option) return;
      selectGroupForMember(option.dataset.groupId);
    };
    confirmAssignGroupBtn.onclick = async () => {
      const targetGroupId = assignGroupIdInput.value;
      if (!targetGroupId) {
        if (window.notify) window.notify.error('Select a group or choose Make Individual before updating the member.');
        return;
      }
      const isMakingIndividual = targetGroupId === INDIVIDUAL_GROUP_VALUE;
      const restoreButton = setButtonLoading(confirmAssignGroupBtn, isMakingIndividual ? 'Updating...' : (currentGroupName ? 'Updating...' : 'Adding...'));
      try {
        await memberService.update(member.id, { group: isMakingIndividual ? null : targetGroupId });
        const countUpdates = [updateGroupMemberCount(memberGroupId)];
        if (!isMakingIndividual) countUpdates.push(updateGroupMemberCount(targetGroupId));
        await Promise.all(countUpdates);
        if (window.notify) {
          window.notify.success(isMakingIndividual
            ? 'Member changed to individual.'
            : (currentGroupName ? 'Member group updated.' : 'Member added to group.'));
        }
        assignGroupModal.style.display = 'none';
        restoreButton();
        navigate(withRefresh(memberProfileRoute));
      } catch (err) {
        if (window.notify) window.notify.error('Failed to update member group: ' + (err.message || 'Please try again.'));
        restoreButton();
      }
    };
    renderAssignGroupResults();
  }

  // Tab switching
  const tabs = container.querySelectorAll('.tab-btn');
  const contents = { overview: container.querySelector('#overview-tab'), loans: container.querySelector('#loans-tab'), savings: container.querySelector('#savings-tab') };
  const contextActionBtn = container.querySelector('#member-context-action-btn');
  let activeProfileTab = 'overview';
  const contextActions = {
    loans: {
      label: primaryRepaymentLoan ? '+ Repayment' : '+ Apply for Loan',
      route: primaryRepaymentLoan ? getRepaymentRoute(primaryRepaymentLoan) : withReturnTo(`#/loans/new?memberId=${legacyRegNo}`, memberProfileRoute),
      visible: true
    },
    savings: {
      label: '+ Record Savings',
      route: withReturnTo(`#/savings/new?memberId=${legacyRegNo}`, memberProfileRoute),
      visible: canRecordSavings
    }
  };
  const updateContextAction = () => {
    const action = contextActions[activeProfileTab];
    if (!contextActionBtn || !action || !action.visible) {
      if (contextActionBtn) contextActionBtn.style.display = 'none';
      return;
    }
    contextActionBtn.textContent = action.label;
    contextActionBtn.style.display = 'inline-flex';
    contextActionBtn.onclick = () => { window.location.hash = action.route; };
  };
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(contents).forEach(c => c.style.display = 'none');
      contents[tab.dataset.tab].style.display = 'block';
      activeProfileTab = tab.dataset.tab;
      updateContextAction();
    };
  });
  updateContextAction();

  // Edit Profile Modal
  const modal = container.querySelector('#edit-profile-modal');
  const editForm = container.querySelector('#edit-member-form');
  const toggleModal = (show) => { modal.style.display = show ? 'flex' : 'none'; };

  const editProfileBtn = container.querySelector('#edit-profile-btn');
  if (editProfileBtn) editProfileBtn.onclick = () => { toggleModal(true); initDateMask(container.querySelector('#edit-dob-input')); };
  container.querySelector('#close-modal-btn').onclick = () => toggleModal(false);
  container.querySelector('#cancel-modal-btn').onclick = () => toggleModal(false);

  let passportPhotoFile = null;
  container.querySelector('#edit-photo-btn').onclick = () => {
    openCamera((dataUrl, file, meta) => {
      container.querySelector('#edit-photo-preview').innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`;
      container.querySelector('#edit-photo-data').value = '';
      passportPhotoFile = file || null;
      if (window.notify && meta?.sizeKb) window.notify.success(`Photo compressed to ${meta.sizeKb} KB.`);
    });
  };

  editForm.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(editForm);
    const updatedData = Object.fromEntries(formData.entries());
    const parsedDob = updatedData.dob ? parseInputDate(updatedData.dob) : memberDob;
    const phoneNumber = updatedData.phone_number || updatedData.phone || memberPhone;
    const maritalStatus = updatedData.maritalStatus || updatedData.marital_status || memberMaritalStatus;
    const childrenCount = Number(updatedData.childrenCount || updatedData.children_count || memberChildrenCount || 0);
    const updatedMember = {
      full_name: updatedData.full_name || member.full_name || '',
      id_number: updatedData.id_number || member.id_number || '',
      phone: phoneNumber,
      phone_number: phoneNumber,
      dob: parsedDob,
      date_of_birth: parsedDob,
      maritalStatus,
      marital_status: maritalStatus,
      childrenCount,
      children_count: childrenCount,
      address: updatedData.address || '',
      status: updatedData.status || member.status || 'active',
      nok_name: updatedData.nok_name || '',
      nok_phone: updatedData.nok_phone || '',
      nok_relationship: updatedData.nok_relationship || ''
    };
    if (passportPhotoFile) updatedMember.passportPhotoFile = passportPhotoFile;
    const restoreButton = setButtonLoading(editForm.querySelector('button[type="submit"]'), 'Saving...');
    try {
      const savedMember = await memberService.update(member.id, updatedMember);
      if (window.notify) window.notify.success('Profile updated successfully!');
      restoreButton();
      toggleModal(false);
      const refreshedRegNo = savedMember.reg_no || legacyRegNo;
      navigate(withRefresh(withReturnTo(`#/members/${refreshedRegNo}`, returnTo)));
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
      updateLoanSummary();
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
