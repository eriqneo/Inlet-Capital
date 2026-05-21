import { add, getById, put } from '../../core/db.js';
import { generateRegNo } from '../../core/numberGen.js';
import { navigate } from '../../core/router.js';
import { openCamera } from '../../components/Camera.js';
import { initDateMask, parseInputDate } from '../../core/utils.js';

export const renderMemberRegistration = async () => {
  const container = document.createElement('div');
  const regNo = generateRegNo();
  
  // Get current registration fee from settings
  const regFeeSetting = await getById('settings', 'individual_reg_fee');
  const regFee = regFeeSetting ? regFeeSetting.value : 1000;

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
            <input type="text" name="fullName" class="form-control" required />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
              <label class="form-label">ID Number</label>
              <input type="text" name="idNo" class="form-control" required />
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
            <input type="tel" name="phone" class="form-control" required />
          </div>

          <div class="form-group">
            <label class="form-label">Residential Address / Town</label>
            <input type="text" name="residence" class="form-control" required />
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
            <input type="text" name="nokName" class="form-control" required />
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
              <label class="form-label">Next of Kin Phone</label>
              <input type="tel" name="nokPhone" class="form-control" required />
            </div>
            <div class="form-group">
              <label class="form-label">Relationship</label>
              <input type="text" name="nokRelationship" class="form-control" required />
            </div>
          </div>

          <div class="card" style="background: var(--bg-light); border: none; margin-top: 24px;">
            <h4 style="margin-bottom: 12px; font-size: 0.875rem; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">Registration Summary</h4>
            <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 16px;">
              <span>Registration Fee</span>
              <span class="font-semibold" style="color: var(--success);">KES ${regFee.toLocaleString()}</span>
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

  // Photo Capture logic
  const takePhotoBtn = container.querySelector('#take-photo-btn');
  const preview = container.querySelector('#passport-preview');
  const photoInput = container.querySelector('#passport-data');

  takePhotoBtn.onclick = () => {
    openCamera((dataUrl) => {
      preview.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`;
      photoInput.value = dataUrl;
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
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const memberData = Object.fromEntries(formData.entries());
    
    const member = {
      ...memberData,
      dob: parseInputDate(memberData.dob),
      regNo,
      registrationDate: new Date().toISOString(),
      registrationFee: regFee,
      status: 'active',
      lastActivity: new Date().toISOString()
    };

    try {
      await add('members', member);
      
      // Record the registration fee payment in fees_log so it reflects in Cash Flow
      await add('fees_log', {
        memberId: regNo,
        amount: regFee,
        type: 'registration_fee',
        date: new Date().toISOString(),
        method: memberData.paymentMethod,
        reference: memberData.paymentMethod === 'cash' ? 'CASH-REG' : (memberData.paymentReference || 'N/A')
      });

      notify.success('Member registered successfully!');
      setTimeout(() => navigate(`#/members/${regNo}`), 1200);
    } catch (err) {
      notify.error('Error registering member: ' + err.message);
    }
  };

  container.querySelector('#cancel-btn').onclick = () => navigate('#/members');

  return container;
};
