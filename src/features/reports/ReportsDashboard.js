import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { loanService } from '../../services/loanService.js';
import { savingsService } from '../../services/savingsService.js';
import { expenseService } from '../../services/expenseService.js';
import { pb } from '../../services/api.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate, formatMoney, formatPercent } from '../../core/utils.js';
import { dataCache } from '../../services/dataCache.js';
import { renderCardSkeleton, renderInlineSyncStatus, renderTableSkeletonRows, setButtonLoading } from '../../core/uiState.js';
import { settingsService } from '../../services/settingsService.js';
import { getArrearsTotal, getDaysInArrears, getScheduleRemaining, isScheduleInArrears, isSchedulePaid } from '../../core/loanScheduleMetrics.js';
import { getRepaymentPrincipalAmount } from '../../core/loanPenalty.js';
import { withReturnTo } from '../../core/navigation.js';
import { getLatestSavingsDate, getMemberActivityStatus } from '../../core/memberActivity.js';
import {
  calculateCollectedInterest,
  getLoanInterestAmount as getContractInterestAmount,
  getLoanLiabilityAmount as getContractLiabilityAmount,
  getLoanPrincipalAmount as getContractPrincipalAmount
} from '../../core/repaymentAllocation.js';
import { canUseOfficerFilter, createOfficerScope, getGroupOfficerId, getMemberOfficerId, loadOfficerOptions, matchesOfficer, populateOfficerSelect, shouldScopeOfficerData } from '../../core/officerScope.js';
import { createLoanPortfolioCalculator, isDisbursedLoanRecord } from '../../core/loanPortfolio.js';

