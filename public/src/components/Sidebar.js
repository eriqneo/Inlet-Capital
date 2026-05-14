import { getSession } from '../core/auth.js';
import { navigate } from '../core/router.js';
import { getAll } from '../core/db.js';

export const renderSidebar = async () => {
  const session = getSession();
  const allLoans = await getAll('loans');
  const pendingCount = allLoans.filter(l => l.status === 'pending').length;

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
      <li><a href="#/" class="nav-item active" data-tooltip="Dashboard"><span class="nav-icon">📊</span> <span class="nav-label">Dashboard</span></a></li>
      <li><a href="#/analytics" class="nav-item" data-tooltip="Analytics"><span class="nav-icon">📈</span> <span class="nav-label">Analytics</span></a></li>
      <li><a href="#/members" class="nav-item" data-tooltip="Members"><span class="nav-icon">👥</span> <span class="nav-label">Members</span></a></li>
      <li><a href="#/groups" class="nav-item" data-tooltip="Groups"><span class="nav-icon">🏘️</span> <span class="nav-label">Groups</span></a></li>
      <li>
        <a href="#/loans" class="nav-item" data-tooltip="Loans">
          <span class="nav-icon">💰</span> <span class="nav-label">Loans</span>
          ${pendingCount > 0 ? `<span class="badge-counter">${pendingCount}</span>` : ''}
        </a>
      </li>
      <li><a href="#/savings" class="nav-item" data-tooltip="Savings"><span class="nav-icon">🏦</span> <span class="nav-label">Savings</span></a></li>
      ${session && session.role === 'admin' ? `
        <li><a href="#/expenses" class="nav-item" data-tooltip="Expenses"><span class="nav-icon">📉</span> <span class="nav-label">Expenses</span></a></li>
        <li><a href="#/reports" class="nav-item" data-tooltip="Reports"><span class="nav-icon">📑</span> <span class="nav-label">Reports</span></a></li>
        <li><a href="#/settings" class="nav-item" data-tooltip="Settings"><span class="nav-icon">⚙️</span> <span class="nav-label">Settings</span></a></li>
      ` : ''}
    </ul>

    <div class="sidebar-footer">
      <div class="user-badge" data-tooltip="${session ? session.name : 'Profile'}">
        <div class="user-avatar">
          ${session ? session.name.charAt(0).toUpperCase() : 'U'}
        </div>
        <div class="user-info">
          <div class="user-name">${session ? session.name : 'Unknown User'}</div>
          <div class="user-role">${session ? (session.role === 'admin' ? 'Super Admin' : 'Loan Officer') : ''}</div>
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
    import('../core/auth.js').then(auth => {
      logoutBtn.onclick = auth.logout;
    });
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
