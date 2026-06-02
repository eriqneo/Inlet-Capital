import { authService } from '../services/authService.js';
import { navigate } from '../core/router.js';
import { pb } from '../services/api.js';

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

const canView = (path, role) => {
  const allowed = roleLinks[path];
  if (!allowed) return false;
  return allowed.includes('*') || allowed.includes(role);
};

export const renderSidebar = async () => {
  const session = authService.getUser();
  let pendingCount = 0;
  try {
    const res = await pb.collection('loans').getList(1, 1, { filter: 'status="pending"' });
    pendingCount = res.totalItems;
  } catch(e) {}

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  
  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <span class="logo-text"><span style="color: var(--secondary);">IN</span>LET</span>
      <button id="toggle-sidebar" class="sidebar-toggle">
        <span id="toggle-icon">◀</span>
      </button>
    </div>
    <ul class="nav-links">
      ${canView('#/', session?.role) ? `<li><a href="#/" class="nav-item active" data-tooltip="Dashboard"><span class="nav-icon">📊</span> <span class="nav-label">Dashboard</span></a></li>` : ''}
      ${canView('#/analytics', session?.role) ? `<li><a href="#/analytics" class="nav-item" data-tooltip="Analytics"><span class="nav-icon">📈</span> <span class="nav-label">Analytics</span></a></li>` : ''}
      ${canView('#/members', session?.role) ? `<li><a href="#/members" class="nav-item" data-tooltip="Members"><span class="nav-icon">👥</span> <span class="nav-label">Members</span></a></li>` : ''}
      ${canView('#/groups', session?.role) ? `<li><a href="#/groups" class="nav-item" data-tooltip="Groups"><span class="nav-icon">🏘️</span> <span class="nav-label">Groups</span></a></li>` : ''}
      ${canView('#/loans', session?.role) ? `<li>
        <a href="#/loans" class="nav-item" data-tooltip="Loans">
          <span class="nav-icon">💰</span> <span class="nav-label">Loans</span>
          ${pendingCount > 0 ? `<span class="badge-counter">${pendingCount}</span>` : ''}
        </a>
      </li>` : ''}
      ${canView('#/savings', session?.role) ? `<li><a href="#/savings" class="nav-item" data-tooltip="Savings"><span class="nav-icon">🏦</span> <span class="nav-label">Savings</span></a></li>` : ''}
      ${canView('#/expenses', session?.role) ? `<li><a href="#/expenses" class="nav-item" data-tooltip="Expenses"><span class="nav-icon">📉</span> <span class="nav-label">Expenses</span></a></li>` : ''}
      ${canView('#/reports', session?.role) ? `<li><a href="#/reports" class="nav-item" data-tooltip="Reports"><span class="nav-icon">📑</span> <span class="nav-label">Reports</span></a></li>` : ''}
      ${canView('#/settings', session?.role) ? `<li><a href="#/settings" class="nav-item" data-tooltip="Settings"><span class="nav-icon">⚙️</span> <span class="nav-label">Settings</span></a></li>` : ''}
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
  const currentHash = window.location.hash || '#/';
  const links = sidebar.querySelectorAll('.nav-item');
  links.forEach(link => {
    if (link.getAttribute('href') === currentHash) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
    
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.getAttribute('href'));
      
      // Update active state
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
      }
    });
  });

  return sidebar;
};
