import { authService } from '../services/authService.js';
import { showLoader, hideLoader } from './utils.js';
// Use Map to guarantee route registration order (prevents :id matching /new or /approve)
const routes = new Map();
let rootElement = null;

export const initRouter = (rootId) => {
  rootElement = document.getElementById(rootId);
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
};

export const addRoute = (path, renderFn, { protect = true, roles = [] } = {}) => {
  routes.set(path, { renderFn, protect, roles });
};

export const navigate = (path) => {
  window.location.hash = path;
};

// Track active subscriptions for cleanup
let activeUnsubscribers = [];

const handleRoute = async () => {
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
    rootElement.innerHTML = `<div class="card text-center" style="margin-top: 50px;"><h2>404 - Not Found</h2><p class="text-muted">The page you are looking for does not exist.</p><button class="btn btn-primary" style="margin-top: 16px;" onclick="window.location.hash = '#/'">Go Dashboard</button></div>`;
    return;
  }

  if (route.protect) {
    const user = authService.getUser();
    if (!user || !authService.isAuthenticated()) {
      navigate('#/login');
      return;
    }
    if (route.roles && route.roles.length > 0 && !route.roles.includes(user.role)) {
      rootElement.innerHTML = `
        <div class="card" style="max-width: 500px; margin: 60px auto; text-align: center;">
          <h2 style="color: var(--danger);">🔒 Access Denied</h2>
          <p class="text-muted">You do not have permission to view this page.</p>
          <button class="btn btn-primary" style="margin-top: 16px;" onclick="window.location.hash='#/'">Back to Dashboard</button>
        </div>`;
      return;
    }
  }

  rootElement.innerHTML = '';
  showLoader();
  try {
    const element = await route.renderFn(params);
    rootElement.appendChild(element);

    // Collect any subscriptions the page registered
    if (element.__subscriptions) {
      activeUnsubscribers.push(...element.__subscriptions);
    }
  } catch (error) {
    console.error('Routing Error:', error);
    console.error('Stack:', error.stack);
    rootElement.innerHTML = `
      <div class="card" style="max-width: 600px; margin: 40px auto; text-align: center; border-top: 4px solid var(--danger);">
        <h2 style="color: var(--danger); margin-bottom: 16px;">Oops! Something went wrong</h2>
        <p class="text-muted" style="margin-bottom: 24px;">An error occurred while loading this page.</p>
        <div style="background: var(--bg-light); padding: 12px; border-radius: 8px; text-align: left; margin-bottom: 24px; overflow-x: auto;">
          <code class="text-xs text-danger" style="white-space: pre-wrap;">${error.message || String(error)}</code>
        </div>
        <button class="btn btn-primary" onclick="window.location.hash = '#/'">Return to Dashboard</button>
      </div>
    `;
  } finally {
    hideLoader();
  }
};
