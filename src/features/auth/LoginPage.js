import { authService } from '../../services/authService.js';
import { handleApiError } from '../../services/api.js';
import { navigate } from '../../core/router.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderLoginPage = async () => {
  const container = document.createElement('div');
  container.className = 'auth-container';
  
  container.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">
        <h1 style="color: var(--primary);">INLET CAPITAL</h1>
        <p class="text-muted text-sm">Microfinance Management</p>
      </div>
      <form id="login-form">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="email" class="form-control" required autocomplete="email" />
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="password" class="form-control" required autocomplete="current-password" />
        </div>
        <div id="login-error" class="text-danger text-sm" style="display: none; margin-bottom: 16px; text-align: center;">Invalid credentials</div>
        <button type="submit" id="login-btn" class="btn btn-primary" style="width: 100%;">Login</button>
      </form>
      <form id="forgot-form" style="display: none;">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="reset-email" class="form-control" required autocomplete="email" />
        </div>
        <div id="reset-message" class="text-sm" style="display: none; margin-bottom: 16px; text-align: center;"></div>
        <button type="submit" id="reset-btn" class="btn btn-primary" style="width: 100%;">Send Reset Link</button>
      </form>
      <div style="text-align: center; margin-top: 24px;">
        <button type="button" id="forgot-toggle" class="btn btn-outline btn-sm">Forgot Password?</button>
        <div class="text-xs text-muted" style="margin-top: 12px;">System access is created by admin only.</div>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const forgotForm = container.querySelector('#forgot-form');
  const errorMsg = container.querySelector('#login-error');
  const loginBtn = container.querySelector('#login-btn');
  const forgotToggle = container.querySelector('#forgot-toggle');
  const resetBtn = container.querySelector('#reset-btn');
  const resetMessage = container.querySelector('#reset-message');
  let forgotMode = false;

  forgotToggle.onclick = () => {
    forgotMode = !forgotMode;
    form.style.display = forgotMode ? 'none' : 'block';
    forgotForm.style.display = forgotMode ? 'block' : 'none';
    forgotToggle.textContent = forgotMode ? 'Back to Login' : 'Forgot Password?';
    errorMsg.style.display = 'none';
    resetMessage.style.display = 'none';
    const email = container.querySelector('#email').value.trim();
    if (email) container.querySelector('#reset-email').value = email;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (loginBtn.disabled) return;
    
    errorMsg.style.display = 'none';
    const email = container.querySelector('#email').value.trim();
    const password = container.querySelector('#password').value;

    const restoreButton = setButtonLoading(loginBtn, 'Logging in...');

    try {
      const authData = await authService.login(email, password);
      navigate(authData.record.force_password_change ? '#/change-password' : '#/');
    } catch (err) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = err.message || 'Invalid credentials';
      handleApiError(err, 'Login');
      restoreButton();
    }
  });

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (resetBtn.disabled) return;
    resetMessage.style.display = 'none';
    const email = container.querySelector('#reset-email').value.trim();
    const restoreButton = setButtonLoading(resetBtn, 'Sending...');
    try {
      await authService.resetPassword(email);
      resetMessage.className = 'text-sm text-success';
      resetMessage.textContent = 'Password reset link sent if this email is registered.';
      resetMessage.style.display = 'block';
    } catch (err) {
      resetMessage.className = 'text-sm text-danger';
      resetMessage.textContent = err.message || 'Could not send password reset link.';
      resetMessage.style.display = 'block';
    } finally {
      restoreButton();
    }
  });

  return container;
};
