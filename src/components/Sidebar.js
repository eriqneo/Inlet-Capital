import { authService } from '../services/authService.js';
import { navigate } from '../core/router.js';
import { pb } from '../services/api.js';
import { settingsService } from '../services/settingsService.js';
import { canAccessModule } from '../core/permissions.js';

const PENDING_LOANS_CACHE_KEY = 'inlet_pending_loans_count';
const PENDING_LOANS_TTL = 2 * 60 * 1000;
let pendingLoanCountPromise = null;

const roleLinks = {
  '#/':           ['*'],
  '#/analytics':  ['super_admin', 'admin', 'manager', 'auditor'],
  '#/members':    ['super_admin', 'admin', 'manager', 'loan_officer', 'cashier', 'group_officer', 'auditor'],
  '#/groups':     ['super_admin', 'admin', 'manager', 'loan_officer', 'group_officer', 'auditor'],
  '#/loans':      ['super_admin', 'admin', 'manager', 'loan_officer'],
  '#/savings':    ['super_admin', 'admin', 'cashier'],
  '#/expenses':   ['super_admin', 'admin', 'cashier'],
  '#/reports':    ['super_admin', 'admin', 'manager', 'loan_officer', 'auditor'],
  '#/settings':   ['super_admin', 'admin'],
};

const pathModules = {
  '#/': 'dashboard',
  '#/analytics': 'analytics',
  '#/members': 'members',
  '#/groups': 'groups',
  '#/loans': 'loans',
  '#/savings': 'savings',
  '#/expenses': 'expenses',
  '#/reports': 'reports',
  '#/settings': 'settings'
};

const canView = (path, user) => {
  const allowed = roleLinks[path];
  if (!allowed) return false;
  const roleAllowed = allowed.includes('*') || allowed.includes(user?.role);
  return roleAllowed && canAccessModule(user, pathModules[path]);
};

export const updateSidebarActiveRoute = (currentHash = window.location.hash || '#/') => {
  const [hash] = currentHash.split('?');
  const links = document.querySelectorAll('.sidebar .nav-item');

  links.forEach(link => {
    const href = link.getAttribute('href');
    const isDashboard = href === '#/' && hash === '#/';
    const isSection = href !== '#/' && (hash === href || hash.startsWith(`${href}/`));
    link.classList.toggle('active', isDashboard || isSection);
  });
};

const getCachedPendingLoanCount = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(PENDING_LOANS_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.ts < PENDING_LOANS_TTL) return cached.count;
  } catch (e) {}
  return 0;
};

const setCachedPendingLoanCount = (count) => {
  try {
    localStorage.setItem(PENDING_LOANS_CACHE_KEY, JSON.stringify({ count, ts: Date.now() }));
  } catch (e) {}
};

const fetchPendingLoanCount = async () => {
  if (!pendingLoanCountPromise) {
    pendingLoanCountPromise = pb.collection('loans')
      .getList(1, 1, { filter: 'status="pending"' })
      .then(res => {
        setCachedPendingLoanCount(res.totalItems);
        return res.totalItems;
      })
      .catch(() => getCachedPendingLoanCount())
      .finally(() => {
        pendingLoanCountPromise = null;
      });
  }
  return pendingLoanCountPromise;
};

const updatePendingLoanBadge = (sidebar, count) => {
  const loansLink = sidebar.querySelector('[data-nav-path="#/loans"]');
  if (!loansLink) return;

  let badge = loansLink.querySelector('.badge-counter');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge-counter';
      loansLink.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) {
    badge.remove();
  }
};

