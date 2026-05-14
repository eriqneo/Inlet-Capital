import { getSession, logout } from '../core/auth.js';
import { getById } from '../core/db.js';

export const renderHeader = async () => {
  const session = getSession();
  const header = document.createElement('header');
  header.className = 'header';
  
  // Fetch Org Details
  const orgName = (await getById('settings', 'org_name'))?.value || 'Inlet Capital';
  const orgLogo = (await getById('settings', 'org_logo'))?.value;

  // Greeting logic
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 18) greeting = 'Good afternoon';

  const user = session ? await getById('users', session.id) : null;
  const name = user ? user.name : (session ? session.name : 'User');
  const role = user ? (user.role === 'admin' ? 'Admin' : 'Loan Officer') : (session ? (session.role === 'admin' ? 'Admin' : 'Loan Officer') : '');

  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <button id="mobile-menu-btn" class="btn btn-outline" style="margin-right: 8px; border: none; padding: 4px; display: none;">
        <span style="font-size: 24px;">☰</span>
      </button>
      
      ${orgLogo ? `
        <div style="height: 40px; width: 40px; background: white; border-radius: 8px; overflow: hidden; padding: 4px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
          <img src="${orgLogo}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
        </div>
      ` : ''}

      <div>
        <h2 style="font-size: 1.125rem; margin: 0;">${greeting}, <span style="color: var(--secondary);">${name}</span></h2>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="text-xs text-muted" style="background: rgba(27,61,114,0.05); padding: 1px 6px; border-radius: 4px;">${role}</span>
          <span class="text-xs text-muted" style="opacity: 0.5;">@ ${orgName}</span>
        </div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 16px;">
      <!-- Logout moved to Sidebar -->
    </div>
  `;

  // Mobile Menu Toggle
  const mobileBtn = header.querySelector('#mobile-menu-btn');
  mobileBtn.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.toggle('open');
    }
  });

  // Responsive logic
  const checkWidth = () => {
    if (window.innerWidth <= 768) {
      mobileBtn.style.display = 'block';
    } else {
      mobileBtn.style.display = 'none';
    }
  };
  window.addEventListener('resize', checkWidth);
  checkWidth();

  // Logout handled in Sidebar
  return header;
};
