import { authService } from '../services/authService.js';
import { destroyAppShell, ensureAppShell } from '../components/Layout.js';
import { updateSidebarActiveRoute } from '../components/Sidebar.js';
import { canAccessModule } from './permissions.js';
// Use Map to guarantee route registration order (prevents :id matching /new or /approve)
const routes = new Map();
let rootElement = null;
let routeRequestId = 0;

export const initRouter = (rootId) => {
  rootElement = document.getElementById(rootId);
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('inlet:user-access-changed', () => {
    if (!rootElement) return;
    destroyAppShell(rootElement);
    void handleRoute();
  });
  handleRoute();
};

export const addRoute = (path, renderFn, { protect = true, roles = [], module = '' } = {}) => {
  routes.set(path, { renderFn, protect, roles, module });
};

export const navigate = (path) => {
  window.location.hash = path;
};

// Track active subscriptions for cleanup
let activeUnsubscribers = [];

const handleRoute = async () => {
  const requestId = ++routeRequestId;

  // CLEANUP: Unsubscribe from previous page's subscriptions
  for (const unsub of activeUnsubscribers) {
    if (typeof unsub === 'function') unsub();
  }
  activeUnsubscribers = [];

  const fullHash = window.location.hash || '#/';
  const [hash, queryString] = fullHash.split('?');
  
  let match = null;
  let route = null;
  let params = {};

  // Parse query string if present
  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
  }

  for (const [path, routeData] of routes) {
    // Convert path like #/members/:id to regex
    const paramNames = [];
    const regexPath = path.replace(/:([^\/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    }) + '$';
    
    const regex = new RegExp('^' + regexPath);
    const result = hash.match(regex);
    
    if (result) {
      route = routeData;
      match = result;
      paramNames.forEach((name, index) => {
        params[name] = result[index + 1];
      });
      break;
    }
  }

  if (!route) {
    destroyAppShell(rootElement);
    rootElement.innerHTML = `<div class="card text-center" style="margin-top: 50px;"><h2>404 - Not Found</h2><p class="text-muted">The page you are looking for does not exist.</p><button class="btn btn-primary" style="margin-top: 16px;" onclick="window.location.hash = '#/'">Go Dashboard</button></div>`;
    return;
  }

  if (route.protect) {
    const user = authService.getUser();
    if (authService.isInactiveExpired()) {
      authService.logout({ reason: 'inactivity' });
      return;
    }
    if (!user || !authService.isAuthenticated()) {
      navigate('#/login');
      return;
    }
    if (authService.isSuspended()) {
      authService.logout({ reason: 'suspended' });
      return;
    }
    if (user.force_password_change && hash !== '#/change-password') {
      navigate('#/change-password');
      return;
    }
    if (route.module && !canAccessModule(user, route.module)) {
      const pageTarget = await ensureAppShell(rootElement);
      updateSidebarActiveRoute(fullHash);
      pageTarget.innerHTML = `
        <div class="card" style="max-width: 520px; margin: 60px auto; text-align: center;">
          <h2 style="color: var(--danger);">Access Not Assigned</h2>
          <p class="text-muted">This module has not been assigned to your account. Contact your administrator if you need access.</p>
          <button class="btn btn-primary" style="margin-top: 16px;" onclick="window.location.hash='#/'">Back to Dashboard</button>
        </div>`;
      return;
    }
    if (route.roles && route.roles.length > 0 && !route.roles.includes(user.role)) {
      const pageTarget = await ensureAppShell(rootElement);
      updateSidebarActiveRoute(fullHash);
      pageTarget.innerHTML = `
        <div class="card" style="max-width: 500px; margin: 60px auto; text-align: center;">
          <h2 style="color: var(--danger);">🔒 Access Denied</h2>
          <p class="text-muted">You do not have permission to view this page.</p>
          <button class="btn btn-primary" style="margin-top: 16px;" onclick="window.location.hash='#/'">Back to Dashboard</button>
        </div>`;
      return;
    }
  }

  const pageTarget = route.protect ? await ensureAppShell(rootElement) : rootElement;
  if (!route.protect) {
    destroyAppShell(rootElement);
  }
  updateSidebarActiveRoute(fullHash);

  pageTarget.innerHTML = `
    <div class="card text-center route-loading" style="padding: 40px; margin: 20px auto; max-width: 520px;">
      <div class="spinner" style="margin: 0 auto 16px;"></div>
      <p class="text-muted">Loading...</p>
    </div>
  `;

  try {
    const element = await route.renderFn(params);
    if (requestId !== routeRequestId) return;

    pageTarget.innerHTML = '';
    pageTarget.appendChild(element);

    // Collect any subscriptions the page registered
    if (element.__subscriptions) {
      activeUnsubscribers.push(...element.__subscriptions);
    }

    if (element.__subscriptionPromise) {
      element.__subscriptionPromise.then((subscriptions = []) => {
        if (requestId === routeRequestId) {
          activeUnsubscribers.push(...subscriptions);
        } else {
          subscriptions.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
          });
        }
      }).catch(error => {
        console.warn('Subscription setup failed:', error);
      });
    }
  } catch (error) {
    if (requestId !== routeRequestId) return;
    console.error('Routing Error:', error);
    console.error('Stack:', error.stack);
    pageTarget.innerHTML = `
      <div class="card" style="max-width: 600px; margin: 40px auto; text-align: center; border-top: 4px solid var(--danger);">
        <h2 style="color: var(--danger); margin-bottom: 16px;">Oops! Something went wrong</h2>
        <p class="text-muted" style="margin-bottom: 24px;">An error occurred while loading this page.</p>
        <div style="background: var(--bg-light); padding: 12px; border-radius: 8px; text-align: left; margin-bottom: 24px; overflow-x: auto;">
          <code class="text-xs text-danger" style="white-space: pre-wrap;">${error.message || String(error)}</code>
        </div>
        <button class="btn btn-primary" onclick="window.location.hash = '#/'">Return to Dashboard</button>
      </div>
    `;
  }
};
