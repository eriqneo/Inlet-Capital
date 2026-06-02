import { authService } from '../../services/authService.js';
import { handleApiError } from '../../services/api.js';
import { navigate } from '../../core/router.js';

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
      <div style="text-align: center; margin-top: 24px;">
        <span class="text-xs text-muted">Use your PocketBase credentials</span>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errorMsg = container.querySelector('#login-error');

  const loginBtn = container.querySelector('#login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (loginBtn.disabled) return;
    
    errorMsg.style.display = 'none';
    const email = container.querySelector('#email').value.trim();
    const password = container.querySelector('#password').value;

    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';

    try {
      await authService.login(email, password);
      navigate('#/');
    } catch (err) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = err.message || 'Invalid credentials';
      handleApiError(err, 'Login');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
    }
  });

  return container;
};