export const renderSidebar = async () => {
  const session = authService.getUser();
  const pendingCount = getCachedPendingLoanCount();
  let orgSettings = {};
  try {
    orgSettings = await settingsService.getAll();
  } catch (err) {
    console.warn('[Sidebar] Failed to load organisation branding:', err.message);
  }
  const orgName = orgSettings.org_name || 'Inlet Capital';
  const orgLogo = orgSettings.org_logo || '';

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  
  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-brand" data-tooltip="${orgName}">
        <div class="sidebar-logo-frame">
          ${orgLogo
            ? `<img src="${orgLogo}" alt="${orgName} logo" class="sidebar-logo-img" />`
            : `<span class="sidebar-logo-fallback">IC</span>`
          }
        </div>
        <div class="logo-text">
          <span class="brand-name">${orgName}</span>
          <span class="brand-subtitle">Management System</span>
        </div>
      </div>
      <button id="toggle-sidebar" class="sidebar-toggle">
        <span id="toggle-icon">◀</span>
      </button>
    </div>
    <ul class="nav-links">
      ${canView('#/', session) ? `<li><a href="#/" class="nav-item active" data-nav-path="#/" data-tooltip="Dashboard"><span class="nav-icon">📊</span> <span class="nav-label">Dashboard</span></a></li>` : ''}
      ${canView('#/analytics', session) ? `<li><a href="#/analytics" class="nav-item" data-nav-path="#/analytics" data-tooltip="Analytics"><span class="nav-icon">📈</span> <span class="nav-label">Analytics</span></a></li>` : ''}
      ${canView('#/members', session) ? `<li><a href="#/members" class="nav-item" data-nav-path="#/members" data-tooltip="Members"><span class="nav-icon">👥</span> <span class="nav-label">Members</span></a></li>` : ''}
      ${canView('#/groups', session) ? `<li><a href="#/groups" class="nav-item" data-nav-path="#/groups" data-tooltip="Groups"><span class="nav-icon">🏘️</span> <span class="nav-label">Groups</span></a></li>` : ''}
      ${canView('#/loans', session) ? `<li>
        <a href="#/loans" class="nav-item" data-nav-path="#/loans" data-tooltip="Loans">
          <span class="nav-icon">💰</span> <span class="nav-label">Loans</span>
          ${pendingCount > 0 ? `<span class="badge-counter">${pendingCount}</span>` : ''}
        </a>
      </li>` : ''}
      ${canView('#/savings', session) ? `<li><a href="#/savings" class="nav-item" data-nav-path="#/savings" data-tooltip="Savings"><span class="nav-icon">🏦</span> <span class="nav-label">Savings</span></a></li>` : ''}
      ${canView('#/expenses', session) ? `<li><a href="#/expenses" class="nav-item" data-nav-path="#/expenses" data-tooltip="Expenses"><span class="nav-icon">📉</span> <span class="nav-label">Expenses</span></a></li>` : ''}
      ${canView('#/reports', session) ? `<li><a href="#/reports" class="nav-item" data-nav-path="#/reports" data-tooltip="Reports"><span class="nav-icon">📑</span> <span class="nav-label">Reports</span></a></li>` : ''}
      ${canView('#/settings', session) ? `<li><a href="#/settings" class="nav-item" data-nav-path="#/settings" data-tooltip="Settings"><span class="nav-icon">⚙️</span> <span class="nav-label">Settings</span></a></li>` : ''}
    </ul>

    <div class="sidebar-footer">
      <div class="user-badge" data-tooltip="${session ? session.name : 'Profile'}">
        <div class="user-avatar">
          ${session ? session.name.charAt(0).toUpperCase() : 'U'}
        </div>
        <div class="user-info">
          <div class="user-name">${session ? session.name || session.email : 'Unknown User'}</div>
          <div class="user-role" style="text-transform: capitalize;">${session && session.role ? session.role.replace('_', ' ') : 'No Role'}</div>
        </div>
      </div>
      <button id="sidebar-logout" class="btn-logout" data-tooltip="Logout">
        <span class="nav-icon">🚪</span> <span class="logout-text">Logout</span>
      </button>
    </div>
  `;

  // Logout Logic
  const logoutBtn = sidebar.querySelector('#sidebar-logout');
  if (logoutBtn) {
    logoutBtn.onclick = () => authService.logout();
  }

  // Toggle Logic
  const toggleBtn = sidebar.querySelector('#toggle-sidebar');
  const toggleIcon = sidebar.querySelector('#toggle-icon');
  
  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('collapsed');
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.classList.toggle('sidebar-collapsed');
    }
    toggleIcon.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
    
    // Save preference
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
  };

  // Restore preference
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    sidebar.classList.add('collapsed');
    toggleIcon.textContent = '▶';
    // We need to wait for main-content to exist or use a mutation observer, 
    // but in withLayout it's added right after.
    setTimeout(() => {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) mainContent.classList.add('sidebar-collapsed');
    }, 0);
  }

  // Highlight active link
  const links = sidebar.querySelectorAll('.nav-item');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.getAttribute('href'));
      updateSidebarActiveRoute(link.getAttribute('href'));
      
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
      }
    });
  });

  updateSidebarActiveRoute();
  fetchPendingLoanCount().then(count => updatePendingLoanBadge(sidebar, count));

  return sidebar;
};
