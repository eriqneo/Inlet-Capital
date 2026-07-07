import { groupService } from '../../services/groupService.js';
import { authService } from '../../services/authService.js';
import { generateGroupId } from '../../core/numberGen.js';
import { navigate } from '../../core/router.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderGroupRegistration = async (params = {}) => {
  const container = document.createElement('div');
  const isEditMode = Boolean(params.id);
  let existingGroup = null;
  if (isEditMode) {
    existingGroup = await groupService.getById(params.id);
  }
  const groupId = existingGroup?.group_id || generateGroupId();
  const toDateInput = (value) => {
    if (!value) return new Date().toISOString().split('T')[0];
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString().split('T')[0] : date.toISOString().split('T')[0];
  };
  const escapeAttr = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
  

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">${isEditMode ? 'Edit Group' : 'Register New Group'}</h1>
        <p class="text-muted">${isEditMode ? 'Update group details without touching its history.' : 'Create a new group for table banking and joint loans.'}</p>
      </div>
      <div class="badge badge-primary" style="font-size: 1rem; padding: 8px 16px;">
        ID: ${groupId}
      </div>
    </div>

    <form id="group-reg-form" class="card" style="max-width: 600px; margin: 0 auto;">
      <div class="form-group">
        <label class="form-label">Group Name</label>
        <input type="text" name="name" class="form-control" required placeholder="e.g. Unity Success Group" value="${escapeAttr(existingGroup?.name || '')}" />
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-group">
          <label class="form-label">Registration Date</label>
          <input type="date" name="registration_date" class="form-control" value="${toDateInput(existingGroup?.registration_date)}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Meeting Day</label>
          <select name="meeting_day" class="form-control">
            ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `
              <option value="${day}" ${(existingGroup?.meeting_day || 'Monday') === day ? 'selected' : ''}>${day}</option>
            `).join('')}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Location / Area</label>
        <input type="text" name="location" class="form-control" required placeholder="e.g. Nakuru East" value="${escapeAttr(existingGroup?.location || '')}" />
      </div>

      <div class="form-group">
        <label class="form-label">Group Phone Number</label>
        <input type="tel" name="phone" class="form-control" required value="${escapeAttr(existingGroup?.phone || existingGroup?.phone_number || '')}" />
      </div>



      <div style="margin-top: 32px; display: flex; justify-content: flex-end; gap: 16px;">
        <button type="button" class="btn btn-outline" onclick="window.location.hash = '#/groups'">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEditMode ? 'Save Changes' : 'Register Group'}</button>
      </div>
    </form>
  `;

  const form = container.querySelector('#group-reg-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const groupData = Object.fromEntries(formData.entries());
    
    const group = {
      name: groupData.name,
      registration_date: new Date(groupData.registration_date).toISOString(),
      meeting_day: groupData.meeting_day,
      location: groupData.location,
      phone: groupData.phone,
      group_id: groupId,
      status: existingGroup?.status || 'active'
    };

    if (!isEditMode) {
      group.member_count = 0;
      group.total_savings = 0;
      group.outstanding_loan = 0;
      const userId = authService.getUser()?.id;
      if (userId) {
        group.created_by = userId;
        group.assigned_officer = userId;
      }
    }

    const restoreButton = setButtonLoading(form.querySelector('button[type="submit"]'), isEditMode ? 'Saving...' : 'Registering...');

    try {
      if (isEditMode) {
        await groupService.update(existingGroup.id, group);
      } else {
        await groupService.create(group);
      }

      if (window.notify) window.notify.success(isEditMode ? 'Group updated successfully!' : 'Group registered successfully!');
      setTimeout(() => navigate(isEditMode ? `#/groups/${existingGroup.id}` : '#/groups'), 800);
    } catch (err) {
      if (window.notify) window.notify.error(`Error ${isEditMode ? 'updating' : 'registering'} group: ` + (err.message || 'Unknown error'));
      console.error(err);
      restoreButton();
    }
  };



  return container;
};
