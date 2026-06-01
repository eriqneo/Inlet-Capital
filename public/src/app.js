
import './components/Toast.js';
import './components/Dialog.js';
import { initRouter, addRoute } from './core/router.js';
import { authService } from './services/authService.js';
import { renderLoginPage } from './features/auth/LoginPage.js';
import { renderDashboard } from './features/dashboard/Dashboard.js';
import { renderMemberList } from './features/members/MemberList.js';
import { renderMemberRegistration } from './features/members/MemberRegistration.js';
import { renderMemberProfile } from './features/members/MemberProfile.js';
import { renderGroupList } from './features/groups/GroupList.js';
import { renderGroupRegistration } from './features/groups/GroupRegistration.js';
import { renderGroupProfile } from './features/groups/GroupProfile.js';
import { renderLoanList } from './features/loans/LoanList.js';
import { renderLoanApplicationForm } from './features/loans/LoanApplicationForm.js';
import { renderLoanApprovalQueue } from './features/loans/LoanApprovalQueue.js';
import { renderLoanDetails } from './features/loans/LoanDetails.js';
import { renderSavingsList } from './features/savings/SavingsList.js';
import { renderSavingsLedger } from './features/savings/SavingsLedger.js';
import { renderExpenseList } from './features/expenses/ExpenseList.js';
import { renderExpenseEntry } from './features/expenses/ExpenseEntry.js';
import { renderReportsDashboard } from './features/reports/ReportsDashboard.js';
import { renderAdminSettings } from './features/settings/AdminSettings.js';
import { renderAnalyticsDashboard } from './features/analytics/AnalyticsDashboard.js';
import { withLayout } from './components/Layout.js';

const initApp = async () => {
  // System uses PocketBase which initializes data on server-side

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(
        (registration) => console.log('SW registered:', registration.scope),
        (error) => console.log('SW registration failed:', error)
      );
    });
  }

  // Define Routes
  addRoute('#/login', renderLoginPage, { protect: false });
  addRoute('#/', async () => await withLayout(await renderDashboard()), { protect: true });
  addRoute('#/analytics', async () => await withLayout(await renderAnalyticsDashboard()), { protect: true, roles: ['super_admin', 'admin', 'manager', 'auditor'] });
  addRoute('#/members', async () => await withLayout(await renderMemberList()), { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer', 'cashier', 'group_officer', 'auditor'] });
  addRoute('#/members/new', async () => await withLayout(await renderMemberRegistration()), { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer'] });
  addRoute('#/members/:id', async (params) => await withLayout(await renderMemberProfile(params)), { protect: true });
  addRoute('#/groups', async () => await withLayout(await renderGroupList()), { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer', 'group_officer', 'auditor'] });
  addRoute('#/groups/new', async () => await withLayout(await renderGroupRegistration()), { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer', 'group_officer'] });
  addRoute('#/groups/:id', async (params) => await withLayout(await renderGroupProfile(params)), { protect: true });
  addRoute('#/loans', async () => await withLayout(await renderLoanList()), { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer'] });
  addRoute('#/loans/new', async (params) => await withLayout(await renderLoanApplicationForm(params || {})), { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer'] });
  addRoute('#/loans/approve', async () => await withLayout(await renderLoanApprovalQueue()), { protect: true, roles: ['super_admin', 'admin', 'manager'] });
  addRoute('#/loans/:id', async (params) => await withLayout(await renderLoanDetails(params || {})), { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer'] });
  addRoute('#/savings', async () => await withLayout(await renderSavingsList()), { protect: true, roles: ['super_admin', 'admin', 'cashier'] });
  addRoute('#/savings/new', async () => await withLayout(await renderSavingsLedger()), { protect: true, roles: ['super_admin', 'admin', 'cashier'] });
  addRoute('#/expenses', async () => await withLayout(await renderExpenseList()), { protect: true, roles: ['super_admin', 'admin', 'cashier'] });
  addRoute('#/expenses/new', async () => await withLayout(await renderExpenseEntry()), { protect: true, roles: ['super_admin', 'admin', 'cashier'] });
  addRoute('#/reports', async () => await withLayout(await renderReportsDashboard()), { protect: true, roles: ['super_admin', 'admin', 'manager', 'loan_officer', 'auditor'] });
  addRoute('#/settings', async () => await withLayout(await renderAdminSettings()), { protect: true, roles: ['super_admin', 'admin'] });
  
  // Refresh session to get latest user role
  if (authService.isAuthenticated()) {
    await authService.refreshSession();
  }

  // Initialize Router
  initRouter('app');
};

document.addEventListener('DOMContentLoaded', initApp);
