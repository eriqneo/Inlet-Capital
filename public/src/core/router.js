import { getSession } from './auth.js';

const routes = {};
let rootElement = null;

export const initRouter = (rootId) => {
  rootElement = document.getElementById(rootId);
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
};

export const addRoute = (path, renderFn, protectedRoute = true) => {
  routes[path] = { renderFn, protectedRoute };
};

export const navigate = (path) => {
  window.location.hash = path;
};

const handleRoute = async () => {
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

  for (const path in routes) {
    // Convert path like #/members/:id to regex
    const paramNames = [];
    const regexPath = path.replace(/:([^\/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    }) + '$';
    
    const regex = new RegExp('^' + regexPath);
    const result = hash.match(regex);
    
    if (result) {
      route = routes[path];
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

  if (route.protectedRoute) {
    const session = getSession();
    if (!session) {
      navigate('#/login');
      return;
    }
  }

  rootElement.innerHTML = '';
  const element = await route.renderFn(params);
  rootElement.appendChild(element);
};
