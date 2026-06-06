
import './components/Toast.js';
import './components/Dialog.js';
import { initRouter, addRoute } from './core/router.js';
import { authService } from './services/authService.js';

const initApp = async () => {
  // System uses PocketBase which initializes data on server-side

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
  
  addRoute('#/', async () => {
    const { renderDashboard } = await import('./features/dashboard/Dashboard.js');
    return await renderDashboard();
  }, { protect: true });

  addRoute('#/analytics', async () => {
    const { renderAnalyticsDashboard } = await import('./features/analytics/AnalyticsDashboard.js');
    return await renderAnalyticsDashboard();
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'auditor'] });

  addRoute('#/members', async () => {
    const { renderMemberList } = await import('./features/members/MemberList.js');
    return await renderMemberList();
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer', 'cashier', 'group_officer', 'auditor'] });

  addRoute('#/members/new', async () => {
    const { renderMemberRegistration } = await import('./features/members/MemberRegistration.js');
    return await renderMemberRegistration();
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer'] });

  addRoute('#/members/:id', async (params) => {
    const { renderMemberProfile } = await import('./features/members/MemberProfile.js');
    return await renderMemberProfile(params);
  }, { protect: true });

  addRoute('#/groups', async () => {
    const { renderGroupList } = await import('./features/groups/GroupList.js');
    return await renderGroupList();
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer', 'group_officer', 'auditor'] });

  addRoute('#/groups/new', async () => {
    const { renderGroupRegistration } = await import('./features/groups/GroupRegistration.js');
    return await renderGroupRegistration();
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer', 'group_officer'] });

  addRoute('#/groups/:id', async (params) => {
    const { renderGroupProfile } = await import('./features/groups/GroupProfile.js');
    return await renderGroupProfile(params);
  }, { protect: true });

  addRoute('#/loans', async () => {
    const { renderLoanList } = await import('./features/loans/LoanList.js');
    return await renderLoanList();
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer'] });

  addRoute('#/loans/new', async (params) => {
    const { renderLoanApplicationForm } = await import('./features/loans/LoanApplicationForm.js');
    return await renderLoanApplicationForm(params || {});
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer'] });

  addRoute('#/loans/approve', async () => {
    const { renderLoanApprovalQueue } = await import('./features/loans/LoanApprovalQueue.js');
    return await renderLoanApprovalQueue();
  }, { protect: true, roles: ['super_admin', 'admin', 'manager'] });

  addRoute('#/loans/:id', async (params) => {
    const { renderLoanDetails } = await import('./features/loans/LoanDetails.js');
    return await renderLoanDetails(params || {});
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer'] });

  addRoute('#/savings', async () => {
    const { renderSavingsList } = await import('./features/savings/SavingsList.js');
    return await renderSavingsList();
  }, { protect: true, roles: ['super_admin', 'admin', 'cashier'] });

  addRoute('#/savings/new', async (params) => {
    const { renderSavingsLedger } = await import('./features/savings/SavingsLedger.js');
    return await renderSavingsLedger(params);
  }, { protect: true, roles: ['super_admin', 'admin', 'cashier'] });

  addRoute('#/expenses', async () => {
    const { renderExpenseList } = await import('./features/expenses/ExpenseList.js');
    return await renderExpenseList();
  }, { protect: true, roles: ['super_admin', 'admin', 'cashier'] });

  addRoute('#/expenses/new', async () => {
    const { renderExpenseEntry } = await import('./features/expenses/ExpenseEntry.js');
    return await renderExpenseEntry();
  }, { protect: true, roles: ['super_admin', 'admin', 'cashier'] });

  addRoute('#/reports', async () => {
    const { renderReportsDashboard } = await import('./features/reports/ReportsDashboard.js');
    return await renderReportsDashboard();
  }, { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer', 'auditor'] });

  addRoute('#/settings', async () => {
    const { renderAdminSettings } = await import('./features/settings/AdminSettings.js');
    return await renderAdminSettings();
  }, { protect: true, roles: ['super_admin', 'admin'] });
  
  // Refresh session to get latest user role
  if (authService.isAuthenticated()) {
    await authService.refreshSession();
  }

  // Initialize Router
  initRouter('app');
};

document.addEventListener('DOMContentLoaded', initApp);
