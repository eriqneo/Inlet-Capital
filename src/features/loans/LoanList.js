import { loanService } from '../../services/loanService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';
import { dataCache, debounce } from '../../services/dataCache.js';
import { renderTableSkeletonRows, setButtonLoading, showDelayedLoading } from '../../core/uiState.js';
import { withReturnTo } from '../../core/navigation.js';
import { authService } from '../../services/authService.js';

export const renderLoanList = async () => {
  const container = document.createElement('div');
  const currentUser = authService.getUser();
  const canApproveLoans = ['super_admin', 'admin'].includes(currentUser?.role);
  
  // We will fetch the loans per page
  let currentPage = 1;
  const pageSize = 10;
  let searchTerm = '';
  let statusFilter = 'running';
  let alphaSort = 'default';
  let requestId = 0;

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Loans Management</h1>
        <p class="text-muted">Track all individual and group loan applications.</p>
      </div>
        ${canApproveLoans ? `<button class="btn btn-secondary" onclick="window.location.hash = '${withReturnTo('#/loans/approve', '#/loans')}'" style="background: #eab308; border-color: #eab308; color: white;">
          <span class="badge" style="background: white; color: #eab308; margin-right: 8px;">!</span>
          Review Pending
        </button>` : ''}
        ${canApproveLoans ? `<button class="btn btn-primary" onclick="window.location.hash = '${withReturnTo('#/loans/approve', '#/loans')}'" style="background: #0d9488; border-color: #0d9488; color: white;">
          <span class="badge" style="background: white; color: #0d9488; margin-right: 8px;">!</span>
          Disburse Approved
        </button>` : ''}
        <button class="btn btn-primary" onclick="window.location.hash = '${withReturnTo('#/loans/new', '#/loans')}'">+ New Loan Application</button>
      </div>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; gap: 16px; flex-wrap: wrap;">
        <input type="text" id="loan-search" class="form-control" placeholder="Search by name, phone, or loan number..." style="max-width: 400px;" />
        <select id="loan-status-filter" class="form-control" style="max-width: 240px;">
          <option value="running" selected>Running Loans</option>
          <option value="pending">Pending Approval</option>
          <option value="awaiting">Awaiting Disbursement</option>
          <option value="declined">Declined</option>
          <option value="completed">Completed</option>
          <option value="all">All Loans</option>
        </select>
        <select id="loan-alpha-sort" class="form-control" style="max-width: 160px;">
          <option value="default">Latest</option>
          <option value="az">Client A-Z</option>
          <option value="za">Client Z-A</option>
        </select>
      </div>
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th>Loan Details</th>
              <th>Client Name</th>
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
  `;

  const tableBody = container.querySelector('#loan-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');
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
  const sortLoansAlphabetically = (items) => [...items].sort((a, b) => {
    const comparison = getLoanClientName(a).localeCompare(getLoanClientName(b), undefined, { sensitivity: 'base' });
    return alphaSort === 'za' ? -comparison : comparison;
  });

  const updateUI = async () => {
    const thisRequest = ++requestId;
    const cancelLoading = showDelayedLoading(() => {
      if (thisRequest !== requestId) return;
      tableBody.innerHTML = renderTableSkeletonRows(8, 6);
      paginationWrapper.innerHTML = '';
    });
    try {
      // Build filter
      const filters = [];
      if (statusFilter === 'running') {
        filters.push('status="disbursed"');
      } else if (statusFilter === 'pending') {
        filters.push('status="pending"');
      } else if (statusFilter === 'awaiting') {
        filters.push('(status="approved" || status="partial_approved")');
      } else if (statusFilter === 'declined') {
        filters.push('status="rejected"');
      } else if (statusFilter === 'completed') {
        filters.push('status="completed"');
      }
      const pbFilter = filters.join(' && ');

      const renderLoanResult = (result) => {
        if (thisRequest !== requestId) return;
        cancelLoading();
        const paginatedLoans = result.items;

        tableBody.innerHTML = paginatedLoans.length === 0 ? `
          <tr><td colspan="8" class="text-center text-muted" style="padding: 40px;">No loans found.</td></tr>
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
          const statusLabel = l.status === 'disbursed' ? 'RUNNING' :
            l.status === 'approved' ? 'AWAITING DISBURSEMENT' :
            l.status === 'partial_approved' ? 'PARTIAL AWAITING DISBURSEMENT' :
            l.status === 'rejected' ? 'DECLINED' :
            l.status.toUpperCase();
          
          return `
          <tr>
            <td>
              <div class="font-semibold">${l.loan_no}</div>
              <div class="text-xs text-muted">${formatDate(l.application_date)}</div>
            </td>
            <td class="font-semibold">${clientName}</td>
            <td class="text-sm">
              ${applicantBadge} ${clientReg}
              ${groupContext}
            </td>
            <td>${l.amount_applied.toLocaleString()}</td>
            <td>${l.total_liability.toLocaleString()}</td>
            <td>
              <div class="fee-status-cell" data-loan="${l.id}">
                ${l.processing_fee_paid
                  ? `<div style="display: flex; align-items: center; gap: 6px;">
                       <span class="badge badge-success" style="gap: 4px;">✓ PAID</span>
                       <div class="text-xs text-muted">${l.processing_fee.toLocaleString()}</div>
                     </div>`
                  : `<div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                       <span class="badge badge-warning">⚠ UNPAID</span>
                       <span class="text-xs text-muted">${l.processing_fee.toLocaleString()}</span>
                       ${l.status === 'pending' ? `<button class="btn-fee-pay" data-id="${l.id}" data-loan="${l.loan_no}" data-amount="${l.processing_fee}" style="font-size: 0.7rem; padding: 4px 10px; background: var(--secondary); color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 2px; font-weight: 600; transition: background 0.2s;">Record Payment</button>` : ''}
                     </div>`
                }
              </div>
            </td>
            <td>
              <span class="badge ${
                l.status === 'disbursed' ? 'badge-success' :
                l.status === 'approved' ? 'badge-primary' :
                l.status === 'partial_approved' ? 'badge-primary' :
                l.status === 'pending' ? 'badge-warning' :
                'badge-danger'
              }" style="${
                l.status === 'approved' || l.status === 'partial_approved' ? 'background: #0d9488; color: white;' : ''
              }">
                ${statusLabel}
              </span>
            </td>
            <td>
              <button class="btn btn-outline btn-sm" onclick="window.location.hash = '${withReturnTo(`#/loans/${l.loan_no}`, '#/loans')}'">View</button>
            </td>
          </tr>`;
        }).join('');

        // Re-attach fee payment listeners
        container.querySelectorAll('.btn-fee-pay').forEach(btn => {
          btn.onclick = () => {
            activeFeeRecordId = btn.dataset.id;
            activeFeeLoan = btn.dataset.loan;
            activeFeeAmount = parseFloat(btn.dataset.amount);
            amountDisplay.textContent = `KES ${activeFeeAmount.toLocaleString()}`;
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

      if (alphaSort !== 'default' || searchTerm) {
        const allLoans = await loanService.getFullListCached({
          filter: pbFilter,
          sort: '-application_date',
          cacheKey: 'loans:list:alpha:expanded:v1'
        });
        const searchedLoans = filterLoansBySearch(allLoans);
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
      tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger" style="padding: 40px;">Failed to load loans.</td></tr>`;
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
  const alphaSortSelect = container.querySelector('#loan-alpha-sort');
  const debouncedSearch = debounce(() => {
    searchTerm = searchInput.value.trim();
    currentPage = 1;
    updateUI();
  }, 300);
  searchInput.addEventListener('input', debouncedSearch);
  statusSelect.onchange = () => {
    statusFilter = statusSelect.value;
    currentPage = 1;
    updateUI();
  };
  alphaSortSelect.onchange = () => {
    alphaSort = alphaSortSelect.value;
    currentPage = 1;
    updateUI();
  };

  updateUI();

  // Real-time updates
  container.__subscriptionPromise = loanService.subscribeToChanges(async () => {
    await dataCache.invalidatePrefix('loans:');
    updateUI();
  })
    .then(unsub => [unsub]);

  return container;
};
