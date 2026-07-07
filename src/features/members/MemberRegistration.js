import { settingsService } from '../../services/settingsService.js';
import { memberService } from '../../services/memberService.js';
import { authService } from '../../services/authService.js';
import { generateRegNo } from '../../core/numberGen.js';
import { navigate } from '../../core/router.js';
import { openCamera } from '../../components/Camera.js';
import { initDateMask, parseInputDate } from '../../core/utils.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderMemberRegistration = async () => {
  const container = document.createElement('div');
  const regNo = generateRegNo();
  const todayInputValue = new Date().toISOString().split('T')[0];
  let regFee = 1000;

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Register New Member</h1>
        <p class="text-muted">Fill in the details to create a new member profile.</p>
      </div>
      <div class="badge badge-primary" style="font-size: 1rem; padding: 8px 16px;">
        ID: ${regNo}
      </div>
    </div>

    <form id="member-reg-form" class="card">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 32px;">
        <!-- Left Column: Personal Info -->
        <div>
          <h3 style="margin-bottom: 16px; border-bottom: 2px solid var(--bg-light); padding-bottom: 8px;">Individual Information</h3>
          
          <div class="form-group">
            <label class="form-label">Full Name (As per ID)</label>
            <input type="text" name="full_name" class="form-control" required />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
              <label class="form-label">ID Number</label>
              <input type="text" name="id_number" class="form-control" required />
            </div>
             <div class="form-group">
               <label class="form-label">Date of Birth</label>
               <input type="text" id="dob-input" name="dob" class="form-control" placeholder="dd/mm/yyyy" required />
             </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
              <label class="form-label">Marital Status</label>
              <select name="maritalStatus" class="form-control">
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">No. of Children</label>
              <input type="number" name="childrenCount" class="form-control" value="0" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Telephone</label>
            <input type="tel" name="phone_number" class="form-control" inputmode="numeric" pattern="[0-9]+" autocomplete="tel" required />
          </div>

          <div class="form-group">
            <label class="form-label">Residential Address / Town</label>
            <input type="text" name="address" class="form-control" required />
          </div>

          <div class="form-group">
            <label class="form-label">KRA PIN (Optional)</label>
            <input type="text" name="kraPin" class="form-control" />
          </div>
        </div>

        <!-- Right Column: Photos & Next of Kin -->
        <div>
          <h3 style="margin-bottom: 16px; border-bottom: 2px solid var(--bg-light); padding-bottom: 8px;">Photos & Next of Kin</h3>
          
          <div class="form-group" style="text-align: center; margin-bottom: 24px;">
            <label class="form-label">Passport Photo</label>
            <div id="passport-preview" style="width: 150px; height: 150px; background: var(--bg-light); border-radius: 8px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; border: 2px dashed var(--border-color); overflow: hidden;">
              <span class="text-muted">No Photo</span>
            </div>
            <button type="button" id="take-photo-btn" class="btn btn-outline btn-sm">Capture from Camera</button>
            <input type="hidden" name="passportPhoto" id="passport-data" />
          </div>

          <div class="form-group">
            <label class="form-label">Next of Kin Name</label>
            <input type="text" name="nok_name" class="form-control" required />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
              <label class="form-label">Next of Kin Phone</label>
              <input type="tel" name="nok_phone" class="form-control" inputmode="numeric" pattern="[0-9]+" autocomplete="tel" required />
            </div>
            <div class="form-group">
              <label class="form-label">Relationship</label>
              <input type="text" name="nok_relationship" class="form-control" required />
            </div>
          </div>

          <div class="card" style="background: var(--bg-light); border: none; margin-top: 24px;">
            <h4 style="margin-bottom: 12px; font-size: 0.875rem; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">Registration Summary</h4>
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 16px;">
              <span>Registration Fee</span>
              <span id="registration-fee-display" class="font-semibold" style="color: var(--success);">KES ${regFee.toLocaleString()}</span>
            </div>

            <div class="form-group" style="margin-bottom: 16px;">
              <label class="form-label" style="font-size: 0.75rem;">Registration Date</label>
              <input type="date" name="registration_date" class="form-control form-control-sm" value="${todayInputValue}" required />
            </div>
            
            <div class="form-group" style="margin-bottom: 16px;">
              <label class="form-label" style="font-size: 0.75rem;">Payment Method</label>
              <div style="display: flex; gap: 8px; margin-top: 6px;">
                <button type="button" class="btn pay-pill active" data-method="mpesa" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">📱 M-Pesa</button>
                <button type="button" class="btn pay-pill" data-method="cash" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">💵 Cash</button>
                <button type="button" class="btn pay-pill" data-method="card" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">💳 Card</button>
              </div>
              <input type="hidden" name="paymentMethod" id="pay-method-val" value="mpesa" />
            </div>

            <div class="form-group" id="pay-ref-group">
              <label class="form-label" style="font-size: 0.75rem;">Transaction Reference / Receipt No.</label>
              <input type="text" name="paymentReference" id="pay-ref-val" class="form-control form-control-sm" placeholder="e.g. QWE123RTY4" required />
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 16px;">
        <button type="button" class="btn btn-outline" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary">Complete Registration</button>
      </div>
    </form>
  `;

  // Date of Birth input mask
  initDateMask(container.querySelector('#dob-input'));

  settingsService.getNumber('individual_reg_fee', regFee).then(value => {
    regFee = Math.max(0, value);
    const feeDisplay = container.querySelector('#registration-fee-display');
    if (feeDisplay) feeDisplay.textContent = `KES ${regFee.toLocaleString()}`;
  }).catch(err => console.warn('[MemberRegistration] Registration fee fetch failed:', err));

  // Photo Capture logic
  const takePhotoBtn = container.querySelector('#take-photo-btn');
  const preview = container.querySelector('#passport-preview');
  const photoInput = container.querySelector('#passport-data');
  let passportPhotoFile = null;

  takePhotoBtn.onclick = () => {
    openCamera((dataUrl, file, meta) => {
      preview.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`;
      photoInput.value = '';
      passportPhotoFile = file || null;
      if (window.notify && meta?.sizeKb) window.notify.success(`Photo compressed to ${meta.sizeKb} KB.`);
    });
  };

  // Payment pill selector interaction
  const pills = container.querySelectorAll('.pay-pill');
  const payMethodInput = container.querySelector('#pay-method-val');
  const payRefGroup = container.querySelector('#pay-ref-group');
  const payRefInput = container.querySelector('#pay-ref-val');

  pills.forEach(pill => {
    pill.onclick = () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const val = pill.dataset.method;
      payMethodInput.value = val;

      if (val === 'cash') {
        payRefGroup.style.display = 'none';
        payRefInput.removeAttribute('required');
        payRefInput.value = '';
      } else {
        payRefGroup.style.display = 'block';
        payRefInput.setAttribute('required', 'true');
        payRefInput.placeholder = val === 'mpesa' ? 'e.g. QWE123RTY4' : 'e.g. Card Slip / Receipt No.';
      }
    };
  });

  // Form Submission
  const form = container.querySelector('#member-reg-form');
  form.querySelectorAll('input[name="phone_number"], input[name="nok_phone"]').forEach(input => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '');
    });
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const memberData = Object.fromEntries(formData.entries());
    const parsedDob = parseInputDate(memberData.dob);
    const selectedRegistrationDate = memberData.registration_date || todayInputValue;
    const capturedAt = new Date().toISOString();
    const phoneNumber = memberData.phone_number || memberData.phone || '';
    const maritalStatus = memberData.maritalStatus || memberData.marital_status || 'Single';
    const childrenCount = Number(memberData.childrenCount || memberData.children_count || 0);
    const currentUserId = authService.getUser()?.id || null;
    
    const member = {
      ...memberData,
      phone: phoneNumber,
      phone_number: phoneNumber,
      dob: parsedDob,
      date_of_birth: parsedDob,
      maritalStatus,
      marital_status: maritalStatus,
      childrenCount,
      children_count: childrenCount,
      reg_no: regNo,
      registration_date: new Date(`${selectedRegistrationDate}T12:00:00`).toISOString(),
      registration_fee: regFee,
      registration_fee_details: {
        method: memberData.paymentMethod || 'cash',
        reference: memberData.paymentReference || '',
        date: capturedAt,
        captured_at: capturedAt
      },
      status: 'active',
      registered_by: currentUserId,
      assigned_officer: currentUserId
    };
    if (passportPhotoFile) member.passportPhotoFile = passportPhotoFile;

    const restoreButton = setButtonLoading(form.querySelector('button[type="submit"]'), 'Registering...');

    try {
      await memberService.create(member);
      
      // Registration fee is tracked natively on the member record now.

      if (window.notify) window.notify.success('Member registered successfully!');
      setTimeout(() => navigate(`#/members/${regNo}`), 1200);
    } catch (err) {
      if (window.notify) window.notify.error('Error registering member: ' + (err.message || 'Unknown error'));
      console.error(err);
      restoreButton();
    }
  };

  container.querySelector('#cancel-btn').onclick = () => navigate('#/members');

  return container;
};
