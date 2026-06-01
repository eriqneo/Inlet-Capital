import { groupService } from '../../services/groupService.js';
import { authService } from '../../services/authService.js';
import { generateGroupId } from '../../core/numberGen.js';
import { navigate } from '../../core/router.js';

export const renderGroupRegistration = async () => {
  const container = document.createElement('div');
  const groupId = generateGroupId();
  

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Register New Group</h1>
        <p class="text-muted">Create a new group for table banking and joint loans.</p>
      </div>
      <div class="badge badge-primary" style="font-size: 1rem; padding: 8px 16px;">
        ID: ${groupId}
      </div>
    </div>

    <form id="group-reg-form" class="card" style="max-width: 600px; margin: 0 auto;">
      <div class="form-group">
        <label class="form-label">Group Name</label>
        <input type="text" name="name" class="form-control" required placeholder="e.g. Unity Success Group" />
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-group">
          <label class="form-label">Registration Date</label>
          <input type="date" name="registration_date" class="form-control" value="${new Date().toISOString().split('T')[0]}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Meeting Day</label>
          <select name="meeting_day" class="form-control">
            <option value="Monday">Monday</option>
            <option value="Tuesday">Tuesday</option>
            <option value="Wednesday">Wednesday</option>
            <option value="Thursday">Thursday</option>
            <option value="Friday">Friday</option>
            <option value="Saturday">Saturday</option>
            <option value="Sunday">Sunday</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Location / Area</label>
        <input type="text" name="location" class="form-control" required placeholder="e.g. Nakuru East" />
      </div>

      <div class="form-group">
        <label class="form-label">Group Phone Number</label>
        <input type="tel" name="phone" class="form-control" required />
      </div>



      <div style="margin-top: 32px; display: flex; justify-content: flex-end; gap: 16px;">
        <button type="button" class="btn btn-outline" onclick="window.location.hash = '#/groups'">Cancel</button>
        <button type="submit" class="btn btn-primary">Register Group</button>
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
      status: 'active',
      member_count: 0,
      total_savings: 0,
      outstanding_loan: 0
    };

    const userId = authService.getUser()?.id;
    if (userId) {
      group.created_by = userId;
    }

    try {
      await groupService.create(group);

      if (window.notify) window.notify.success('Group registered successfully!');
      setTimeout(() => navigate('#/groups'), 1200);
    } catch (err) {
      if (window.notify) window.notify.error('Error registering group: ' + (err.message || 'Unknown error'));
      console.error(err);
    }
  };



  return container;
};
