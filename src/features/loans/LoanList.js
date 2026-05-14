import { getAll, getById, put, add } from '../../core/db.js';
import { renderPagination } from '../../components/Pagination.js';

export const renderLoanList = async () => {
  const container = document.createElement('div');
  const [loans, members, groups] = await Promise.all([
    getAll('loans'),
    getAll('members'),
    getAll('groups')
  ]);
  const pendingCount = loans.filter(l => l.status === 'pending').length;

  let currentPage = 1;
  const pageSize = 10;
  const sortedLoans = [...loans].sort((a, b) => new Date(b.applicationDate) - new Date(a.applicationDate));

  // Helper to get client name
  const getClientName = (loan) => {
    if (loan.memberId) {
      const member = members.find(m => m.regNo === loan.memberId);
      return member ? member.fullName : 'Unknown Member';
    } else if (loan.groupId) {
      const group = groups.find(g => g.groupId === loan.groupId);
      return group ? group.name : 'Unknown Group';
    }
    return 'Unknown';
  };

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Loans Management</h1>
        <p class="text-muted">Track all individual and group loan applications.</p>
      </div>
      <div style="display: flex; gap: 12px;">
        ${pendingCount > 0 ? `<button class="btn btn-secondary" onclick="window.location.hash = '#/loans/approve'">
          <span class="badge" style="background: white; color: var(--secondary); margin-right: 8px;">${pendingCount}</span>
          Review Pending
        </button>` : ''}
        <button class="btn btn-primary" onclick="window.location.hash = '#/loans/new'">+ New Loan Application</button>
      </div>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
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
            <label class="form-label">Transaction Reference / Receipt No.</label>
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

  const updateUI = () => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginatedLoans = sortedLoans.slice(start, end);

    tableBody.innerHTML = paginatedLoans.length === 0 ? `
      <tr><td colspan="8" class="text-center text-muted" style="padding: 40px;">No loans found.</td></tr>
    ` : paginatedLoans.map(l => `
      <tr>
        <td>
          <div class="font-semibold">${l.loanNo}</div>
          <div class="text-xs text-muted">${new Date(l.applicationDate).toLocaleDateString()}</div>
        </td>
        <td class="font-semibold">${getClientName(l)}</td>
        <td class="text-sm">
          ${l.memberId ? `<span class="badge badge-primary" style="font-size: 0.7rem;">INDIV</span> ${l.memberId}` : `<span class="badge" style="background: var(--surface-dark); color: white; font-size: 0.7rem;">GROUP</span> ${l.groupId}`}
        </td>
        <td>KES ${l.amountApplied.toLocaleString()}</td>
        <td>KES ${l.totalLiability.toLocaleString()}</td>
        <td>
          <div class="fee-status-cell" data-loan="${l.loanNo}">
            ${l.processingFeePaid
              ? `<div style="display: flex; align-items: center; gap: 6px;">
                   <span class="badge badge-success" style="gap: 4px;">✓ PAID</span>
                   <div class="text-xs text-muted">KES ${l.processingFee.toLocaleString()}</div>
                 </div>`
              : `<div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                   <span class="badge badge-warning">⚠ UNPAID</span>
                   <span class="text-xs text-muted">KES ${l.processingFee.toLocaleString()}</span>
                   ${l.status === 'pending' ? `<button class="btn-fee-pay" data-loan="${l.loanNo}" data-amount="${l.processingFee}" style="font-size: 0.7rem; padding: 4px 10px; background: var(--secondary); color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 2px; font-weight: 600; transition: background 0.2s;">Record Payment</button>` : ''}
                 </div>`
            }
          </div>
        </td>
        <td>
          <span class="badge ${
            l.status === 'approved' ? 'badge-success' :
            l.status === 'pending' ? 'badge-warning' :
            'badge-danger'
          }">${l.status.toUpperCase()}</span>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/loans/${l.loanNo}'">View</button>
        </td>
      </tr>
    `).join('');

    // Re-attach fee payment listeners
    container.querySelectorAll('.btn-fee-pay').forEach(btn => {
      btn.onclick = () => {
        activeFeeLoan = btn.dataset.loan;
        activeFeeAmount = parseFloat(btn.dataset.amount);
        amountDisplay.textContent = `KES ${activeFeeAmount.toLocaleString()}`;
        loanDisplay.textContent = `Loan Reference: ${activeFeeLoan}`;
        modal.style.display = 'flex';
      };
    });

    paginationWrapper.innerHTML = '';
    const pagination = renderPagination(sortedLoans.length, pageSize, currentPage, (newPage) => {
      currentPage = newPage;
      updateUI();
    });
    if (pagination) paginationWrapper.appendChild(pagination);
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
  const refInput = container.querySelector('#fee-reference');

  let activeFeeLoan = null;
  let activeFeeAmount = 0;

  methodSelect.onchange = () => {
    if (methodSelect.value === 'cash') {
      refGroup.style.display = 'none';
      refInput.removeAttribute('required');
    } else {
      refGroup.style.display = 'block';
      refInput.setAttribute('required', 'true');
    }
  };

  const closeModal = () => {
    modal.style.display = 'none';
    activeFeeLoan = null;
    form.reset();
  };

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!activeFeeLoan) return;

    const loan = await getById('loans', activeFeeLoan);
    loan.processingFeePaid = true;
    loan.processingFeePaidDate = new Date().toISOString();
    loan.processingFeeDetails = {
      method: methodSelect.value,
      reference: refInput.value
    };

    try {
      await put('loans', loan);
      await add('fees_log', {
        loanId: loan.loanNo,
        memberId: loan.memberId || loan.groupId,
        amount: loan.processingFee,
        type: 'processing_fee',
        date: new Date().toISOString(),
        method: methodSelect.value,
        reference: refInput.value
      });

      notify.success('Processing fee recorded successfully!');
      closeModal();
      window.location.reload(); // Hard refresh to update data
    } catch (err) {
      notify.error('Error recording fee: ' + err.message);
    }
  };

  updateUI();

  return container;
};