export const renderReportsDashboard = async () => {
  const container = document.createElement('div');
  let members = [], groups = [], loans = [], expenses = [], schedules = [], savings = [], repayments = [], settlements = [];
  let lifecycleGroups = [], lifecycleMembers = [];
  let sourceMembers = [], sourceGroups = [], sourceLoans = [], sourceSchedules = [], sourceSavings = [], sourceRepayments = [], sourceSettlements = [];
  let sourceLifecycleGroups = [], sourceLifecycleMembers = [];
  let officerFilter = 'all';
  let repaymentsLoaded = false;
  let repaymentLoadError = null;
  let orgSettings = {};
  try {
    orgSettings = await settingsService.getAll();
  } catch (err) {
    console.warn('[Reports] Organisation branding unavailable:', err.message);
  }
  const orgName = orgSettings.org_name || 'Inlet Capital';
  const orgLogo = orgSettings.org_logo || '';
  const configuredPenaltyAmount = Number(orgSettings.penalty_amount);
  const automaticPenaltyAmount = orgSettings.penalty_amount === null
    || orgSettings.penalty_amount === undefined
    || orgSettings.penalty_amount === ''
    || !Number.isFinite(configuredPenaltyAmount)
    ? 500
    : configuredPenaltyAmount;
  const generatedAt = new Date();
  const pageSize = 10;
  let pages = {
    individuals: 1,
    groups: 1,
    disbursements: 1,
    registrations: 1,
    cashflow: 1,
    withdrawals: 1,
    repayments: 1,
    arrears: 1,
    lifecycle: 1,
    alerts: 1
  };

  let activeFilters = {
    individuals: 'all',
    groups: 'all',
    disbursements: 'all',
    registrations: 'all',
    cashflow: 'all',
    withdrawals: 'all',
    repayments: 'all',
    arrears: 'all',
    lifecycle: 'all'
  };
  let dateRange = {
    from: '',
    to: ''
  };
  let activeSorts = {
    individuals: 'name_asc',
    groups: 'name_asc',
    disbursements: 'date_desc',
    registrations: 'date_desc',
    cashflow: 'date_desc',
    withdrawals: 'date_desc',
    repayments: 'date_asc',
    arrears: 'days_desc',
    lifecycle: 'date_desc'
  };
  let isFullReportRender = false;

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;" class="no-print">
      <div>
        <h1 class="text-xl">System Reports</h1>
        <p class="text-muted">Comprehensive analytics and reporting.</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <button class="btn btn-outline" id="export-excel-btn" style="border-color: #10b981; color: #10b981;">📥 Export Excel</button>
        <button class="btn btn-outline" id="print-report-btn">🖨️ Print Report</button>
      </div>
    </div>

    <div class="card no-print" style="padding: 0; margin-bottom: 12px;">
      <div style="display: flex; border-bottom: 1px solid var(--border-color); overflow-x: auto;">
        <button class="tab-btn active" data-tab="pl">Profit & Loss Overview</button>
        <button class="tab-btn" data-tab="individuals">Individual Performance</button>
        <button class="tab-btn" data-tab="groups">Group Performance</button>
        <button class="tab-btn" data-tab="disbursements">Disbursements</button>
        <button class="tab-btn" data-tab="registrations">Registrations</button>
        <button class="tab-btn" data-tab="cashflow">Cash Flow</button>
        <button class="tab-btn" data-tab="withdrawals">Withdrawals</button>
        <button class="tab-btn" data-tab="repayments">Repayments</button>
        <button class="tab-btn" data-tab="arrears">Arrears Aging</button>
        <button class="tab-btn" data-tab="lifecycle">Lifecycle</button>
        <button class="tab-btn" data-tab="alerts">Alerts & Reminders</button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div id="filter-bar" class="no-print" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--bg-light); padding: 12px 20px; border-radius: 12px; flex-wrap: wrap;">
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <div id="filter-controls" style="display: flex; gap: 8px; flex-wrap: wrap;">
          <!-- Filters injected here -->
        </div>
        ${canUseOfficerFilter() ? '<select id="report-officer-filter" class="form-control" style="min-width: 210px; padding: 6px 8px; font-size: 0.75rem;"><option value="all">All Loan Officers</option></select>' : ''}
        <div id="sort-controls" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-left: 1px solid var(--border-color); padding-left: 12px;">
          <!-- Sort control injected here -->
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-left: 1px solid var(--border-color); padding-left: 12px;">
          <label class="text-xs text-muted" for="report-date-from">From</label>
          <input type="date" id="report-date-from" class="form-control" style="width: 145px; padding: 6px 8px; font-size: 0.75rem;" />
          <label class="text-xs text-muted" for="report-date-to">To</label>
          <input type="date" id="report-date-to" class="form-control" style="width: 145px; padding: 6px 8px; font-size: 0.75rem;" />
          <button type="button" class="btn btn-outline btn-sm" id="report-date-clear" style="font-size: 0.7rem; padding: 5px 10px;">Clear</button>
        </div>
      </div>
      <div id="filter-count" class="text-xs font-semibold" style="color: var(--secondary);">Showing all records</div>
    </div>

    <div id="report-content">
      <div id="report-print-header" class="print-only">
        <div class="print-brand-mark">
          ${orgLogo ? `<img src="${orgLogo}" alt="${orgName} logo" />` : `<span>${orgName.split(' ').map(word => word[0]).join('').slice(0, 2).toUpperCase()}</span>`}
        </div>
        <div class="print-brand-copy">
          <div class="print-org-name">${orgName}</div>
          <div class="print-report-name" id="print-report-name">Profit & Loss Overview</div>
          <div class="print-report-meta" id="print-report-meta">Generated ${generatedAt.toLocaleString()}</div>
        </div>
      </div>

      <!-- 1. Profit & Loss Overview -->
      <div id="pl-tab" class="report-section">
        <h2 style="margin-bottom: 8px;">Profit & Loss Overview</h2>
        <p class="text-sm text-muted" style="margin-bottom: 24px;">Income, expenses, and portfolio context for the selected period.</p>

        <div class="text-xs text-muted" style="font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 10px;">Income</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 28px;">
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #10b981; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Registration Fees</div>
            <div class="text-xl font-semibold text-success" id="pl-registration-fees" style="margin-top: 8px;">KES 0</div>
            <div class="text-xs text-muted" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75;">Members & Groups</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #06b6d4; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Processing Fees</div>
            <div class="text-xl font-semibold text-success" id="pl-processing-fees" style="margin-top: 8px;">KES 0</div>
            <div class="text-xs text-muted" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75;">Loan Origination</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #10b981; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Collected Interest</div>
            <div class="text-xl font-semibold text-success" id="pl-collected-interest" style="margin-top: 8px;">KES 0</div>
            <div class="text-xs text-muted" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75;">Recovered from repayments</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #f97316; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Collected Fines</div>
            <div class="text-xl font-semibold" id="pl-collected-fines" style="margin-top: 8px; color: #f97316;">KES 0</div>
            <div class="text-xs text-muted" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75;">Late payment charges</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid var(--success); box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">Total Income</div>
            <div class="text-xl font-semibold text-success" id="pl-total-income" style="margin-top: 8px;">KES 0</div>
            <div class="text-xs text-muted" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75;">Fees + interest + fines</div>
          </div>
        </div>

        <div class="text-xs text-muted" style="font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 10px;">Expenses</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 28px;">
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #ef4444; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Total Operating Costs</div>
            <div class="text-xl font-semibold text-danger" id="pl-operating-costs" style="margin-top: 8px;">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid var(--primary); box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">Net Income</div>
            <div class="text-xl font-semibold" id="pl-net-income" style="margin-top: 8px;">KES 0</div>
            <div class="text-xs text-muted" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75;">Total income minus operating costs</div>
          </div>
        </div>

        <div class="text-xs text-muted" style="font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 10px;">Portfolio Context</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 32px;">
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid var(--primary); box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Total Capital Disbursed</div>
            <div class="text-xl font-semibold" id="pl-capital-disbursed" style="margin-top: 8px;">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #f59e0b; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Expected Interest Portfolio</div>
            <div class="text-xl font-semibold text-primary" id="pl-expected-interest" style="margin-top: 8px;">KES 0</div>
          </div>
        </div>
      </div>

      <!-- 2. Individual Performance -->
      <div id="individuals-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Individual Reports</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-bottom: 16px;">
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--success);">
            <div class="text-xs text-muted">Savings Net</div>
            <div class="text-xl font-semibold text-success" id="individuals-total-savings">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--danger);">
            <div class="text-xs text-muted">OLB</div>
            <div class="text-xl font-semibold text-danger" id="individuals-total-olb">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--warning);">
            <div class="text-xs text-muted">Arrears</div>
            <div class="text-xl font-semibold text-warning" id="individuals-total-arrears">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
            <div class="text-xs text-muted">Table Entries</div>
            <div class="text-xl font-semibold text-primary" id="individuals-entry-count">0</div>
          </div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Name / ID</th>
                <th>Group</th>
                <th>Phone</th>
                <th>A.Savings <span title="Accumulated Savings Net — deposits minus withdrawals by this member" style="cursor:help; opacity:0.6;">ⓘ</span></th>
                <th>OL Balance</th>
                <th>Total Repaid</th>
                <th style="color: var(--danger);">Arrears</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="individuals-table-body"></tbody>
          </table>
          <div id="individuals-pagination"></div>
        </div>
      </div>

      <!-- 3. Group Performance -->
      <div id="groups-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Group Reports</h2>
        <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary); margin-bottom: 16px; max-width: 260px;">
          <div class="text-xs text-muted">Table Entries</div>
          <div class="text-xl font-semibold text-primary" id="groups-entry-count">0</div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Group Name / ID</th>
                <th>Phone</th>
                <th>A.Savings <span title="Accumulated Savings — total deposits by all group members" style="cursor:help; opacity:0.6;">ⓘ</span></th>
                <th>OL Balance</th>
                <th style="color: var(--success);">Active 🟢</th>
                <th style="color: var(--danger);">Inactive 🔴</th>
                <th style="color: var(--danger);">Arrears</th>
                <th style="color: var(--warning);">In Arrears ⚠</th>
              </tr>
            </thead>
            <tbody id="groups-table-body"></tbody>
          </table>
          <div id="groups-pagination"></div>
        </div>
      </div>

      <!-- 4. Disbursements -->
      <div id="disbursements-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Disbursement Report</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 16px;">
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--success);">
            <div class="text-xs text-muted">Total Disbursed</div>
            <div class="text-xl font-semibold text-success" id="disbursements-total-amount">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
            <div class="text-xs text-muted">Table Entries</div>
            <div class="text-xl font-semibold text-primary" id="disbursements-entry-count">0</div>
          </div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table" style="font-size: 0.75rem;">
            <thead>
              <tr>
                <th>LOAN NO</th>
                <th>CLIENT NAME</th>
                <th>PHONE NO</th>
                <th>GROUP</th>
                <th>DISBURSED</th>
                <th>APPLICATION DATE</th>
                <th>APPROVAL DATE</th>
                <th>DISBURSED DATE</th>
                <th>PERIOD</th>
                <th>END DATE</th>
                <th>GUARANTOR</th>
                <th>G. PHONE NUMBER</th>
                <th>RELATION</th>
                <th>SECURITIES</th>
                <th>OFFICERS</th>
              </tr>
            </thead>
            <tbody id="disbursements-table-body"></tbody>
          </table>
          <div id="disbursements-pagination"></div>
        </div>
      </div>

      <!-- 5. Registrations -->
      <div id="registrations-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Registration Report</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 16px;">
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--success);">
            <div class="text-xs text-muted">Amount Received</div>
            <div class="text-xl font-semibold text-success" id="registrations-amount-received">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
            <div class="text-xs text-muted">Table Entries</div>
            <div class="text-xl font-semibold text-primary" id="registrations-entry-count">0</div>
          </div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Reg No / Date</th>
                <th>Name</th>
                <th>Group</th>
                <th>ID / Phone</th>
                <th>Reg Fee</th>
                <th>Next of Kin</th>
                <th>NOK Phone</th>
              </tr>
            </thead>
            <tbody id="registrations-table-body"></tbody>
          </table>
          <div id="registrations-pagination"></div>
        </div>
      </div>

      <!-- 6. Cash Flow -->
      <div id="cashflow-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Cash Flow Ledger</h2>
        <div id="cashflow-summary" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <!-- Summary cards injected here -->
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Type</th>
                <th>Client / Member</th>
                <th>Group</th>
                <th>Reference</th>
                <th>Amount</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody id="cashflow-table-body"></tbody>
          </table>
          <div id="cashflow-pagination"></div>
        </div>
      </div>

      <!-- 7. Withdrawals -->
      <div id="withdrawals-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Withdrawal Report</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 16px;">
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--danger);">
            <div class="text-xs text-muted">Total Withdrawal Amount</div>
            <div class="text-xl font-semibold text-danger" id="withdrawals-total-amount">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
            <div class="text-xs text-muted">Table Entries</div>
            <div class="text-xl font-semibold text-primary" id="withdrawals-entry-count">0</div>
          </div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Group</th>
                <th>Remarks</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody id="withdrawals-table-body"></tbody>
          </table>
          <div id="withdrawals-pagination"></div>
        </div>
      </div>

      <!-- 8. Repayments -->
      <div id="repayments-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Repayments Report</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 16px;">
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--success);">
            <div class="text-xs text-muted">Amount Paid</div>
            <div class="text-xl font-semibold text-success" id="repayments-total-paid">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--danger);">
            <div class="text-xs text-muted">Outstanding OLB</div>
            <div class="text-xl font-semibold text-danger" id="repayments-total-olb">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
            <div class="text-xs text-muted">Table Entries</div>
            <div class="text-xl font-semibold text-primary" id="repayments-entry-count">0</div>
          </div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Ln Number</th>
                <th>Client Name</th>
                <th>Group</th>
                <th>OLB</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>Amount Paid</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="repayments-table-body"></tbody>
          </table>
          <div id="repayments-pagination"></div>
        </div>
      </div>

      <!-- 9. Arrears Aging -->
      <div id="arrears-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Arrears Aging Report</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 16px;">
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--danger);">
            <div class="text-xs text-muted">Total Arrears</div>
            <div class="text-xl font-semibold text-danger" id="arrears-total-amount">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid #10b981;">
            <div class="text-xs text-muted">1-30 Days</div>
            <div class="text-xl font-semibold" style="color: #10b981;" id="arrears-1-30-count">0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid #f59e0b;">
            <div class="text-xs text-muted">31-60 Days</div>
            <div class="text-xl font-semibold" style="color: #f59e0b;" id="arrears-31-60-count">0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid #ef4444;">
            <div class="text-xs text-muted">61+ Days</div>
            <div class="text-xl font-semibold" style="color: #ef4444;" id="arrears-61-plus-count">0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
            <div class="text-xs text-muted">Table Entries</div>
            <div class="text-xl font-semibold text-primary" id="arrears-entry-count">0</div>
          </div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Ln Number</th>
                <th>Client Name</th>
                <th>Phone</th>
                <th>Group</th>
                <th>Due Date</th>
                <th>Days Late</th>
                <th>Age Band</th>
                <th>Arrears Amount</th>
                <th>OLB</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="arrears-table-body"></tbody>
          </table>
          <div id="arrears-pagination"></div>
        </div>
      </div>

      <!-- 10. Lifecycle -->
      <div id="lifecycle-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Lifecycle Report</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 16px;">
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--danger);">
            <div class="text-xs text-muted">Suspended Groups</div>
            <div class="text-xl font-semibold text-danger" id="lifecycle-suspended-groups">0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--warning);">
            <div class="text-xs text-muted">Suspended Members</div>
            <div class="text-xl font-semibold text-warning" id="lifecycle-suspended-members">0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
            <div class="text-xs text-muted">Closed Accounts</div>
            <div class="text-xl font-semibold text-primary" id="lifecycle-closed-accounts">0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
            <div class="text-xs text-muted">Table Entries</div>
            <div class="text-xl font-semibold text-primary" id="lifecycle-entry-count">0</div>
          </div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Type</th>
                <th>Group</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="lifecycle-table-body"></tbody>
          </table>
          <div id="lifecycle-pagination"></div>
        </div>
      </div>

      <!-- 11. Alerts & Reminders -->
      <div id="alerts-tab" class="report-section" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h2 style="margin: 0;">Repayment Alerts & Reminders</h2>
          <div id="alert-summary-badges" style="display: flex; gap: 8px;"></div>
        </div>
        <div id="alerts-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 16px;">
          <!-- Alert cards injected here -->
        </div>
        <div id="alerts-pagination" style="margin-top: 24px;"></div>
      </div>
    </div>

    <style>
      .tab-btn {
        padding: 16px 24px;
        background: transparent;
        border: none;
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        cursor: pointer;
        color: var(--text-muted);
        border-bottom: 2px solid transparent;
        white-space: nowrap;
      }
      .tab-btn.active {
        color: var(--primary);
        border-bottom-color: var(--secondary);
        background: rgba(27, 61, 114, 0.02);
      }
      .print-only { display: none; }
      @media print {
        .no-print { display: none !important; }
        #report-content > .report-section { display: none !important; }
        #report-content > .report-section.print-active { display: block !important; margin-bottom: 0; page-break-after: auto; }
        .print-only { display: flex !important; }
        #report-print-header {
          align-items: center;
          gap: 18px;
          padding: 0 0 18px;
          margin-bottom: 22px;
          border-bottom: 2px solid #1b3d72;
        }
        .print-brand-mark {
          width: 68px;
          height: 68px;
          border-radius: 18px;
          border: 1px solid #d7dfec;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px;
          box-shadow: 0 8px 20px rgba(15, 37, 69, 0.12);
          overflow: hidden;
          color: #1b3d72;
          font-weight: 800;
          font-size: 1.2rem;
        }
        .print-brand-mark img { width: 100%; height: 100%; object-fit: contain; }
        .print-org-name {
          font-family: 'Outfit', sans-serif;
          font-weight: 800;
          font-size: 1.25rem;
          color: #1b3d72;
        }
        .print-report-name {
          margin-top: 4px;
          font-size: 1.05rem;
          font-weight: 700;
          color: #111827;
        }
        .print-report-meta {
          margin-top: 4px;
          font-size: 0.78rem;
          color: #64748b;
        }
        .card { border: none; box-shadow: none; padding: 0; }
        body { background: white; }
        .sidebar, .header { display: none !important; }
        .main-content { margin-left: 0 !important; }
      }
    </style>
  `;

  const setReportLoadingRows = () => {
    ['individuals', 'groups', 'disbursements', 'registrations', 'cashflow', 'withdrawals', 'repayments', 'arrears', 'lifecycle'].forEach(tab => {
      const tbody = container.querySelector(`#${tab}-table-body`);
      if (tbody) tbody.innerHTML = renderTableSkeletonRows(tab === 'cashflow' ? 7 : 9, 6);
    });
    container.querySelector('#alerts-container').innerHTML = `
      <div style="grid-column: 1/-1;">${renderCardSkeleton({ title: 'Loading repayment alerts from PocketHost...', rows: 4 })}</div>
    `;
    const activeSection = container.querySelector('.report-section[style*="block"]') || container.querySelector('#pl-tab');
    if (activeSection && !activeSection.querySelector('.inline-sync-status')) {
      activeSection.insertAdjacentHTML('afterbegin', `<div class="no-print" style="margin-bottom: 12px;">${renderInlineSyncStatus('Syncing report data from PocketHost...')}</div>`);
    }
  };

  const getMemberPhone = (member) => member?.phone_number || member?.phone || member?.mobile || '-';
  const getGroupPhone = (group) => group?.phone || group?.phone_number || group?.mobile || '-';
  const getMemberDob = (member) => member?.dob || member?.date_of_birth || member?.dateOfBirth || member?.birth_date || '';
  const getRelationId = (value) => typeof value === 'string' ? value : (value?.id || '');
  const getSavingMemberId = (saving) => getRelationId(saving?.member) || saving?.expand?.member?.id || '';
  const getSavingGroupId = (saving) => getRelationId(saving?.group) || saving?.expand?.group?.id || '';
  const getLoanMemberId = (loan) => getRelationId(loan?.member) || loan?.expand?.member?.id || '';
  const getLoanGroupId = (loan) => getRelationId(loan?.group) || loan?.expand?.group?.id || '';
  const getRepaymentLoanId = (repayment) => getRelationId(repayment?.loan) || repayment?.expand?.loan?.id || '';
  const getScheduleLoanId = (schedule) => getRelationId(schedule?.loan) || schedule?.expand?.loan?.id || '';
  const isActiveSavingsTransaction = (saving) => !saving?.is_reversed;
  const getSavingsTransactionDate = (saving) => saving?.date || saving?.created;
  const getSavingsSignedAmount = (saving) => {
    const amount = Number(saving?.amount) || 0;
    return saving?.type === 'withdrawal' ? -amount : amount;
  };
  const getLoanPrincipalAmount = (loan) => {
    const approved = Number(loan?.approved_amount) || 0;
    if (approved > 0) return approved;
    const applied = Number(loan?.amount_applied) || 0;
    if (applied > 0) return applied;
    const liability = Number(loan?.total_liability) || 0;
    const interest = Number(loan?.interest_amount) || 0;
    if (liability > 0) return Math.max(0, liability - interest);
    return 0;
  };
  const getLoanInterestAmount = (loan) => {
    const storedInterest = Number(loan?.interest_amount) || 0;
    if (storedInterest > 0) return storedInterest;
    const liability = Number(loan?.total_liability) || 0;
    if (liability <= 0) return 0;
    return Math.max(0, liability - getLoanPrincipalAmount(loan));
  };
  const getLoanLiabilityAmount = getContractLiabilityAmount;
  const isLoanPortfolioRecord = isDisbursedLoanRecord;
  const getSchedulesForLoan = (loan) => schedules.filter(schedule => getScheduleLoanId(schedule) === loan?.id);
  const getRepaymentsForLoan = (loan) => repayments.filter(repayment => getRepaymentLoanId(repayment) === loan?.id);
  const getLoanPrincipalPaidAmount = (loan) => getRepaymentsForLoan(loan)
    .reduce((sum, repayment) => sum + getRepaymentPrincipalAmount(repayment), 0);
  const getLoanCashPaidAmount = (loan) => getRepaymentsForLoan(loan)
    .reduce((sum, repayment) => sum + (Number(repayment.amount) || 0), 0);
  let portfolioCalculatorCache = null;
  let portfolioRepaymentsRef = null;
  let portfolioSettlementsRef = null;
  let portfolioSchedulesRef = null;
  const getPortfolioCalculator = () => {
    if (!portfolioCalculatorCache || portfolioRepaymentsRef !== repayments || portfolioSettlementsRef !== settlements || portfolioSchedulesRef !== schedules) {
      portfolioRepaymentsRef = repayments;
      portfolioSettlementsRef = settlements;
      portfolioSchedulesRef = schedules;
      portfolioCalculatorCache = createLoanPortfolioCalculator({
        repayments,
        settlements,
        schedules,
        penaltyAmount: automaticPenaltyAmount
      });
    }
    return portfolioCalculatorCache;
  };
  const getLoanOutstandingBalanceWithFines = (loan) => getPortfolioCalculator().getOutstanding(loan);
  const toValidDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const getDateRangeBounds = () => {
    const fromDate = dateRange.from ? new Date(`${dateRange.from}T00:00:00`) : null;
    const toDate = dateRange.to ? new Date(`${dateRange.to}T23:59:59.999`) : null;
    return { fromDate, toDate };
  };
  const isWithinDateRange = (value) => {
    if (!dateRange.from && !dateRange.to) return true;
    const date = toValidDate(value);
    if (!date) return false;
    const { fromDate, toDate } = getDateRangeBounds();
    if (fromDate && date < fromDate) return false;
    if (toDate && date > toDate) return false;
    return true;
  };
  const getDateRangeLabel = () => {
    if (!dateRange.from && !dateRange.to) return 'All Dates';
    if (dateRange.from && dateRange.to) return `${formatDate(dateRange.from)} to ${formatDate(dateRange.to)}`;
    if (dateRange.from) return `From ${formatDate(dateRange.from)}`;
    return `Until ${formatDate(dateRange.to)}`;
  };
  const getReportRowsForView = (tab, rows, size = pageSize) => {
    if (isFullReportRender) return rows;
    const start = ((pages[tab] || 1) - 1) * size;
    return rows.slice(start, start + size);
  };
  const renderReportPagination = (elementId, totalItems, size, onPageChange) => {
    const pag = container.querySelector(elementId);
    if (!pag) return;
    pag.innerHTML = '';
    if (isFullReportRender) return;
    const ctrl = renderPagination(totalItems, size, pages[elementId.replace('#', '').replace('-pagination', '')] || 1, onPageChange);
    if (ctrl) pag.appendChild(ctrl);
  };
  const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
  const compareDate = (a, b) => {
    const da = toValidDate(a)?.getTime() || 0;
    const db = toValidDate(b)?.getTime() || 0;
    return da - db;
  };
  const getSortName = (tab, row) => {
    if (tab === 'individuals') return row.member?.full_name;
    if (tab === 'groups') return row.name;
    if (tab === 'disbursements') return row.expand?.member?.full_name || row.expand?.group?.name;
    if (tab === 'registrations') return row.full_name;
    if (tab === 'cashflow') return row.clientName;
    if (tab === 'withdrawals') return row.name;
    if (tab === 'repayments' || tab === 'arrears') return row.clientName;
    if (tab === 'lifecycle') return row.name;
    return '';
  };
  const getSortDate = (tab, row) => {
    if (tab === 'individuals') return row.member?.registration_date || row.member?.created;
    if (tab === 'groups') return row.lastActivityDate || row.registration_date || row.created;
    if (tab === 'disbursements') return row.disbursement_date || row.application_date || row.created;
    if (tab === 'registrations') return row.registration_date || row.created;
    if (tab === 'cashflow' || tab === 'withdrawals') return row.date;
    if (tab === 'repayments' || tab === 'arrears') return row.dueDate;
    if (tab === 'lifecycle') return row.updated;
    return '';
  };
  const getSortAmount = (tab, row) => {
    if (tab === 'individuals') return Number(row.olBalance) || 0;
    if (tab === 'groups') return Number(row.outstandingLoan || row.arrearsAmount || row.totalSavings) || 0;
    if (tab === 'disbursements') return Number(row.approved_amount || row.amount_applied) || 0;
    if (tab === 'registrations') return Number(row.registration_fee) || 0;
    if (tab === 'cashflow' || tab === 'withdrawals') return Number(row.amount) || 0;
    if (tab === 'repayments') return Number(row.paid || row.olb) || 0;
    if (tab === 'arrears') return Number(row.arrearsAmount) || 0;
    return 0;
  };
  const sortReportRows = (tab, rows) => {
    const sort = activeSorts[tab] || '';
    const sorted = rows.slice();
    if (sort === 'name_asc') sorted.sort((a, b) => compareText(getSortName(tab, a), getSortName(tab, b)));
    if (sort === 'name_desc') sorted.sort((a, b) => compareText(getSortName(tab, b), getSortName(tab, a)));
    if (sort === 'date_asc') sorted.sort((a, b) => compareDate(getSortDate(tab, a), getSortDate(tab, b)));
    if (sort === 'date_desc') sorted.sort((a, b) => compareDate(getSortDate(tab, b), getSortDate(tab, a)));
    if (sort === 'amount_asc') sorted.sort((a, b) => getSortAmount(tab, a) - getSortAmount(tab, b));
    if (sort === 'amount_desc') sorted.sort((a, b) => getSortAmount(tab, b) - getSortAmount(tab, a));
    if (sort === 'days_asc') sorted.sort((a, b) => (Number(a.daysLate) || 0) - (Number(b.daysLate) || 0));
    if (sort === 'days_desc') sorted.sort((a, b) => (Number(b.daysLate) || 0) - (Number(a.daysLate) || 0));
    return sorted;
  };

  const updatePLSummary = () => {
    const getRegistrationFeeDate = (member) => member.registration_fee_details?.date || member.registration_fee_details?.captured_at || member.registration_date || member.created;
    const getProcessingFeeDate = (loan) => loan.processing_fee_details?.date || loan.processing_fee_details?.captured_at || loan.created;
    const repaymentsByLoanId = repayments.reduce((map, repayment) => {
      const loanId = getRepaymentLoanId(repayment);
      if (!loanId) return map;
      if (!map.has(loanId)) map.set(loanId, []);
      map.get(loanId).push(repayment);
      return map;
    }, new Map());
    const getInterestCollectedInRange = (loan) => {
      const { fromDate, toDate } = getDateRangeBounds();
      return calculateCollectedInterest({
        loan,
        repayments: repaymentsByLoanId.get(String(loan.id)) || [],
        fromDate,
        toDate
      });
    };
    const isIncomeLoan = (loan) => {
      if (!['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan.status)) return false;
      return !!(loan.disbursement_date || repaymentsByLoanId.has(String(loan.id)));
    };
    const getLoanIncomeDate = (loan) => loan.disbursement_date || loan.approved_date || loan.application_date || loan.created;
    const approvedLoans = loans.filter(l => isIncomeLoan(l) && isWithinDateRange(getLoanIncomeDate(l)));
    const repaymentLoans = loans.filter(isIncomeLoan);
    const filteredExpenses = expenses.filter(e => isWithinDateRange(e.date || e.expense_date || e.created));
    const filteredMembers = members.filter(m => isWithinDateRange(getRegistrationFeeDate(m)));
    const filteredProcessingFeeLoans = loans.filter(l => l.processing_fee_paid && isWithinDateRange(getProcessingFeeDate(l)));
    const filteredFineRepayments = repayments.filter(r => isWithinDateRange(r.date || r.created));
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalCapitalDisbursed = approvedLoans.reduce((sum, l) => sum + getContractPrincipalAmount(l), 0);
    const expectedInterest = approvedLoans.reduce((sum, l) => sum + getContractInterestAmount(l), 0);
    const collectedInterest = repaymentLoans.reduce((sum, loan) => sum + getInterestCollectedInRange(loan), 0);
    const collectedFines = filteredFineRepayments.reduce((sum, r) => sum + (Number(r.fine_amount) || 0), 0);
    const processingFeesCollected = filteredProcessingFeeLoans.reduce((sum, l) => sum + (l.processing_fee || 0), 0);
    const registrationFeesCollected = filteredMembers.reduce((sum, m) => sum + (m.registration_fee || 0), 0);
    const totalIncome = registrationFeesCollected + processingFeesCollected + collectedInterest + collectedFines;
    const netIncome = totalIncome - totalExpenses;

    container.querySelector('#pl-capital-disbursed').textContent = `KES ${formatMoney(totalCapitalDisbursed)}`;
    container.querySelector('#pl-registration-fees').textContent = `KES ${formatMoney(registrationFeesCollected)}`;
    container.querySelector('#pl-processing-fees').textContent = `KES ${formatMoney(processingFeesCollected)}`;
    container.querySelector('#pl-expected-interest').textContent = `KES ${formatMoney(expectedInterest)}`;
    const collectedInterestEl = container.querySelector('#pl-collected-interest');
    collectedInterestEl.textContent = repaymentLoadError
      ? 'Unavailable'
      : repaymentsLoaded ? `KES ${formatMoney(collectedInterest)}` : 'Syncing...';
    collectedInterestEl.title = repaymentLoadError?.message || '';
    container.querySelector('#pl-collected-fines').textContent = `KES ${formatMoney(collectedFines)}`;
    container.querySelector('#pl-total-income').textContent = `KES ${formatMoney(totalIncome)}`;
    container.querySelector('#pl-operating-costs').textContent = `KES ${formatMoney(totalExpenses)}`;
    const netIncomeEl = container.querySelector('#pl-net-income');
    netIncomeEl.textContent = `KES ${formatMoney(netIncome)}`;
    netIncomeEl.style.color = netIncome >= 0 ? 'var(--success)' : 'var(--danger)';
  };

  setReportLoadingRows();

  const updateIndividuals = () => {
    const filtered = members.filter(m => {
      if (activeFilters.individuals === 'all') return true;
      const isGroupMember = Boolean(getRelationId(m.group) || m.expand?.group?.id);
      if (activeFilters.individuals === 'individual') return !isGroupMember;
      if (activeFilters.individuals === 'group') return isGroupMember;
      return true;
    });
    const individualRows = filtered.map(m => {
      const allMemberLoans = loans.filter(l => getLoanMemberId(l) === m.id && isLoanPortfolioRecord(l));
      const runningLoans = allMemberLoans.filter(l => getLoanOutstandingBalanceWithFines(l) > 0);
      const completedLoans = allMemberLoans.filter(l => getLoanOutstandingBalanceWithFines(l) <= 0 || ['completed', 'closed'].includes(l.status));
      const mLoans = runningLoans.length > 0 ? runningLoans : completedLoans;
      const collectibleLoans = runningLoans;
      const totalLiability = mLoans.reduce((sum, l) => sum + getLoanLiabilityAmount(l), 0);
      const totalRepaid = mLoans.reduce((sum, l) => sum + getLoanCashPaidAmount(l), 0);
      const principalPaid = mLoans.reduce((sum, l) => sum + getLoanPrincipalPaidAmount(l), 0);
      const olBalance = mLoans.reduce((sum, l) => sum + getLoanOutstandingBalanceWithFines(l), 0);
      const percentRepaid = totalLiability > 0 ? (principalPaid / totalLiability) * 100 : (mLoans.length > 0 ? 100 : 0);
      const percentRepaidLabel = formatPercent(percentRepaid);
      const overdueSchedules = schedules.filter(s => collectibleLoans.some(ml => ml.id === getScheduleLoanId(s)) && isScheduleInArrears(s));
      const onTrack = overdueSchedules.length === 0;
      const totalArrears = getArrearsTotal(overdueSchedules);
      const allMemberSavings = savings.filter(s => getSavingMemberId(s) === m.id && isActiveSavingsTransaction(s));
      const mSavings = allMemberSavings.filter(s => isWithinDateRange(getSavingsTransactionDate(s)));
      const deposits = mSavings.filter(s => s.type === 'deposit').reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const withdrawals = mSavings.filter(s => s.type === 'withdrawal').reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const totalSav = mSavings.reduce((sum, s) => sum + getSavingsSignedAmount(s), 0);
      const lastSavingsDate = getLatestSavingsDate(allMemberSavings);
      const activityStatus = getMemberActivityStatus(m, lastSavingsDate);
      const groupName = m.expand?.group?.name || 'Individual';

      return {
        member: m,
        groupName,
        mLoans,
        totalSav,
        deposits,
        withdrawals,
        olBalance,
        totalRepaid,
        totalArrears,
        percentRepaid,
        percentRepaidLabel,
        onTrack,
        activityStatus
      };
    });
    const totalIndividualSavings = individualRows.reduce((sum, row) => sum + (Number(row.totalSav) || 0), 0);
    const totalIndividualDeposits = individualRows.reduce((sum, row) => sum + (Number(row.deposits) || 0), 0);
    const totalIndividualWithdrawals = individualRows.reduce((sum, row) => sum + (Number(row.withdrawals) || 0), 0);
    const groupAccountSavings = savings.filter(s => {
      if (!isActiveSavingsTransaction(s)) return false;
      if (!isWithinDateRange(getSavingsTransactionDate(s))) return false;
      const hasGroup = Boolean(getSavingGroupId(s));
      const hasMember = Boolean(getSavingMemberId(s));
      if (!hasGroup || hasMember) return false;
      return activeFilters.individuals === 'all' || activeFilters.individuals === 'group';
    });
    const groupAccountDeposits = groupAccountSavings
      .filter(s => s.type === 'deposit')
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const groupAccountWithdrawals = groupAccountSavings
      .filter(s => s.type === 'withdrawal')
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const groupAccountNet = groupAccountSavings.reduce((sum, s) => sum + getSavingsSignedAmount(s), 0);
    const savingsAnalysisTotal = totalIndividualSavings + groupAccountNet;
    const savingsAnalysisDeposits = totalIndividualDeposits + groupAccountDeposits;
    const savingsAnalysisWithdrawals = totalIndividualWithdrawals + groupAccountWithdrawals;
    const memberLoanOlb = loans
      .filter(loan => isLoanPortfolioRecord(loan) && getLoanMemberId(loan))
      .filter(loan => {
        if (activeFilters.individuals === 'all') return true;
        const member = loan.expand?.member || members.find(item => item.id === getLoanMemberId(loan));
        const isGroupMember = Boolean(getRelationId(member?.group) || member?.expand?.group?.id);
        return activeFilters.individuals === 'group' ? isGroupMember : !isGroupMember;
      })
      .reduce((sum, loan) => sum + getLoanOutstandingBalanceWithFines(loan), 0);
    const groupAccountOlb = loans
      .filter(loan => isLoanPortfolioRecord(loan) && !getLoanMemberId(loan) && getLoanGroupId(loan))
      .filter(() => activeFilters.individuals === 'all' || activeFilters.individuals === 'group')
      .reduce((sum, loan) => sum + getLoanOutstandingBalanceWithFines(loan), 0);
    const olbAnalysisTotal = memberLoanOlb + groupAccountOlb;
    const totalIndividualArrears = individualRows.reduce((sum, row) => sum + (Number(row.totalArrears) || 0), 0);
    const savingsKpiEl = container.querySelector('#individuals-total-savings');
    const olbKpiEl = container.querySelector('#individuals-total-olb');
    const arrearsKpiEl = container.querySelector('#individuals-total-arrears');
    if (savingsKpiEl) {
      savingsKpiEl.innerHTML = `
        <div>KES ${formatMoney(savingsAnalysisTotal)}</div>
        <div class="text-xs" style="margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap;">
          <span style="color: var(--success); font-weight: 700;">DEP ${formatMoney(savingsAnalysisDeposits)}</span>
          <span style="color: var(--danger); font-weight: 700;">WIT ${formatMoney(savingsAnalysisWithdrawals)}</span>
          <span style="color: var(--text-muted); font-weight: 700;">Members ${formatMoney(totalIndividualSavings)}</span>
          ${groupAccountNet !== 0 ? `<span style="color: var(--primary); font-weight: 700;">Group Acc ${formatMoney(groupAccountNet)}</span>` : ''}
        </div>
      `;
    }
    if (olbKpiEl) {
      olbKpiEl.innerHTML = `
        <div>KES ${formatMoney(olbAnalysisTotal)}</div>
        <div class="text-xs" style="margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap;">
          <span style="color: var(--text-muted); font-weight: 700;">Members ${formatMoney(memberLoanOlb)}</span>
          ${groupAccountOlb !== 0 ? `<span style="color: var(--primary); font-weight: 700;">Group Acc ${formatMoney(groupAccountOlb)}</span>` : ''}
        </div>
      `;
    }
    if (arrearsKpiEl) arrearsKpiEl.textContent = `KES ${formatMoney(totalIndividualArrears)}`;
    const entriesCountEl = container.querySelector('#individuals-entry-count');
    if (entriesCountEl) entriesCountEl.textContent = filtered.length.toLocaleString();

    const sortedRows = sortReportRows('individuals', individualRows);
    const paginated = getReportRowsForView('individuals', sortedRows);
    const tbody = container.querySelector('#individuals-table-body');
    
    tbody.innerHTML = paginated.map(row => {
      const {
        member: m,
        groupName,
        mLoans,
        totalSav,
        olBalance,
        totalRepaid,
        totalArrears,
        percentRepaid,
        percentRepaidLabel,
        onTrack,
        activityStatus
      } = row;

      return `
        <tr>
          <td><div class="font-semibold">${m.full_name}</div><div class="text-xs text-muted">${m.id_number}</div></td>
          <td><span class="badge badge-outline" style="font-size: 0.65rem;">${groupName}</span></td>
          <td>${getMemberPhone(m)}</td>
          <td>${formatMoney(totalSav)}</td>
          <td class="text-danger font-semibold">${formatMoney(olBalance)}</td>
          <td class="text-success font-semibold">${formatMoney(totalRepaid)}</td>
          <td class="text-danger font-bold">${formatMoney(totalArrears)}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="flex: 1; height: 6px; background: var(--bg-light); border-radius: 3px; overflow: hidden; min-width: 60px;">
                <div style="width: ${percentRepaid}%; height: 100%; background: ${percentRepaid >= 100 ? 'var(--success)' : 'var(--primary)'};"></div>
              </div>
              <span class="text-xs font-semibold">${percentRepaidLabel}</span>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${mLoans.length === 0 ? '<span class="badge badge-secondary">NO LOAN</span>' : 
                (percentRepaid >= 100 ? '<span class="badge badge-success">COMPLETED</span>' :
                (onTrack ? '<span class="badge badge-primary">ON TRACK</span>' : '<span class="badge badge-danger">ARREARS</span>'))}
              ${!activityStatus.isActive ? '<span class="badge badge-outline" style="border-color: #ef4444; color: #ef4444; font-size: 0.65rem;">INACTIVE</span>' : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
    
    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${members.length} records`;
    renderReportPagination('#individuals-pagination', filtered.length, pageSize, (p) => { pages.individuals = p; updateIndividuals(); });
  };

  const updateGroups = () => {
    const isOutstandingLoan = (loan) => Boolean(loan.disbursement_date)
      && ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan.status);
    const isCollectibleLoan = (loan) => loan.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan.status) && loan.disbursement_date);
    const dormantCutoff = new Date();
    dormantCutoff.setMonth(dormantCutoff.getMonth() - 6);
    const toValidDate = (value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const getMostRecentDate = (values) => values
      .map(toValidDate)
      .filter(Boolean)
      .sort((a, b) => b - a)[0] || null;
    const calculateOutstandingLoanBalance = (groupLoans) => groupLoans
      .filter(isOutstandingLoan)
      .reduce((sum, loan) => {
        const principal = Number(loan.approved_amount || loan.amount_applied) || 0;
        const liability = Number(loan.total_liability) || (principal + (Number(loan.interest_amount) || 0));
        const paid = repayments
          .filter(r => r.loan === loan.id)
          .reduce((repaymentSum, r) => repaymentSum + (Number(r.amount) || 0), 0);
        return sum + Math.max(0, liability - paid);
      }, 0);

    const groupData = groups.map(g => {
      const gMembers = members.filter(m => m.group === g.id);
      const groupMemberIds = new Set(gMembers.map(m => m.id));
      
      let activeCount = 0;
      let inactiveCount = 0;
      let arrearsCount = 0;
      let arrearsAmount = 0;
      const groupAccountSavings = savings.filter(s => getSavingGroupId(s) === g.id && !getSavingMemberId(s) && isActiveSavingsTransaction(s));
      let gTotalSavings = groupAccountSavings.reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);
      const groupActivityDates = [
        ...groupAccountSavings.map(s => s.date || s.created)
      ];

      gMembers.forEach(m => {
        const mSavings = savings.filter(s => getSavingMemberId(s) === m.id && isActiveSavingsTransaction(s));
        gTotalSavings += mSavings.reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);
        groupActivityDates.push(...mSavings.map(s => s.date || s.created));
        const lastSavingsDate = mSavings.length > 0 ? new Date(Math.max(...mSavings.map(s => new Date(s.date)))) : null;
        const isInactive = !lastSavingsDate || (new Date() - lastSavingsDate > 90 * 24 * 60 * 60 * 1000);
        
        if (isInactive) inactiveCount++; else activeCount++;

        const mLoans = loans.filter(l => l.member === m.id && isCollectibleLoan(l));
        const overdueSchedules = schedules.filter(s => mLoans.some(ml => ml.id === s.loan) && isScheduleInArrears(s));
        const hasArrears = overdueSchedules.length > 0;
        if (hasArrears) arrearsCount++;
        arrearsAmount += getArrearsTotal(overdueSchedules);
      });
      
      const gl = loans.filter(l => l.group === g.id && !l.member && isCollectibleLoan(l));
      const allGroupRelatedLoans = loans.filter(l => (l.group === g.id && !l.member) || groupMemberIds.has(l.member));
      groupActivityDates.push(...allGroupRelatedLoans.flatMap(l => [l.application_date, l.disbursement_date, l.created]));
      const gOutstanding = calculateOutstandingLoanBalance(allGroupRelatedLoans);
      arrearsAmount += schedules
        .filter(s => gl.some(loan => loan.id === s.loan) && isScheduleInArrears(s))
        .reduce((sum, s) => sum + getArrearsTotal([s]), 0);
      const lastActivityDate = getMostRecentDate(groupActivityDates);
      const isDormant = !lastActivityDate || lastActivityDate < dormantCutoff;

      return { ...g, activeCount, inactiveCount, arrearsCount, arrearsAmount, totalSavings: gTotalSavings, outstandingLoan: Math.max(0, gOutstanding), lastActivityDate, isDormant };
    });

    const filtered = groupData.filter(g => {
      if (!isWithinDateRange(g.lastActivityDate || g.registration_date || g.created)) return false;
      if (activeFilters.groups === 'all') return true;
      if (activeFilters.groups === 'active') return !g.isDormant;
      if (activeFilters.groups === 'inactive' || activeFilters.groups === 'dormant') return g.isDormant;
      return true;
    });
    const entriesCountEl = container.querySelector('#groups-entry-count');
    if (entriesCountEl) entriesCountEl.textContent = filtered.length.toLocaleString();

    const sortedRows = sortReportRows('groups', filtered);
    const paginated = getReportRowsForView('groups', sortedRows);
    
    container.querySelector('#groups-table-body').innerHTML = paginated.map(g => `
      <tr>
        <td>
          <div class="font-semibold">${g.name}</div>
          <div class="text-xs text-muted">${g.group_id}</div>
          <div style="margin-top: 4px; display: flex; gap: 4px;">
            <span class="text-xs font-bold" style="color: var(--success);">🟢 ${g.activeCount}</span>
            <span class="text-xs font-bold" style="color: var(--danger);">🔴 ${g.inactiveCount}</span>
            <span class="text-xs font-bold" style="color: var(--warning);">⚠ ${g.arrearsCount}</span>
          </div>
          <div class="text-xs text-muted" style="margin-top: 4px;">
            ${g.isDormant
              ? '<span class="badge badge-danger" style="font-size: 0.62rem;">DORMANT GROUP</span>'
              : '<span class="badge badge-success" style="font-size: 0.62rem;">ACTIVE GROUP</span>'}
            <span style="margin-left: 4px;">Last activity: ${g.lastActivityDate ? formatDate(g.lastActivityDate) : 'None'}</span>
          </div>
        </td>
        <td>${getGroupPhone(g)}</td>
        <td>${formatMoney(g.totalSavings)}</td>
        <td>${formatMoney(g.outstandingLoan)}</td>
        <td class="font-bold text-success">${g.activeCount}</td>
        <td class="font-bold text-danger">${g.inactiveCount}</td>
        <td class="font-bold text-danger">${formatMoney(g.arrearsAmount)}</td>
        <td class="font-bold text-warning">${g.arrearsCount}</td>
      </tr>`).join('');
    
    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${groups.length} records`;
    renderReportPagination('#groups-pagination', filtered.length, pageSize, (p) => { pages.groups = p; updateGroups(); });
  };

  const updateDisbursements = () => {
    const formatSecurities = (collaterals = []) => {
      const items = collaterals
        .map(c => c?.item || c?.name || c?.description)
        .filter(Boolean);
      return items.length > 0 ? items.join(', ') : '-';
    };
    const addMonths = (dateInput, months) => {
      const date = new Date(dateInput);
      if (Number.isNaN(date.getTime())) return null;
      date.setMonth(date.getMonth() + (Number(months) || 0));
      return date;
    };
    const getLoanEndDate = (loan) => {
      const loanSchedules = schedules.filter(schedule => schedule.loan === loan.id && schedule.due_date);
      if (loanSchedules.length > 0) {
        const latestDueDate = loanSchedules
          .map(schedule => new Date(schedule.due_date))
          .filter(date => !Number.isNaN(date.getTime()))
          .sort((a, b) => b - a)[0];
        if (latestDueDate) return latestDueDate;
      }
      return addMonths(loan.disbursement_date, loan.period);
    };

    const allApproved = loans.filter(l => ['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date);
    const filtered = allApproved.filter(l => {
      if (!isWithinDateRange(l.disbursement_date)) return false;
      const member = l.expand?.member;
      const memberGroup = member?.expand?.group || null;
      const isGroupAccount = Boolean(l.group && !l.member);
      const isGroupMember = Boolean(l.member && (l.group || memberGroup));
      if (activeFilters.disbursements === 'all') return true;
      if (activeFilters.disbursements === 'individual') return Boolean(l.member) && !isGroupMember;
      if (activeFilters.disbursements === 'group_members') return isGroupMember;
      if (activeFilters.disbursements === 'group') return isGroupAccount;
      return true;
    });
    const entriesCountEl = container.querySelector('#disbursements-entry-count');
    if (entriesCountEl) entriesCountEl.textContent = filtered.length.toLocaleString();
    const totalDisbursed = filtered.reduce((sum, loan) => sum + (Number(loan.approved_amount || loan.amount_applied) || 0), 0);
    const totalDisbursedEl = container.querySelector('#disbursements-total-amount');
    if (totalDisbursedEl) totalDisbursedEl.textContent = `KES ${formatMoney(totalDisbursed)}`;

    const sortedRows = sortReportRows('disbursements', filtered);
    const paginated = getReportRowsForView('disbursements', sortedRows);
    
    container.querySelector('#disbursements-table-body').innerHTML = paginated.map(l => {
      const member = l.expand?.member;
      const group = l.expand?.group || member?.expand?.group;
      const officer = l.expand?.processed_by;
      const guarantor = l.guarantor || {};
      const clientName = member?.full_name || group?.name || 'Unknown';
      const clientPhone = member ? getMemberPhone(member) : (group?.phone || group?.phone_number || '-');
      const groupName = group?.name || 'Individual';
      const guarantorPhone = guarantor.phone || guarantor.phone_number || guarantor.guarantorPhone || '-';
      const guarantorRelation = guarantor.relationship || guarantor.relation || '-';
      const officerName = officer?.name || officer?.email || officer?.username || '-';
      const endDate = getLoanEndDate(l);

      return `
      <tr>
        <td class="font-semibold">${l.loan_no}</td>
        <td class="font-semibold">${clientName}</td>
        <td>${clientPhone}</td>
        <td><span class="badge badge-outline" style="font-size: 0.65rem;">${groupName}</span></td>
        <td class="text-success font-semibold">${formatMoney(l.approved_amount)}</td>
        <td>${formatDate(l.application_date)}</td>
        <td>${l.approved_date ? formatDate(l.approved_date) : '-'}</td>
        <td>${formatDate(l.disbursement_date)}</td>
        <td>${l.period} Months</td>
        <td>${formatDate(endDate)}</td>
        <td>${guarantor.name || '-'}</td>
        <td>${guarantorPhone}</td>
        <td>${guarantorRelation}</td>
        <td>${formatSecurities(l.collaterals)}</td>
        <td>${officerName}</td>
      </tr>`;
    }).join('');
    
    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${allApproved.length} records`;
    renderReportPagination('#disbursements-pagination', filtered.length, pageSize, (p) => { pages.disbursements = p; updateDisbursements(); });
  };

  const updateRegistrations = () => {
    const filtered = members.filter(m => {
      if (!isWithinDateRange(m.registration_date || m.created)) return false;
      if (activeFilters.registrations === 'all') return true;
      const regDate = new Date(m.registration_date);
      const now = new Date();
      if (activeFilters.registrations === 'month') return regDate.getMonth() === now.getMonth() && regDate.getFullYear() === now.getFullYear();
      if (activeFilters.registrations === 'quarter') {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const regQuarter = Math.floor(regDate.getMonth() / 3);
        return regQuarter === currentQuarter && regDate.getFullYear() === now.getFullYear();
      }
      return true;
    });
    const entriesCountEl = container.querySelector('#registrations-entry-count');
    if (entriesCountEl) entriesCountEl.textContent = filtered.length.toLocaleString();
    const amountReceived = filtered.reduce((sum, member) => sum + (Number(member.registration_fee) || 0), 0);
    const amountReceivedEl = container.querySelector('#registrations-amount-received');
    if (amountReceivedEl) amountReceivedEl.textContent = `KES ${formatMoney(amountReceived)}`;

    const sortedRows = sortReportRows('registrations', filtered);
    const paginated = getReportRowsForView('registrations', sortedRows);
    
    container.querySelector('#registrations-table-body').innerHTML = paginated.map(m => {
      const groupName = m.expand?.group?.name || 'Individual';

      return `
      <tr>
        <td><div class="font-semibold">${m.reg_no}</div><div class="text-xs text-muted">${formatDate(m.registration_date)}</div></td>
        <td>
          <div class="font-semibold">${m.full_name}</div>
          <div class="text-xs text-muted">DOB: ${getMemberDob(m) ? formatDate(getMemberDob(m)) : '-'}</div>
        </td>
        <td><span class="badge badge-outline" style="font-size: 0.65rem;">${groupName}</span></td>
        <td><div>${m.id_number}</div><div class="text-xs text-muted">${getMemberPhone(m)}</div></td>
        <td>${formatMoney(m.registration_fee)}</td>
        <td>${m.nok_name} (${m.nok_relationship})</td>
        <td><a href="tel:${m.nok_phone}" style="color: var(--primary); text-decoration: none;">${m.nok_phone || '-'}</a></td>
      </tr>`;
    }).join('');
    
    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${members.length} records`;
    renderReportPagination('#registrations-pagination', filtered.length, pageSize, (p) => { pages.registrations = p; updateRegistrations(); });
  };

  const updateCashFlow = () => {
    const membersById = new Map(members.map(member => [member.id, member]));
    const groupsById = new Map(groups.map(group => [group.id, group]));
    const loansById = new Map(loans.map(loan => [loan.id, loan]));
    const getMemberGroupName = (member) => {
      const group = member?.expand?.group || groupsById.get(member?.group);
      return group?.name || 'Individual';
    };
    const resolveGroupOwner = (group) => ({
      client: group?.group_id || '-',
      clientName: group?.name || 'Unknown Group',
      groupName: group?.name || 'Group account'
    });
    const resolveMemberOwner = (member) => ({
      client: member?.reg_no || member?.id_number || '-',
      clientName: member?.full_name || 'Unknown Member',
      groupName: getMemberGroupName(member)
    });
    const resolveLoanOwner = (loanInput) => {
      const loan = loansById.get(loanInput?.id || loanInput) || loanInput || {};
      const member = loan.expand?.member || membersById.get(loan.member);
      const group = loan.expand?.group || groupsById.get(loan.group);
      if (member) return resolveMemberOwner(member);
      if (group) return resolveGroupOwner(group);
      return {
        client: loan.loan_no || '-',
        clientName: loan.loan_no ? `Loan ${loan.loan_no}` : 'Unknown',
        groupName: 'Unassigned'
      };
    };
    const resolveSavingsOwner = (saving) => {
      const member = saving.expand?.member || membersById.get(getSavingMemberId(saving));
      const group = saving.expand?.group || groupsById.get(getSavingGroupId(saving));
      if (member) return resolveMemberOwner(member);
      if (group) return resolveGroupOwner(group);
      return { client: saving.reference || '-', clientName: 'Unknown', groupName: 'Unassigned' };
    };

    // Aggregate all money-in
    let entries = [
      ...savings.filter(isActiveSavingsTransaction).map(s => {
        const owner = resolveSavingsOwner(s);
        const isWithdrawal = s.type === 'withdrawal';
        return {
          date: getSavingsTransactionDate(s),
          type: isWithdrawal ? 'Savings Withdrawal' : 'Savings Deposit',
          ...owner,
          ref: s.reference || (isWithdrawal ? 'SAVE-W' : 'SAVE-D'),
          amount: Number(s.amount) || 0,
          direction: isWithdrawal ? 'out' : 'in',
          savingsType: isWithdrawal ? 'withdrawal' : 'deposit',
          method: s.payment_method || 'Cash/Transfer'
        };
      }),
      ...repayments.map(r => {
        const loan = r.expand?.loan || loansById.get(r.loan);
        const owner = resolveLoanOwner(loan);
        return {
          date: r.date,
          type: 'Loan Repayment',
          ...owner,
          ref: loan?.loan_no || r.loan || 'LOAN',
          amount: Number(r.amount) || 0,
          direction: 'in',
          method: r.method || r.payment_method || 'M-Pesa'
        };
      }),
      ...repayments
        .filter(r => Number(r.fine_amount) > 0)
        .map(r => {
          const loan = r.expand?.loan || loansById.get(r.loan);
          const owner = resolveLoanOwner(loan);
          return {
            date: r.date,
            type: 'Late Payment Fine',
            ...owner,
            ref: loan?.loan_no || r.loan || 'FINE',
            amount: Number(r.fine_amount) || 0,
            direction: 'in',
            method: r.method || r.payment_method || 'M-Pesa'
          };
        }),
      ...members.map(m => ({
        date: m.registration_fee_details?.date || m.registration_fee_details?.captured_at || m.registration_date,
        type: 'Registration Fee',
        ...resolveMemberOwner(m),
        ref: m.registration_fee_details?.reference || 'REG-FEE',
        amount: Number(m.registration_fee) || 0,
        direction: 'in',
        method: m.registration_fee_details?.method || 'Cash'
      })),
      ...loans.filter(l => l.processing_fee_paid).map(l => ({
        date: l.processing_fee_details?.date || l.processing_fee_details?.captured_at || l.created,
        type: 'Processing Fee',
        ...resolveLoanOwner(l),
        ref: l.processing_fee_details?.reference || 'PROC-FEE',
        amount: Number(l.processing_fee) || 0,
        direction: 'in',
        method: l.processing_fee_details?.method || 'Cash'
      }))
    ].filter(e => isWithinDateRange(e.date)).sort((a, b) => new Date(b.date) - new Date(a.date));

    const filtered = entries.filter(e => {
      if (activeFilters.cashflow === 'all') return true;
      if (activeFilters.cashflow === 'savings') return e.type === 'Savings Deposit' || e.type === 'Savings Withdrawal';
      if (activeFilters.cashflow === 'repayments') return e.type === 'Loan Repayment';
      if (activeFilters.cashflow === 'fees') return e.type.includes('Fee') || e.type.includes('Fine');
      return true;
    });

    // Summary Cards
    const total = filtered.reduce((sum, e) => sum + (e.direction === 'out' ? -(e.amount || 0) : (e.amount || 0)), 0);
    const savingsRows = filtered.filter(e => e.type === 'Savings Deposit' || e.type === 'Savings Withdrawal');
    const savingsDeposits = savingsRows.filter(e => e.savingsType === 'deposit').reduce((sum, e) => sum + (e.amount || 0), 0);
    const savingsWithdrawals = savingsRows.filter(e => e.savingsType === 'withdrawal').reduce((sum, e) => sum + (e.amount || 0), 0);
    const sTotal = savingsDeposits - savingsWithdrawals;
    const rTotal = filtered.filter(e => e.type === 'Loan Repayment').reduce((sum, e) => sum + (e.amount || 0), 0);
    const fTotal = filtered.filter(e => e.type.includes('Fee') || e.type.includes('Fine')).reduce((sum, e) => sum + (e.amount || 0), 0);

    container.querySelector('#cashflow-summary').innerHTML = `
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
        <div class="text-xs text-muted">Total Cash-In</div>
        <div class="text-lg font-bold">KES ${formatMoney(total)}</div>
      </div>
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--success);">
        <div class="text-xs text-muted">Savings Net</div>
        <div class="text-lg font-bold">KES ${formatMoney(sTotal)}</div>
        <div class="text-xs" style="margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap;">
          <span style="color: var(--success); font-weight: 700;">DEP ${formatMoney(savingsDeposits)}</span>
          <span style="color: var(--danger); font-weight: 700;">WIT ${formatMoney(savingsWithdrawals)}</span>
        </div>
      </div>
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--secondary);">
        <div class="text-xs text-muted">Repayments</div>
        <div class="text-lg font-bold">KES ${formatMoney(rTotal)}</div>
      </div>
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--warning);">
        <div class="text-xs text-muted">Total Fees</div>
        <div class="text-lg font-bold">KES ${formatMoney(fTotal)}</div>
      </div>
    `;

    const sortedRows = sortReportRows('cashflow', filtered);
    const paginated = getReportRowsForView('cashflow', sortedRows);

    container.querySelector('#cashflow-table-body').innerHTML = paginated.map(e => {
      return `
        <tr>
          <td>
            <div class="font-semibold">${formatDate(e.date)}</div>
            <div class="text-xs text-muted">${new Date(e.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </td>
          <td><span class="badge" style="background: rgba(27,61,114,0.05); color: var(--primary); font-size: 0.65rem;">${e.type.toUpperCase()}</span></td>
          <td>
            <div class="font-semibold">${e.clientName || 'Unknown'}</div>
            <div class="text-xs text-muted">${e.client || '-'}</div>
          </td>
          <td><span class="badge badge-outline" style="font-size: 0.65rem;">${e.groupName}</span></td>
          <td>${e.ref || '-'}</td>
          <td class="font-bold ${e.direction === 'out' ? 'text-danger' : 'text-success'}">${e.direction === 'out' ? '-' : ''}${formatMoney(e.amount)}</td>
          <td><span class="text-xs">${e.method}</span></td>
        </tr>`;
    }).join('');

    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${entries.length} records`;
    renderReportPagination('#cashflow-pagination', filtered.length, pageSize, (p) => { pages.cashflow = p; updateCashFlow(); });
  };

  const updateWithdrawals = () => {
    const withdrawalRows = savings
      .filter(s => s.type === 'withdrawal' && isActiveSavingsTransaction(s))
      .map(s => {
        const member = s.expand?.member || members.find(m => m.id === getSavingMemberId(s));
        const group = s.expand?.group || member?.expand?.group || groups.find(g => g.id === getSavingGroupId(s));
        const isGroupAccount = Boolean(getSavingGroupId(s) && !getSavingMemberId(s));
        const isGroupMember = Boolean(member && group);
        return {
          name: member?.full_name || group?.name || 'Unknown',
          groupName: group?.name || (member ? 'Individual' : '-'),
          accountScope: isGroupAccount ? 'group_account' : (isGroupMember ? 'group_member' : 'independent'),
          remarks: s.remarks || '-',
          amount: Number(s.amount) || 0,
          date: s.date || s.created
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const filtered = withdrawalRows.filter(row => {
      if (!isWithinDateRange(row.date)) return false;
      if (activeFilters.withdrawals === 'individual') return row.accountScope === 'independent';
      if (activeFilters.withdrawals === 'group_members') return row.accountScope === 'group_member';
      if (activeFilters.withdrawals === 'group') return row.accountScope === 'group_account';
      return true;
    });
    const totalWithdrawalsAmount = filtered.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const totalEl = container.querySelector('#withdrawals-total-amount');
    if (totalEl) totalEl.textContent = `KES ${formatMoney(totalWithdrawalsAmount)}`;
    const entriesCountEl = container.querySelector('#withdrawals-entry-count');
    if (entriesCountEl) entriesCountEl.textContent = filtered.length.toLocaleString();

    const sortedRows = sortReportRows('withdrawals', filtered);
    const paginated = getReportRowsForView('withdrawals', sortedRows);

    container.querySelector('#withdrawals-table-body').innerHTML = paginated.length === 0
      ? '<tr><td colspan="4" class="text-center text-muted" style="padding: 32px;">No withdrawals found.</td></tr>'
      : paginated.map(row => `
        <tr>
          <td class="font-semibold">${row.name}</td>
          <td><span class="badge badge-outline" style="font-size: 0.65rem;">${row.groupName}</span></td>
          <td class="text-sm">${row.remarks}</td>
          <td class="font-bold text-danger">${formatMoney(row.amount)}</td>
        </tr>
      `).join('');

    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${withdrawalRows.length} withdrawals`;
    renderReportPagination('#withdrawals-pagination', filtered.length, pageSize, (p) => { pages.withdrawals = p; updateWithdrawals(); });
  };

  const updateRepayments = () => {
    const membersById = new Map(members.map(member => [member.id, member]));
    const groupsById = new Map(groups.map(group => [group.id, group]));
    const loansById = new Map(loans.map(loan => [loan.id, loan]));
    const isCollectibleLoan = (loan) => isLoanPortfolioRecord(loan) && getLoanOutstandingBalanceWithFines(loan) > 0;
    const getLoanOwner = (loan) => {
      const member = loan?.expand?.member || membersById.get(getLoanMemberId(loan));
      const group = loan?.expand?.group || groupsById.get(getLoanGroupId(loan)) || member?.expand?.group || groupsById.get(member?.group);
      return {
        clientName: member?.full_name || group?.name || 'Unknown',
        groupName: group?.name || (member ? 'Individual' : '-')
      };
    };

    const repaymentRows = schedules
      .map(schedule => {
        const loan = loansById.get(getScheduleLoanId(schedule));
        if (!loan || !isCollectibleLoan(loan)) return null;
        const paid = Number(schedule.paid) || 0;
        const olb = getLoanOutstandingBalanceWithFines(loan);
        const isArrears = isScheduleInArrears(schedule);
        const isPaid = isSchedulePaid(schedule);
        const owner = getLoanOwner(loan);
        return {
          schedule,
          loan,
          ...owner,
          olb,
          paid,
          status: isArrears ? 'Arrears' : 'Not in Arrears',
          statusClass: isArrears ? 'badge-danger' : (isPaid ? 'badge-success' : 'badge-primary'),
          isArrears,
          isPaid,
          dueDate: schedule.due_date
        };
      })
      .filter(Boolean)
      .filter(row => {
        if (!isWithinDateRange(row.dueDate)) return false;
        if (activeFilters.repayments === 'arrears') return row.isArrears;
        if (activeFilters.repayments === 'not_arrears') return !row.isArrears;
        if (activeFilters.repayments === 'paid') return row.isPaid;
        return true;
      })
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    const totalPaid = repaymentRows.reduce((sum, row) => sum + row.paid, 0);
    const totalOlb = loans
      .filter(isLoanPortfolioRecord)
      .reduce((sum, loan) => sum + getLoanOutstandingBalanceWithFines(loan), 0);

    const totalPaidEl = container.querySelector('#repayments-total-paid');
    const totalOlbEl = container.querySelector('#repayments-total-olb');
    const entriesCountEl = container.querySelector('#repayments-entry-count');
    if (totalPaidEl) totalPaidEl.textContent = `KES ${formatMoney(totalPaid)}`;
    if (totalOlbEl) totalOlbEl.textContent = `KES ${formatMoney(totalOlb)}`;
    if (entriesCountEl) entriesCountEl.textContent = repaymentRows.length.toLocaleString();

    const sortedRows = sortReportRows('repayments', repaymentRows);
    const paginated = getReportRowsForView('repayments', sortedRows);
    const tbody = container.querySelector('#repayments-table-body');
    tbody.innerHTML = paginated.length === 0
      ? '<tr><td colspan="8" class="text-center text-muted" style="padding: 32px;">No repayment schedule rows found.</td></tr>'
      : paginated.map(row => `
        <tr>
          <td class="font-semibold">${row.loan.loan_no || '-'}</td>
          <td class="font-semibold">${row.clientName}</td>
          <td><span class="badge badge-outline" style="font-size: 0.65rem;">${row.groupName}</span></td>
          <td class="font-bold text-danger">${formatMoney(row.olb)}</td>
          <td><span class="badge ${row.statusClass}" style="font-size: 0.65rem;">${row.status}</span></td>
          <td>${formatDate(row.dueDate)}</td>
          <td class="font-bold text-success">${formatMoney(row.paid)}</td>
          <td>
            <button class="btn btn-primary btn-xs" onclick="window.location.hash = '${withReturnTo(`#/loans/${row.loan.loan_no}`, '#/reports?tab=repayments')}'">View Profile</button>
          </td>
        </tr>
      `).join('');

    const totalSchedules = schedules.filter(schedule => isCollectibleLoan(loansById.get(getScheduleLoanId(schedule)))).length;
    container.querySelector('#filter-count').textContent = `Showing ${repaymentRows.length} of ${totalSchedules} repayment schedules`;
    renderReportPagination('#repayments-pagination', repaymentRows.length, pageSize, (p) => { pages.repayments = p; updateRepayments(); });
  };

  const updateArrears = () => {
    const membersById = new Map(members.map(member => [member.id, member]));
    const groupsById = new Map(groups.map(group => [group.id, group]));
    const loansById = new Map(loans.map(loan => [loan.id, loan]));
    const getLoanLiability = (loan) => {
      const storedLiability = Number(loan?.total_liability) || 0;
      if (storedLiability > 0) return storedLiability;
      const principal = Number(loan?.approved_amount || loan?.amount_applied) || 0;
      return principal + (Number(loan?.interest_amount) || 0);
    };
    const repaymentsByLoan = repayments.reduce((map, repayment) => {
      if (!repayment.loan) return map;
      map.set(repayment.loan, (map.get(repayment.loan) || 0) + (Number(repayment.amount) || 0));
      return map;
    }, new Map());
    const isCollectibleLoan = (loan) => loan?.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan?.status) && loan?.disbursement_date);
    const getLoanOwner = (loan) => {
      const member = loan?.expand?.member || membersById.get(loan?.member);
      const group = loan?.expand?.group || groupsById.get(loan?.group) || member?.expand?.group || groupsById.get(member?.group);
      return {
        clientName: member?.full_name || group?.name || 'Unknown',
        phone: member ? getMemberPhone(member) : getGroupPhone(group),
        groupName: group?.name || (member ? 'Individual' : '-')
      };
    };
    const getAgeBand = (daysLate) => {
      if (daysLate >= 61) {
        return { id: '61_plus', label: '61+ days', color: '#ef4444', badgeClass: 'badge-danger' };
      }
      if (daysLate >= 31) {
        return { id: '31_60', label: '31-60 days', color: '#f59e0b', badgeClass: 'badge-warning' };
      }
      return { id: '1_30', label: '1-30 days', color: '#10b981', badgeClass: 'badge-success' };
    };

    const arrearsRows = schedules
      .map(schedule => {
        const loan = loansById.get(schedule.loan);
        if (!loan || !isCollectibleLoan(loan) || !isScheduleInArrears(schedule)) return null;
        const daysLate = getDaysInArrears(schedule);
        const ageBand = getAgeBand(daysLate);
        const arrearsAmount = getScheduleRemaining(schedule);
        if (arrearsAmount <= 0) return null;
        const owner = getLoanOwner(loan);
        const olb = Math.max(0, getLoanLiability(loan) - (repaymentsByLoan.get(loan.id) || 0));
        return {
          schedule,
          loan,
          ...owner,
          dueDate: schedule.due_date,
          daysLate,
          ageBand,
          arrearsAmount,
          olb
        };
      })
      .filter(Boolean)
      .filter(row => {
        if (!isWithinDateRange(row.dueDate)) return false;
        if (activeFilters.arrears === '1_30') return row.ageBand.id === '1_30';
        if (activeFilters.arrears === '31_60') return row.ageBand.id === '31_60';
        if (activeFilters.arrears === '61_plus') return row.ageBand.id === '61_plus';
        return true;
      })
      .sort((a, b) => b.daysLate - a.daysLate);

    const totalArrearsAmount = arrearsRows.reduce((sum, row) => sum + row.arrearsAmount, 0);
    const count1To30 = arrearsRows.filter(row => row.ageBand.id === '1_30').length;
    const count31To60 = arrearsRows.filter(row => row.ageBand.id === '31_60').length;
    const count61Plus = arrearsRows.filter(row => row.ageBand.id === '61_plus').length;
    const totalAmountEl = container.querySelector('#arrears-total-amount');
    const count1To30El = container.querySelector('#arrears-1-30-count');
    const count31To60El = container.querySelector('#arrears-31-60-count');
    const count61PlusEl = container.querySelector('#arrears-61-plus-count');
    const entriesCountEl = container.querySelector('#arrears-entry-count');
    if (totalAmountEl) totalAmountEl.textContent = `KES ${formatMoney(totalArrearsAmount)}`;
    if (count1To30El) count1To30El.textContent = count1To30.toLocaleString();
    if (count31To60El) count31To60El.textContent = count31To60.toLocaleString();
    if (count61PlusEl) count61PlusEl.textContent = count61Plus.toLocaleString();
    if (entriesCountEl) entriesCountEl.textContent = arrearsRows.length.toLocaleString();

    const sortedRows = sortReportRows('arrears', arrearsRows);
    const paginated = getReportRowsForView('arrears', sortedRows);
    const tbody = container.querySelector('#arrears-table-body');
    tbody.innerHTML = paginated.length === 0
      ? '<tr><td colspan="10" class="text-center text-muted" style="padding: 32px;">No arrears found for the selected filter.</td></tr>'
      : paginated.map(row => `
        <tr style="border-left: 4px solid ${row.ageBand.color};">
          <td class="font-semibold">${row.loan.loan_no || '-'}</td>
          <td class="font-semibold">${row.clientName}</td>
          <td>${row.phone}</td>
          <td><span class="badge badge-outline" style="font-size: 0.65rem;">${row.groupName}</span></td>
          <td>${formatDate(row.dueDate)}</td>
          <td class="font-bold" style="color: ${row.ageBand.color};">${row.daysLate}</td>
          <td><span class="badge ${row.ageBand.badgeClass}" style="font-size: 0.65rem;">${row.ageBand.label}</span></td>
          <td class="font-bold text-danger">${formatMoney(row.arrearsAmount)}</td>
          <td class="font-bold text-danger">${formatMoney(row.olb)}</td>
          <td>
            <button class="btn btn-primary btn-xs" onclick="window.location.hash = '${withReturnTo(`#/loans/${row.loan.loan_no}`, '#/reports?tab=arrears')}'">View Profile</button>
          </td>
        </tr>
      `).join('');

    const totalArrearsSchedules = schedules.filter(schedule => {
      const loan = loansById.get(schedule.loan);
      return isCollectibleLoan(loan) && isScheduleInArrears(schedule);
    }).length;
    container.querySelector('#filter-count').textContent = `Showing ${arrearsRows.length} of ${totalArrearsSchedules} overdue schedules`;
    renderReportPagination('#arrears-pagination', arrearsRows.length, pageSize, (p) => { pages.arrears = p; updateArrears(); });
  };

  const updateLifecycle = () => {
    const canRevive = pb.authStore.model?.role === 'super_admin';
    const groupRows = lifecycleGroups
      .filter(group => ['suspended', 'closed', 'dissolved'].includes(String(group.status || '').toLowerCase()))
      .map(group => ({
        id: group.id,
        type: 'group',
        name: group.name || 'Unknown Group',
        ref: group.group_id || '-',
        groupName: group.name || '-',
        phone: getGroupPhone(group),
        status: String(group.status || 'suspended').toLowerCase(),
        updated: group.updated || group.created
      }));
    const memberRows = lifecycleMembers
      .filter(member => ['suspended', 'closed', 'exited'].includes(String(member.status || '').toLowerCase()))
      .map(member => ({
        id: member.id,
        type: 'member',
        name: member.full_name || 'Unknown Member',
        ref: member.reg_no || member.id_number || '-',
        groupName: member.expand?.group?.name || 'Individual',
        phone: getMemberPhone(member),
        status: String(member.status || 'suspended').toLowerCase(),
        updated: member.updated || member.created
      }));
    const rows = [...groupRows, ...memberRows]
      .filter(row => {
        if (!isWithinDateRange(row.updated)) return false;
        if (activeFilters.lifecycle === 'groups') return row.type === 'group';
        if (activeFilters.lifecycle === 'members') return row.type === 'member';
        if (activeFilters.lifecycle === 'suspended') return row.status === 'suspended';
        if (activeFilters.lifecycle === 'closed') return ['closed', 'dissolved', 'exited'].includes(row.status);
        return true;
      })
      .sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

    const groupsEl = container.querySelector('#lifecycle-suspended-groups');
    const membersEl = container.querySelector('#lifecycle-suspended-members');
    const closedEl = container.querySelector('#lifecycle-closed-accounts');
    const entriesEl = container.querySelector('#lifecycle-entry-count');
    if (groupsEl) groupsEl.textContent = groupRows.filter(row => row.status === 'suspended').length.toLocaleString();
    if (membersEl) membersEl.textContent = memberRows.filter(row => row.status === 'suspended').length.toLocaleString();
    if (closedEl) closedEl.textContent = [...groupRows, ...memberRows].filter(row => ['closed', 'dissolved', 'exited'].includes(row.status)).length.toLocaleString();
    if (entriesEl) entriesEl.textContent = rows.length.toLocaleString();

    const sortedRows = sortReportRows('lifecycle', rows);
    const paginated = getReportRowsForView('lifecycle', sortedRows);
    const tbody = container.querySelector('#lifecycle-table-body');
    tbody.innerHTML = paginated.length === 0
      ? '<tr><td colspan="7" class="text-center text-muted" style="padding: 32px;">No suspended records found.</td></tr>'
      : paginated.map(row => `
        <tr>
          <td>
            <div class="font-semibold">${row.name}</div>
            <div class="text-xs text-muted">${row.ref}</div>
          </td>
          <td><span class="badge badge-outline" style="font-size: 0.65rem;">${row.type.toUpperCase()}</span></td>
          <td>${row.groupName}</td>
          <td>${row.phone}</td>
          <td><span class="badge ${row.status === 'suspended' ? 'badge-danger' : 'badge-outline'}" style="font-size: 0.65rem;">${String(row.status).toUpperCase()}</span></td>
          <td>${row.updated ? formatDate(row.updated) : '-'}</td>
          <td>
            ${row.status === 'suspended' && canRevive ? `
              <button class="btn btn-primary btn-xs lifecycle-revive-btn" data-id="${row.id}" data-type="${row.type}">Revive</button>
            ` : row.status === 'suspended' ? '<span class="text-xs text-muted">Super admin only</span>' : '<span class="text-xs text-muted">Closed permanently</span>'}
          </td>
        </tr>
      `).join('');

    container.querySelectorAll('.lifecycle-revive-btn').forEach(btn => {
      btn.onclick = async () => {
        const recordType = btn.dataset.type;
        const recordId = btn.dataset.id;
        const confirmed = window.confirmDialog ? await window.confirmDialog({
          title: `Revive ${recordType}`,
          message: `This will return the ${recordType} to active status. Historical financial data remains unchanged.`,
          confirmText: 'Revive',
          cancelText: 'Cancel',
          type: 'info'
        }) : confirm(`Revive this ${recordType}?`);
        if (!confirmed) return;

        const restoreButton = setButtonLoading(btn, 'Reviving...');
        try {
          if (recordType === 'group') {
            await groupService.revive(recordId);
            lifecycleGroups = lifecycleGroups.map(group => group.id === recordId ? { ...group, status: 'active' } : group);
            const revivedGroup = lifecycleGroups.find(group => group.id === recordId);
            if (revivedGroup && !groups.some(group => group.id === recordId)) groups = [...groups, revivedGroup];
          } else {
            await memberService.revive(recordId);
            lifecycleMembers = lifecycleMembers.map(member => member.id === recordId ? { ...member, status: 'active' } : member);
            members = members.map(member => member.id === recordId ? { ...member, status: 'active' } : member);
          }
          if (window.notify) window.notify.success(`${recordType === 'group' ? 'Group' : 'Member'} revived.`);
          updateLifecycle();
        } catch (err) {
          restoreButton();
          if (window.notify) window.notify.error('Revive failed: ' + (err.message || 'Unknown error'));
        }
      };
    });

    container.querySelector('#filter-count').textContent = `Showing ${rows.length} lifecycle records`;
    renderReportPagination('#lifecycle-pagination', rows.length, pageSize, (p) => { pages.lifecycle = p; updateLifecycle(); });
  };

  const updateAlerts = () => {
    const now = new Date();
    const upcomingThreshold = new Date();
    upcomingThreshold.setDate(now.getDate() + 7);

    // Find all unpaid schedule items that are overdue or upcoming
    const alertItems = schedules.filter(s => !isSchedulePaid(s)).map(s => {
      if (!isWithinDateRange(s.due_date)) return null;
      const loan = loans.find(l => l.id === s.loan);
      const isCollectibleLoan = loan?.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan?.status) && loan?.disbursement_date);
      if (!isCollectibleLoan) return null;
      const remainingAmount = getScheduleRemaining(s);
      if (remainingAmount <= 0) return null;
      
      const member = loan.expand?.member;
      const groupName = member?.expand?.group?.name || loan.expand?.group?.name || 'Individual';
      const guarantor = loan.guarantor || {};
      const guarantorPhone = guarantor.phone || guarantor.phone_number || guarantor.guarantorPhone || '-';

      const dueDate = new Date(s.due_date);
      const diffDays = isScheduleInArrears(s, now)
        ? getDaysInArrears(s, now)
        : Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())) / (1000 * 60 * 60 * 24));

      let priority = '';
      let color = '';
      let label = '';

      if (diffDays > 30) { priority = 'CRITICAL'; color = '#ef4444'; label = 'OVERDUE > 30 DAYS'; }
      else if (diffDays > 0) { priority = 'URGENT'; color = '#f59e0b'; label = `OVERDUE ${diffDays} DAYS`; }
      else if (diffDays === 0) { priority = 'DUE TODAY'; color = '#d97706'; label = 'DUE TODAY'; }
      else if (dueDate <= upcomingThreshold) { priority = 'UPCOMING'; color = '#3b82f6'; label = 'DUE IN ' + Math.abs(diffDays) + ' DAYS'; }
      else return null;

      return { ...s, loanObj: loan, member, groupName, guarantorPhone, remainingAmount, diffDays, priority, color, label };
    }).filter(Boolean).sort((a, b) => b.diffDays - a.diffDays);

    const counts = { critical: 0, urgent: 0, today: 0, upcoming: 0 };
    alertItems.forEach(a => {
      if (a.priority === 'CRITICAL') counts.critical++;
      else if (a.priority === 'URGENT') counts.urgent++;
      else if (a.priority === 'DUE TODAY') counts.today++;
      else counts.upcoming++;
    });

    container.querySelector('#alert-summary-badges').innerHTML = `
      <span class="badge" style="background: #ef4444; color: white;">Critical: ${counts.critical}</span>
      <span class="badge" style="background: #f59e0b; color: white;">Urgent: ${counts.urgent}</span>
      <span class="badge" style="background: #3b82f6; color: white;">Upcoming: ${counts.upcoming}</span>
    `;

    const paginated = getReportRowsForView('alerts', alertItems, 6);

    container.querySelector('#alerts-container').innerHTML = paginated.map(a => `
      <div class="card" style="border-top: 4px solid ${a.color};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div>
            <span class="text-xs font-bold" style="color: ${a.color};">${a.label}</span>
            <h3 style="margin: 4px 0 0 0; font-size: 1rem;">${a.member?.full_name || a.groupName || 'Unknown'}</h3>
            <div class="text-xs text-muted">${a.member?.reg_no || a.loanObj?.expand?.group?.group_id || 'N/A'} &bull; <span style="font-weight: 500; font-size: 0.7rem;">${a.groupName}</span></div>
          </div>
          <div class="text-right">
            <div class="text-xs text-muted">Amount Due</div>
            <div class="font-bold text-danger">KES ${formatMoney(Number(a.remainingAmount || 0))}</div>
          </div>
        </div>
        <div style="font-size: 0.8rem; margin-bottom: 16px; background: var(--bg-light); padding: 8px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between;"><span>Loan No:</span> <strong>${a.loanObj?.loan_no}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Installment:</span> <strong>#${a.installment_no}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Due Date:</span> <strong>${formatDate(a.due_date)}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Installment Amount:</span> <strong>${formatMoney(a.amount)}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Paid This Installment:</span> <strong>${formatMoney(a.paid)}</strong></div>
        </div>
        <div style="font-size: 0.8rem; margin-bottom: 16px;">
          <div>📞 <strong>Phone:</strong> ${getMemberPhone(a.member) !== '-' ? getMemberPhone(a.member) : getGroupPhone(a.loanObj?.expand?.group)}</div>
          <div>👤 <strong>Guarantor Phone:</strong> ${a.guarantorPhone}</div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <button class="btn btn-outline btn-xs call-reminder-btn" data-loan="${a.loan}" data-member="${a.member?.id}">📞 Mark Called</button>
          <button class="btn btn-primary btn-xs" onclick="window.location.hash = '${withReturnTo(`#/loans/${a.loanObj?.loan_no}`, '#/reports?tab=alerts')}'">👁 View Loan</button>
        </div>
      </div>
    `).join('') || '<div class="card text-center text-muted" style="grid-column: 1/-1;">No active alerts found.</div>';

    // Call Reminder Action
    container.querySelectorAll('.call-reminder-btn').forEach(btn => {
      btn.onclick = async () => {
        const { loan, member } = btn.dataset;
        const restoreButton = setButtonLoading(btn, 'Logging...');
        // Optional Phase: Audit log using pb if desired
        try {
          await pb.collection('audit_log').create({
            user: pb.authStore.model?.id,
            action: 'call_reminder',
            details: `Follow-up call for loan ${loan} member ${member}`
          });
        } catch (e) {
          console.warn('Audit log create failed, maybe collection does not exist yet', e);
          restoreButton();
          return;
        }
        if (window.notify) window.notify.success('Call reminder logged');
        btn.disabled = true;
        btn.textContent = 'Logged';
      };
    });

    renderReportPagination('#alerts-pagination', alertItems.length, 6, (p) => { pages.alerts = p; updateAlerts(); });
  };

  // Tab switching and Filter logic
  const tabs = container.querySelectorAll('.tab-btn');
  const sections = container.querySelectorAll('.report-section');
  const filterControls = container.querySelector('#filter-controls');
  const sortControls = container.querySelector('#sort-controls');
  const reportOfficerSelect = container.querySelector('#report-officer-filter');
  const dateFromInput = container.querySelector('#report-date-from');
  const dateToInput = container.querySelector('#report-date-to');
  const dateClearBtn = container.querySelector('#report-date-clear');
  const reportLabels = {
    pl: 'Profit & Loss Overview',
    individuals: 'Individual Performance',
    groups: 'Group Performance',
    disbursements: 'Disbursements',
    registrations: 'Registrations',
    cashflow: 'Cash Flow',
    withdrawals: 'Withdrawals',
    repayments: 'Repayments',
    arrears: 'Arrears Aging',
    lifecycle: 'Lifecycle',
    alerts: 'Alerts & Reminders'
  };
  const getActiveTab = () => Array.from(tabs).find(t => t.classList.contains('active'))?.dataset.tab || 'pl';
  const getActiveFilterLabel = (tab) => {
    const activeFilter = activeFilters[tab];
    const activeFilterBtn = Array.from(filterControls.querySelectorAll('button'))
      .find(btn => btn.classList.contains('btn-primary'));
    if (activeFilterBtn) return activeFilterBtn.textContent;
    if (!activeFilter || activeFilter === 'all') return 'All Records';
    return activeFilter.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  };
  const updatePrintHeader = () => {
    const activeTab = getActiveTab();
    const reportName = reportLabels[activeTab] || activeTab;
    const filterLabel = activeTab === 'pl' || activeTab === 'alerts' ? 'All Records' : getActiveFilterLabel(activeTab);
    const dateLabel = getDateRangeLabel();
    const officerLabel = reportOfficerSelect?.selectedOptions?.[0]?.textContent || 'All Loan Officers';
    const reportNameEl = container.querySelector('#print-report-name');
    const reportMetaEl = container.querySelector('#print-report-meta');
    if (reportNameEl) reportNameEl.textContent = reportName;
    if (reportMetaEl) reportMetaEl.textContent = `${officerLabel} • ${filterLabel} • ${dateLabel} • Generated ${new Date().toLocaleString()}`;
  };

  const refreshActiveReport = () => {
    const tab = getActiveTab();
    if (tab === 'pl') updatePLSummary();
    if (tab === 'individuals') updateIndividuals();
    if (tab === 'groups') updateGroups();
    if (tab === 'disbursements') updateDisbursements();
    if (tab === 'registrations') updateRegistrations();
    if (tab === 'cashflow') updateCashFlow();
    if (tab === 'withdrawals') updateWithdrawals();
    if (tab === 'repayments') updateRepayments();
    if (tab === 'arrears') updateArrears();
    if (tab === 'lifecycle') updateLifecycle();
    if (tab === 'alerts') updateAlerts();
    updatePrintHeader();
  };
  const applyOfficerScope = () => {
    const scope = createOfficerScope({ members: sourceMembers, groups: sourceGroups });
    members = sourceMembers.filter(member => matchesOfficer(getMemberOfficerId(member), officerFilter));
    groups = sourceGroups.filter(group => matchesOfficer(getGroupOfficerId(group), officerFilter));
    lifecycleMembers = sourceLifecycleMembers.filter(member => matchesOfficer(getMemberOfficerId(member), officerFilter));
    lifecycleGroups = sourceLifecycleGroups.filter(group => matchesOfficer(getGroupOfficerId(group), officerFilter));
    loans = sourceLoans.filter(loan => matchesOfficer(scope.getLoanOfficerId(loan), officerFilter));
    savings = sourceSavings.filter(saving => matchesOfficer(scope.getSavingOfficerId(saving), officerFilter));
    const loanIds = new Set(loans.map(loan => loan.id));
    schedules = sourceSchedules.filter(schedule => loanIds.has(getScheduleLoanId(schedule)));
    repayments = sourceRepayments.filter(repayment => loanIds.has(getRepaymentLoanId(repayment)));
    settlements = sourceSettlements.filter(settlement => loanIds.has(getRelationId(settlement?.loan)));
  };
  const renderFullActiveReport = () => {
    isFullReportRender = true;
    refreshActiveReport();
  };
  const restorePaginatedActiveReport = () => {
    if (!isFullReportRender) return;
    isFullReportRender = false;
    refreshActiveReport();
  };

  const updateFiltersUI = (tab) => {
    filterControls.innerHTML = '';
    sortControls.innerHTML = '';
    let filters = [];
    let sortOptions = [];
    
    if (tab === 'individuals') {
      filters = [
        { id: 'all', label: 'All Members' },
        { id: 'individual', label: 'Individual' },
        { id: 'group', label: 'Group Members' }
      ];
      sortOptions = [
        { id: 'name_asc', label: 'Name A-Z' },
        { id: 'name_desc', label: 'Name Z-A' },
        { id: 'amount_desc', label: 'OLB High-Low' },
        { id: 'amount_asc', label: 'OLB Low-High' },
        { id: 'date_desc', label: 'Newest' },
        { id: 'date_asc', label: 'Oldest' }
      ];
    } else if (tab === 'groups') {
      filters = [
        { id: 'all', label: 'All Groups' },
        { id: 'active', label: 'Active Groups' },
        { id: 'inactive', label: 'Inactive Groups' },
        { id: 'dormant', label: 'Dormant Groups' }
      ];
      sortOptions = [
        { id: 'name_asc', label: 'Name A-Z' },
        { id: 'name_desc', label: 'Name Z-A' },
        { id: 'amount_desc', label: 'OLB High-Low' },
        { id: 'amount_asc', label: 'OLB Low-High' },
        { id: 'date_desc', label: 'Latest Activity' },
        { id: 'date_asc', label: 'Oldest Activity' }
      ];
    } else if (tab === 'disbursements') {
      filters = [
        { id: 'all', label: 'All Disbursements' },
        { id: 'individual', label: 'To Individuals' },
        { id: 'group_members', label: 'To Individual in Groups' },
        { id: 'group', label: 'To Groups' }
      ];
      sortOptions = [
        { id: 'date_desc', label: 'Newest Date' },
        { id: 'date_asc', label: 'Oldest Date' },
        { id: 'name_asc', label: 'Client A-Z' },
        { id: 'name_desc', label: 'Client Z-A' },
        { id: 'amount_desc', label: 'Amount High-Low' },
        { id: 'amount_asc', label: 'Amount Low-High' }
      ];
    } else if (tab === 'registrations') {
      filters = [
        { id: 'all', label: 'All Time' },
        { id: 'month', label: 'This Month' },
        { id: 'quarter', label: 'This Quarter' }
      ];
      sortOptions = [
        { id: 'date_desc', label: 'Newest Date' },
        { id: 'date_asc', label: 'Oldest Date' },
        { id: 'name_asc', label: 'Name A-Z' },
        { id: 'name_desc', label: 'Name Z-A' },
        { id: 'amount_desc', label: 'Fee High-Low' },
        { id: 'amount_asc', label: 'Fee Low-High' }
      ];
    } else if (tab === 'cashflow') {
      filters = [
        { id: 'all', label: 'All Entries' },
        { id: 'savings', label: 'Savings' },
        { id: 'repayments', label: 'Repayments' },
        { id: 'fees', label: 'Fees Only' }
      ];
      sortOptions = [
        { id: 'date_desc', label: 'Newest Date' },
        { id: 'date_asc', label: 'Oldest Date' },
        { id: 'name_asc', label: 'Client A-Z' },
        { id: 'name_desc', label: 'Client Z-A' },
        { id: 'amount_desc', label: 'Amount High-Low' },
        { id: 'amount_asc', label: 'Amount Low-High' }
      ];
    } else if (tab === 'withdrawals') {
      filters = [
        { id: 'all', label: 'All Withdrawals' },
        { id: 'individual', label: 'Independent Individuals' },
        { id: 'group_members', label: 'Individuals in Groups' },
        { id: 'group', label: 'Group Accounts' }
      ];
      sortOptions = [
        { id: 'date_desc', label: 'Newest Date' },
        { id: 'date_asc', label: 'Oldest Date' },
        { id: 'name_asc', label: 'Name A-Z' },
        { id: 'name_desc', label: 'Name Z-A' },
        { id: 'amount_desc', label: 'Amount High-Low' },
        { id: 'amount_asc', label: 'Amount Low-High' }
      ];
    } else if (tab === 'repayments') {
      filters = [
        { id: 'all', label: 'All Repayments' },
        { id: 'arrears', label: 'In Arrears' },
        { id: 'not_arrears', label: 'Not in Arrears' },
        { id: 'paid', label: 'Paid' }
      ];
      sortOptions = [
        { id: 'date_asc', label: 'Due Date Oldest' },
        { id: 'date_desc', label: 'Due Date Newest' },
        { id: 'name_asc', label: 'Client A-Z' },
        { id: 'name_desc', label: 'Client Z-A' },
        { id: 'amount_desc', label: 'Paid High-Low' },
        { id: 'amount_asc', label: 'Paid Low-High' }
      ];
    } else if (tab === 'arrears') {
      filters = [
        { id: 'all', label: 'All Arrears' },
        { id: '1_30', label: '1-30 Days' },
        { id: '31_60', label: '31-60 Days' },
        { id: '61_plus', label: '61+ Days' }
      ];
      sortOptions = [
        { id: 'days_desc', label: 'Days Late High-Low' },
        { id: 'days_asc', label: 'Days Late Low-High' },
        { id: 'date_asc', label: 'Due Date Oldest' },
        { id: 'date_desc', label: 'Due Date Newest' },
        { id: 'name_asc', label: 'Client A-Z' },
        { id: 'name_desc', label: 'Client Z-A' },
        { id: 'amount_desc', label: 'Arrears High-Low' },
        { id: 'amount_asc', label: 'Arrears Low-High' }
      ];
    } else if (tab === 'lifecycle') {
      filters = [
        { id: 'all', label: 'All Lifecycle' },
        { id: 'suspended', label: 'Suspended' },
        { id: 'closed', label: 'Closed' },
        { id: 'groups', label: 'Groups' },
        { id: 'members', label: 'Members' }
      ];
      sortOptions = [
        { id: 'date_desc', label: 'Newest' },
        { id: 'date_asc', label: 'Oldest' },
        { id: 'name_asc', label: 'Name A-Z' },
        { id: 'name_desc', label: 'Name Z-A' }
      ];
    }

    container.querySelector('#filter-bar').style.display = 'flex';
    if (sortOptions.length > 0) {
      const select = document.createElement('select');
      select.className = 'form-control';
      select.style.cssText = 'width: 180px; padding: 6px 8px; font-size: 0.75rem;';
      select.setAttribute('aria-label', 'Sort report');
      select.innerHTML = sortOptions.map(option => `
        <option value="${option.id}" ${activeSorts[tab] === option.id ? 'selected' : ''}>Sort: ${option.label}</option>
      `).join('');
      select.onchange = () => {
        activeSorts[tab] = select.value;
        pages[tab] = 1;
        refreshActiveReport();
      };
      sortControls.appendChild(select);
    }
    filters.forEach(f => {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm ${activeFilters[tab] === f.id ? 'btn-primary' : 'btn-outline'}`;
      btn.style.fontSize = '0.7rem';
      btn.style.padding = '4px 12px';
      if (activeFilters[tab] === f.id) {
        btn.style.background = 'var(--secondary)';
        btn.style.borderColor = 'var(--secondary)';
      }
      btn.textContent = f.label;
      btn.onclick = () => {
        activeFilters[tab] = f.id;
        pages[tab] = 1; // Reset pagination
        updateFiltersUI(tab);
        refreshActiveReport();
      };
      filterControls.appendChild(btn);
    });
    updatePrintHeader();
  };

  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      sections.forEach(s => s.style.display = 'none');
      sections.forEach(s => s.classList.remove('print-active'));
      tab.classList.add('active');
      const activeSection = container.querySelector(`#${tab.dataset.tab}-tab`);
      activeSection.style.display = 'block';
      activeSection.classList.add('print-active');
      updateFiltersUI(tab.dataset.tab);
      refreshActiveReport();
    };
  });

  const applyDateRangeChange = () => {
    dateRange = {
      from: dateFromInput?.value || '',
      to: dateToInput?.value || ''
    };
    Object.keys(pages).forEach(key => { pages[key] = 1; });
    refreshActiveReport();
  };

  if (dateFromInput) dateFromInput.onchange = applyDateRangeChange;
  if (dateToInput) dateToInput.onchange = applyDateRangeChange;
  if (dateClearBtn) {
    dateClearBtn.onclick = () => {
      if (dateFromInput) dateFromInput.value = '';
      if (dateToInput) dateToInput.value = '';
      applyDateRangeChange();
    };
  }

  container.querySelector('#print-report-btn').onclick = () => {
    updatePrintHeader();
    renderFullActiveReport();
    setTimeout(() => window.print(), 50);
  };

  window.addEventListener('afterprint', restorePaginatedActiveReport);
  container.__subscriptions = [
    () => window.removeEventListener('afterprint', restorePaginatedActiveReport)
  ];

  // Excel Export Functionality
  container.querySelector('#export-excel-btn').onclick = () => {
    const activeTab = getActiveTab();
    renderFullActiveReport();
    const table = container.querySelector(`#${activeTab}-tab table`);
    if (!table) {
      if (window.notify) window.notify.error('No data table found to export');
      restorePaginatedActiveReport();
      return;
    }

    const reportName = reportLabels[activeTab] || activeTab;
    const filterLabel = activeTab === 'pl' || activeTab === 'alerts' ? 'All Records' : getActiveFilterLabel(activeTab);
    let tsv = `${orgName}\n${reportName}\n${filterLabel}\n${getDateRangeLabel()}\nGenerated ${new Date().toLocaleString()}\n\n`;
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
      const cols = row.querySelectorAll('th, td');
      const rowData = Array.from(cols).map(col => {
        let text = col.innerText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        return text;
      });
      tsv += rowData.join('\t') + '\n';
    });

    const blob = new Blob([tsv], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inlet_${activeTab}_report_${new Date().toISOString().split('T')[0]}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (window.notify) window.notify.success(`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} report exported to Excel!`);
    restorePaginatedActiveReport();
  };

  // Initial state based on URL or default
  const hashObj = window.location.hash.split('?');
  let initialTab = 'pl';
  if (hashObj.length > 1) {
    const params = new URLSearchParams(hashObj[1]);
    if (params.get('tab')) {
      initialTab = params.get('tab');
    }
  }

  const initialBtn = Array.from(tabs).find(t => t.dataset.tab === initialTab) || tabs[0];
  initialBtn.click();

  const loadReportsData = async () => {
    try {
      [sourceMembers, sourceGroups, sourceLifecycleGroups, sourceLifecycleMembers, sourceLoans, expenses] = await Promise.all([
        memberService.getAll(),
        groupService.getAll(),
        groupService.getAllIncludingLifecycle(),
        memberService.getAllIncludingLifecycle(),
        loanService.getFullListFresh({ expand: 'member,member.group,group,processed_by', cacheKey: 'loans:financial:expanded:v1' }),
        shouldScopeOfficerData()
          ? Promise.resolve([])
          : dataCache.get('expenses', () => expenseService.getFullList())
      ]);

      applyOfficerScope();
      if (reportOfficerSelect) {
        const options = await loadOfficerOptions({ members: sourceMembers, groups: sourceGroups, loans: sourceLoans });
        populateOfficerSelect(reportOfficerSelect, options, officerFilter);
      }

      updatePLSummary();
      updateDisbursements();
      updateRegistrations();

      const [scheduleResult, savingsResult, repaymentResult, settlementResult] = await Promise.allSettled([
        pb.collection('loan_schedule').getFullList(),
        savingsService.getFullListCached({ expand: 'member,member.group,group', cacheKey: 'savings:reports:expanded:v2' }),
        pb.collection('loan_repayments').getFullList({ expand: 'loan,loan.member,loan.group' }),
        loanService.getBalanceOffsFullList({ expand: '' })
      ]);

      if (scheduleResult.status === 'fulfilled') sourceSchedules = scheduleResult.value;
      else console.warn('[Reports] Loan schedules unavailable:', scheduleResult.reason?.message);
      if (savingsResult.status === 'fulfilled') sourceSavings = savingsResult.value;
      else console.warn('[Reports] Savings unavailable:', savingsResult.reason?.message);
      if (repaymentResult.status === 'fulfilled') {
        sourceRepayments = repaymentResult.value;
        repaymentsLoaded = true;
        repaymentLoadError = null;
      } else {
        repaymentLoadError = repaymentResult.reason || new Error('Repayments could not be loaded');
        console.warn('[Reports] Loan repayments unavailable:', repaymentLoadError.message);
      }
      if (settlementResult.status === 'fulfilled') sourceSettlements = settlementResult.value.filter(item => item.status !== 'reversed');
      else console.warn('[Reports] Loan balance-offs unavailable:', settlementResult.reason?.message);

      applyOfficerScope();

      updateIndividuals();
      updateGroups();
      updateDisbursements();
      updatePLSummary();

      const activeTab = Array.from(tabs).find(t => t.classList.contains('active'))?.dataset.tab;
      if (activeTab === 'cashflow') updateCashFlow();
      if (activeTab === 'withdrawals') updateWithdrawals();
      if (activeTab === 'repayments') updateRepayments();
      if (activeTab === 'arrears') updateArrears();
      if (activeTab === 'lifecycle') updateLifecycle();
      if (activeTab === 'alerts') updateAlerts();
    } catch (err) {
      console.error('Error loading report data:', err);
      const activeSection = container.querySelector('.report-section[style*="block"]') || container.querySelector('#pl-tab');
      activeSection.innerHTML = `<div class="card text-center text-danger">Failed to load reports: ${err.message}</div>`;
    }
  };

  if (reportOfficerSelect) {
    reportOfficerSelect.onchange = () => {
      officerFilter = reportOfficerSelect.value;
      Object.keys(pages).forEach(key => { pages[key] = 1; });
      applyOfficerScope();
      refreshActiveReport();
    };
  }

  loadReportsData();

  return container;
};
