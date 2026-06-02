import { authService } from '../services/authService.js';
import { settingsService } from '../services/settingsService.js';

let cachedOrgSettings = null;
let orgSettingsPromise = null;

const loadOrgSettings = async () => {
  if (cachedOrgSettings) return cachedOrgSettings;
  if (!orgSettingsPromise) {
    orgSettingsPromise = settingsService.getAll()
      .then(settings => {
        cachedOrgSettings = settings;
        return settings;
      })
      .catch(() => ({}))
      .finally(() => {
        orgSettingsPromise = null;
      });
  }
  return orgSettingsPromise;
};

const applyOrgSettings = (header, settings = {}) => {
  const orgName = settings.org_name || 'Inlet Capital';
  const orgLogo = settings.org_logo;
  const orgNameEl = header.querySelector('#header-org-name');
  const logoSlot = header.querySelector('#header-logo-slot');

  if (orgNameEl) orgNameEl.textContent = `@ ${orgName}`;
  if (logoSlot && orgLogo) {
    logoSlot.innerHTML = `
      <div style="height: 40px; width: 40px; background: white; border-radius: 8px; overflow: hidden; padding: 4px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
        <img src="${orgLogo}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
      </div>
    `;
  }
};

export const renderHeader = async () => {
  const user = authService.getUser();
  const header = document.createElement('header');
  header.className = 'header';

  // Greeting logic
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 18) greeting = 'Good afternoon';

  const name = user ? user.name || user.email : 'User';
  const role = (user && user.role) ? user.role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'No Role';

  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <button id="mobile-menu-btn" class="btn btn-outline mobile-menu-toggle" style="margin-right: 8px; border: none; padding: 4px; background: transparent;">
        <span style="font-size: 24px;">☰</span>
      </button>
      
      <div id="header-logo-slot"></div>

      <div>
        <h2 style="font-size: 1.125rem; margin: 0;">${greeting}, <span style="color: var(--secondary);">${name}</span></h2>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="text-xs text-muted" style="background: rgba(27,61,114,0.05); padding: 1px 6px; border-radius: 4px;">${role}</span>
          <span id="header-org-name" class="text-xs text-muted" style="opacity: 0.5;">@ Inlet Capital</span>
        </div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 16px;">
      <div id="sync-status" class="badge" style="background: rgba(16, 185, 129, 0.1); color: var(--success); font-weight: 600; padding: 6px 12px; display: flex; align-items: center; gap: 6px;">
        <div style="width: 8px; height: 8px; border-radius: 50%; background: var(--success);"></div>
        Synced
      </div>
    </div>
  `;

  // Sync status will be updated dynamically by syncManager later
  if (!navigator.onLine) {
    const syncBadge = header.querySelector('#sync-status');
    syncBadge.style.background = 'rgba(239, 68, 68, 0.1)';
    syncBadge.style.color = 'var(--danger)';
    syncBadge.innerHTML = `<div style="width: 8px; height: 8px; border-radius: 50%; background: var(--danger);"></div> Offline`;
  }
  
  window.addEventListener('online', () => {
    const syncBadge = header.querySelector('#sync-status');
    if (syncBadge) {
      syncBadge.style.background = 'rgba(16, 185, 129, 0.1)';
      syncBadge.style.color = 'var(--success)';
      syncBadge.innerHTML = `<div style="width: 8px; height: 8px; border-radius: 50%; background: var(--success);"></div> Synced`;
    }
  });
  
  window.addEventListener('offline', () => {
    const syncBadge = header.querySelector('#sync-status');
    if (syncBadge) {
      syncBadge.style.background = 'rgba(239, 68, 68, 0.1)';
      syncBadge.style.color = 'var(--danger)';
      syncBadge.innerHTML = `<div style="width: 8px; height: 8px; border-radius: 50%; background: var(--danger);"></div> Offline`;
    }
  });

  // Mobile Menu Toggle
  const mobileBtn = header.querySelector('#mobile-menu-btn');
  mobileBtn.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.toggle('open');
    }
  });

  if (cachedOrgSettings) {
    applyOrgSettings(header, cachedOrgSettings);
  } else {
    loadOrgSettings().then(settings => applyOrgSettings(header, settings));
  }

  // Logout handled in Sidebar
  return header;
};
