import { loanService } from '../../services/loanService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate, formatMoney } from '../../core/utils.js';
import { dataCache, debounce } from '../../services/dataCache.js';
import { renderTableSkeletonRows, setButtonLoading, showDelayedLoading } from '../../core/uiState.js';
import { withReturnTo } from '../../core/navigation.js';
import { authService } from '../../services/authService.js';
import { canUseOfficerFilter, createOfficerScope, loadOfficerOptions, matchesOfficer, populateOfficerSelect } from '../../core/officerScope.js';
import { pb } from '../../services/api.js';
import { settingsService } from '../../services/settingsService.js';
import { createLoanPortfolioCalculator } from '../../core/loanPortfolio.js';
import { getLoanEndDate, isDistressUnitLoan } from '../../core/distressUnit.js';
import { getRecoveryAgeDays, isDebtRecoveryLoan, isRecoveredLoan } from '../../core/debtRecovery.js';
import { openDebtRecoveryRenewal } from './DebtRecoveryRenewal.js';

export const renderLoanList = async (options = {}) => {
  const container = document.createElement('div');
  const currentUser = authService.getUser();
  const canApproveLoans = ['super_admin', 'admin'].includes(currentUser?.role);
  const canEditLoans = ['super_admin', 'admin'].includes(currentUser?.role);
  const canDeleteLoans = currentUser?.role === 'super_admin';
  const isDistressMode = options.mode === 'distress';
  const isRecoveryMode = options.mode === 'recovery';
  const isRecoveredMode = options.mode === 'recovered';
  const isUnitMode = isDistressMode || isRecoveryMode || isRecoveredMode;
  const currentRoute = isRecoveredMode ? '#/loans/recovered' : isRecoveryMode ? '#/loans/debt-recovery' : isDistressMode ? '#/loans/distress-unit' : '#/loans';
  
  // We will fetch the loans per page
  let currentPage = 1;
  const pageSize = 10;
  let searchTerm = '';
  let statusFilter = isRecoveredMode ? 'recovered' : isRecoveryMode ? 'recovery' : isDistressMode ? 'distress' : 'running';
  let alphaSort = 'default';
  let officerFilter = 'all';
  let dateRange = { from: '', to: '' };
  let requestId = 0;

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
      <div>
        <h1 class="text-xl">${isRecoveredMode ? 'Recovered Loans (RL)' : isRecoveryMode ? 'Debt Recovery Unit (D.R.U)' : isDistressMode ? 'Distress Unit (DU)' : 'Loans Management'}</h1>
        <p class="text-muted">${isRecoveredMode ? 'D.R.U loans fully settled, including outstanding fines.' : isRecoveryMode ? 'No payments received for 90 days or more.' : isDistressMode ? 'Loans past their repayment period with outstanding balances.' : 'Track all individual and group loan applications.'}</p>
      </div>
      <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
        ${!isUnitMode && canApproveLoans ? `<button class="btn btn-secondary" onclick="window.location.hash = '${withReturnTo('#/loans/approve', '#/loans')}'" style="background: #eab308; border-color: #eab308; color: white;">
          <span class="badge" style="background: white; color: #eab308; margin-right: 8px;">!</span>
          Review Pending
        </button>` : ''}
        ${!isUnitMode && canApproveLoans ? `<button class="btn btn-primary" onclick="window.location.hash = '${withReturnTo('#/loans/approve', '#/loans')}'" style="background: #0d9488; border-color: #0d9488; color: white;">
          <span class="badge" style="background: white; color: #0d9488; margin-right: 8px;">!</span>
          Disburse Approved
        </button>` : ''}
        ${isUnitMode ? `<button class="btn btn-outline" onclick="window.location.hash = '#/loans'">Back to Loans</button>` : `<button class="btn btn-primary" onclick="window.location.hash = '${withReturnTo('#/loans/new', '#/loans')}'">+ New Loan Application</button>`}
      </div>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div class="loan-filter-bar">
        <input type="text" id="loan-search" class="form-control loan-search-input" placeholder="Search by name, phone, or loan number..." />
        ${isUnitMode ? '' : `<select id="loan-status-filter" class="form-control" style="max-width: 240px;">
          <option value="running" selected>Running Loans</option>
          <option value="pending">Pending Approval</option>
          <option value="awaiting">Awaiting Disbursement</option>
          <option value="declined">Declined</option>
          <option value="completed">Completed</option>
          <option value="written_off">Written Off</option>
          <option value="balanced_off">Balanced Off</option>
          <option value="all">All Loans</option>
        </select>`}
        <div class="loan-date-range">
          <label><span>From</span><input type="date" id="loan-date-from" class="form-control" /></label>
          <label><span>To</span><input type="date" id="loan-date-to" class="form-control" /></label>
          <button type="button" class="btn btn-outline btn-sm" id="loan-date-clear">Clear</button>
        </div>
        <select id="loan-alpha-sort" class="form-control" style="max-width: 160px;">
          <option value="default">Latest</option>
          <option value="az">Client A-Z</option>
          <option value="za">Client Z-A</option>
        </select>
        ${canUseOfficerFilter() ? '<select id="loan-officer-filter" class="form-control" style="min-width: 210px;"><option value="all">All Loan Officers</option></select>' : ''}
      </div>
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th>Loan Details</th>
              <th>Client Name</th>
              <th>Group</th>
              <th>Applicant ID</th>
              <th>Applied</th>
              <th>A.Liability</th>
              <th>Processing Fee</th>
              <th>Loan Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="loan-table-body">
            <!-- Content will be injected here -->
          </tbody>
        </table>
      </div>
      <div id="pagination-wrapper"></div>
    </div>
    <!-- Fee Collection Modal -->
    <div id="fee-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 1000; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px);">
      <div class="card" style="width: 100%; max-width: 450px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); border: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <h3 style="margin: 0; color: var(--primary); font-size: 1.25rem;">Collect Processing Fee</h3>
          <button id="close-fee-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px dashed var(--success); border-radius: 8px; padding: 16px; margin-bottom: 20px; text-align: center;">
          <div class="text-xs text-muted" style="text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 4px;">Amount Due</div>
          <div id="fee-modal-amount" style="font-size: 2rem; font-weight: 700; color: var(--success);">KES 0</div>
          <div id="fee-modal-loan" class="text-xs text-muted" style="margin-top: 4px;">Loan: ---</div>
        </div>

        <form id="fee-collection-form">
          <div class="form-group">
            <label class="form-label">Payment Method</label>
            <select id="fee-payment-method" class="form-control" required>
              <option value="mpesa">M-Pesa</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </div>
          
          <div class="form-group" id="fee-reference-group">
            <label class="form-label" id="fee-reference-label">M-Pesa Transaction Code</label>
            <input type="text" id="fee-reference" class="form-control" placeholder="e.g. QWE123RTY4" required />
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px;">
            <button type="button" class="btn btn-outline" id="cancel-fee-btn">Cancel</button>
            <button type="submit" class="btn btn-primary" style="background: var(--success); border-color: var(--success);">Confirm Payment</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Loan Edit Modal -->
    <div id="loan-edit-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px);">
      <div class="card" style="width: 100%; max-width: 620px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); border: none;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <div>
            <h3 id="loan-edit-title" style="margin: 0; color: var(--primary); font-size: 1.25rem;">Edit Loan Record</h3>
            <p id="loan-edit-subtitle" class="text-xs text-muted" style="margin-top: 4px;">Update controlled loan details.</p>
          </div>
          <button id="close-loan-edit-modal" type="button" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        <form id="loan-edit-form">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
            <div class="form-group">
              <label class="form-label">Application Date</label>
              <input type="date" name="application_date" class="form-control" required />
            </div>
            <div class="form-group">
              <label class="form-label">Approval Date</label>
              <input type="date" name="approved_date" class="form-control" />
            </div>
            <div class="form-group">
              <label class="form-label">Disbursement Date</label>
              <input type="date" name="disbursement_date" class="form-control" />
            </div>
            <div class="form-group">
              <label class="form-label">Status</label>
              <select name="status" class="form-control" required>
                ${['pending','approved','partial_approved','disbursed','completed','written_off','closed','rejected','expired'].map(status => `<option value="${status}">${status.replace('_', ' ').toUpperCase()}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Remarks</label>
            <textarea name="purpose" class="form-control" rows="3" placeholder="Add loan remarks"></textarea>
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border-color);">
            <button type="button" class="btn btn-outline" id="cancel-loan-edit-btn">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Loan</button>
          </div>
        </form>
      </div>
    </div>

    <style>
      .loan-action-group { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .loan-icon-action { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--border-color); background: #fff; color: var(--primary); cursor: pointer; font-size: 0.9rem; transition: all 0.18s ease; }
      .loan-icon-action:hover { transform: translateY(-1px); box-shadow: 0 6px 12px rgba(15, 37, 69, 0.08); border-color: var(--primary); }
      .loan-icon-action.danger { color: var(--danger); }
      .loan-icon-action.danger:hover { border-color: var(--danger); background: rgba(239, 68, 68, 0.06); }
      .loan-filter-bar { padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
      .loan-search-input { max-width: 400px; }
      .loan-date-range { display: inline-flex; align-items: end; gap: 8px; flex-wrap: wrap; padding: 8px; border: 1px solid var(--border-color); border-radius: 8px; background: #fff; }
      .loan-date-range label { display: grid; gap: 4px; font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }
      .loan-date-range input { width: 146px; padding: 7px 8px; font-size: 0.78rem; }
      @media (max-width: 860px) {
        .loan-filter-bar, .loan-search-input, .loan-date-range { width: 100%; }
        .loan-date-range { display: grid; grid-template-columns: 1fr 1fr auto; align-items: end; }
        .loan-date-range input { width: 100%; }
      }
    </style>
  `;

  const tableBody = container.querySelector('#loan-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
  const toDateInputValue = (dateValue) => {
    if (!dateValue) return '';
    const date = new Date(String(dateValue).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  };
  const toPocketDate = (dateValue) => dateValue ? new Date(`${dateValue}T12:00:00`).toISOString() : '';
  const toPocketDateTime = (value, endOfDay = false) => value
    ? `${value} ${endOfDay ? '23:59:59.999Z' : '00:00:00.000Z'}`
    : '';
  const buildLoanDateFilter = () => {
    const parts = [];
    if (dateRange.from) {
      const from = toPocketDateTime(dateRange.from);
      parts.push(`(disbursement_date>="${from}" || (disbursement_date="" && application_date>="${from}"))`);
    }
    if (dateRange.to) {
      const to = toPocketDateTime(dateRange.to, true);
      parts.push(`(disbursement_date<="${to}" || (disbursement_date="" && application_date<="${to}"))`);
    }
    return parts.join(' && ');
  };
  const hasInvalidDateRange = () => Boolean(dateRange.from && dateRange.to && dateRange.from > dateRange.to);
  const combineFilters = (...filters) => filters.filter(Boolean).map(filter => `(${filter})`).join(' && ');
  const disbursedStatuses = ['disbursed', 'completed', 'written_off', 'closed'];
  const getLoanRemarks = (loan) => loan.purpose || loan.remarks || loan.note || '';
  const getLoanClientName = (loan) => {
    const member = loan.expand?.member;
    const loanGroup = loan.expand?.group;
    return member?.full_name || loanGroup?.name || 'Unknown';
  };
  const getLoanSearchText = (loan) => {
    const member = loan.expand?.member || {};
    const group = loan.expand?.group || member.expand?.group || {};
    return [
      loan.loan_no,
      loan.status,
      member.full_name,
      member.reg_no,
      member.id_number,
      member.phone_number,
      member.phone,
      member.mobile,
      group.name,
      group.group_id,
      group.phone,
      group.phone_number,
      group.mobile
    ].filter(Boolean).join(' ').toLowerCase();
  };
  const filterLoansBySearch = (items) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return items;
    return items.filter(loan => getLoanSearchText(loan).includes(q));
  };
  const filterLoansByOfficer = (items) => {
    if (officerFilter === 'all') return items;
    const { getLoanOfficerId } = createOfficerScope();
    return items.filter(loan => matchesOfficer(getLoanOfficerId(loan), officerFilter));
  };
  const sortLoansAlphabetically = (items) => [...items].sort((a, b) => {
    const comparison = getLoanClientName(a).localeCompare(getLoanClientName(b), undefined, { sensitivity: 'base' });
    return alphaSort === 'za' ? -comparison : comparison;
  });

  const updateUI = async () => {
    const thisRequest = ++requestId;
    const cancelLoading = showDelayedLoading(() => {
      if (thisRequest !== requestId) return;
      tableBody.innerHTML = renderTableSkeletonRows(9, 6);
      paginationWrapper.innerHTML = '';
    });
    try {
      if (hasInvalidDateRange()) {
        cancelLoading();
        paginationWrapper.innerHTML = '';
        tableBody.innerHTML = `
          <tr><td colspan="9" class="text-center text-danger" style="padding: 40px;">Select a From date that is before the To date.</td></tr>
        `;
        return;
      }
      // Build filter
      const filters = [];
      if (statusFilter === 'running') {
        filters.push('status="disbursed"');
      } else if (statusFilter === 'pending') {
        filters.push('status="pending"');
      } else if (statusFilter === 'awaiting') {
        filters.push('(status="approved" || status="partial_approved") && disbursement_date=""');
      } else if (statusFilter === 'declined') {
        filters.push('status="rejected"');
      } else if (statusFilter === 'completed') {
        filters.push('status="completed"');
      } else if (statusFilter === 'written_off') {
        filters.push('status="written_off"');
      }
      const dateFilter = buildLoanDateFilter();
      if (dateFilter) filters.push(dateFilter);
      const pbFilter = filters.join(' && ');

      const renderLoanResult = (result) => {
        if (thisRequest !== requestId) return;
        cancelLoading();
        const paginatedLoans = result.items;

        tableBody.innerHTML = paginatedLoans.length === 0 ? `
          <tr><td colspan="9" class="text-center text-muted" style="padding: 40px;">${isRecoveredMode ? 'No fully recovered D.R.U loans found.' : 'No loans found.'}</td></tr>
        ` : paginatedLoans.map(l => {
          const member = l.expand?.member;
          const loanGroup = l.expand?.group;
          const memberGroup = member?.expand?.group;
          const isGroupAccountLoan = Boolean(loanGroup && !member);
          const clientName = getLoanClientName(l);
          const clientReg = member ? member.reg_no : (loanGroup ? loanGroup.group_id : 'Unknown');
          const applicantBadge = isGroupAccountLoan
            ? `<span class="badge" style="background: var(--surface-dark); color: white; font-size: 0.7rem;">TB</span>`
            : (memberGroup ? '' : `<span class="badge badge-primary" style="font-size: 0.7rem;">INDIV</span>`);
          const groupContext = member && memberGroup
            ? `<div class="text-xs text-muted" style="margin-top: 4px;">${memberGroup.name || memberGroup.group_id || 'Group member'}</div>`
            : '';
          const groupLabel = isGroupAccountLoan
            ? (loanGroup?.name || loanGroup?.group_id || 'Table Banking')
            : (memberGroup?.name || 'Individual');
          const groupCode = isGroupAccountLoan
            ? (loanGroup?.group_id || '')
            : (memberGroup?.group_id || '');
          const groupBadgeClass = isGroupAccountLoan || memberGroup ? 'badge-primary' : 'badge-outline';
          const isDistressUnit = Boolean(l.__distressUnit);
          const isRecoveryUnit = Boolean(l.__recoveryUnit);
          const statusLabel = l.__recovered ? 'RECOVERED (RL)' : isRecoveryUnit ? 'DEBT RECOVERY (D.R.U)' : isDistressUnit ? 'DISTRESS UNIT (DU)' :
            l.status === 'disbursed' ? 'RUNNING' :
            l.status === 'approved' ? 'AWAITING DISBURSEMENT' :
            l.status === 'partial_approved' ? 'PARTIAL AWAITING DISBURSEMENT' :
            l.status === 'rejected' ? 'DECLINED' :
            l.status === 'written_off' ? 'WRITTEN OFF' :
            l.status.toUpperCase();
          
          return `
          <tr>
            <td>
              <div class="font-semibold">${l.loan_no}</div>
              <div class="text-xs text-muted">${l.disbursement_date ? formatDate(l.disbursement_date) : 'Not disbursed'}</div>
            </td>
            <td class="font-semibold">${clientName}</td>
            <td>
              <span class="badge ${groupBadgeClass}" style="font-size: 0.65rem;">${groupLabel}</span>
              ${groupCode ? `<div class="text-xs text-muted" style="margin-top: 4px;">${groupCode}</div>` : ''}
            </td>
            <td class="text-sm">
              ${applicantBadge} ${clientReg}
              ${groupContext}
            </td>
            <td>${formatMoney(l.amount_applied)}</td>
            <td>${formatMoney(l.total_liability)}</td>
            <td>
              <div class="fee-status-cell" data-loan="${l.id}">
                ${l.processing_fee_paid
                  ? `<div style="display: flex; align-items: center; gap: 6px;">
                       <span class="badge badge-success" style="gap: 4px;">✓ PAID</span>
                       <div class="text-xs text-muted">${formatMoney(l.processing_fee)}</div>
                     </div>`
                  : `<div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                       <span class="badge badge-warning">⚠ UNPAID</span>
                       <span class="text-xs text-muted">${formatMoney(l.processing_fee)}</span>
                       ${l.status === 'pending' ? `<button class="btn-fee-pay" data-id="${l.id}" data-loan="${l.loan_no}" data-amount="${l.processing_fee}" style="font-size: 0.7rem; padding: 4px 10px; background: var(--secondary); color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 2px; font-weight: 600; transition: background 0.2s;">Record Payment</button>` : ''}
                     </div>`
                }
              </div>
            </td>
            <td>
              <span class="badge ${
                l.__recovered ? 'badge-success' : isDistressUnit || isRecoveryUnit ? 'badge-danger' :
                l.status === 'disbursed' ? 'badge-success' :
                l.status === 'approved' ? 'badge-primary' :
                l.status === 'partial_approved' ? 'badge-primary' :
                l.status === 'pending' ? 'badge-warning' :
                l.status === 'written_off' ? 'badge-danger' :
                'badge-danger'
              }" style="${
                l.status === 'approved' || l.status === 'partial_approved' ? 'background: #0d9488; color: white;' : ''
              }">
                ${statusLabel}
              </span>
              ${isDistressUnit ? `<div class="text-xs text-muted" style="margin-top: 4px;">Ended ${formatDate(l.__duEndDate)} · OLB ${formatMoney(l.__duOutstanding)}</div>` : ''}
              ${isRecoveryUnit ? `<div class="text-xs text-muted" style="margin-top: 4px;">${getRecoveryAgeDays(l)} days unpaid &middot; OLB ${formatMoney(l.__duOutstanding)}</div>` : ''}
              ${l.__recovered ? `<div class="text-xs text-muted" style="margin-top: 4px;">Fully paid &middot; OLB ${formatMoney(0)}</div>` : ''}
            </td>
            <td>
              <div class="loan-action-group">
                ${(isRecoveryUnit || isDistressUnit) && canDeleteLoans ? `<button type="button" class="btn btn-outline btn-sm loan-row-action" data-action="renew" data-id="${l.id}">Renew</button>` : ''}
                <button type="button" class="loan-icon-action loan-row-action" data-action="view" data-id="${l.id}" title="View loan" aria-label="View loan">⊙</button>
                <button type="button" class="loan-icon-action loan-row-action" data-action="comments" data-id="${l.id}" title="View comments" aria-label="View comments">
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                ${canEditLoans ? `<button type="button" class="loan-icon-action loan-row-action" data-action="edit" data-id="${l.id}" title="Edit loan" aria-label="Edit loan">✎</button>` : ''}
                ${canDeleteLoans ? `<button type="button" class="loan-icon-action danger loan-row-action" data-action="delete" data-id="${l.id}" title="Delete loan" aria-label="Delete loan">×</button>` : ''}
              </div>
            </td>
          </tr>`;
        }).join('');

        container.querySelectorAll('.loan-row-action').forEach(btn => {
          btn.onclick = async () => {
            const loan = paginatedLoans.find(item => item.id === btn.dataset.id);
            if (!loan) return;
            if (btn.dataset.action === 'renew') {
              openDebtRecoveryRenewal(loan, async () => {
                currentPage = 1;
                await updateUI();
              });
              return;
            }
            if (btn.dataset.action === 'view') {
              window.location.hash = withReturnTo(`#/loans/${loan.loan_no}`, currentRoute);
              return;
            }
            if (btn.dataset.action === 'comments') {
              window.location.hash = withReturnTo(`#/loans/${loan.loan_no}?tab=comments`, currentRoute);
              return;
            }
            if (btn.dataset.action === 'edit') {
              openLoanEdit(loan);
              return;
            }
            if (btn.dataset.action === 'delete') {
              await deleteLoan(loan);
            }
          };
        });

        // Re-attach fee payment listeners
        container.querySelectorAll('.btn-fee-pay').forEach(btn => {
          btn.onclick = () => {
            activeFeeRecordId = btn.dataset.id;
            activeFeeLoan = btn.dataset.loan;
            activeFeeAmount = parseFloat(btn.dataset.amount);
            amountDisplay.textContent = `KES ${formatMoney(activeFeeAmount)}`;
            loanDisplay.textContent = `Loan Reference: ${activeFeeLoan}`;
            modal.style.display = 'flex';
          };
        });

        paginationWrapper.innerHTML = '';
        const pagination = renderPagination(result.totalItems, pageSize, currentPage, (newPage) => {
          currentPage = newPage;
          updateUI();
        });
        if (pagination) paginationWrapper.appendChild(pagination);
      };

      if (statusFilter === 'balanced_off') {
        const [allLoans, balanceOffs] = await Promise.all([
          loanService.getFullListCached({
            filter: dateFilter,
            sort: '-application_date',
            cacheKey: 'loans:list:balanced-off:expanded:v1'
          }),
          loanService.getBalanceOffsFullList({ expand: '' })
        ]);
        const balancedLoanIds = new Set(balanceOffs
          .filter(record => record.status !== 'reversed')
          .map(record => typeof record.loan === 'string' ? record.loan : record.loan?.id)
          .filter(Boolean));
        const matchedLoans = allLoans.filter(loan => balancedLoanIds.has(loan.id));
        const officerLoans = filterLoansByOfficer(matchedLoans);
        const searchedLoans = filterLoansBySearch(officerLoans);
        const sortedLoans = alphaSort !== 'default' ? sortLoansAlphabetically(searchedLoans) : searchedLoans;
        const start = (currentPage - 1) * pageSize;
        renderLoanResult({
          items: sortedLoans.slice(start, start + pageSize),
          totalItems: sortedLoans.length
        });
        return;
      }

      if (isUnitMode) {
        const [allLoans, repayments, settlements, schedules, penaltyAmount] = await Promise.all([
          loanService.getFullListCached({
            filter: combineFilters(isRecoveredMode
              ? '(status="disbursed" || status="completed" || status="closed" || status="approved" || status="partial_approved") && disbursement_date!=""'
              : 'status="disbursed"', dateFilter),
            sort: '-application_date',
            cacheKey: isRecoveredMode ? 'loans:list:recovered:expanded:v1' : 'loans:list:distress-unit:expanded:v1'
          }),
          dataCache.get('loan_repayments:loan-list:all:v1', () => pb.collection('loan_repayments').getFullList()),
          loanService.getBalanceOffsFullList({ expand: '' }),
          dataCache.get('loan_schedule:loan-list:all:v1', () => pb.collection('loan_schedule').getFullList()),
          settingsService.getNumber('penalty_amount', 500)
        ]);
        const portfolioCalculator = createLoanPortfolioCalculator({
          repayments,
          settlements,
          schedules,
          penaltyAmount,
          referenceDate: new Date()
        });
        const matchedLoans = allLoans
          .map(loan => {
            const outstanding = portfolioCalculator.getOutstanding(loan);
            const endDate = getLoanEndDate(loan);
            return {
              ...loan,
              __distressUnit: isDistressUnitLoan(loan, { outstandingBalance: outstanding }),
              __recoveryUnit: isDebtRecoveryLoan(loan, {
                repayments: portfolioCalculator.getRepayments(loan.id),
                settlements: portfolioCalculator.getSettlements(loan.id),
                schedules: portfolioCalculator.getSchedules(loan.id)
              }),
              __recovered: isRecoveredMode && isRecoveredLoan(loan, {
                repayments: portfolioCalculator.getRepayments(loan.id),
                settlements: portfolioCalculator.getSettlements(loan.id),
                schedules: portfolioCalculator.getSchedules(loan.id),
                penaltyAmount
              }),
              __duOutstanding: outstanding,
              __duEndDate: endDate
            };
          })
          .filter(loan => isRecoveredMode ? loan.__recovered : isRecoveryMode ? loan.__recoveryUnit : loan.__distressUnit)
          .map(loan => ({ ...loan, __distressUnit: isDistressMode && loan.__distressUnit, __recoveryUnit: isRecoveryMode && loan.__recoveryUnit }));
        const officerLoans = filterLoansByOfficer(matchedLoans);
        const searchedLoans = filterLoansBySearch(officerLoans);
        const sortedLoans = alphaSort !== 'default' ? sortLoansAlphabetically(searchedLoans) : searchedLoans;
        const start = (currentPage - 1) * pageSize;
        renderLoanResult({
          items: sortedLoans.slice(start, start + pageSize),
          totalItems: sortedLoans.length
        });
        return;
      }

      if (alphaSort !== 'default' || searchTerm || officerFilter !== 'all') {
        const allLoans = await loanService.getFullListCached({
          filter: pbFilter,
          sort: '-application_date',
          cacheKey: 'loans:list:alpha:expanded:v1'
        });
        const officerLoans = filterLoansByOfficer(allLoans);
        const searchedLoans = filterLoansBySearch(officerLoans);
        const sortedLoans = alphaSort !== 'default' ? sortLoansAlphabetically(searchedLoans) : searchedLoans;
        const start = (currentPage - 1) * pageSize;
        renderLoanResult({
          items: sortedLoans.slice(start, start + pageSize),
          totalItems: sortedLoans.length
        });
        return;
      }

      const query = { page: currentPage, perPage: pageSize, filter: pbFilter };
      const result = await loanService.getAllCached(query, freshResult => renderLoanResult(freshResult));
      renderLoanResult(result);

    } catch (e) {
      cancelLoading();
      console.error(e);
      tableBody.innerHTML = `<tr><td colspan="9" class="text-center text-danger" style="padding: 40px;">Failed to load loans.</td></tr>`;
    }
  };

  const loanEditModal = container.querySelector('#loan-edit-modal');
  const loanEditForm = container.querySelector('#loan-edit-form');
  const loanEditTitle = container.querySelector('#loan-edit-title');
  const loanEditSubtitle = container.querySelector('#loan-edit-subtitle');
  const closeLoanEditBtn = container.querySelector('#close-loan-edit-modal');
  const cancelLoanEditBtn = container.querySelector('#cancel-loan-edit-btn');
  let activeEditLoan = null;

  const closeLoanEditModal = () => {
    loanEditModal.style.display = 'none';
    activeEditLoan = null;
    loanEditForm.reset();
  };

  const openLoanEdit = (loan) => {
    if (!canEditLoans) {
      if (window.notify) window.notify.error('Only admins can edit loan records.');
      return;
    }
    activeEditLoan = loan;
    loanEditTitle.textContent = `Edit ${loan.loan_no}`;
    loanEditSubtitle.textContent = `${getLoanClientName(loan)} · controlled loan record update`;
    loanEditForm.elements.application_date.value = toDateInputValue(loan.application_date);
    loanEditForm.elements.approved_date.value = toDateInputValue(loan.approved_date);
    loanEditForm.elements.disbursement_date.value = toDateInputValue(loan.disbursement_date);
    loanEditForm.elements.status.value = loan.status || 'pending';
    loanEditForm.elements.purpose.value = getLoanRemarks(loan);
    loanEditModal.style.display = 'flex';
  };

  const deleteLoan = async (loan) => {
    if (!canDeleteLoans) {
      if (window.notify) window.notify.error('Only super admins can delete loan records.');
      return;
    }
    const confirmed = window.confirmDialog ? await window.confirmDialog({
      title: 'Delete Loan Record',
      message: `This will permanently delete loan ${loan.loan_no}. If repayments or schedules exist, PocketBase may block the deletion to protect financial history.`,
      confirmText: 'Delete Loan',
      cancelText: 'Keep Record',
      type: 'danger'
    }) : confirm(`Delete loan ${loan.loan_no} permanently?`);
    if (!confirmed) return;

    try {
      await loanService.delete(loan.id);
      if (window.notify) window.notify.success('Loan record deleted.');
      updateUI();
    } catch (err) {
      if (window.notify) window.notify.error('Failed to delete loan: ' + (err.message || 'This loan may have linked repayments or schedules.'));
    }
  };

  closeLoanEditBtn.onclick = closeLoanEditModal;
  cancelLoanEditBtn.onclick = closeLoanEditModal;
  loanEditModal.addEventListener('click', (event) => {
    if (event.target === loanEditModal) closeLoanEditModal();
  });

  loanEditForm.onsubmit = async (event) => {
    event.preventDefault();
    if (!activeEditLoan) return;
    if (!loanEditForm.reportValidity()) return;

    const formData = new FormData(loanEditForm);
    const data = Object.fromEntries(formData.entries());
    const payload = {
      application_date: toPocketDate(data.application_date),
      status: data.status,
      purpose: data.purpose || ''
    };
    if (data.approved_date) payload.approved_date = toPocketDate(data.approved_date);
    if (disbursedStatuses.includes(data.status)) {
      if (!data.disbursement_date) {
        if (window.notify) window.notify.error('Disbursement date is required once a loan is disbursed, completed, or closed.');
        return;
      }
      payload.disbursement_date = toPocketDate(data.disbursement_date);
    }

    const restoreButton = setButtonLoading(loanEditForm.querySelector('button[type="submit"]'), 'Saving...');
    try {
      await loanService.update(activeEditLoan.id, payload);
      if (window.notify) window.notify.success('Loan record updated.');
      closeLoanEditModal();
      updateUI();
    } catch (err) {
      if (window.notify) window.notify.error('Failed to update loan: ' + (err.message || 'Please try again.'));
      restoreButton();
    }
  };

  // Modal Logic
  const modal = container.querySelector('#fee-modal');
  const amountDisplay = container.querySelector('#fee-modal-amount');
  const loanDisplay = container.querySelector('#fee-modal-loan');
  const closeBtn = container.querySelector('#close-fee-modal');
  const cancelBtn = container.querySelector('#cancel-fee-btn');
  const form = container.querySelector('#fee-collection-form');
  const methodSelect = container.querySelector('#fee-payment-method');
  const refGroup = container.querySelector('#fee-reference-group');
  const refLabel = container.querySelector('#fee-reference-label');
  const refInput = container.querySelector('#fee-reference');

  let activeFeeRecordId = null;
  let activeFeeLoan = null;
  let activeFeeAmount = 0;

  methodSelect.onchange = () => {
    const val = methodSelect.value;
    if (val === 'cash') {
      refGroup.style.display = 'none';
      refInput.removeAttribute('required');
      refInput.value = '';
    } else if (val === 'bank') {
      refGroup.style.display = 'block';
      refLabel.textContent = 'Bank Transfer / Cheque Reference';
      refInput.placeholder = 'e.g. CHQ-987654';
      refInput.setAttribute('required', 'true');
    } else { // mpesa
      refGroup.style.display = 'block';
      refLabel.textContent = 'M-Pesa Transaction Code';
      refInput.placeholder = 'e.g. QWE123RTY4';
      refInput.setAttribute('required', 'true');
    }
  };

  const closeModal = () => {
    modal.style.display = 'none';
    activeFeeRecordId = null;
    activeFeeLoan = null;
    form.reset();
  };

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!activeFeeRecordId) return;
    const restoreButton = setButtonLoading(form.querySelector('button[type="submit"]'), 'Recording...');

    try {
      const capturedAt = new Date().toISOString();
      await loanService.update(activeFeeRecordId, {
        processing_fee_paid: true,
        processing_fee_details: {
          method: methodSelect.value,
          reference: refInput.value,
          date: capturedAt,
          captured_at: capturedAt
        }
      });
      
      // Processing fee payment is now stored entirely in the loan object.
      // We removed the legacy fees_log collection requirement.

      if (window.notify) window.notify.success('Processing fee recorded successfully!');
      closeModal();
      updateUI(); // Refresh table without reloading page
    } catch (err) {
      if (window.notify) window.notify.error('Error recording fee: ' + (err.message || 'Validation Failed'));
      console.error(err);
      restoreButton();
    }
  };

  const searchInput = container.querySelector('#loan-search');
  const statusSelect = container.querySelector('#loan-status-filter');
  const dateFromInput = container.querySelector('#loan-date-from');
  const dateToInput = container.querySelector('#loan-date-to');
  const dateClearBtn = container.querySelector('#loan-date-clear');
  const alphaSortSelect = container.querySelector('#loan-alpha-sort');
  const officerFilterSelect = container.querySelector('#loan-officer-filter');
  const debouncedSearch = debounce(() => {
    searchTerm = searchInput.value.trim();
    currentPage = 1;
    updateUI();
  }, 300);
  searchInput.addEventListener('input', debouncedSearch);
  const applyDateFilter = () => {
    dateRange = {
      from: dateFromInput?.value || '',
      to: dateToInput?.value || ''
    };
    currentPage = 1;
    updateUI();
  };
  dateFromInput.addEventListener('change', applyDateFilter);
  dateToInput.addEventListener('change', applyDateFilter);
  dateClearBtn.onclick = () => {
    dateFromInput.value = '';
    dateToInput.value = '';
    applyDateFilter();
  };
  if (statusSelect) {
    statusSelect.onchange = () => {
      statusFilter = statusSelect.value;
      currentPage = 1;
      updateUI();
    };
  }
  alphaSortSelect.onchange = () => {
    alphaSort = alphaSortSelect.value;
    currentPage = 1;
    updateUI();
  };
  if (officerFilterSelect) {
    officerFilterSelect.onchange = () => {
      officerFilter = officerFilterSelect.value;
      currentPage = 1;
      updateUI();
    };
    loadOfficerOptions().then(options => populateOfficerSelect(officerFilterSelect, options, officerFilter));
  }

  updateUI();

  // Real-time updates
  const refreshUnit = debounce(async () => {
    await dataCache.invalidatePrefix('loans:');
    if (isUnitMode) {
      await dataCache.invalidatePrefix('loan_schedule');
      await dataCache.invalidatePrefix('loan_repayments');
    }
    updateUI();
  }, 250);
  container.__subscriptionPromise = Promise.all([
    loanService.subscribeToChanges(refreshUnit),
    ...(isUnitMode ? ['loan_repayments', 'loan_balance_offs', 'loan_schedule'].map(name =>
      pb.collection(name).subscribe('*', refreshUnit)) : [])
  ]);

  return container;
};
