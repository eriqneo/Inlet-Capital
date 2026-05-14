import { login } from '../../core/auth.js';
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
          <label class="form-label">Username</label>
          <input type="text" id="username" class="form-control" required autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label">PIN</label>
          <input type="password" id="pin" class="form-control" required autocomplete="off" />
        </div>
        <div id="login-error" class="text-danger text-sm" style="display: none; margin-bottom: 16px; text-align: center;">Invalid credentials</div>
        <button type="submit" class="btn btn-primary" style="width: 100%;">Login</button>
      </form>
      <div style="text-align: center; margin-top: 24px;">
        <span class="text-xs text-muted">Default login: admin / 0000</span>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errorMsg = container.querySelector('#login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = container.querySelector('#username').value;
    const pin = container.querySelector('#pin').value;

    const success = await login(username, pin);
    if (success) {
      navigate('#/');
    } else {
      errorMsg.style.display = 'block';
    }
  });

  return container;
};
