import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { loanService } from '../../services/loanService.js';
import { savingsService } from '../../services/savingsService.js';
import { expenseService } from '../../services/expenseService.js';
import { pb } from '../../services/api.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';
import { dataCache } from '../../services/dataCache.js';
import { renderCardSkeleton, renderInlineSyncStatus, renderTableSkeletonRows, setButtonLoading } from '../../core/uiState.js';
import { settingsService } from '../../services/settingsService.js';
import { getArrearsTotal, getDaysInArrears, getScheduleRemaining, isScheduleInArrears, isSchedulePaid } from '../../core/loanScheduleMetrics.js';
import { withReturnTo } from '../../core/navigation.js';

export const renderReportsDashboard = async () => {
  const container = document.createElement('div');
  let members = [], groups = [], loans = [], expenses = [], schedules = [], savings = [], repayments = [];
  let orgSettings = {};
  try {
    orgSettings = await settingsService.getAll();
  } catch (err) {
    console.warn('[Reports] Organisation branding unavailable:', err.message);
  }
  const orgName = orgSettings.org_name || 'Inlet Capital';
  const orgLogo = orgSettings.org_logo || '';
  const generatedAt = new Date();
  const pageSize = 10;
  let pages = {
    individuals: 1,
    groups: 1,
    disbursements: 1,
    registrations: 1,
    cashflow: 1,
    withdrawals: 1,
    alerts: 1
  };

  let activeFilters = {
    individuals: 'all',
    groups: 'all',
    disbursements: 'all',
    registrations: 'all',
    cashflow: 'all',
    withdrawals: 'all'
  };

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
        <button class="tab-btn" data-tab="alerts">Alerts & Reminders</button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div id="filter-bar" class="no-print" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; background: var(--bg-light); padding: 12px 20px; border-radius: 12px;">
      <div id="filter-controls" style="display: flex; gap: 8px;">
        <!-- Filters injected here -->
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
        <h2 style="margin-bottom: 24px;">Financial Overview</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 32px;">
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid var(--primary); box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Total Capital Disbursed</div>
            <div class="text-xl font-semibold" id="pl-capital-disbursed" style="margin-top: 8px;">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #10b981; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Total Reg Fees</div>
            <div class="text-xl font-semibold text-success" id="pl-registration-fees" style="margin-top: 8px;">KES 0</div>
            <div class="text-xs text-muted" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75;">Members & Groups</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #06b6d4; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Total Processing Fees</div>
            <div class="text-xl font-semibold text-success" id="pl-processing-fees" style="margin-top: 8px;">KES 0</div>
            <div class="text-xs text-muted" style="margin-top: 4px; font-size: 0.7rem; opacity: 0.75;">Loan Origination</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #f59e0b; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Expected Interest Portfolio</div>
            <div class="text-xl font-semibold text-primary" id="pl-expected-interest" style="margin-top: 8px;">KES 0</div>
          </div>
          <div class="card" style="background: var(--bg-light); border: none; border-left: 4px solid #ef4444; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div class="text-xs text-muted" style="font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Total Operating Costs</div>
            <div class="text-xl font-semibold text-danger" id="pl-operating-costs" style="margin-top: 8px;">KES 0</div>
          </div>
        </div>
      </div>

      <!-- 2. Individual Performance -->
      <div id="individuals-tab" class="report-section" style="display: none;">
        <h2 style="margin-bottom: 16px;">Individual Reports</h2>
        <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary); margin-bottom: 16px; max-width: 260px;">
          <div class="text-xs text-muted">Table Entries</div>
          <div class="text-xl font-semibold text-primary" id="individuals-entry-count">0</div>
        </div>
        <div class="table-responsive card" style="padding: 0;">
          <table class="table">
            <thead>
              <tr>
                <th>Name / ID</th>
                <th>Group</th>
                <th>Phone</th>
                <th>A.Savings <span title="Accumulated Savings — total deposits by this member" style="cursor:help; opacity:0.6;">ⓘ</span></th>
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
        <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary); margin-bottom: 16px; max-width: 260px;">
          <div class="text-xs text-muted">Table Entries</div>
          <div class="text-xl font-semibold text-primary" id="disbursements-entry-count">0</div>
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
        <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary); margin-bottom: 16px; max-width: 260px;">
          <div class="text-xs text-muted">Table Entries</div>
          <div class="text-xl font-semibold text-primary" id="registrations-entry-count">0</div>
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

      <!-- 7. Alerts & Reminders -->
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
    ['individuals', 'groups', 'disbursements', 'registrations', 'cashflow', 'withdrawals'].forEach(tab => {
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

  const updatePLSummary = () => {
    const approvedLoans = loans.filter(l => ['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalCapitalDisbursed = approvedLoans.reduce((sum, l) => sum + (l.approved_amount || 0), 0);
    const expectedInterest = approvedLoans.reduce((sum, l) => sum + (l.interest_amount || 0), 0);
    const processingFeesCollected = loans.filter(l => l.processing_fee_paid).reduce((sum, l) => sum + (l.processing_fee || 0), 0);
    const registrationFeesCollected = members.reduce((sum, m) => sum + (m.registration_fee || 0), 0);

    container.querySelector('#pl-capital-disbursed').textContent = `KES ${totalCapitalDisbursed.toLocaleString()}`;
    container.querySelector('#pl-registration-fees').textContent = `KES ${registrationFeesCollected.toLocaleString()}`;
    container.querySelector('#pl-processing-fees').textContent = `KES ${processingFeesCollected.toLocaleString()}`;
    container.querySelector('#pl-expected-interest').textContent = `KES ${expectedInterest.toLocaleString()}`;
    container.querySelector('#pl-operating-costs').textContent = `KES ${totalExpenses.toLocaleString()}`;
  };

  setReportLoadingRows();

  const updateIndividuals = () => {
    const getLoanLiability = (loan) => {
      const storedLiability = Number(loan.total_liability) || 0;
      if (storedLiability > 0) return storedLiability;
      const principal = Number(loan.approved_amount || loan.amount_applied) || 0;
      const interest = Number(loan.interest_amount) || 0;
      return principal + interest;
    };
    const filtered = members.filter(m => {
      if (activeFilters.individuals === 'all') return true;
      const isGroupMember = !!m.group;
      if (activeFilters.individuals === 'individual') return !isGroupMember;
      if (activeFilters.individuals === 'group') return isGroupMember;
      return true;
    });
    const entriesCountEl = container.querySelector('#individuals-entry-count');
    if (entriesCountEl) entriesCountEl.textContent = filtered.length.toLocaleString();

    const start = (pages.individuals - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    const tbody = container.querySelector('#individuals-table-body');
    
    tbody.innerHTML = paginated.map(m => {
      const allMemberLoans = loans.filter(l => (l.member === m.id) && l.disbursement_date);
      const runningLoans = allMemberLoans.filter(l => l.status === 'disbursed' || (['approved', 'partial_approved'].includes(l.status) && l.disbursement_date));
      const completedLoans = allMemberLoans.filter(l => ['completed', 'closed'].includes(l.status));
      const mLoans = runningLoans.length > 0 ? runningLoans : completedLoans;
      const collectibleLoans = runningLoans;
      const totalLiability = mLoans.reduce((sum, l) => sum + getLoanLiability(l), 0);
      const memberLoanIds = new Set(mLoans.map(loan => loan.id));
      const totalRepaid = repayments
        .filter(r => memberLoanIds.has(r.loan))
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const olBalance = Math.max(0, totalLiability - totalRepaid);
      const percentRepaid = totalLiability > 0 ? ((totalRepaid / totalLiability) * 100).toFixed(1) : (mLoans.length > 0 ? 100 : 0);
      const overdueSchedules = schedules.filter(s => collectibleLoans.some(ml => ml.id === s.loan) && isScheduleInArrears(s));
      const onTrack = overdueSchedules.length === 0;
      const totalArrears = getArrearsTotal(overdueSchedules);

      // Active Logic: Savings in last 90 days
      const mSavings = savings.filter(s => s.member === m.id && !s.is_reversed);
      const totalSav = mSavings.reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);
      const lastSavingsDate = mSavings.length > 0 ? new Date(Math.max(...mSavings.map(s => new Date(s.date)))) : null;
      const isInactive = !lastSavingsDate || (new Date() - lastSavingsDate > 90 * 24 * 60 * 60 * 1000);

      const groupName = m.expand?.group?.name || 'Individual';

      return `
        <tr>
          <td><div class="font-semibold">${m.full_name}</div><div class="text-xs text-muted">${m.id_number}</div></td>
          <td><span class="badge badge-outline" style="font-size: 0.65rem;">${groupName}</span></td>
          <td>${getMemberPhone(m)}</td>
          <td>${(totalSav || 0).toLocaleString()}</td>
          <td class="text-danger font-semibold">${olBalance.toLocaleString()}</td>
          <td class="text-success font-semibold">${totalRepaid.toLocaleString()}</td>
          <td class="text-danger font-bold">${totalArrears.toLocaleString()}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="flex: 1; height: 6px; background: var(--bg-light); border-radius: 3px; overflow: hidden; min-width: 60px;">
                <div style="width: ${percentRepaid}%; height: 100%; background: ${percentRepaid >= 100 ? 'var(--success)' : 'var(--primary)'};"></div>
              </div>
              <span class="text-xs font-semibold">${percentRepaid}%</span>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${mLoans.length === 0 ? '<span class="badge badge-secondary">NO LOAN</span>' : 
                (percentRepaid >= 100 ? '<span class="badge badge-success">COMPLETED</span>' :
                (onTrack ? '<span class="badge badge-primary">ON TRACK</span>' : '<span class="badge badge-danger">ARREARS</span>'))}
              ${isInactive ? '<span class="badge badge-outline" style="border-color: #ef4444; color: #ef4444; font-size: 0.65rem;">INACTIVE</span>' : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
    
    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${members.length} records`;
    const pag = container.querySelector('#individuals-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, pages.individuals, (p) => { pages.individuals = p; updateIndividuals(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateGroups = () => {
    const isOutstandingLoan = (loan) => ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan.status);
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
      const groupAccountSavings = savings.filter(s => s.group === g.id && !s.member && !s.is_reversed);
      let gTotalSavings = groupAccountSavings.reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);
      const groupActivityDates = [
        ...groupAccountSavings.map(s => s.date || s.created)
      ];

      gMembers.forEach(m => {
        const mSavings = savings.filter(s => s.member === m.id && !s.is_reversed);
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
      if (activeFilters.groups === 'all') return true;
      if (activeFilters.groups === 'active') return !g.isDormant;
      if (activeFilters.groups === 'inactive' || activeFilters.groups === 'dormant') return g.isDormant;
      return true;
    });
    const entriesCountEl = container.querySelector('#groups-entry-count');
    if (entriesCountEl) entriesCountEl.textContent = filtered.length.toLocaleString();

    const start = (pages.groups - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    
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
        <td>${(g.totalSavings || 0).toLocaleString()}</td>
        <td>${(g.outstandingLoan || 0).toLocaleString()}</td>
        <td class="font-bold text-success">${g.activeCount}</td>
        <td class="font-bold text-danger">${g.inactiveCount}</td>
        <td class="font-bold text-danger">${(g.arrearsAmount || 0).toLocaleString()}</td>
        <td class="font-bold text-warning">${g.arrearsCount}</td>
      </tr>`).join('');
    
    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${groups.length} records`;
    const pag = container.querySelector('#groups-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, pages.groups, (p) => { pages.groups = p; updateGroups(); });
    if (ctrl) pag.appendChild(ctrl);
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

    const start = (pages.disbursements - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    
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
        <td class="text-success font-semibold">${(l.approved_amount || 0).toLocaleString()}</td>
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
    const pag = container.querySelector('#disbursements-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, pages.disbursements, (p) => { pages.disbursements = p; updateDisbursements(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateRegistrations = () => {
    const filtered = members.filter(m => {
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

    const start = (pages.registrations - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    
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
        <td>${(m.registration_fee || 0).toLocaleString()}</td>
        <td>${m.nok_name} (${m.nok_relationship})</td>
        <td><a href="tel:${m.nok_phone}" style="color: var(--primary); text-decoration: none;">${m.nok_phone || '-'}</a></td>
      </tr>`;
    }).join('');
    
    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${members.length} records`;
    const pag = container.querySelector('#registrations-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, pages.registrations, (p) => { pages.registrations = p; updateRegistrations(); });
    if (ctrl) pag.appendChild(ctrl);
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
      const member = saving.expand?.member || membersById.get(saving.member);
      const group = saving.expand?.group || groupsById.get(saving.group);
      if (member) return resolveMemberOwner(member);
      if (group) return resolveGroupOwner(group);
      return { client: saving.reference || '-', clientName: 'Unknown', groupName: 'Unassigned' };
    };

    // Aggregate all money-in
    let entries = [
      ...savings.map(s => {
        const owner = resolveSavingsOwner(s);
        return {
          date: s.date,
          type: 'Savings Deposit',
          ...owner,
          ref: s.reference || `SAVE-D`,
          amount: s.amount,
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
          amount: r.amount,
          method: r.method || r.payment_method || 'M-Pesa'
        };
      }),
      ...members.map(m => ({
        date: m.registration_date,
        type: 'Registration Fee',
        ...resolveMemberOwner(m),
        ref: 'REG-FEE',
        amount: m.registration_fee,
        method: 'Cash'
      })),
      ...loans.filter(l => l.processing_fee_paid).map(l => ({
        date: l.application_date, // approximation for now
        type: 'Processing Fee',
        ...resolveLoanOwner(l),
        ref: 'PROC-FEE',
        amount: l.processing_fee,
        method: 'Cash'
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const filtered = entries.filter(e => {
      if (activeFilters.cashflow === 'all') return true;
      if (activeFilters.cashflow === 'savings') return e.type === 'Savings Deposit';
      if (activeFilters.cashflow === 'repayments') return e.type === 'Loan Repayment';
      if (activeFilters.cashflow === 'fees') return e.type.includes('Fee');
      return true;
    });

    // Summary Cards
    const total = filtered.reduce((sum, e) => sum + (e.amount || 0), 0);
    const sTotal = filtered.filter(e => e.type === 'Savings Deposit').reduce((sum, e) => sum + (e.amount || 0), 0);
    const rTotal = filtered.filter(e => e.type === 'Loan Repayment').reduce((sum, e) => sum + (e.amount || 0), 0);
    const fTotal = filtered.filter(e => e.type.includes('Fee')).reduce((sum, e) => sum + (e.amount || 0), 0);

    container.querySelector('#cashflow-summary').innerHTML = `
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
        <div class="text-xs text-muted">Total Cash-In</div>
        <div class="text-lg font-bold">KES ${total.toLocaleString()}</div>
      </div>
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--success);">
        <div class="text-xs text-muted">Savings</div>
        <div class="text-lg font-bold">KES ${sTotal.toLocaleString()}</div>
      </div>
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--secondary);">
        <div class="text-xs text-muted">Repayments</div>
        <div class="text-lg font-bold">KES ${rTotal.toLocaleString()}</div>
      </div>
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--warning);">
        <div class="text-xs text-muted">Total Fees</div>
        <div class="text-lg font-bold">KES ${fTotal.toLocaleString()}</div>
      </div>
    `;

    const start = (pages.cashflow - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

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
          <td class="font-bold text-success">${(e.amount || 0).toLocaleString()}</td>
          <td><span class="text-xs">${e.method}</span></td>
        </tr>`;
    }).join('');

    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${entries.length} records`;
    const pag = container.querySelector('#cashflow-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, pages.cashflow, (p) => { pages.cashflow = p; updateCashFlow(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateWithdrawals = () => {
    const withdrawalRows = savings
      .filter(s => s.type === 'withdrawal' && !s.is_reversed)
      .map(s => {
        const member = s.expand?.member;
        const group = s.expand?.group || member?.expand?.group;
        const isGroupAccount = Boolean(s.group && !s.member);
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
      if (activeFilters.withdrawals === 'individual') return row.accountScope === 'independent';
      if (activeFilters.withdrawals === 'group_members') return row.accountScope === 'group_member';
      if (activeFilters.withdrawals === 'group') return row.accountScope === 'group_account';
      return true;
    });
    const totalWithdrawalsAmount = filtered.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const totalEl = container.querySelector('#withdrawals-total-amount');
    if (totalEl) totalEl.textContent = `KES ${totalWithdrawalsAmount.toLocaleString()}`;
    const entriesCountEl = container.querySelector('#withdrawals-entry-count');
    if (entriesCountEl) entriesCountEl.textContent = filtered.length.toLocaleString();

    const start = (pages.withdrawals - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    container.querySelector('#withdrawals-table-body').innerHTML = paginated.length === 0
      ? '<tr><td colspan="4" class="text-center text-muted" style="padding: 32px;">No withdrawals found.</td></tr>'
      : paginated.map(row => `
        <tr>
          <td class="font-semibold">${row.name}</td>
          <td><span class="badge badge-outline" style="font-size: 0.65rem;">${row.groupName}</span></td>
          <td class="text-sm">${row.remarks}</td>
          <td class="font-bold text-danger">${row.amount.toLocaleString()}</td>
        </tr>
      `).join('');

    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${withdrawalRows.length} withdrawals`;
    const pag = container.querySelector('#withdrawals-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, pages.withdrawals, (p) => { pages.withdrawals = p; updateWithdrawals(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateAlerts = () => {
    const now = new Date();
    const upcomingThreshold = new Date();
    upcomingThreshold.setDate(now.getDate() + 7);

    // Find all unpaid schedule items that are overdue or upcoming
    const alertItems = schedules.filter(s => !isSchedulePaid(s)).map(s => {
      const loan = loans.find(l => l.id === s.loan);
      const isCollectibleLoan = loan?.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan?.status) && loan?.disbursement_date);
      if (!isCollectibleLoan) return null;
      if (getScheduleRemaining(s) <= 0) return null;
      
      const member = loan.expand?.member;
      const groupName = member?.expand?.group?.name || loan.expand?.group?.name || 'Individual';

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

      return { ...s, loanObj: loan, member, groupName, diffDays, priority, color, label };
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

    const start = (pages.alerts - 1) * 6; // 6 cards per page
    const paginated = alertItems.slice(start, start + 6);

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
            <div class="font-bold text-danger">KES ${(a.amount || 0).toLocaleString()}</div>
          </div>
        </div>
        <div style="font-size: 0.8rem; margin-bottom: 16px; background: var(--bg-light); padding: 8px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between;"><span>Loan No:</span> <strong>${a.loanObj?.loan_no}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Installment:</span> <strong>#${a.installment_no}</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Due Date:</span> <strong>${formatDate(a.due_date)}</strong></div>
        </div>
        <div style="font-size: 0.8rem; margin-bottom: 16px;">
          <div>📞 <strong>Phone:</strong> ${getMemberPhone(a.member) !== '-' ? getMemberPhone(a.member) : getGroupPhone(a.loanObj?.expand?.group)}</div>
          <div>👤 <strong>NOK:</strong> ${a.member?.nok_name || 'N/A'} (${a.member?.nok_phone || 'N/A'})</div>
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

    const pag = container.querySelector('#alerts-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(alertItems.length, 6, pages.alerts, (p) => { pages.alerts = p; updateAlerts(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  // Tab switching and Filter logic
  const tabs = container.querySelectorAll('.tab-btn');
  const sections = container.querySelectorAll('.report-section');
  const filterControls = container.querySelector('#filter-controls');
  const reportLabels = {
    pl: 'Profit & Loss Overview',
    individuals: 'Individual Performance',
    groups: 'Group Performance',
    disbursements: 'Disbursements',
    registrations: 'Registrations',
    cashflow: 'Cash Flow',
    withdrawals: 'Withdrawals',
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
    const reportNameEl = container.querySelector('#print-report-name');
    const reportMetaEl = container.querySelector('#print-report-meta');
    if (reportNameEl) reportNameEl.textContent = reportName;
    if (reportMetaEl) reportMetaEl.textContent = `${filterLabel} • Generated ${new Date().toLocaleString()}`;
  };

  const updateFiltersUI = (tab) => {
    filterControls.innerHTML = '';
    let filters = [];
    
    if (tab === 'individuals') {
      filters = [
        { id: 'all', label: 'All Members' },
        { id: 'individual', label: 'Individual' },
        { id: 'group', label: 'Group Members' }
      ];
    } else if (tab === 'groups') {
      filters = [
        { id: 'all', label: 'All Groups' },
        { id: 'active', label: 'Active Groups' },
        { id: 'inactive', label: 'Inactive Groups' },
        { id: 'dormant', label: 'Dormant Groups' }
      ];
    } else if (tab === 'disbursements') {
      filters = [
        { id: 'all', label: 'All Disbursements' },
        { id: 'individual', label: 'To Individuals' },
        { id: 'group_members', label: 'To Individual in Groups' },
        { id: 'group', label: 'To Groups' }
      ];
    } else if (tab === 'registrations') {
      filters = [
        { id: 'all', label: 'All Time' },
        { id: 'month', label: 'This Month' },
        { id: 'quarter', label: 'This Quarter' }
      ];
    } else if (tab === 'cashflow') {
      filters = [
        { id: 'all', label: 'All Entries' },
        { id: 'savings', label: 'Savings' },
        { id: 'repayments', label: 'Repayments' },
        { id: 'fees', label: 'Fees Only' }
      ];
    } else if (tab === 'withdrawals') {
      filters = [
        { id: 'all', label: 'All Withdrawals' },
        { id: 'individual', label: 'Independent Individuals' },
        { id: 'group_members', label: 'Individuals in Groups' },
        { id: 'group', label: 'Group Accounts' }
      ];
    }

    if (filters.length === 0 && tab !== 'alerts') {
      container.querySelector('#filter-bar').style.display = 'none';
      updatePrintHeader();
      return;
    }

    container.querySelector('#filter-bar').style.display = 'flex';
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
        if (tab === 'individuals') updateIndividuals();
        if (tab === 'groups') updateGroups();
        if (tab === 'disbursements') updateDisbursements();
        if (tab === 'registrations') updateRegistrations();
        if (tab === 'cashflow') updateCashFlow();
        if (tab === 'withdrawals') updateWithdrawals();
        updatePrintHeader();
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
      if (tab.dataset.tab === 'cashflow') updateCashFlow();
      if (tab.dataset.tab === 'withdrawals') updateWithdrawals();
      if (tab.dataset.tab === 'alerts') updateAlerts();
      updatePrintHeader();
    };
  });

  container.querySelector('#print-report-btn').onclick = () => {
    updatePrintHeader();
    window.print();
  };

  // Excel Export Functionality
  container.querySelector('#export-excel-btn').onclick = () => {
    const activeTab = getActiveTab();
    const table = container.querySelector(`#${activeTab}-tab table`);
    if (!table) {
      if (window.notify) window.notify.error('No data table found to export');
      return;
    }

    const reportName = reportLabels[activeTab] || activeTab;
    const filterLabel = activeTab === 'pl' || activeTab === 'alerts' ? 'All Records' : getActiveFilterLabel(activeTab);
    let tsv = `${orgName}\n${reportName}\n${filterLabel}\nGenerated ${new Date().toLocaleString()}\n\n`;
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
      [members, groups, loans, expenses] = await Promise.all([
        memberService.getAll(),
        groupService.getAll(),
        loanService.getFullListCached({ expand: 'member,member.group,group,processed_by', cacheKey: 'loans:reports:expanded:v2' }),
        dataCache.get('expenses', () => expenseService.getFullList())
      ]);

      updatePLSummary();
      updateDisbursements();
      updateRegistrations();

      [schedules, savings, repayments] = await Promise.all([
        pb.collection('loan_schedule').getFullList(),
        savingsService.getFullListCached({ expand: 'member,member.group,group', cacheKey: 'savings:reports:expanded:v2' }),
        pb.collection('loan_repayments').getFullList({ expand: 'loan,loan.member,loan.group' })
      ]);

      updateIndividuals();
      updateGroups();
      updateDisbursements();

      const activeTab = Array.from(tabs).find(t => t.classList.contains('active'))?.dataset.tab;
      if (activeTab === 'cashflow') updateCashFlow();
      if (activeTab === 'withdrawals') updateWithdrawals();
      if (activeTab === 'alerts') updateAlerts();
    } catch (err) {
      console.error('Error loading report data:', err);
      const activeSection = container.querySelector('.report-section[style*="block"]') || container.querySelector('#pl-tab');
      activeSection.innerHTML = `<div class="card text-center text-danger">Failed to load reports: ${err.message}</div>`;
    }
  };

  loadReportsData();

  return container;
};
