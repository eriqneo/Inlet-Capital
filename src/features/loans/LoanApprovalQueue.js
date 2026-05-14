import { getAll, getById, put, add } from '../../core/db.js';
import { navigate } from '../../core/router.js';

export const renderLoanApprovalQueue = async () => {
  const container = document.createElement('div');
  const allLoans = await getAll('loans');
  const pendingLoans = allLoans.filter(l => l.status === 'pending');

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 class="text-xl">Loan Approval Queue</h1>
      <p class="text-muted">Review and process pending loan applications.</p>
    </div>

    <div style="display: flex; flex-direction: column; gap: 20px;">
      ${pendingLoans.length === 0 ? `
        <div class="card text-center" style="padding: 60px;">
          <p class="text-muted">No pending applications at the moment.</p>
        </div>
      ` : pendingLoans.map(l => {
          const feePaid = !!l.processingFeePaid;
          return `
        <div class="card" style="border-left: 4px solid ${feePaid ? 'var(--success)' : 'var(--warning)'};">

          <!-- Header Row -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
            <div style="display: flex; gap: 16px; align-items: center;">
              <div style="background: var(--bg-light); padding: 12px; border-radius: 8px; text-align: center; min-width: 80px;">
                <div class="text-xs text-muted">Applied</div>
                <div class="font-semibold">KES ${l.amountApplied.toLocaleString()}</div>
              </div>
              <div>
                <h3 style="font-size: 1.125rem;">${l.loanNo}</h3>
                <span class="text-sm text-muted">Type: ${l.type.toUpperCase()} | Applied: ${new Date(l.applicationDate).toLocaleDateString()}</span>
              </div>
            </div>
            <div style="text-align: right;">
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
                ? `<div class="text-xs text-muted" style="margin-top: 4px;">Received on ${new Date(l.processingFeePaidDate).toLocaleDateString()} via ${l.processingFeeDetails?.method || 'System'}</div>`
                : `<div class="text-xs text-muted" style="margin-top: 4px;">Must be collected before disbursement</div>`
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

          <!-- Action Footer -->
          <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <button class="btn btn-outline btn-sm text-danger" onclick="window.rejectLoan('${l.loanNo}')">Reject</button>
            <button class="btn btn-outline btn-sm" onclick="window.partialApproveLoan('${l.loanNo}')" ${!feePaid ? 'disabled title="Collect processing fee first"' : ''}>Partial Approve</button>
            <button class="btn btn-primary btn-sm" onclick="window.approveLoan('${l.loanNo}')" ${!feePaid ? 'disabled title="Collect processing fee first"' : ''}>
              ${feePaid ? 'Approve & Disburse' : '🔒 Approve (Fee Required)'}
            </button>
          </div>

          ${!feePaid ? `<p class="text-xs text-muted" style="text-align: right; margin-top: 8px;">Approval buttons unlock once processing fee is received.</p>` : ''}
        </div>
      `}).join('')}
    </div>

    <!-- Partial Approval Modal -->
    <div id="partial-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 400px;">
        <h3>Partial Approval</h3>
        <p class="text-sm text-muted" style="margin-bottom: 20px;">Enter the reduced amount for this loan.</p>
        <div class="form-group">
          <label class="form-label">Approved Amount (KES)</label>
          <input type="number" id="partial-amount" class="form-control" />
        </div>
        <div class="form-group">
          <label class="form-label">Reason / Remark</label>
          <textarea id="partial-reason" class="form-control" rows="2"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
          <button class="btn btn-outline" onclick="document.getElementById('partial-modal').style.display = 'none'">Cancel</button>
          <button class="btn btn-primary" id="confirm-partial-btn">Confirm Approval</button>
        </div>
      </div>
    </div>

    <!-- Fee Collection Modal -->
    <div id="queue-fee-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 1000; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px);">
      <div class="card" style="width: 100%; max-width: 450px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); border: none;">
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
  `;

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
    navigate('#/loans/approve'); // Refresh the queue
  };

  // --- Approve full ---
  window.approveLoan = async (loanNo) => {
    const loan = await getById('loans', loanNo);
    if (!loan.processingFeePaid) {
      notify.error('Please collect the processing fee before approving this loan.');
      return;
    }
    if (!confirm('Approve this loan for the full amount and disburse?')) return;
    loan.status = 'approved';
    loan.approvedAmount = loan.amountApplied;
    loan.disbursementDate = new Date().toISOString();
    await generateSchedule(loan);
    await put('loans', loan);
    notify.success('Loan approved and disbursed!');
    navigate('#/loans');
  };

  // --- Reject ---
  window.rejectLoan = async (loanNo) => {
    const reason = prompt('Reason for rejection:');
    if (reason === null) return;
    const loan = await getById('loans', loanNo);
    loan.status = 'rejected';
    loan.rejectionReason = reason;
    await put('loans', loan);
    notify.success('Loan rejected.');
    navigate('#/loans');
  };

  // --- Partial approve ---
  const partialModal = container.querySelector('#partial-modal');
  let activePartialLoan = null;

  window.partialApproveLoan = (loanNo) => {
    activePartialLoan = loanNo;
    partialModal.style.display = 'flex';
  };

  container.querySelector('#confirm-partial-btn').onclick = async () => {
    const amount = parseFloat(container.querySelector('#partial-amount').value);
    const reason = container.querySelector('#partial-reason').value;
    if (!amount) return;

    const loan = await getById('loans', activePartialLoan);
    loan.status = 'approved';
    loan.approvedAmount = amount;
    loan.disbursementDate = new Date().toISOString();
    loan.partialReason = reason;

    const interestRate = (await getById('settings', 'interest_rate_percent'))?.value || 20;
    loan.interestAmount = amount * (interestRate / 100);
    loan.totalLiability = amount + loan.interestAmount;

    await generateSchedule(loan);
    await put('loans', loan);

    partialModal.style.display = 'none';
    notify.success('Loan partially approved and disbursed!');
    navigate('#/loans');
  };

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
