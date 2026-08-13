
import './components/Toast.js';
import './components/Dialog.js';
import { initRouter, addRoute } from './core/router.js';
import { authService } from './services/authService.js';
import { dataCache } from './services/dataCache.js';

const initApp = async () => {
  // System uses PocketBase which initializes data on server-side
  await dataCache.ensureCurrentEpoch();

  // Register Service Worker for PWA (Production Only)
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(
        (registration) => console.log('SW registered:', registration.scope),
        (error) => console.log('SW registration failed:', error)
      );
    });
  } else if ('serviceWorker' in navigator && import.meta.env.DEV) {
    // Unregister in dev mode to ensure clean local debugging
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
  }

  // Define Routes
  addRoute('#/login', async () => {
    const { renderLoginPage } = await import('./features/auth/LoginPage.js');
    return await renderLoginPage();
  }, { protect: false });

  addRoute('#/change-password', async () => {
    const { renderChangePasswordPage } = await import('./features/auth/ChangePasswordPage.js');
    return await renderChangePasswordPage();
  }, { protect: true });
  
  addRoute('#/', async () => {
    const { renderDashboard } = await import('./features/dashboard/Dashboard.js');
    return await renderDashboard();
  }, { protect: true });

  addRoute('#/analytics', async () => {
    const { renderAnalyticsDashboard } = await import('./features/analytics/AnalyticsDashboard.js');
    return await renderAnalyticsDashboard();
  }, { protect: true, module: 'analytics' });

  addRoute('#/members', async () => {
    const { renderMemberList } = await import('./features/members/MemberList.js');
    return await renderMemberList();
  }, { protect: true, module: 'members' });

  addRoute('#/members/new', async () => {
    const { renderMemberRegistration } = await import('./features/members/MemberRegistration.js');
    return await renderMemberRegistration();
  }, { protect: true, module: 'members' });

  addRoute('#/members/:id', async (params) => {
    const { renderMemberProfile } = await import('./features/members/MemberProfile.js');
    return await renderMemberProfile(params);
  }, { protect: true, module: 'members' });

  addRoute('#/groups', async () => {
    const { renderGroupList } = await import('./features/groups/GroupList.js');
    return await renderGroupList();
  }, { protect: true, module: 'groups' });

  addRoute('#/groups/new', async () => {
    const { renderGroupRegistration } = await import('./features/groups/GroupRegistration.js');
    return await renderGroupRegistration();
  }, { protect: true, module: 'groups' });

  addRoute('#/groups/:id/edit', async (params) => {
    const { renderGroupRegistration } = await import('./features/groups/GroupRegistration.js');
    return await renderGroupRegistration(params);
  }, { protect: true, roles: ['super_admin', 'admin'], module: 'groups' });

  addRoute('#/groups/:id', async (params) => {
    const { renderGroupProfile } = await import('./features/groups/GroupProfile.js');
    return await renderGroupProfile(params);
  }, { protect: true, module: 'groups' });

  addRoute('#/loans', async () => {
    const { renderLoanList } = await import('./features/loans/LoanList.js');
    return await renderLoanList();
  }, { protect: true, module: 'loans' });

  addRoute('#/loans/new', async (params) => {
    const { renderLoanApplicationForm } = await import('./features/loans/LoanApplicationForm.js');
    return await renderLoanApplicationForm(params || {});
  }, { protect: true, module: 'loans' });

  addRoute('#/loans/approve', async (params) => {
    const { renderLoanApprovalQueue } = await import('./features/loans/LoanApprovalQueue.js');
    return await renderLoanApprovalQueue(params || {});
  }, { protect: true, roles: ['super_admin', 'admin'], module: 'loans' });

  addRoute('#/loans/:id', async (params) => {
    const { renderLoanDetails } = await import('./features/loans/LoanDetails.js');
    return await renderLoanDetails(params || {});
  }, { protect: true, module: 'loans' });

  addRoute('#/savings', async () => {
    const { renderSavingsList } = await import('./features/savings/SavingsList.js');
    return await renderSavingsList();
  }, { protect: true, module: 'savings' });

  addRoute('#/savings/new', async (params) => {
    const { renderSavingsLedger } = await import('./features/savings/SavingsLedger.js');
    return await renderSavingsLedger(params);
  }, { protect: true, module: 'savings' });

  addRoute('#/expenses', async () => {
    const { renderExpenseList } = await import('./features/expenses/ExpenseList.js');
    return await renderExpenseList();
  }, { protect: true, module: 'expenses' });

  addRoute('#/expenses/new', async () => {
    const { renderExpenseEntry } = await import('./features/expenses/ExpenseEntry.js');
    return await renderExpenseEntry();
  }, { protect: true, module: 'expenses' });

  addRoute('#/reports', async () => {
    const { renderReportsDashboard } = await import('./features/reports/ReportsDashboard.js');
    return await renderReportsDashboard();
  }, { protect: true, module: 'reports' });

  addRoute('#/settings', async () => {
    const { renderAdminSettings } = await import('./features/settings/AdminSettings.js');
    return await renderAdminSettings();
  }, { protect: true, roles: ['super_admin', 'admin'], module: 'settings' });
  
  // Refresh session to get latest user role
  if (authService.isAuthenticated()) {
    authService.startInactivityWatch();
    await authService.refreshSession();
  }

  // Initialize Router
  initRouter('app');
};

document.addEventListener('DOMContentLoaded', initApp);
