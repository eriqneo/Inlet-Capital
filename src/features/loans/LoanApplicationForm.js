import { loanService } from '../../services/loanService.js';
import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { authService } from '../../services/authService.js';
import { settingsService } from '../../services/settingsService.js';
import { savingsService } from '../../services/savingsService.js';
import { generateLoanNo } from '../../core/numberGen.js';
import { openCamera } from '../../components/Camera.js';
import { renderIdentityPhoto } from '../../components/IdentityPhoto.js';
import { setButtonLoading } from '../../core/uiState.js';
import { getReturnTo, navigateToReturn } from '../../core/navigation.js';
import { getLoanFinalDueDate, getRepaymentScheduleDueDate } from '../../core/repaymentSchedule.js';
import { formatDate, formatMoney } from '../../core/utils.js';
import { calculateSavingsConsistency } from '../../core/savingsConsistency.js';
import { getSavingsConsistencySummary, renderSavingsConsistency } from '../../components/SavingsConsistency.js';
import Fuse from 'fuse.js';

export const renderLoanApplicationForm = async (params = {}) => {
  const container = document.createElement('div');
  const loanNo = generateLoanNo();
  const todayInputValue = new Date().toISOString().split('T')[0];
  
  const settings = { interestRate: 20, processingFeeRate: 8 };
  const canEditLoanRates = authService.hasRole('super_admin', 'admin');
  const returnTo = getReturnTo(params, '#/loans');
  let members = [];
  let groups = [];

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" id="loan-return-btn">← Back</button>
        <div>
          <h1 class="text-xl">New Loan Application</h1>
          <p class="text-muted">Apply for a loan for an individual or a group.</p>
        </div>
      </div>
      <div class="badge badge-primary" style="font-size: 1rem; padding: 8px 16px;">
        Loan No: ${loanNo}
      </div>
    </div>

    <form id="loan-app-form">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
        
        <!-- Section 1: Loan Type & Applicant -->
        <div class="card">
          <h3 style="margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">1. Applicant Details</h3>
          
          <div class="form-group">
            <label class="form-label">Applicant Type</label>
            <select id="applicant-type" class="form-control" required>
              <option value="individual">Individual Loan</option>
              <option value="group">Group Loan</option>
              <option value="group-member">Individual in Group</option>
            </select>
          </div>

          <div class="form-group" id="member-select-group">
            <label class="form-label">Select Member</label>
            <input type="search" class="form-control" id="member-search" placeholder="Search name, reg no, phone, or ID" autocomplete="off" />
            <input type="hidden" name="memberId" id="member-select" />
            <div id="member-search-results" class="loan-picker-results" style="margin-top: 10px;"></div>
            <div id="selected-member-summary" class="text-xs text-muted" style="margin-top: 10px;"></div>
          </div>

          <div class="form-group" id="group-select-group" style="display: none;">
            <label class="form-label">Select Group</label>
            <input type="search" class="form-control" id="group-search" placeholder="Search group name, table banking ID, or location" autocomplete="off" />
            <input type="hidden" name="groupId" id="group-select" />
            <div id="group-search-results" class="loan-picker-results" style="margin-top: 10px;"></div>
            <div id="selected-group-summary" class="text-xs text-muted" style="margin-top: 10px;"></div>
            <div id="group-autofill-status" style="display: none; margin-top: 8px; font-size: 0.75rem; padding: 6px 10px; border-radius: 4px; transition: all 0.3s ease;"></div>
          </div>
          <div id="loan-savings-consistency-alert" class="loan-savings-consistency-alert" style="display: none;"></div>
        </div>

        <!-- Section 2: Loan Parameters -->
        <div class="card">
          <h3 style="margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">2. Loan Details</h3>
          
          <div class="form-group">
            <label class="form-label">Loan Product / Type</label>
            <select name="type" id="loan-type-select" class="form-control" required>
              <option value="business">Business Loan</option>
              <option value="emergency">Emergency Loan</option>
              <option value="school_fees">School Fees</option>
              <option value="development">Table Banking Loan</option>
              <option value="farming">Farming Loan</option>
            </select>
            <div class="text-xs text-muted" style="margin-top: 6px;">Members with an active unpaid loan can only apply for Emergency or School Fees loans.</div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Amount Applied (KES)</label>
            <input type="number" name="amount" id="loan-amount" class="form-control" required min="1000" />
          </div>

          <div class="form-group">
            <label class="form-label">Application Date</label>
            <input type="date" name="application_date" class="form-control" value="${todayInputValue}" required />
          </div>

          <div class="form-group">
            <label class="form-label">Loan Period (Months)</label>
            <div class="loan-period-grid">
              <select id="loan-period-preset" class="form-control" aria-label="Loan period preset">
                <option value="1">1 Month</option>
                <option value="3">3 Months</option>
                <option value="6" selected>6 Months</option>
                <option value="9">9 Months</option>
                <option value="12">12 Months</option>
                <option value="18">18 Months</option>
                <option value="24">24 Months</option>
                <option value="36">36 Months</option>
                <option value="48">48 Months</option>
                <option value="custom">Custom</option>
              </select>
              <input
                type="number"
                id="loan-period-custom"
                class="form-control"
                min="1"
                max="120"
                step="1"
                inputmode="numeric"
                placeholder="Months"
                style="display: none;"
                aria-label="Custom loan period in months"
              />
            </div>
            <input type="hidden" name="period" id="loan-period" value="6" />
            <div id="loan-period-helper" class="text-xs text-muted" style="margin-top: 6px;">Repayment runs for 6 months. Use Custom for terms up to 120 months.</div>
          </div>

          <div class="form-group" id="farming-grace-period-group" style="display: none;">
            <label class="form-label" for="farming-grace-period">Grace Period Before First Repayment (Months)</label>
            <input type="number" name="grace_period_months" id="farming-grace-period" class="form-control" min="3" max="12" step="1" inputmode="numeric" value="3" disabled />
            <div class="text-xs text-muted" style="margin-top: 6px;">Enter the agreed grace period. Farming loans commonly start repayment after 3 or 4 months.</div>
          </div>

          <div class="loan-term-preview" id="loan-term-preview">
            <div>
              <span class="text-xs text-muted">Monthly Installment</span>
              <strong id="summary-monthly">KES 0</strong>
            </div>
            <div>
              <span class="text-xs text-muted">First Repayment Due</span>
              <strong id="summary-first-due-date">—</strong>
            </div>
            <div>
              <span class="text-xs text-muted">Expected Final Due Date</span>
              <strong id="summary-final-date">—</strong>
            </div>
          </div>

          <div class="loan-term-note text-xs text-muted">
            The schedule preview uses the application date until the loan is disbursed.
          </div>

          <div class="form-group">
            <label class="form-label">Purpose of Loan</label>
            <textarea name="purpose" class="form-control" rows="2" required></textarea>
          </div>
        </div>

        <!-- Section 3: Summary & Fees -->
        <div class="card" style="background: var(--surface-dark); color: white;">
          <h3 style="margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; color: white;">3. Fee Summary</h3>
          
          <div style="display: flex; flex-direction: column; gap: 12px; font-size: 0.875rem;">
            <div style="display: flex; justify-content: space-between;">
              <span>Applied Amount:</span>
              <span id="summary-applied">KES 0</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span id="summary-interest-label">Interest (${settings.interestRate}%):</span>
              <span id="summary-interest">KES 0</span>
            </div>
            ${canEditLoanRates ? `
              <div style="display: grid; grid-template-columns: 1fr 110px; gap: 12px; align-items: end; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
                <div>
                  <label for="interest-rate-input" style="display: block; font-size: 0.75rem; opacity: 0.75; margin-bottom: 4px;">Interest Rate Override</label>
                  <div style="font-size: 0.72rem; opacity: 0.62;">Admin-only special offer rate for this application.</div>
                </div>
                <div style="position: relative;">
                  <input type="number" id="interest-rate-input" class="form-control" min="0" max="100" step="0.1" value="${settings.interestRate}" style="padding-right: 28px; background: rgba(255,255,255,0.95);" />
                  <span style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 0.8rem;">%</span>
                </div>
              </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; font-weight: 700;">
              <span>Total Liability:</span>
              <span id="summary-total" style="color: var(--secondary-light);">KES 0</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 12px; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border-left: 4px solid var(--secondary);">
              <div>
                <div id="summary-processing-label" style="font-size: 0.75rem; opacity: 0.7;">Processing Fee (${settings.processingFeeRate}%)</div>
                <div id="summary-processing" style="font-size: 1rem; font-weight: 700;">KES 0</div>
              </div>
              <div style="text-align: right; font-size: 0.75rem; opacity: 0.7;">Payable before<br>disbursement</div>
            </div>
            ${canEditLoanRates ? `
              <div style="display: grid; grid-template-columns: 1fr 110px; gap: 12px; align-items: end; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
                <div>
                  <label for="processing-fee-rate-input" style="display: block; font-size: 0.75rem; opacity: 0.75; margin-bottom: 4px;">Processing Fee Override</label>
                  <div style="font-size: 0.72rem; opacity: 0.62;">Admin-only fee rate for this application.</div>
                </div>
                <div style="position: relative;">
                  <input type="number" id="processing-fee-rate-input" class="form-control" min="0" max="100" step="0.1" value="${settings.processingFeeRate}" style="padding-right: 28px; background: rgba(255,255,255,0.95);" />
                  <span style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 0.8rem;">%</span>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>

      <!-- Collateral Section -->
      <div class="card" style="margin-top: 24px;">
        <h3 style="margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">4. Securities / Collaterals</h3>
        <div id="collateral-list" style="margin-bottom: 16px;">
          <!-- Dynamic Collateral Rows -->
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="add-collateral-btn">+ Add Security Item</button>
      </div>

      <!-- Guarantor Section -->
      <div class="card" style="margin-top: 24px;">
        <h3 style="margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">5. Guarantor Information</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;">
          <div class="form-group">
            <label class="form-label">Guarantor Name</label>
            <input type="text" name="guarantorName" class="form-control" required />
          </div>
          <div class="form-group">
            <label class="form-label">Guarantor Phone</label>
            <input type="tel" name="guarantorPhone" class="form-control" required />
          </div>
          <div class="form-group">
            <label class="form-label">Guarantor ID Number</label>
            <input type="text" name="guarantorIdNumber" class="form-control" inputmode="numeric" pattern="[0-9\\s-]{5,}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Relationship</label>
            <input type="text" name="guarantorRelationship" class="form-control" required />
          </div>
          <div class="form-group">
            <label class="form-label">Guarantor Photo</label>
            <div id="guarantor-preview" style="width: 100%; height: 100px; background: var(--bg-light); border-radius: 8px; margin-bottom: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
              <span class="text-muted text-xs">No Photo</span>
            </div>
            <button type="button" class="btn btn-outline btn-xs" id="take-guarantor-photo">Capture Photo</button>
            <input type="hidden" name="guarantorPhoto" id="guarantor-photo-data" />
          </div>
        </div>
      </div>

      <div style="margin-top: 32px; display: flex; justify-content: flex-end; gap: 16px;">
        <button type="button" class="btn btn-outline" id="loan-cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary btn-lg">Submit Application</button>
      </div>
    </form>

    <style>
      .loan-picker-results { max-height: 280px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: white; }
      .loan-picker-option { width: 100%; display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px; background: white; border: none; border-bottom: 1px solid var(--border-color); text-align: left; cursor: pointer; }
      .loan-picker-option:last-child { border-bottom: none; }
      .loan-picker-option:hover, .loan-picker-option.selected { background: rgba(27, 61, 114, 0.06); }
      .loan-picker-option[disabled] { cursor: not-allowed; opacity: 0.72; }
      .loan-picker-empty { padding: 18px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
      .loan-period-grid { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 10px; }
      .loan-term-preview {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: rgba(27, 61, 114, 0.04);
      }
      .loan-term-preview > div { display: grid; gap: 4px; min-width: 0; }
      .loan-term-preview strong { color: var(--primary); font-size: 0.95rem; }
      .loan-term-note { margin-top: 8px; line-height: 1.45; }
      .loan-savings-consistency-alert {
        margin-top: 14px;
        border-radius: 10px;
        border: 1px solid rgba(245, 158, 11, 0.28);
        border-left: 4px solid var(--warning);
        background: rgba(245, 158, 11, 0.08);
        padding: 14px;
      }
      .loan-savings-consistency-alert.healthy {
        border-color: rgba(16, 185, 129, 0.28);
        border-left-color: var(--success);
        background: rgba(16, 185, 129, 0.08);
      }
      .loan-savings-consistency-alert .savings-consistency-heading h3 { margin: 0; }
      .loan-savings-consistency-alert .savings-consistency-metrics { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
      @media (max-width: 520px) {
        .loan-period-grid,
        .loan-term-preview { grid-template-columns: 1fr; }
      }
    </style>
  `;

  container.querySelector('#loan-return-btn').onclick = () => { window.location.hash = returnTo; };
  container.querySelector('#loan-cancel-btn').onclick = () => { window.location.hash = returnTo; };

  // Logic: Show/Hide Applicant Selectors & Auto-fill
  const applicantTypeSelect = container.querySelector('#applicant-type');
  const memberGroup = container.querySelector('#member-select-group');
  const groupGroup = container.querySelector('#group-select-group');
  const memberSelect = container.querySelector('#member-select');
  const groupSelect = container.querySelector('#group-select');
  const memberSearch = container.querySelector('#member-search');
  const groupSearch = container.querySelector('#group-search');
  const memberSearchResults = container.querySelector('#member-search-results');
  const groupSearchResults = container.querySelector('#group-search-results');
  const selectedMemberSummary = container.querySelector('#selected-member-summary');
  const selectedGroupSummary = container.querySelector('#selected-group-summary');
  const autofillStatus = container.querySelector('#group-autofill-status');
  const savingsConsistencyAlert = container.querySelector('#loan-savings-consistency-alert');
  let memberFuse = null;
  let groupFuse = null;
  let groupSelectionLocked = false;
  let savingsAssessmentRequestId = 0;
  let refreshSavingsConsistencyNotice = () => {};

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
  const getMemberLabel = (member) => `${member.full_name || 'Unnamed member'} (${member.reg_no || 'No reg no'})`;
  const getGroupLabel = (group) => `${group.name || 'Unnamed group'} (${group.group_id || 'No group ID'})`;

  const populateApplicantOptions = () => {
    memberFuse = new Fuse(members, {
      keys: [
        { name: 'full_name', weight: 0.45 },
        { name: 'reg_no', weight: 0.25 },
        { name: 'phone_number', weight: 0.15 },
        { name: 'phone', weight: 0.1 },
        { name: 'id_number', weight: 0.05 }
      ],
      threshold: 0.34,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 1
    });
    groupFuse = new Fuse(groups, {
      keys: [
        { name: 'name', weight: 0.5 },
        { name: 'group_id', weight: 0.3 },
        { name: 'location', weight: 0.15 },
        { name: 'phone', weight: 0.05 }
      ],
      threshold: 0.34,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 1
    });
    renderMemberSearchResults();
    renderGroupSearchResults();
  };

  const applyRoutePrefill = () => {
    if (params.memberId) {
      const member = members.find(m => m.id === params.memberId || m.reg_no === params.memberId);
      if (member && member.group) {
        applicantTypeSelect.value = 'group-member';
      } else {
        applicantTypeSelect.value = 'individual';
      }
      applicantTypeSelect.dispatchEvent(new Event('change'));
      if (member) selectMember(member.id);
    } else if (params.groupId) {
      applicantTypeSelect.value = 'group';
      const group = groups.find(g => g.id === params.groupId || g.group_id === params.groupId);
      applicantTypeSelect.dispatchEvent(new Event('change'));
      if (group) selectGroup(group.id);
    }
  };

  const renderMemberSearchResults = () => {
    const selectedId = memberSelect.value;
    const query = memberSearch.value.trim();
    let matches = [];

    if (members.length === 0) {
      memberSearchResults.innerHTML = `<div class="loan-picker-empty">No members are available.</div>`;
      return;
    }

    if (query && memberFuse) {
      matches = memberFuse.search(query).slice(0, 8).map(result => result.item);
    } else {
      matches = members.slice(0, 8);
    }

    if (matches.length === 0) {
      memberSearchResults.innerHTML = `<div class="loan-picker-empty">No matching members found.</div>`;
      return;
    }

    memberSearchResults.innerHTML = matches.map(member => `
      <button type="button" class="loan-picker-option ${member.id === selectedId ? 'selected' : ''}" data-member-id="${member.id}">
        <span>
          <span class="font-semibold">${escapeHtml(member.full_name || 'Unnamed member')}</span>
          <span class="text-xs text-muted" style="display:block; margin-top: 2px;">${escapeHtml(member.reg_no || '-')} · ${escapeHtml(member.phone_number || member.phone || 'No phone')}</span>
        </span>
        <span class="badge badge-primary" style="font-size: 0.65rem;">Select</span>
      </button>
    `).join('');
  };

  const renderGroupSearchResults = () => {
    const selectedId = groupSelect.value;
    const query = groupSearch.value.trim();
    let matches = [];

    if (groups.length === 0) {
      groupSearchResults.innerHTML = `<div class="loan-picker-empty">No groups are available.</div>`;
      return;
    }

    if (query && groupFuse) {
      matches = groupFuse.search(query).slice(0, 8).map(result => result.item);
    } else if (selectedId) {
      matches = groups.filter(group => group.id === selectedId).concat(groups.filter(group => group.id !== selectedId).slice(0, 7));
    } else {
      matches = groups.slice(0, 8);
    }

    if (matches.length === 0) {
      groupSearchResults.innerHTML = `<div class="loan-picker-empty">No matching groups found.</div>`;
      return;
    }

    groupSearchResults.innerHTML = matches.map(group => `
      <button type="button" class="loan-picker-option ${group.id === selectedId ? 'selected' : ''}" data-group-id="${group.id}" ${groupSelectionLocked ? 'disabled' : ''}>
        <span>
          <span class="font-semibold">${escapeHtml(group.name || 'Unnamed group')}</span>
          <span class="text-xs text-muted" style="display:block; margin-top: 2px;">${escapeHtml(group.group_id || '-')} · ${escapeHtml(group.location || 'No location')}</span>
        </span>
        <span class="badge badge-primary" style="font-size: 0.65rem;">${groupSelectionLocked ? 'Auto' : 'Select'}</span>
      </button>
    `).join('');
  };

  const selectGroup = (groupId, { syncSearch = true } = {}) => {
    const group = groups.find(g => g.id === groupId);
    groupSelect.value = group?.id || '';
    selectedGroupSummary.textContent = group ? `Selected: ${getGroupLabel(group)}` : '';
    if (syncSearch) groupSearch.value = group ? getGroupLabel(group) : '';
    renderGroupSearchResults();
    refreshSavingsConsistencyNotice();
  };

  const clearGroupSelection = () => {
    groupSelect.value = '';
    groupSearch.value = '';
    selectedGroupSummary.textContent = '';
    renderGroupSearchResults();
    refreshSavingsConsistencyNotice();
  };

  const updateGroupAutofill = () => {
    if (applicantTypeSelect.value !== 'group-member') {
      autofillStatus.style.display = 'none';
      groupSelectionLocked = false;
      groupSearch.disabled = false;
      renderGroupSearchResults();
      return;
    }

    const selectedMember = members.find(member => member.id === memberSelect.value);
    const groupId = selectedMember?.group || selectedMember?.expand?.group?.id || null;
    
    if (groupId) {
      groupSelectionLocked = true;
      groupSearch.disabled = true;
      selectGroup(groupId);
      const groupName = groups.find(g => g.id === groupId)?.name;
      autofillStatus.innerHTML = `Auto-filled: <strong>${escapeHtml(groupName || 'Unknown')}</strong>`;
      autofillStatus.style.background = 'rgba(16, 185, 129, 0.1)';
      autofillStatus.style.color = 'var(--success)';
      autofillStatus.style.display = 'block';
    } else {
      groupSelectionLocked = false;
      groupSearch.disabled = false;
      clearGroupSelection();
      autofillStatus.innerHTML = `Member is not in any group. Consider using Individual Loan.`;
      autofillStatus.style.background = 'rgba(239, 68, 68, 0.1)';
      autofillStatus.style.color = 'var(--danger)';
      autofillStatus.style.display = 'block';
    }
  };

  const selectMember = (memberId, { syncSearch = true } = {}) => {
    const member = members.find(m => m.id === memberId);
    memberSelect.value = member?.id || '';
    selectedMemberSummary.textContent = member ? `Selected: ${getMemberLabel(member)}` : '';
    if (syncSearch) memberSearch.value = member ? getMemberLabel(member) : '';
    renderMemberSearchResults();
    updateGroupAutofill();
    refreshSavingsConsistencyNotice();
  };

  const clearMemberSelection = () => {
    memberSelect.value = '';
    memberSearch.value = '';
    selectedMemberSummary.textContent = '';
    renderMemberSearchResults();
    updateGroupAutofill();
    refreshSavingsConsistencyNotice();
  };

  applicantTypeSelect.onchange = () => {
    if (applicantTypeSelect.value === 'individual') {
      memberGroup.style.display = 'block';
      groupGroup.style.display = 'none';
      autofillStatus.style.display = 'none';
      groupSelectionLocked = false;
      groupSearch.disabled = false;
      clearGroupSelection();
    } else if (applicantTypeSelect.value === 'group') {
      memberGroup.style.display = 'none';
      groupGroup.style.display = 'block';
      autofillStatus.style.display = 'none';
      groupSelectionLocked = false;
      groupSearch.disabled = false;
      clearMemberSelection();
    } else {
      memberGroup.style.display = 'block';
      groupGroup.style.display = 'block';
      updateGroupAutofill();
    }
  };

  memberSearch.oninput = () => {
    memberSelect.value = '';
    selectedMemberSummary.textContent = '';
    renderMemberSearchResults();
    updateGroupAutofill();
  };
  memberSearchResults.onclick = (e) => {
    const option = e.target.closest('.loan-picker-option');
    if (!option) return;
    selectMember(option.dataset.memberId);
  };
  groupSearch.oninput = () => {
    if (groupSelectionLocked) return;
    groupSelect.value = '';
    selectedGroupSummary.textContent = '';
    renderGroupSearchResults();
  };
  groupSearchResults.onclick = (e) => {
    if (groupSelectionLocked) return;
    const option = e.target.closest('.loan-picker-option');
    if (!option) return;
    selectGroup(option.dataset.groupId);
  };

  populateApplicantOptions();

  // Logic: Real-time Calculations
  const amountInput = container.querySelector('#loan-amount');
  const sApplied = container.querySelector('#summary-applied');
  const sInterest = container.querySelector('#summary-interest');
  const sTotal = container.querySelector('#summary-total');
  const sProcessing = container.querySelector('#summary-processing');
  const sInterestLabel = container.querySelector('#summary-interest-label');
  const sProcessingLabel = container.querySelector('#summary-processing-label');
  const interestRateInput = container.querySelector('#interest-rate-input');
  const processingFeeRateInput = container.querySelector('#processing-fee-rate-input');
  const applicationDateInput = container.querySelector('[name="application_date"]');
  const periodPreset = container.querySelector('#loan-period-preset');
  const periodCustom = container.querySelector('#loan-period-custom');
  const periodInput = container.querySelector('#loan-period');
  const periodHelper = container.querySelector('#loan-period-helper');
  const loanTypeSelect = container.querySelector('#loan-type-select');
  const farmingGracePeriodGroup = container.querySelector('#farming-grace-period-group');
  const farmingGracePeriodInput = container.querySelector('#farming-grace-period');
  const sMonthly = container.querySelector('#summary-monthly');
  const sFirstDueDate = container.querySelector('#summary-first-due-date');
  const sFinalDate = container.querySelector('#summary-final-date');
  const termNote = container.querySelector('.loan-term-note');

  refreshSavingsConsistencyNotice = async () => {
    const requestId = ++savingsAssessmentRequestId;
    const selectedMember = members.find(member => member.id === memberSelect.value);
    const groupId = selectedMember?.group || selectedMember?.expand?.group?.id || groupSelect.value;
    const selectedGroup = groups.find(group => group.id === groupId) || selectedMember?.expand?.group;

    if (!selectedMember || !groupId) {
      savingsConsistencyAlert.style.display = 'none';
      savingsConsistencyAlert.innerHTML = '';
      return;
    }
    if (!selectedGroup) {
      savingsConsistencyAlert.className = 'loan-savings-consistency-alert';
      savingsConsistencyAlert.style.display = 'block';
      savingsConsistencyAlert.innerHTML = '<div class="font-semibold text-warning">Savings consistency cannot be verified because this member group is not loaded.</div>';
      return;
    }

    savingsConsistencyAlert.className = 'loan-savings-consistency-alert';
    savingsConsistencyAlert.style.display = 'block';
    savingsConsistencyAlert.innerHTML = '<div class="text-sm text-muted">Checking savings consistency...</div>';

    try {
      const memberSavings = await savingsService.getByMember(selectedMember.id);
      if (requestId !== savingsAssessmentRequestId) return;
      const assessment = calculateSavingsConsistency({
        member: selectedMember,
        group: selectedGroup,
        savings: memberSavings,
        referenceDate: applicationDateInput?.value || todayInputValue
      });
      const summary = getSavingsConsistencySummary(assessment);
      const isHealthy = summary.tone === 'success' && assessment.status !== 'unavailable';
      savingsConsistencyAlert.className = `loan-savings-consistency-alert ${isHealthy ? 'healthy' : ''}`;
      savingsConsistencyAlert.innerHTML = `
        <div class="font-semibold" style="color: ${isHealthy ? 'var(--success)' : 'var(--warning)'};">${escapeHtml(summary.headline)}</div>
        <div class="text-xs text-muted" style="margin-top: 4px;">${escapeHtml(summary.detail)}</div>
        <div style="margin-top: 12px;">${renderSavingsConsistency(assessment)}</div>
      `;
    } catch (error) {
      if (requestId !== savingsAssessmentRequestId) return;
      savingsConsistencyAlert.className = 'loan-savings-consistency-alert';
      savingsConsistencyAlert.style.display = 'block';
      savingsConsistencyAlert.innerHTML = `
        <div class="font-semibold text-warning">Savings consistency could not be verified</div>
        <div class="text-xs text-muted" style="margin-top: 4px;">${escapeHtml(error.message || 'Check savings records and try again.')}</div>
      `;
    }
  };

  const getSelectedPeriod = () => {
    const value = Number.parseInt(periodInput.value, 10);
    return Number.isInteger(value) && value >= 1 && value <= 120 ? value : 0;
  };

  const setPeriodValue = () => {
    let nextPeriod;
    if (periodPreset.value === 'custom') {
      periodCustom.style.display = 'block';
      nextPeriod = Number.parseInt(periodCustom.value, 10);
    } else {
      periodCustom.style.display = 'none';
      nextPeriod = Number.parseInt(periodPreset.value, 10);
    }

    const validPeriod = Number.isInteger(nextPeriod) && nextPeriod >= 1 && nextPeriod <= 120 ? nextPeriod : 0;
    periodInput.value = validPeriod ? String(validPeriod) : '';
    periodHelper.textContent = validPeriod
      ? `Repayment runs for ${validPeriod} ${validPeriod === 1 ? 'month' : 'months'}. Use Custom for terms up to 120 months.`
      : 'Enter a whole loan period between 1 and 120 months.';
    updateCalculations();
  };

  const updateCalculations = () => {
    const amount = parseFloat(amountInput.value) || 0;
    const period = getSelectedPeriod();
    const interest = amount * (settings.interestRate / 100);
    const total = amount + interest;
    const processing = amount * (settings.processingFeeRate / 100);
    const monthly = period > 0 ? total / period : 0;
    const previewLoan = {
      type: loanTypeSelect.value,
      grace_period_months: farmingGracePeriodInput.value,
      period,
      application_date: applicationDateInput?.value || todayInputValue
    };
    const firstDueDate = period > 0 ? getRepaymentScheduleDueDate(previewLoan, 1) : null;
    const finalDueDate = getLoanFinalDueDate(previewLoan);

    sApplied.textContent = `KES ${formatMoney(amount)}`;
    sInterest.textContent = `KES ${formatMoney(interest)}`;
    sTotal.textContent = `KES ${formatMoney(total)}`;
    sProcessing.textContent = `KES ${formatMoney(processing)}`;
    sMonthly.textContent = `KES ${formatMoney(monthly)}`;
    sFirstDueDate.textContent = firstDueDate ? formatDate(firstDueDate) : '—';
    sFinalDate.textContent = finalDueDate ? formatDate(finalDueDate) : '—';
    sInterestLabel.textContent = `Interest (${settings.interestRate}%):`;
    sProcessingLabel.textContent = `Processing Fee (${settings.processingFeeRate}%):`;
    termNote.textContent = loanTypeSelect.value === 'farming'
      ? `Farming repayments begin after the agreed ${Number(farmingGracePeriodInput.value) || 0}-month grace period. The preview uses the application date until the loan is disbursed.`
      : 'The first installment starts one month after disbursement. The preview uses the application date until the loan is disbursed.';
  };

  const syncFarmingGracePeriod = () => {
    const isFarmingLoan = loanTypeSelect.value === 'farming';
    farmingGracePeriodGroup.style.display = isFarmingLoan ? 'block' : 'none';
    farmingGracePeriodInput.disabled = !isFarmingLoan;
    farmingGracePeriodInput.required = isFarmingLoan;
    if (isFarmingLoan && !farmingGracePeriodInput.value) farmingGracePeriodInput.value = '3';
    updateCalculations();
  };

  amountInput.oninput = updateCalculations;
  applicationDateInput.oninput = () => {
    updateCalculations();
    refreshSavingsConsistencyNotice();
  };
  periodPreset.onchange = setPeriodValue;
  periodCustom.oninput = setPeriodValue;
  loanTypeSelect.onchange = syncFarmingGracePeriod;
  farmingGracePeriodInput.oninput = updateCalculations;
  if (interestRateInput) {
    interestRateInput.oninput = () => {
      const nextRate = Number(interestRateInput.value);
      settings.interestRate = Number.isFinite(nextRate) && nextRate >= 0 ? nextRate : 0;
      updateCalculations();
    };
  }
  if (processingFeeRateInput) {
    processingFeeRateInput.oninput = () => {
      const nextRate = Number(processingFeeRateInput.value);
      settings.processingFeeRate = Number.isFinite(nextRate) && nextRate >= 0 ? nextRate : 0;
      updateCalculations();
    };
  }

  Promise.all([
    settingsService.getNumber('interest_rate_percent', settings.interestRate),
    settingsService.getNumber('processing_fee_percent', settings.processingFeeRate),
    memberService.getAll(),
    groupService.getAll()
  ]).then(([interestRate, processingFeeRate, membersData, groupsData]) => {
    settings.interestRate = interestRate;
    settings.processingFeeRate = processingFeeRate;
    if (interestRateInput) interestRateInput.value = settings.interestRate;
    if (processingFeeRateInput) processingFeeRateInput.value = settings.processingFeeRate;
    sInterestLabel.textContent = `Interest (${settings.interestRate}%):`;
    sProcessingLabel.textContent = `Processing Fee (${settings.processingFeeRate}%):`;
    members = membersData || [];
    groups = groupsData || [];
    populateApplicantOptions();
    applyRoutePrefill();
    syncFarmingGracePeriod();
  }).catch(err => {
    console.warn('[LoanApplicationForm] Applicant/settings preload failed:', err);
    populateApplicantOptions();
  });

  // Logic: Dynamic Collateral
  const collateralList = container.querySelector('#collateral-list');
  const addCollateralBtn = container.querySelector('#add-collateral-btn');
  let collateralCount = 0;
  const collateralPhotoMeta = {};

  const addCollateralRow = () => {
    collateralCount++;
    const collateralIndex = collateralCount;
    const id = `collateral-${collateralCount}`;
    const row = document.createElement('div');
    row.className = 'card';
    row.style.cssText = 'margin-bottom: 12px; background: var(--bg-light); border: 1px dashed var(--border-color);';
    row.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 12px; align-items: end;">
        <div class="form-group" style="margin: 0;">
          <label class="form-label text-xs">Item Description</label>
          <input type="text" name="collateral_item_${collateralCount}" class="form-control" required />
        </div>
        <div class="form-group" style="margin: 0;">
          <label class="form-label text-xs">Estimated Value (KES)</label>
          <input type="number" name="collateral_value_${collateralCount}" class="form-control" required />
        </div>
        <div class="form-group" style="margin: 0;">
          <label class="form-label text-xs">Photo</label>
          <button type="button" class="btn btn-outline btn-xs" id="capture-${id}" style="width: 100%;">Capture Image</button>
          <input type="hidden" name="collateral_photo_${collateralCount}" id="data-${id}" />
        </div>
        <button type="button" class="btn btn-danger btn-xs" onclick="this.closest('.card').remove()">Remove</button>
      </div>
      <div id="preview-${id}" style="margin-top: 12px; display: none; height: 60px;"></div>
    `;
    collateralList.appendChild(row);

    row.querySelector(`#capture-${id}`).onclick = () => {
      openCamera((dataUrl, _file, meta) => {
        row.querySelector(`#preview-${id}`).style.display = 'block';
        row.querySelector(`#preview-${id}`).innerHTML = `<img src="${dataUrl}" style="height: 100%; border-radius: 4px;" />`;
        row.querySelector(`#data-${id}`).value = dataUrl;
        collateralPhotoMeta[collateralIndex] = {
          sizeKb: meta?.sizeKb || 0,
          mimeType: _file?.type || 'image/webp'
        };
        if (window.notify && meta?.sizeKb) window.notify.success(`Security image compressed to ${meta.sizeKb} KB.`);
      });
    };
  };

  addCollateralBtn.onclick = addCollateralRow;
  addCollateralRow(); // Add first row by default

  // Logic: Guarantor Photo
  const takeGPhotoBtn = container.querySelector('#take-guarantor-photo');
  const gPreview = container.querySelector('#guarantor-preview');
  const gPhotoInput = container.querySelector('#guarantor-photo-data');
  let guarantorPhotoMeta = null;

  takeGPhotoBtn.onclick = () => {
    openCamera((dataUrl, _file, meta) => {
      gPreview.innerHTML = renderIdentityPhoto(dataUrl, 'Guarantor');
      gPhotoInput.value = dataUrl;
      guarantorPhotoMeta = {
        sizeKb: meta?.sizeKb || 0,
        mimeType: _file?.type || 'image/webp'
      };
      if (window.notify && meta?.sizeKb) window.notify.success(`Guarantor photo compressed to ${meta.sizeKb} KB.`);
    });
  };

  // Logic: Form Submission
  const form = container.querySelector('#loan-app-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const formData = new FormData(form);
    const rawData = Object.fromEntries(formData.entries());
    
    // Process Collaterals
    const collaterals = [];
    for (let i = 1; i <= collateralCount; i++) {
      if (rawData[`collateral_item_${i}`]) {
        collaterals.push({
          item: rawData[`collateral_item_${i}`],
          value: parseFloat(rawData[`collateral_value_${i}`]),
          photo: rawData[`collateral_photo_${i}`],
          photo_size_kb: collateralPhotoMeta[i]?.sizeKb || null,
          photo_mime_type: collateralPhotoMeta[i]?.mimeType || null
        });
      }
    }

    const amount = parseFloat(rawData.amount);
    const selectedApplicationDate = rawData.application_date || todayInputValue;
    const submittedRate = Number(interestRateInput?.value);
    const submittedProcessingFeeRate = Number(processingFeeRateInput?.value);
    const interestRate = canEditLoanRates && Number.isFinite(submittedRate) && submittedRate >= 0
      ? submittedRate
      : settings.interestRate;
    const processingFeeRate = canEditLoanRates && Number.isFinite(submittedProcessingFeeRate) && submittedProcessingFeeRate >= 0
      ? submittedProcessingFeeRate
      : settings.processingFeeRate;
    const interest = amount * (interestRate / 100);
    const processingFee = amount * (processingFeeRate / 100);
    const period = Number.parseInt(rawData.period, 10);
    const gracePeriod = rawData.type === 'farming'
      ? Number.parseInt(rawData.grace_period_months, 10)
      : 0;

    if (!Number.isInteger(period) || period < 1 || period > 120) {
      window.notify?.error('Enter a valid loan period between 1 and 120 months.');
      return;
    }
    if (rawData.type === 'farming' && (!Number.isInteger(gracePeriod) || gracePeriod < 3 || gracePeriod > 12)) {
      window.notify?.error('Enter an agreed farming-loan grace period between 3 and 12 months.');
      return;
    }

    const loan = {
      loan_no: loanNo,
      type: rawData.type,
      amount_applied: amount,
      approved_amount: 0,
      interest_rate: interestRate,
      interest_amount: interest,
      total_liability: amount + interest,
      processing_fee_rate: processingFeeRate,
      processing_fee: processingFee,
      processing_fee_paid: false,
      period,
      grace_period_months: gracePeriod,
      purpose: rawData.purpose,
      status: 'pending',
      application_date: new Date(`${selectedApplicationDate}T12:00:00`).toISOString(),
      guarantor: {
        name: rawData.guarantorName,
        phone: rawData.guarantorPhone,
        id_number: rawData.guarantorIdNumber,
        relationship: rawData.guarantorRelationship,
        photo: rawData.guarantorPhoto || null,
        photo_size_kb: guarantorPhotoMeta?.sizeKb || null,
        photo_mime_type: guarantorPhotoMeta?.mimeType || null
      },
      collaterals: collaterals
    };

    if (applicantTypeSelect.value === 'individual') {
      if (!rawData.memberId) return window.notify?.error('Please select a member');
      loan.member = rawData.memberId;
    } else if (applicantTypeSelect.value === 'group') {
      if (!rawData.groupId) return window.notify?.error('Please select a group');
      loan.group = rawData.groupId;
    } else {
      if (!rawData.memberId) return window.notify?.error('Please select a member');
      loan.member = rawData.memberId;
      if (rawData.groupId) loan.group = rawData.groupId;
    }

    const userId = authService.getUser()?.id;
    if (userId) loan.processed_by = userId;

    const restoreButton = setButtonLoading(form.querySelector('button[type="submit"]'), 'Submitting...');

    try {
      await loanService.apply(loan);
      if (window.notify) window.notify.success('Loan application submitted successfully!');
      navigateToReturn(params, '#/loans');
    } catch (err) {
      if (window.notify) window.notify.error('Error submitting loan: ' + (err.message || 'Validation Failed'));
      console.error(err);
      restoreButton();
    }
  };

  return container;
};
