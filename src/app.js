import { initializeData } from './core/schema.js';
import './components/Toast.js';
import { initRouter, addRoute } from './core/router.js';
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
  // Initialize DB and Seed Data
  try {
    await initializeData();
    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }

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
  addRoute('#/login', renderLoginPage, false);
  addRoute('#/', async () => await withLayout(await renderDashboard()), true);
  addRoute('#/analytics', async () => await withLayout(await renderAnalyticsDashboard()), true);
  addRoute('#/members', async () => await withLayout(await renderMemberList()), true);
  addRoute('#/members/new', async () => await withLayout(await renderMemberRegistration()), true);
  addRoute('#/members/:id', async (params) => await withLayout(await renderMemberProfile(params)), true);
  addRoute('#/groups', async () => await withLayout(await renderGroupList()), true);
  addRoute('#/groups/new', async () => await withLayout(await renderGroupRegistration()), true);
  addRoute('#/groups/:id', async (params) => await withLayout(await renderGroupProfile(params)), true);
  addRoute('#/loans', async () => await withLayout(await renderLoanList()), true);
  addRoute('#/loans/new', async (params) => await withLayout(await renderLoanApplicationForm(params || {})), true);
  addRoute('#/loans/approve', async () => await withLayout(await renderLoanApprovalQueue()), true);
  addRoute('#/loans/:id', async (params) => await withLayout(await renderLoanDetails(params || {})), true);
  addRoute('#/savings', async () => await withLayout(await renderSavingsList()), true);
  addRoute('#/savings/new', async () => await withLayout(await renderSavingsLedger()), true);
  addRoute('#/expenses', async () => await withLayout(await renderExpenseList()), true);
  addRoute('#/expenses/new', async () => await withLayout(await renderExpenseEntry()), true);
  addRoute('#/reports', async () => await withLayout(await renderReportsDashboard()), true);
  addRoute('#/settings', async () => await withLayout(await renderAdminSettings()), true);
  
  // Initialize Router
  initRouter('app');
};

document.addEventListener('DOMContentLoaded', initApp);
