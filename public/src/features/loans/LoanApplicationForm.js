import { loanService } from '../../services/loanService.js';
import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { authService } from '../../services/authService.js';
import { settingsService } from '../../services/settingsService.js';
import { generateLoanNo } from '../../core/numberGen.js';
import { navigate } from '../../core/router.js';
import { openCamera } from '../../components/Camera.js';

export const renderLoanApplicationForm = async (params = {}) => {
  const container = document.createElement('div');
  const loanNo = generateLoanNo();
  
  // Settings (Now fetched directly from PocketBase settings collection via settingsService)
  const settings = {
    interestRate: (await settingsService.get('interest_rate_percent')) || 20,
    processingFeeRate: (await settingsService.get('processing_fee_percent')) || 8,
  };

  const members = await memberService.getAll();
  const groups = await groupService.getAll();

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">New Loan Application</h1>
        <p class="text-muted">Apply for a loan for an individual or a group.</p>
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
            <select name="memberId" class="form-control" id="member-select">
              <option value="">Select a member...</option>
              ${members.map(m => `<option value="${m.id}" data-group="${m.group || ''}">${m.full_name} (${m.reg_no})</option>`).join('')}
            </select>
          </div>

          <div class="form-group" id="group-select-group" style="display: none;">
            <label class="form-label">Select Group</label>
            <select name="groupId" class="form-control" id="group-select">
              <option value="">Select a group...</option>
              ${groups.map(g => `<option value="${g.id}">${g.name} (${g.group_id})</option>`).join('')}
            </select>
            <div id="group-autofill-status" style="display: none; margin-top: 8px; font-size: 0.75rem; padding: 6px 10px; border-radius: 4px; transition: all 0.3s ease;"></div>
          </div>
        </div>

        <!-- Section 2: Loan Parameters -->
        <div class="card">
          <h3 style="margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">2. Loan Details</h3>
          
          <div class="form-group">
            <label class="form-label">Loan Product / Type</label>
            <select name="type" class="form-control" required>
              <option value="business">Business Loan</option>
              <option value="emergency">Emergency Loan</option>
              <option value="school_fees">School Fees</option>
              <option value="development">Development Loan</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">Amount Applied (KES)</label>
            <input type="number" name="amount" id="loan-amount" class="form-control" required min="1000" />
          </div>

          <div class="form-group">
            <label class="form-label">Loan Period (Months)</label>
            <select name="period" class="form-control">
              <option value="1">1 Month</option>
              <option value="2">2 Months</option>
              <option value="3">3 Months</option>
              <option value="4">4 Months</option>
              <option value="5">5 Months</option>
              <option value="6">6 Months</option>
              <option value="7">7 Months</option>
              <option value="8">8 Months</option>
              <option value="9">9 Months</option>
              <option value="10">10 Months</option>
              <option value="11">11 Months</option>
              <option value="12">12 Months</option>
            </select>
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
              <span>Interest (${settings.interestRate}%):</span>
              <span id="summary-interest">KES 0</span>
            </div>
            <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; font-weight: 700;">
              <span>Total Liability:</span>
              <span id="summary-total" style="color: var(--secondary-light);">KES 0</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 12px; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border-left: 4px solid var(--secondary);">
              <div>
                <div style="font-size: 0.75rem; opacity: 0.7;">Processing Fee (${settings.processingFeeRate}%)</div>
                <div id="summary-processing" style="font-size: 1rem; font-weight: 700;">KES 0</div>
              </div>
              <div style="text-align: right; font-size: 0.75rem; opacity: 0.7;">Payable before<br>disbursement</div>
            </div>
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
        <button type="button" class="btn btn-outline" onclick="window.location.hash = '#/loans'">Cancel</button>
        <button type="submit" class="btn btn-primary btn-lg">Submit Application</button>
      </div>
    </form>
  `;

  // Logic: Show/Hide Applicant Selectors & Auto-fill
  const applicantTypeSelect = container.querySelector('#applicant-type');
  const memberGroup = container.querySelector('#member-select-group');
  const groupGroup = container.querySelector('#group-select-group');
  const memberSelect = container.querySelector('#member-select');
  const groupSelect = container.querySelector('#group-select');
  const autofillStatus = container.querySelector('#group-autofill-status');

  memberSelect.onchange = () => {
    if (applicantTypeSelect.value !== 'group-member') {
      autofillStatus.style.display = 'none';
      groupSelect.disabled = false;
      return;
    }

    const selectedOption = memberSelect.options[memberSelect.selectedIndex];
    const groupId = selectedOption ? selectedOption.dataset.group : null;
    
    if (groupId) {
      groupSelect.value = groupId;
      const groupName = groups.find(g => g.id === groupId)?.name;
      autofillStatus.innerHTML = `✅ Auto-filled: <strong>${groupName || 'Unknown'}</strong>`;
      autofillStatus.style.background = 'rgba(16, 185, 129, 0.1)';
      autofillStatus.style.color = 'var(--success)';
      autofillStatus.style.display = 'block';
      groupSelect.disabled = true; // Lock the field
    } else {
      groupSelect.value = '';
      groupSelect.disabled = false;
      autofillStatus.innerHTML = `⚠️ Member is not in any group. Consider using Individual Loan.`;
      autofillStatus.style.background = 'rgba(239, 68, 68, 0.1)';
      autofillStatus.style.color = 'var(--danger)';
      autofillStatus.style.display = 'block';
    }
  };

  applicantTypeSelect.onchange = () => {
    if (applicantTypeSelect.value === 'individual') {
      memberGroup.style.display = 'block';
      groupGroup.style.display = 'none';
      autofillStatus.style.display = 'none';
      groupSelect.disabled = false;
    } else if (applicantTypeSelect.value === 'group') {
      memberGroup.style.display = 'none';
      groupGroup.style.display = 'block';
      autofillStatus.style.display = 'none';
      groupSelect.disabled = false;
    } else {
      memberGroup.style.display = 'block';
      groupGroup.style.display = 'block';
      memberSelect.dispatchEvent(new Event('change')); // Trigger auto-fill if member is already selected
    }
  };

  // Pre-fill from Params
  if (params.memberId) {
    // If we have an ID from router params, try to match it
    const member = members.find(m => m.id === params.memberId || m.reg_no === params.memberId);
    if (member && member.group) {
      applicantTypeSelect.value = 'group-member';
    } else {
      applicantTypeSelect.value = 'individual';
    }
    memberSelect.value = member ? member.id : '';
    applicantTypeSelect.dispatchEvent(new Event('change'));
  } else if (params.groupId) {
    applicantTypeSelect.value = 'group';
    const group = groups.find(g => g.id === params.groupId || g.group_id === params.groupId);
    groupSelect.value = group ? group.id : '';
    applicantTypeSelect.dispatchEvent(new Event('change'));
  }

  // Logic: Real-time Calculations
  const amountInput = container.querySelector('#loan-amount');
  const sApplied = container.querySelector('#summary-applied');
  const sInterest = container.querySelector('#summary-interest');
  const sTotal = container.querySelector('#summary-total');
  const sProcessing = container.querySelector('#summary-processing');

  const updateCalculations = () => {
    const amount = parseFloat(amountInput.value) || 0;
    const interest = amount * (settings.interestRate / 100);
    const total = amount + interest;
    const processing = amount * (settings.processingFeeRate / 100);

    sApplied.textContent = `KES ${amount.toLocaleString()}`;
    sInterest.textContent = `KES ${interest.toLocaleString()}`;
    sTotal.textContent = `KES ${total.toLocaleString()}`;
    sProcessing.textContent = `KES ${processing.toLocaleString()}`;
  };

  amountInput.oninput = updateCalculations;

  // Logic: Dynamic Collateral
  const collateralList = container.querySelector('#collateral-list');
  const addCollateralBtn = container.querySelector('#add-collateral-btn');
  let collateralCount = 0;

  const addCollateralRow = () => {
    collateralCount++;
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
      openCamera((dataUrl) => {
        row.querySelector(`#preview-${id}`).style.display = 'block';
        row.querySelector(`#preview-${id}`).innerHTML = `<img src="${dataUrl}" style="height: 100%; border-radius: 4px;" />`;
        row.querySelector(`#data-${id}`).value = dataUrl;
      });
    };
  };

  addCollateralBtn.onclick = addCollateralRow;
  addCollateralRow(); // Add first row by default

  // Logic: Guarantor Photo
  const takeGPhotoBtn = container.querySelector('#take-guarantor-photo');
  const gPreview = container.querySelector('#guarantor-preview');
  const gPhotoInput = container.querySelector('#guarantor-photo-data');

  takeGPhotoBtn.onclick = () => {
    openCamera((dataUrl) => {
      gPreview.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`;
      gPhotoInput.value = dataUrl;
    });
  };

  // Logic: Form Submission
  const form = container.querySelector('#loan-app-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    // Ensure disabled groupSelect is included in FormData
    const groupSelectSubmit = container.querySelector('#group-select');
    if (groupSelectSubmit) groupSelectSubmit.disabled = false;
    
    const formData = new FormData(form);
    const rawData = Object.fromEntries(formData.entries());
    
    // Process Collaterals
    const collaterals = [];
    for (let i = 1; i <= collateralCount; i++) {
      if (rawData[`collateral_item_${i}`]) {
        collaterals.push({
          item: rawData[`collateral_item_${i}`],
          value: parseFloat(rawData[`collateral_value_${i}`]),
          photo: rawData[`collateral_photo_${i}`]
        });
      }
    }

    const amount = parseFloat(rawData.amount);
    const interestRate = settings.interestRate;
    const interest = amount * (interestRate / 100);
    const processingFee = amount * (settings.processingFeeRate / 100);

    const loan = {
      loan_no: loanNo,
      type: rawData.type,
      amount_applied: amount,
      approved_amount: 0,
      interest_rate: interestRate,
      interest_amount: interest,
      total_liability: amount + interest,
      processing_fee: processingFee,
      processing_fee_paid: false,
      period: parseInt(rawData.period),
      purpose: rawData.purpose,
      status: 'pending',
      application_date: new Date().toISOString(),
      guarantor: {
        name: rawData.guarantorName,
        phone: rawData.guarantorPhone,
        relationship: rawData.guarantorRelationship,
        photo: rawData.guarantorPhoto || null
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

    try {
      await loanService.apply(loan);
      if (window.notify) window.notify.success('Loan application submitted successfully!');
      navigate('#/loans');
    } catch (err) {
      if (window.notify) window.notify.error('Error submitting loan: ' + (err.message || 'Validation Failed'));
      console.error(err);
    }
  };

  return container;
};
