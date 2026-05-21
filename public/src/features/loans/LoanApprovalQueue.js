import { getAll, getById, put, add } from '../../core/db.js';
import { navigate } from '../../core/router.js';
import { formatDate } from '../../core/utils.js';

export const renderLoanApprovalQueue = async () => {
  const container = document.createElement('div');
  const allLoans = await getAll('loans');
  const now = new Date();
  let updatedAny = false;

  // Run silent 14-day expiry sweep on load
  for (const loan of allLoans) {
    if (['approved', 'partial_approved'].includes(loan.status) && loan.approvedDate) {
      const daysSinceApproval = (now - new Date(loan.approvedDate)) / (1000 * 60 * 60 * 24);
      if (daysSinceApproval > 14) {
        loan.status = 'expired';
        loan.expiredDate = now.toISOString();
        await put('loans', loan);
        updatedAny = true;
      }
    }
  }

  // Fetch fresh loans if statuses changed
  const freshLoans = updatedAny ? await getAll('loans') : allLoans;

  // Filter queues
  const pendingLoans = freshLoans.filter(l => l.status === 'pending');
  const awaitingLoans = freshLoans.filter(l => ['approved', 'partial_approved'].includes(l.status));
  const expiredLoans = freshLoans.filter(l => l.status === 'expired');

  // Helper to calculate days remaining for disbursement
  const getDaysRemaining = (approvedDateStr) => {
    if (!approvedDateStr) return 0;
    const approvedDate = new Date(approvedDateStr);
    const deadline = new Date(approvedDate);
    deadline.setDate(deadline.getDate() + 14);
    const timeDiff = deadline - now;
    return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
  };

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 class="text-xl">Loan Decision Centre</h1>
      <p class="text-muted">Review pending applications, manage approved disbursement windows, and re-activate expired approvals.</p>
    </div>

    <!-- Queue Tab Selection Buttons -->
    <div class="card" style="padding: 0; margin-bottom: 24px; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
      <div style="display: flex; background: var(--bg-light); border-bottom: 1px solid var(--border-color);">
        <button class="queue-tab-btn active" data-queue="pending" style="flex: 1; padding: 16px; border: none; background: transparent; font-weight: 600; font-family: 'Inter', sans-serif; cursor: pointer; color: var(--text-muted); border-bottom: 3px solid transparent; transition: all 0.2s;">
          🟡 Pending Review (${pendingLoans.length})
        </button>
        <button class="queue-tab-btn" data-queue="awaiting" style="flex: 1; padding: 16px; border: none; background: transparent; font-weight: 600; font-family: 'Inter', sans-serif; cursor: pointer; color: var(--text-muted); border-bottom: 3px solid transparent; transition: all 0.2s;">
          🟢 Awaiting Disbursement (${awaitingLoans.length})
        </button>
        <button class="queue-tab-btn" data-queue="expired" style="flex: 1; padding: 16px; border: none; background: transparent; font-weight: 600; font-family: 'Inter', sans-serif; cursor: pointer; color: var(--text-muted); border-bottom: 3px solid transparent; transition: all 0.2s;">
          🔴 Expired Approvals (${expiredLoans.length})
        </button>
      </div>
    </div>

    <!-- Decision Lists -->
    <div>
      <!-- 1. Pending Review Queue -->
      <div id="pending-queue" style="display: flex; flex-direction: column; gap: 20px;">
        ${pendingLoans.length === 0 ? `
          <div class="card text-center" style="padding: 60px; border-radius: 12px;">
            <p class="text-muted">No pending applications at the moment.</p>
          </div>
        ` : pendingLoans.map(l => {
            const feePaid = !!l.processingFeePaid;
            return `
          <div class="card" style="border-left: 4px solid ${feePaid ? 'var(--success)' : 'var(--warning)'}; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
            <!-- Header Row -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
              <div style="display: flex; gap: 16px; align-items: center;">
                <div style="background: var(--bg-light); padding: 12px; border-radius: 8px; text-align: center; min-width: 90px;">
                  <div class="text-xs text-muted">Applied</div>
                  <div class="font-semibold">KES ${l.amountApplied.toLocaleString()}</div>
                </div>
                <div>
                  <h3 style="font-size: 1.125rem;">${l.loanNo}</h3>
                  <span class="text-sm text-muted">Type: ${l.type.toUpperCase()} | Applied: ${formatDate(l.applicationDate)}</span>
                </div>
              </div>
              <div>
                ${feePaid
                  ? `<span class="badge badge-success" style="padding: 6px 12px;">✓ Fee Cleared</span>`
                  : `<span class="badge badge-warning" style="padding: 6px 12px;">⚠ Fee Pending</span>`
                }
              </div>
            </div>

            <!-- Processing Fee Banner -->
            <div style="
              display: flex; align-items: center; justify-content: space-between;
              padding: 16px 20px;
              border-radius: 10px;
              margin-bottom: 20px;
              background: ${feePaid ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.1)'};
              border: 1px solid ${feePaid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.4)'};
            ">
              <div>
                <div style="font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em; color: ${feePaid ? 'var(--success)' : 'var(--warning)'}; text-transform: uppercase;">Processing Fee</div>
                <div style="font-size: 1.5rem; font-weight: 700; margin-top: 2px;">KES ${l.processingFee.toLocaleString()}</div>
                ${feePaid
                  ? `<div class="text-xs text-muted" style="margin-top: 4px;">Received on ${formatDate(l.processingFeePaidDate)} via ${l.processingFeeDetails?.method || 'System'}</div>`
                  : `<div class="text-xs text-muted" style="margin-top: 4px;">Must be collected before approval is locked</div>`
                }
              </div>
              ${!feePaid ? `
                <button
                  class="btn btn-primary record-fee-btn"
                  data-loan="${l.loanNo}"
                  data-amount="${l.processingFee}"
                  style="display: flex; align-items: center; gap: 8px; white-space: nowrap; background: var(--secondary); border: none;"
                >
                  <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                  Receive Fee Now
                </button>
              ` : ''}
            </div>

            <!-- Details Grid -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; background: var(--bg-light); padding: 16px; border-radius: 8px;">
              <div>
                <div class="text-xs text-muted">Securities</div>
                <div class="text-sm font-semibold">${l.collaterals.length} Items provided</div>
              </div>
              <div>
                <div class="text-xs text-muted">Guarantor</div>
                <div class="text-sm font-semibold">${l.guarantor.name}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Purpose</div>
                <div class="text-sm">${l.purpose}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Total Liability</div>
                <div class="text-sm font-semibold">KES ${l.totalLiability.toLocaleString()}</div>
              </div>
            </div>

            <!-- Action Buttons -->
            <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px;">
              <button class="btn btn-outline btn-sm text-danger" data-action="reject" data-loan="${l.loanNo}">Reject</button>
              <button class="btn btn-outline btn-sm" data-action="partial" data-loan="${l.loanNo}" ${!feePaid ? 'disabled title="Collect processing fee first"' : ''}>Partial Approve</button>
              <button class="btn btn-primary btn-sm" data-action="approve" data-loan="${l.loanNo}" ${!feePaid ? 'disabled title="Collect processing fee first"' : ''} style="background: var(--primary); border: none;">
                ${feePaid ? 'Approve Loan' : '🔒 Approve (Fee Required)'}
              </button>
            </div>
            ${!feePaid ? `<p class="text-xs text-muted" style="text-align: right; margin-top: 8px;">Approval buttons unlock once processing fee is received.</p>` : ''}
          </div>
        `}).join('')}
      </div>

      <!-- 2. Awaiting Disbursement Queue -->
      <div id="awaiting-queue" style="display: none; flex-direction: column; gap: 20px;">
        ${awaitingLoans.length === 0 ? `
          <div class="card text-center" style="padding: 60px; border-radius: 12px;">
            <p class="text-muted">No approved loans awaiting disbursement.</p>
          </div>
        ` : awaitingLoans.map(l => {
            const daysLeft = getDaysRemaining(l.approvedDate);
            const urgent = daysLeft <= 3;
            const deadlineDate = new Date(l.approvedDate);
            deadlineDate.setDate(deadlineDate.getDate() + 14);

            return `
          <div class="card" style="border-left: 4px solid var(--primary); border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
            <!-- Header Row -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
              <div>
                <h3 style="font-size: 1.125rem;">${l.loanNo}</h3>
                <span class="text-sm text-muted">Type: ${l.type.toUpperCase()} | Approved on: ${formatDate(l.approvedDate)}</span>
              </div>
              <div>
                <span class="badge ${urgent ? 'badge-danger' : 'badge-success'}" style="padding: 6px 12px; font-weight: bold;">
                  ${daysLeft > 0 ? `${daysLeft} Days Remaining` : 'Expires Today!'}
                </span>
              </div>
            </div>

            <!-- Details Block -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; background: var(--bg-light); padding: 16px; border-radius: 8px;">
              <div>
                <div class="text-xs text-muted">Approved Amount</div>
                <div class="text-sm font-semibold text-success">KES ${l.approvedAmount.toLocaleString()}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Total Repayment Amount</div>
                <div class="text-sm font-semibold text-primary">KES ${l.totalLiability.toLocaleString()}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Expiry Deadline</div>
                <div class="text-sm font-semibold" style="color: ${urgent ? 'var(--danger)' : 'inherit'};">${formatDate(deadlineDate)}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Approval State</div>
                <div class="text-sm"><span class="badge badge-success" style="font-size: 0.75rem;">${l.status === 'partial_approved' ? 'PARTIALLY APPROVED' : 'APPROVED'}</span></div>
              </div>
            </div>

            <!-- Action buttons -->
            <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px;">
              <button class="btn btn-outline btn-sm text-danger" data-action="cancel" data-loan="${l.loanNo}">Cancel Approval</button>
              <button class="btn btn-primary btn-sm" data-action="disburse" data-loan="${l.loanNo}" style="background: var(--success); border: none;">
                Disburse Funds Now 💸
              </button>
            </div>
          </div>
        `}).join('')}
      </div>

      <!-- 3. Expired Approvals Queue -->
      <div id="expired-queue" style="display: none; flex-direction: column; gap: 20px;">
        ${expiredLoans.length === 0 ? `
          <div class="card text-center" style="padding: 60px; border-radius: 12px;">
            <p class="text-muted">No expired loan approvals found.</p>
          </div>
        ` : expiredLoans.map(l => `
          <div class="card" style="border-left: 4px solid var(--danger); border-radius: 12px; opacity: 0.9; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
              <div>
                <h3 style="font-size: 1.125rem; text-decoration: line-through; color: var(--text-muted);">${l.loanNo}</h3>
                <span class="text-sm text-muted">Approved: ${formatDate(l.approvedDate)} | Expired: ${formatDate(l.expiredDate)}</span>
              </div>
              <div>
                <span class="badge badge-danger" style="padding: 6px 12px; font-weight: bold;">🔴 EXPIRED</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; background: var(--bg-light); padding: 16px; border-radius: 8px;">
              <div>
                <div class="text-xs text-muted">Approved Amount (Unreleased)</div>
                <div class="text-sm font-semibold" style="text-decoration: line-through;">KES ${l.approvedAmount.toLocaleString()}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Reason</div>
                <div class="text-sm text-danger">Disbursement window (14 days) closed.</div>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px;">
              <button class="btn btn-outline btn-sm" data-action="reactivate" data-loan="${l.loanNo}" style="border-color: var(--primary); color: var(--primary);">
                Re-activate Approval 🔄
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Partial Approval Modal -->
    <div id="partial-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 400px; border-radius: 12px;">
        <h3>Partial Approval</h3>
        <p class="text-sm text-muted" style="margin-bottom: 20px;">Enter the reduced approved amount for this loan.</p>
        <div class="form-group">
          <label class="form-label">Approved Amount (KES)</label>
          <input type="number" id="partial-amount" class="form-control" placeholder="e.g. 50000" />
        </div>
        <div class="form-group">
          <label class="form-label">Reason / Remark</label>
          <textarea id="partial-reason" class="form-control" rows="2" placeholder="e.g. Insufficient guarantees"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
          <button class="btn btn-outline" onclick="document.getElementById('partial-modal').style.display = 'none'">Cancel</button>
          <button class="btn btn-primary" id="confirm-partial-btn">Confirm Approval</button>
        </div>
      </div>
    </div>

    <!-- Fee Collection Modal -->
    <div id="queue-fee-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 1000; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px);">
      <div class="card" style="width: 100%; max-width: 450px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); border: none; border-radius: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
          <h3 style="margin: 0; color: var(--primary); font-size: 1.25rem;">Collect Processing Fee</h3>
          <button id="close-queue-fee-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px dashed var(--success); border-radius: 8px; padding: 16px; margin-bottom: 20px; text-align: center;">
          <div class="text-xs text-muted" style="text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-bottom: 4px;">Amount Due</div>
          <div id="queue-fee-amount" style="font-size: 2rem; font-weight: 700; color: var(--success);">KES 0</div>
          <div id="queue-fee-loan" class="text-xs text-muted" style="margin-top: 4px;">Loan: ---</div>
        </div>

        <form id="queue-fee-form">
          <div class="form-group">
            <label class="form-label">Payment Method</label>
            <select id="queue-fee-method" class="form-control" required>
              <option value="mpesa">M-Pesa</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank Transfer</option>
            </select>
          </div>
          
          <div class="form-group" id="queue-fee-ref-group">
            <label class="form-label">Transaction Reference / Receipt No.</label>
            <input type="text" id="queue-fee-ref" class="form-control" placeholder="e.g. QWE123RTY4" required />
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px;">
            <button type="button" class="btn btn-outline" id="cancel-queue-fee-btn">Cancel</button>
            <button type="submit" class="btn btn-primary" style="background: var(--success); border-color: var(--success);">Confirm Payment</button>
          </div>
        </form>
      </div>
    </div>

    <style>
      .queue-tab-btn.active {
        color: var(--primary) !important;
        border-bottom-color: var(--secondary) !important;
        background: rgba(27, 61, 114, 0.03);
      }
      .queue-tab-btn:hover {
        background: rgba(27, 61, 114, 0.01);
      }
    </style>
  `;

  // --- Queue Tab Switching Logic ---
  const queueTabs = container.querySelectorAll('.queue-tab-btn');
  const sections = {
    pending: container.querySelector('#pending-queue'),
    awaiting: container.querySelector('#awaiting-queue'),
    expired: container.querySelector('#expired-queue')
  };

  queueTabs.forEach(tab => {
    tab.onclick = () => {
      queueTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      Object.values(sections).forEach(s => s.style.display = 'none');
      sections[tab.dataset.queue].style.display = 'flex';
    };
  });

  // --- Fee Collection Modal Logic ---
  const feeModal = container.querySelector('#queue-fee-modal');
  const feeForm = container.querySelector('#queue-fee-form');
  const feeAmountText = container.querySelector('#queue-fee-amount');
  const feeLoanText = container.querySelector('#queue-fee-loan');
  const feeMethod = container.querySelector('#queue-fee-method');
  const feeRefGroup = container.querySelector('#queue-fee-ref-group');
  const feeRef = container.querySelector('#queue-fee-ref');
  
  let currentFeeLoan = null;

  feeMethod.onchange = () => {
    if (feeMethod.value === 'cash') {
      feeRefGroup.style.display = 'none';
      feeRef.removeAttribute('required');
    } else {
      feeRefGroup.style.display = 'block';
      feeRef.setAttribute('required', 'true');
    }
  };

  const closeFeeModal = () => {
    feeModal.style.display = 'none';
    currentFeeLoan = null;
    feeForm.reset();
  };

  container.querySelector('#close-queue-fee-modal').onclick = closeFeeModal;
  container.querySelector('#cancel-queue-fee-btn').onclick = closeFeeModal;

  container.querySelectorAll('.record-fee-btn').forEach(btn => {
    btn.onclick = () => {
      currentFeeLoan = btn.dataset.loan;
      const amount = parseFloat(btn.dataset.amount);
      feeAmountText.textContent = `KES ${amount.toLocaleString()}`;
      feeLoanText.textContent = `Loan Reference: ${currentFeeLoan}`;
      feeModal.style.display = 'flex';
    };
  });

  const refreshQueue = async (tabName) => {
    const parent = container.parentNode;
    if (!parent) {
      navigate('#/loans/approve');
      return;
    }
    const newContainer = await renderLoanApprovalQueue();
    parent.replaceChild(newContainer, container);
    if (tabName) {
      const tab = newContainer.querySelector(`[data-queue="${tabName}"]`);
      if (tab) tab.click();
    }
  };

  feeForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!currentFeeLoan) return;

    const loan = await getById('loans', currentFeeLoan);
    loan.processingFeePaid = true;
    loan.processingFeePaidDate = new Date().toISOString();
    loan.processingFeeDetails = {
      method: feeMethod.value,
      reference: feeRef.value
    };

    await put('loans', loan);
    await add('fees_log', {
      loanId: loan.loanNo,
      memberId: loan.memberId || loan.groupId,
      amount: loan.processingFee,
      type: 'processing_fee',
      date: new Date().toISOString(),
      method: feeMethod.value,
      reference: feeRef.value
    });

    closeFeeModal();
    await refreshQueue('pending');
  };

  // --- Action Handlers ---

  const partialModal = container.querySelector('#partial-modal');
  let activePartialLoan = null;

  container.querySelector('#confirm-partial-btn').onclick = async () => {
    const amount = parseFloat(container.querySelector('#partial-amount').value);
    const reason = container.querySelector('#partial-reason').value;
    if (!amount) return;

    const loan = await getById('loans', activePartialLoan);
    loan.status = 'partial_approved';
    loan.approvedAmount = amount;
    loan.approvedDate = new Date().toISOString();
    loan.partialReason = reason;

    const interestRate = (await getById('settings', 'interest_rate_percent'))?.value || 20;
    loan.interestAmount = amount * (interestRate / 100);
    loan.totalLiability = amount + loan.interestAmount;

    await put('loans', loan);

    partialModal.style.display = 'none';
    notify.success('Loan partially approved! Moved to Awaiting Disbursement.');
    await refreshQueue('awaiting');
  };

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;

    const { action, loan: loanNo } = btn.dataset;
    if (!loanNo) return;

    btn.disabled = true;
    const origText = btn.innerHTML;
    btn.innerHTML = 'Processing...';

    try {
      if (action === 'approve') {
        const loan = await getById('loans', loanNo);
        if (!loan.processingFeePaid) {
          notify.error('Please collect the processing fee before approving this loan.');
          return;
        }

        const confirmed = await confirmDialog({
          title: 'Approve Loan Application',
          message: `Are you sure you want to approve this loan (${loanNo}) for the full amount of KES ${loan.amountApplied.toLocaleString()}?`,
          confirmText: 'Approve Loan',
          type: 'success'
        });
        if (!confirmed) return;
        
        loan.status = 'approved';
        loan.approvedAmount = loan.amountApplied;
        loan.approvedDate = new Date().toISOString();
        
        await put('loans', loan);
        notify.success('Loan approved! Moved to Awaiting Disbursement.');
        await refreshQueue('awaiting');
      } 
      else if (action === 'reject') {
        const loan = await getById('loans', loanNo);
        const reason = await promptDialog({
          title: 'Reject Loan Application',
          message: 'Specify the reason for declining this loan application:',
          placeholder: 'e.g. Insufficient guarantees or poor track record...',
          required: true,
          confirmText: 'Reject Application'
        });
        if (reason === null) return;

        loan.status = 'rejected';
        loan.rejectionReason = reason;
        await put('loans', loan);
        notify.success('Loan rejected.');
        navigate('#/loans');
      }
      else if (action === 'partial') {
        activePartialLoan = loanNo;
        partialModal.style.display = 'flex';
      }
      else if (action === 'disburse') {
        const loan = await getById('loans', loanNo);
        const daysLeft = getDaysRemaining(loan.approvedDate);
        if (daysLeft <= -14) {
          notify.error('This loan approval has expired and cannot be disbursed.');
          return;
        }

        const confirmed = await confirmDialog({
          title: 'Disburse Funds',
          message: `Are you sure you want to disburse KES ${loan.approvedAmount.toLocaleString()} to this client now? This will generate the repayment schedule.`,
          confirmText: 'Yes, Disburse 💸',
          type: 'success'
        });
        if (!confirmed) return;
        
        loan.status = 'disbursed';
        loan.disbursementDate = new Date().toISOString();
        
        await generateSchedule(loan);
        await put('loans', loan);
        notify.success('Funds disbursed successfully! Repayment schedule generated.');
        navigate('#/loans');
      }
      else if (action === 'cancel') {
        const confirmed = await confirmDialog({
          title: 'Cancel Approval',
          message: 'Are you sure you want to cancel the approval for this loan? It will return to Pending Review.',
          confirmText: 'Yes, Cancel',
          type: 'warning'
        });
        if (!confirmed) return;

        const loan = await getById('loans', loanNo);
        loan.status = 'pending';
        delete loan.approvedDate;
        delete loan.approvedAmount;
        
        await put('loans', loan);
        notify.success('Approval cancelled. Loan returned to Pending.');
        await refreshQueue('pending');
      }
      else if (action === 'reactivate') {
        const confirmed = await confirmDialog({
          title: 'Re-activate Loan Approval',
          message: 'Re-activate this expired loan back to Pending Review?',
          confirmText: 'Yes, Re-activate',
          type: 'info'
        });
        if (!confirmed) return;

        const loan = await getById('loans', loanNo);
        loan.status = 'pending';
        delete loan.approvedDate;
        delete loan.expiredDate;
        delete loan.approvedAmount;
        
        await put('loans', loan);
        notify.success('Loan re-activated to Pending Review.');
        await refreshQueue('pending');
      }
    } finally {
      if (action !== 'partial') {
        btn.disabled = false;
        btn.innerHTML = origText;
      } else {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  });

  // --- Helper: Generate Repayment Schedule ---
  async function generateSchedule(loan) {
    const installmentAmount = loan.totalLiability / loan.period;
    const startDate = new Date(loan.disbursementDate);
    for (let i = 1; i <= loan.period; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(startDate.getMonth() + i);
      await add('loan_schedule', {
        loanId: loan.loanNo,
        installmentNo: i,
        dueDate: dueDate.toISOString(),
        amount: installmentAmount,
        paid: 0,
        status: 'pending'
      });
    }
  }

  return container;
};
