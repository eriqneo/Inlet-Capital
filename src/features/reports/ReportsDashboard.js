import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { loanService } from '../../services/loanService.js';
import { expenseService } from '../../services/expenseService.js';
import { pb } from '../../services/api.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';
import { dataCache } from '../../services/dataCache.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderReportsDashboard = async () => {
  const container = document.createElement('div');
  let members = [], groups = [], loans = [], expenses = [], schedules = [], savings = [], repayments = [];
  const pageSize = 10;
  let pages = {
    individuals: 1,
    groups: 1,
    disbursements: 1,
    registrations: 1,
    cashflow: 1,
    alerts: 1
  };

  let activeFilters = {
    individuals: 'all',
    groups: 'all',
    disbursements: 'all',
    registrations: 'all',
    cashflow: 'all'
  };

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;" class="no-print">
      <div>
        <h1 class="text-xl">System Reports</h1>
        <p class="text-muted">Comprehensive analytics and reporting.</p>
      </div>
      <div style="display: flex; gap: 12px;">
        <button class="btn btn-outline" id="export-excel-btn" style="border-color: #10b981; color: #10b981;">📥 Export Excel</button>
        <button class="btn btn-outline" onclick="window.print()">🖨️ Print Report</button>
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
        <div class="table-responsive card" style="padding: 0;">
          <table class="table" style="font-size: 0.75rem;">
            <thead>
              <tr>
                <th>Loan No</th>
                <th>Client</th>
                <th>Group</th>
                <th>Disbursed</th>
                <th>Start Date</th>
                <th>Period</th>
                <th>Guarantor</th>
                <th>Securities</th>
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
      @media print {
        .no-print { display: none !important; }
        .report-section { display: block !important; margin-bottom: 40px; page-break-after: always; }
        .card { border: none; box-shadow: none; padding: 0; }
        body { background: white; }
        .sidebar, .header { display: none !important; }
        .main-content { margin-left: 0 !important; }
      }
    </style>
  `;

  const setReportLoadingRows = () => {
    ['individuals', 'groups', 'disbursements', 'registrations', 'cashflow'].forEach(tab => {
      const tbody = container.querySelector(`#${tab}-table-body`);
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 32px;">Loading report data...</td></tr>`;
    });
    container.querySelector('#alerts-container').innerHTML = `
      <div class="card text-center text-muted" style="grid-column: 1/-1;">
        <div class="spinner" style="margin: 0 auto 12px;"></div>
        Loading repayment alerts...
      </div>
    `;
  };

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
    const filtered = members.filter(m => {
      if (activeFilters.individuals === 'all') return true;
      const isGroupMember = !!m.group;
      if (activeFilters.individuals === 'individual') return !isGroupMember;
      if (activeFilters.individuals === 'group') return isGroupMember;
      return true;
    });

    const start = (pages.individuals - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    const tbody = container.querySelector('#individuals-table-body');
    
    tbody.innerHTML = paginated.map(m => {
      const mLoans = loans.filter(l => (l.member === m.id) && (['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date));
      const totalLiability = mLoans.reduce((sum, l) => sum + (l.total_liability || 0), 0);
      const totalRepaid = repayments.filter(r => r.expand?.loan?.member === m.id && mLoans.some(ml => ml.id === r.loan)).reduce((sum, r) => sum + r.amount, 0);
      const olBalance = Math.max(0, totalLiability - totalRepaid);
      const percentRepaid = totalLiability > 0 ? ((totalRepaid / totalLiability) * 100).toFixed(1) : (mLoans.length > 0 ? 100 : 0);
      const overdueSchedules = schedules.filter(s => mLoans.some(ml => ml.id === s.loan) && s.status !== 'paid' && new Date(s.due_date) < new Date());
      const onTrack = overdueSchedules.length === 0;
      const totalArrears = overdueSchedules.reduce((sum, s) => sum + (s.amount || 0), 0);

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
          <td>${m.phone}</td>
          <td>KES ${(totalSav || 0).toLocaleString()}</td>
          <td class="text-danger font-semibold">KES ${olBalance.toLocaleString()}</td>
          <td class="text-success font-semibold">KES ${totalRepaid.toLocaleString()}</td>
          <td class="text-danger font-bold">KES ${totalArrears.toLocaleString()}</td>
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
    const groupData = groups.map(g => {
      const gMembers = members.filter(m => m.group === g.id);
      
      let activeCount = 0;
      let inactiveCount = 0;
      let arrearsCount = 0;
      let gTotalSavings = savings.filter(s => s.group === g.id && !s.member && !s.is_reversed).reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);

      gMembers.forEach(m => {
        const mSavings = savings.filter(s => s.member === m.id && !s.is_reversed);
        gTotalSavings += mSavings.reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);
        const lastSavingsDate = mSavings.length > 0 ? new Date(Math.max(...mSavings.map(s => new Date(s.date)))) : null;
        const isInactive = !lastSavingsDate || (new Date() - lastSavingsDate > 90 * 24 * 60 * 60 * 1000);
        
        if (isInactive) inactiveCount++; else activeCount++;

        const mLoans = loans.filter(l => l.member === m.id && (['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date));
        const hasArrears = schedules.some(s => mLoans.some(ml => ml.id === s.loan) && s.status !== 'paid' && new Date(s.due_date) < new Date());
        if (hasArrears) arrearsCount++;
      });
      
      const gl = loans.filter(l => l.group === g.id && !l.member && ['disbursed','approved','completed','closed'].includes(l.status));
      let gOutstanding = gl.reduce((sum, l) => sum + (l.total_liability || 0), 0);
      // minus repaid for group loans
      gOutstanding -= repayments.filter(r => r.expand?.loan?.group === g.id && !r.expand?.loan?.member).reduce((sum, r) => sum + r.amount, 0);

      return { ...g, activeCount, inactiveCount, arrearsCount, totalSavings: gTotalSavings, outstandingLoan: Math.max(0, gOutstanding) };
    });

    const filtered = groupData.filter(g => {
      if (activeFilters.groups === 'all') return true;
      if (activeFilters.groups === 'active') return g.activeCount > 0;
      if (activeFilters.groups === 'dormant') return g.activeCount === 0;
      return true;
    });

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
        </td>
        <td>${g.phone}</td>
        <td>KES ${(g.totalSavings || 0).toLocaleString()}</td>
        <td>KES ${(g.outstandingLoan || 0).toLocaleString()}</td>
        <td class="font-bold text-success">${g.activeCount}</td>
        <td class="font-bold text-danger">${g.inactiveCount}</td>
        <td class="font-bold text-warning">${g.arrearsCount}</td>
      </tr>`).join('');
    
    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${groups.length} records`;
    const pag = container.querySelector('#groups-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, pages.groups, (p) => { pages.groups = p; updateGroups(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateDisbursements = () => {
    const allApproved = loans.filter(l => ['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date);
    const filtered = allApproved.filter(l => {
      if (activeFilters.disbursements === 'all') return true;
      if (activeFilters.disbursements === 'individual') return !!l.member;
      if (activeFilters.disbursements === 'group') return !!l.group && !l.member;
      return true;
    });

    const start = (pages.disbursements - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    
    container.querySelector('#disbursements-table-body').innerHTML = paginated.map(l => {
      let clientName = l.expand?.member?.full_name || l.expand?.group?.name || 'Unknown';
      let clientRef = l.expand?.member?.reg_no || l.expand?.group?.group_id || '';
      let groupName = l.expand?.member?.expand?.group?.name || l.expand?.group?.name || 'Individual';

      return `
      <tr>
        <td class="font-semibold">${l.loan_no}</td>
        <td>
          <div class="font-semibold">${clientName}</div>
          <div class="text-xs text-muted">${clientRef}</div>
        </td>
        <td><span class="badge badge-outline" style="font-size: 0.65rem;">${groupName}</span></td>
        <td class="text-success font-semibold">KES ${(l.approved_amount || 0).toLocaleString()}</td>
        <td>${formatDate(l.disbursement_date)}</td>
        <td>${l.period} Months</td>
        <td>${l.guarantor?.name || '-'}</td>
        <td>${l.collaterals?.length || 0} Items</td>
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

    const start = (pages.registrations - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);
    
    container.querySelector('#registrations-table-body').innerHTML = paginated.map(m => {
      const groupName = m.expand?.group?.name || 'Individual';

      return `
      <tr>
        <td><div class="font-semibold">${m.reg_no}</div><div class="text-xs text-muted">${formatDate(m.registration_date)}</div></td>
        <td>
          <div class="font-semibold">${m.full_name}</div>
          <div class="text-xs text-muted">DoB: ${formatDate(m.dob)}</div>
        </td>
        <td><span class="badge badge-outline" style="font-size: 0.65rem;">${groupName}</span></td>
        <td><div>${m.id_number}</div><div class="text-xs text-muted">${m.phone}</div></td>
        <td>KES ${(m.registration_fee || 0).toLocaleString()}</td>
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
    // Aggregate all money-in
    let entries = [
      ...savings.map(s => ({ 
        date: s.date, 
        type: 'Savings Deposit', 
        client: s.expand?.member?.reg_no || s.expand?.group?.group_id,
        clientName: s.expand?.member?.full_name || s.expand?.group?.name,
        groupName: s.expand?.member?.expand?.group?.name || s.expand?.group?.name || 'Individual',
        ref: s.reference || `SAVE-D`, 
        amount: s.amount, 
        method: 'Cash/Transfer' 
      })),
      ...repayments.map(r => ({ 
        date: r.date, 
        type: 'Loan Repayment', 
        client: r.expand?.loan?.expand?.member?.reg_no || r.expand?.loan?.expand?.group?.group_id,
        clientName: r.expand?.loan?.expand?.member?.full_name || r.expand?.loan?.expand?.group?.name,
        groupName: r.expand?.loan?.expand?.member?.expand?.group?.name || r.expand?.loan?.expand?.group?.name || 'Individual',
        ref: r.expand?.loan?.loan_no, 
        amount: r.amount, 
        method: r.method || 'M-Pesa' 
      })),
      ...members.map(m => ({ 
        date: m.registration_date, 
        type: 'Registration Fee', 
        client: m.reg_no,
        clientName: m.full_name,
        groupName: m.expand?.group?.name || 'Individual',
        ref: 'REG-FEE', 
        amount: m.registration_fee, 
        method: 'Cash' 
      })),
      ...loans.filter(l => l.processing_fee_paid).map(l => ({ 
        date: l.application_date, // approximation for now
        type: 'Processing Fee', 
        client: l.expand?.member?.reg_no || l.expand?.group?.group_id,
        clientName: l.expand?.member?.full_name || l.expand?.group?.name,
        groupName: l.expand?.member?.expand?.group?.name || l.expand?.group?.name || 'Individual',
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
          <td class="font-bold text-success">KES ${(e.amount || 0).toLocaleString()}</td>
          <td><span class="text-xs">${e.method}</span></td>
        </tr>`;
    }).join('');

    container.querySelector('#filter-count').textContent = `Showing ${filtered.length} of ${entries.length} records`;
    const pag = container.querySelector('#cashflow-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(filtered.length, pageSize, pages.cashflow, (p) => { pages.cashflow = p; updateCashFlow(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateAlerts = () => {
    const now = new Date();
    const upcomingThreshold = new Date();
    upcomingThreshold.setDate(now.getDate() + 7);

    // Find all unpaid schedule items that are overdue or upcoming
    const alertItems = schedules.filter(s => s.status !== 'paid').map(s => {
      const loan = loans.find(l => l.id === s.loan);
      if (!loan || !['disbursed', 'approved', 'completed', 'closed'].includes(loan.status) || !loan.disbursement_date) return null;
      
      const member = loan.expand?.member;
      const groupName = member?.expand?.group?.name || loan.expand?.group?.name || 'Individual';

      const dueDate = new Date(s.due_date);
      const diffTime = now - dueDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

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
          <div>📞 <strong>Phone:</strong> ${a.member?.phone || a.loanObj?.expand?.group?.phone || 'N/A'}</div>
          <div>👤 <strong>NOK:</strong> ${a.member?.nok_name || 'N/A'} (${a.member?.nok_phone || 'N/A'})</div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <button class="btn btn-outline btn-xs call-reminder-btn" data-loan="${a.loan}" data-member="${a.member?.id}">📞 Mark Called</button>
          <button class="btn btn-primary btn-xs" onclick="window.location.hash = '#/loans/${a.loanObj?.loan_no}'">👁 View Loan</button>
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

  const updateFiltersUI = (tab) => {
    filterControls.innerHTML = '';
    let filters = [];
    
    if (tab === 'individuals') {
      filters = [
        { id: 'all', label: 'All Members' },
        { id: 'individual', label: 'Independents' },
        { id: 'group', label: 'Group Members' }
      ];
    } else if (tab === 'groups') {
      filters = [
        { id: 'all', label: 'All Groups' },
        { id: 'active', label: 'Active Groups' },
        { id: 'dormant', label: 'Dormant Groups' }
      ];
    } else if (tab === 'disbursements') {
      filters = [
        { id: 'all', label: 'All Disbursements' },
        { id: 'individual', label: 'To Individuals' },
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
    }

    if (filters.length === 0 && tab !== 'alerts') {
      container.querySelector('#filter-bar').style.display = 'none';
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
      };
      filterControls.appendChild(btn);
    });
  };

  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      sections.forEach(s => s.style.display = 'none');
      tab.classList.add('active');
      container.querySelector(`#${tab.dataset.tab}-tab`).style.display = 'block';
      updateFiltersUI(tab.dataset.tab);
      if (tab.dataset.tab === 'cashflow') updateCashFlow();
      if (tab.dataset.tab === 'alerts') updateAlerts();
    };
  });

  // Excel Export Functionality
  container.querySelector('#export-excel-btn').onclick = () => {
    const activeTab = Array.from(tabs).find(t => t.classList.contains('active')).dataset.tab;
    const table = container.querySelector(`#${activeTab}-tab table`);
    if (!table) {
      if (window.notify) window.notify.error('No data table found to export');
      return;
    }

    let tsv = '';
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
        dataCache.get('members', () => memberService.getAll()),
        dataCache.get('groups', () => groupService.getAll()),
        dataCache.get('loans_expanded', () => pb.collection('loans').getFullList({ expand: 'member,group' })),
        dataCache.get('expenses', () => expenseService.getFullList())
      ]);

      updatePLSummary();
      updateDisbursements();
      updateRegistrations();

      [schedules, savings, repayments] = await Promise.all([
        dataCache.get('loan_schedule', () => pb.collection('loan_schedule').getFullList()),
        dataCache.get('savings_expanded', () => pb.collection('savings').getFullList({ expand: 'member,group' })),
        dataCache.get('loan_repayments_expanded', () => pb.collection('loan_repayments').getFullList({ expand: 'loan' }))
      ]);

      updateIndividuals();
      updateGroups();

      const activeTab = Array.from(tabs).find(t => t.classList.contains('active'))?.dataset.tab;
      if (activeTab === 'cashflow') updateCashFlow();
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
