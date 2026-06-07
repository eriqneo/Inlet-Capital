import { authService } from '../../services/authService.js';
import { navigate } from '../../core/router.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderChangePasswordPage = async () => {
  const container = document.createElement('div');
  const user = authService.getUser();

  container.innerHTML = `
    <div class="card" style="max-width: 520px; margin: 32px auto;">
      <h1 class="text-xl" style="margin-bottom: 8px;">Change Password</h1>
      <p class="text-muted" style="margin-bottom: 24px;">Set a private password before using the system.</p>
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 12px 14px; margin-bottom: 20px;">
        <div class="font-semibold" style="font-size: 0.9rem;">First login security step</div>
        <div class="text-xs text-muted" style="margin-top: 4px;">Use the temporary password issued by admin, then choose your own password.</div>
      </div>
      <form id="change-password-form">
        <div class="form-group">
          <label class="form-label">Account</label>
          <input type="email" class="form-control" value="${user?.email || ''}" disabled />
        </div>
        <div class="form-group">
          <label class="form-label">Temporary / Current Password</label>
          <input type="password" name="currentPassword" class="form-control" required autocomplete="current-password" />
        </div>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input type="password" name="newPassword" class="form-control" required minlength="8" autocomplete="new-password" />
        </div>
        <div class="form-group">
          <label class="form-label">Confirm New Password</label>
          <input type="password" name="confirmPassword" class="form-control" required minlength="8" autocomplete="new-password" />
        </div>
        <div id="change-password-error" class="text-danger text-sm" style="display: none; margin-bottom: 16px;"></div>
        <button type="submit" class="btn btn-primary" id="change-password-submit" style="width: 100%;">Save New Password</button>
      </form>
    </div>
  `;

  const form = container.querySelector('#change-password-form');
  const error = container.querySelector('#change-password-error');
  const submitBtn = container.querySelector('#change-password-submit');

  form.onsubmit = async (event) => {
    event.preventDefault();
    error.style.display = 'none';
    const data = Object.fromEntries(new FormData(form).entries());
    if (data.newPassword !== data.confirmPassword) {
      error.textContent = 'New passwords do not match.';
      error.style.display = 'block';
      return;
    }
    if (data.newPassword === data.currentPassword) {
      error.textContent = 'Choose a password different from the temporary password.';
      error.style.display = 'block';
      return;
    }

    const restoreButton = setButtonLoading(submitBtn, 'Saving...');
    try {
      await authService.changeOwnPassword(data.currentPassword, data.newPassword);
      container.innerHTML = `
        <div class="card" style="max-width: 560px; margin: 32px auto; text-align: center;">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(16, 185, 129, 0.12); color: var(--success); display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 18px;">✓</div>
          <h1 class="text-xl" style="margin-bottom: 8px;">You're Set</h1>
          <p class="text-muted" style="max-width: 420px; margin: 0 auto 22px;">Your private password is saved. You can now use the system with your assigned access rights.</p>
          <div style="text-align: left; background: var(--bg-light); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; margin-bottom: 22px;">
            <div class="font-semibold" style="margin-bottom: 8px;">Quick orientation</div>
            <div class="text-sm text-muted" style="line-height: 1.65;">
              Start from the dashboard, use the sidebar to open your modules, and record work only in areas assigned to your role.
            </div>
          </div>
          <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
            <button type="button" class="btn btn-primary" id="start-tour-btn">Start Quick Tour</button>
            <button type="button" class="btn btn-outline" id="skip-tour-btn">Go to Dashboard</button>
          </div>
        </div>
      `;
      container.querySelector('#start-tour-btn').onclick = () => {
        localStorage.setItem('inlet_show_welcome_tour', 'true');
        navigate('#/');
      };
      container.querySelector('#skip-tour-btn').onclick = () => {
        localStorage.removeItem('inlet_show_welcome_tour');
        navigate('#/');
      };
    } catch (err) {
      error.textContent = err.message || 'Could not change password.';
      error.style.display = 'block';
      restoreButton();
    }
  };

  return container;
};
