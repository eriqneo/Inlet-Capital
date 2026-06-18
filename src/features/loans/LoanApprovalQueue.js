import { loanService } from '../../services/loanService.js';
import { settingsService } from '../../services/settingsService.js';
import { navigate } from '../../core/router.js';
import { formatDate } from '../../core/utils.js';
import { pb } from '../../services/api.js'; // We'll use pb to get all loans for the queue
import { renderCardSkeleton, setButtonLoading } from '../../core/uiState.js';
import { getReturnTo, withReturnTo } from '../../core/navigation.js';
import { addMonthsPreservingDay, getRepaymentScheduleAnchorDate } from '../../core/repaymentSchedule.js';

const QUEUE_FILTER = 'status="pending" || status="approved" || status="partial_approved" || status="expired"';

export const renderLoanApprovalQueue = async (params = {}) => {
  const container = document.createElement('div');
  const returnTo = getReturnTo(params, '#/loans');

  // Show loading shell immediately so router never appends an empty element
  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; align-items: center; gap: 16px;">
      <button class="btn btn-outline btn-sm" onclick="window.location.hash = '${returnTo}'">← Back</button>
      <div>
        <h1 class="text-xl">Loan Decision Centre</h1>
        <p class="text-muted">Review pending applications, manage approved disbursement windows, and re-activate expired approvals.</p>
      </div>
    </div>
    <div style="display: grid; gap: 16px;">
      ${renderCardSkeleton({ title: 'Checking approval queue from PocketHost...', rows: 4 })}
      ${renderCardSkeleton({ title: 'Preparing disbursement windows...', rows: 3 })}
    </div>
  `;

  let allLoans;
  try {
    allLoans = await pb.collection('loans').getFullList({ filter: QUEUE_FILTER, expand: 'member,member.group,group' });
  } catch (err) {
    console.error('[LoanApprovalQueue] Failed to fetch loans:', err);
    container.innerHTML = `
      <div style="margin-bottom: 24px; display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash = '${returnTo}'">← Back</button>
        <h1 class="text-xl">Loan Decision Centre</h1>
      </div>
      <div class="card text-center" style="padding: 60px; border-top: 3px solid var(--danger);">
        <p class="text-danger font-semibold">Failed to load approval queue.</p>
        <p class="text-muted text-sm">${err.message || 'Check your connection and try again.'}</p>
        <button class="btn btn-outline" style="margin-top: 16px;" onclick="window.location.reload()">Retry</button>
      </div>
    `;
    return container;
  }

  // — rest of the function continues with allLoans guaranteed —
  const now = new Date();
  let updatedAny = false;

  // Run silent 14-day expiry sweep on load
  for (const loan of allLoans) {
    if (['approved', 'partial_approved'].includes(loan.status) && loan.approved_date) {
      const daysSinceApproval = (now - new Date(loan.approved_date)) / (1000 * 60 * 60 * 24);
      if (daysSinceApproval > 14) {
        loan.status = 'expired';
        loan.expired_date = now.toISOString();
        await loanService.update(loan.id, {
          status: loan.status,
          expired_date: loan.expired_date
        });
        updatedAny = true;
      }
    }
  }

  // Fetch fresh loans if statuses changed
  const freshLoans = updatedAny ? await pb.collection('loans').getFullList({ filter: QUEUE_FILTER, expand: 'member,member.group,group' }) : allLoans;

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
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; align-items: center; gap: 16px;">
      <button class="btn btn-outline btn-sm" onclick="window.location.hash = '${returnTo}'">← Back</button>
      <div>
        <h1 class="text-xl">Loan Decision Centre</h1>
        <p class="text-muted">Review pending applications, manage approved disbursement windows, and re-activate expired approvals.</p>
      </div>
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
            const feePaid = !!l.processing_fee_paid;
            const clientName = l.expand?.member?.full_name || l.expand?.group?.name || 'Unknown Client';
            return `
          <div class="card" style="border-left: 4px solid ${feePaid ? 'var(--success)' : 'var(--warning)'}; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
            <!-- Header Row -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
              <div style="display: flex; gap: 16px; align-items: center;">
                <div style="background: var(--bg-light); padding: 12px; border-radius: 8px; text-align: center; min-width: 90px;">
                  <div class="text-xs text-muted">Applied</div>
                  <div class="font-semibold">KES ${l.amount_applied.toLocaleString()}</div>
                </div>
                <div>
                  <h3 style="font-size: 1.125rem;">${l.loan_no}</h3>
                  <span class="text-sm text-muted">Client: ${clientName} | Type: ${l.type.toUpperCase()} | Applied: ${formatDate(l.application_date)}</span>
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
                <div style="font-size: 1.5rem; font-weight: 700; margin-top: 2px;">KES ${l.processing_fee.toLocaleString()}</div>
                ${feePaid
                  ? `<div class="text-xs text-muted" style="margin-top: 4px;">Received via ${l.processing_fee_details?.method || 'System'}</div>`
                  : `<div class="text-xs text-muted" style="margin-top: 4px;">Must be collected before approval is locked</div>`
                }
              </div>
              ${!feePaid ? `
                <button
                  class="btn btn-primary record-fee-btn"
                  data-id="${l.id}"
                  data-loan="${l.loan_no}"
                  data-amount="${l.processing_fee}"
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
                <div class="text-sm font-semibold">${l.collaterals?.length || 0} Items provided</div>
              </div>
              <div>
                <div class="text-xs text-muted">Guarantor</div>
                <div class="text-sm font-semibold">${l.guarantor?.name || 'None'}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Purpose</div>
                <div class="text-sm">${l.purpose}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Total Liability</div>
                <div class="text-sm font-semibold">KES ${l.total_liability.toLocaleString()}</div>
              </div>
            </div>

            <!-- Action Buttons -->
            <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px;">
              <button class="btn btn-outline btn-sm text-danger" data-action="reject" data-id="${l.id}">Reject</button>
              <button class="btn btn-outline btn-sm" data-action="partial" data-id="${l.id}" ${!feePaid ? 'disabled title="Collect processing fee first"' : ''}>Partial Approve</button>
              <button class="btn btn-primary btn-sm" data-action="approve" data-id="${l.id}" ${!feePaid ? 'disabled title="Collect processing fee first"' : ''} style="background: var(--primary); border: none;">
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
            const daysLeft = getDaysRemaining(l.approved_date);
            const urgent = daysLeft <= 3;
            const deadlineDate = new Date(l.approved_date);
            deadlineDate.setDate(deadlineDate.getDate() + 14);
            const clientName = l.expand?.member?.full_name || l.expand?.group?.name || 'Unknown Client';

            return `
          <div class="card" style="border-left: 4px solid var(--primary); border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
            <!-- Header Row -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
              <div>
                <h3 style="font-size: 1.125rem;">${l.loan_no}</h3>
                <span class="text-sm text-muted">Client: ${clientName} | Type: ${l.type.toUpperCase()} | Approved on: ${formatDate(l.approved_date)}</span>
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
                <div class="text-sm font-semibold text-success">KES ${l.approved_amount.toLocaleString()}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Total Repayment Amount</div>
                <div class="text-sm font-semibold text-primary">KES ${l.total_liability.toLocaleString()}</div>
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
            ${l.approval_comment ? `
              <div style="margin-bottom: 20px; padding: 14px 16px; border-radius: 8px; background: rgba(13, 148, 136, 0.07); border-left: 3px solid #0d9488;">
                <div class="text-xs text-muted" style="margin-bottom: 4px;">Approval Comment</div>
                <div class="text-sm">${escapeHtml(l.approval_comment)}</div>
              </div>
            ` : ''}

            <!-- Action buttons -->
            <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px;">
              <button class="btn btn-outline btn-sm text-danger" data-action="cancel" data-id="${l.id}">Cancel Approval</button>
              <button class="btn btn-primary btn-sm" data-action="disburse" data-id="${l.id}" style="background: var(--success); border: none;">
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
                <h3 style="font-size: 1.125rem; text-decoration: line-through; color: var(--text-muted);">${l.loan_no}</h3>
                <span class="text-sm text-muted">Approved: ${formatDate(l.approved_date)} | Expired: ${formatDate(l.expired_date)}</span>
              </div>
              <div>
                <span class="badge badge-danger" style="padding: 6px 12px; font-weight: bold;">🔴 EXPIRED</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; background: var(--bg-light); padding: 16px; border-radius: 8px;">
              <div>
                <div class="text-xs text-muted">Approved Amount (Unreleased)</div>
                <div class="text-sm font-semibold" style="text-decoration: line-through;">KES ${l.approved_amount.toLocaleString()}</div>
              </div>
              <div>
                <div class="text-xs text-muted">Reason</div>
                <div class="text-sm text-danger">Disbursement window (14 days) closed.</div>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--border-color); padding-top: 16px;">
              <button class="btn btn-outline btn-sm" data-action="reactivate" data-id="${l.id}" style="border-color: var(--primary); color: var(--primary);">
                Re-activate Approval 🔄
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Full Approval Modal -->
    <div id="full-approval-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 440px; border-radius: 12px;">
        <h3>Approve Full Loan</h3>
        <p class="text-sm text-muted" id="full-approval-context" style="margin-bottom: 20px;">Confirm the full approved amount and add a decision comment.</p>
        <div class="form-group">
          <label class="form-label">Approval Comment</label>
          <textarea id="full-approval-comment" class="form-control" rows="3" placeholder="e.g. Client meets all approval requirements and fee is cleared."></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
          <button class="btn btn-outline" id="cancel-full-approval-btn">Cancel</button>
          <button class="btn btn-primary" id="confirm-full-approval-btn">Confirm Full Approval</button>
        </div>
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
            <label class="form-label" id="queue-fee-ref-label">M-Pesa Transaction Code</label>
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
  const feeRefLabel = container.querySelector('#queue-fee-ref-label');
  const feeRef = container.querySelector('#queue-fee-ref');
  
  let currentFeeLoanId = null;

  feeMethod.onchange = () => {
    const val = feeMethod.value;
    if (val === 'cash') {
      feeRefGroup.style.display = 'none';
      feeRef.removeAttribute('required');
      feeRef.value = '';
    } else if (val === 'bank') {
      feeRefGroup.style.display = 'block';
      feeRefLabel.textContent = 'Bank Transfer / Cheque Reference';
      feeRef.placeholder = 'e.g. CHQ-987654';
      feeRef.setAttribute('required', 'true');
    } else { // mpesa
      feeRefGroup.style.display = 'block';
      feeRefLabel.textContent = 'M-Pesa Transaction Code';
      feeRef.placeholder = 'e.g. QWE123RTY4';
      feeRef.setAttribute('required', 'true');
    }
  };

  const closeFeeModal = () => {
    feeModal.style.display = 'none';
    currentFeeLoanId = null;
    feeForm.reset();
  };

  container.querySelector('#close-queue-fee-modal').onclick = closeFeeModal;
  container.querySelector('#cancel-queue-fee-btn').onclick = closeFeeModal;

  container.querySelectorAll('.record-fee-btn').forEach(btn => {
    btn.onclick = () => {
      currentFeeLoanId = btn.dataset.id;
      const amount = parseFloat(btn.dataset.amount);
      feeAmountText.textContent = `KES ${amount.toLocaleString()}`;
      feeLoanText.textContent = `Loan Reference: ${btn.dataset.loan}`;
      feeModal.style.display = 'flex';
    };
  });

  const refreshQueue = async (tabName) => {
    const parent = container.parentNode;
    if (!parent) {
      navigate(withReturnTo('#/loans/approve', returnTo));
      return;
    }
    const newContainer = await renderLoanApprovalQueue({ returnTo });
    parent.replaceChild(newContainer, container);
    if (tabName) {
      const tab = newContainer.querySelector(`[data-queue="${tabName}"]`);
      if (tab) tab.click();
    }
  };

  feeForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!currentFeeLoanId) return;
    const restoreButton = setButtonLoading(feeForm.querySelector('button[type="submit"]'), 'Recording...');

    try {
      const capturedAt = new Date().toISOString();
      await loanService.update(currentFeeLoanId, {
        processing_fee_paid: true,
        processing_fee_details: {
          method: feeMethod.value,
          reference: feeRef.value,
          date: capturedAt,
          captured_at: capturedAt
        }
      });

      // Processing fee payment is now stored entirely in the loan object.
      // We removed the legacy fees_log collection requirement.

      closeFeeModal();
      await refreshQueue('pending');
    } catch (err) {
      console.error(err);
      if (window.notify) window.notify.error('Failed to save fee: ' + err.message);
      restoreButton();
    }
  };

  // --- Action Handlers ---

  const fullApprovalModal = container.querySelector('#full-approval-modal');
  const fullApprovalContext = container.querySelector('#full-approval-context');
  const fullApprovalComment = container.querySelector('#full-approval-comment');
  const confirmFullApprovalBtn = container.querySelector('#confirm-full-approval-btn');
  let activeFullApprovalLoanId = null;

  const closeFullApprovalModal = () => {
    fullApprovalModal.style.display = 'none';
    activeFullApprovalLoanId = null;
    fullApprovalComment.value = '';
  };
  container.querySelector('#cancel-full-approval-btn').onclick = closeFullApprovalModal;

  confirmFullApprovalBtn.onclick = async () => {
    if (!activeFullApprovalLoanId) return;
    const restoreButton = setButtonLoading(confirmFullApprovalBtn, 'Approving...');
    try {
      const loan = await loanService.getById(activeFullApprovalLoanId);
      if (!loan.processing_fee_paid) {
        if (window.notify) window.notify.error('Please collect the processing fee before approving this loan.');
        restoreButton();
        return;
      }

      await loanService.update(activeFullApprovalLoanId, {
        status: 'approved',
        approved_amount: loan.amount_applied,
        approved_date: new Date().toISOString(),
        approval_comment: fullApprovalComment.value.trim()
      });

      closeFullApprovalModal();
      if (window.notify) window.notify.success('Loan approved! Moved to Awaiting Disbursement.');
      await refreshQueue('awaiting');
    } catch (err) {
      if (window.notify) window.notify.error('Loan approval failed: ' + err.message);
      restoreButton();
    }
  };

  const partialModal = container.querySelector('#partial-modal');
  let activePartialLoanId = null;

  container.querySelector('#confirm-partial-btn').onclick = async () => {
    const btn = container.querySelector('#confirm-partial-btn');
    const amount = parseFloat(container.querySelector('#partial-amount').value);
    const reason = container.querySelector('#partial-reason').value;
    if (!amount) return;
    const restoreButton = setButtonLoading(btn, 'Approving...');

    try {
      const loan = await loanService.getById(activePartialLoanId);
      const interestRate = await settingsService.getNumber('interest_rate_percent', 20);
      const interestAmount = amount * (interestRate / 100);

      await loanService.update(activePartialLoanId, {
        status: 'partial_approved',
        approved_amount: amount,
        approved_date: new Date().toISOString(),
        interest_amount: interestAmount,
        total_liability: amount + interestAmount,
        approval_comment: reason.trim()
      });

      partialModal.style.display = 'none';
      if (window.notify) window.notify.success('Loan partially approved! Moved to Awaiting Disbursement.');
      await refreshQueue('awaiting');
    } catch (err) {
      if (window.notify) window.notify.error('Partial approval failed: ' + err.message);
      restoreButton();
    }
  };

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;

    const { action, id } = btn.dataset;
    if (!id) return;

    const restoreButton = setButtonLoading(btn, action === 'disburse' ? 'Disbursing...' : 'Processing...');

    try {
      if (action === 'approve') {
        const loan = await loanService.getById(id);
        if (!loan.processing_fee_paid) {
          if (window.notify) window.notify.error('Please collect the processing fee before approving this loan.');
          return;
        }
        activeFullApprovalLoanId = id;
        fullApprovalContext.textContent = `Approve ${loan.loan_no} for the full amount of KES ${loan.amount_applied.toLocaleString()}.`;
        fullApprovalComment.value = loan.approval_comment || '';
        fullApprovalModal.style.display = 'flex';
      } 
      else if (action === 'reject') {
        const loan = await loanService.getById(id);
        const reason = window.promptDialog ? await window.promptDialog({
          title: 'Reject Loan Application',
          message: 'Specify the reason for declining this loan application:',
          placeholder: 'e.g. Insufficient guarantees or poor track record...',
          required: true,
          confirmText: 'Reject Application'
        }) : prompt('Reason for rejection:');
        
        if (reason === null) return;

        await loanService.update(id, {
          status: 'rejected'
        });
        
        if (window.notify) window.notify.success('Loan rejected.');
        navigate('#/loans');
      }
      else if (action === 'partial') {
        activePartialLoanId = id;
        partialModal.style.display = 'flex';
      }
      else if (action === 'disburse') {
        const loan = await loanService.getById(id);
        const daysLeft = getDaysRemaining(loan.approved_date);
        if (daysLeft <= -14) {
          if (window.notify) window.notify.error('This loan approval has expired and cannot be disbursed.');
          return;
        }

        const confirmed = window.confirmDialog ? await window.confirmDialog({
          title: 'Disburse Funds',
          message: `Are you sure you want to disburse KES ${loan.approved_amount.toLocaleString()} to this client now? This will generate the repayment schedule.`,
          confirmText: 'Yes, Disburse 💸',
          type: 'success'
        }) : confirm(`Disburse KES ${loan.approved_amount.toLocaleString()}?`);
        
        if (!confirmed) return;
        
        const updatedLoan = await loanService.update(id, {
          status: 'disbursed',
          disbursement_date: new Date().toISOString()
        });
        
        await generateSchedule(updatedLoan);
        if (window.notify) window.notify.success('Funds disbursed successfully! Repayment schedule generated.');
        navigate('#/loans');
      }
      else if (action === 'cancel') {
        const confirmed = window.confirmDialog ? await window.confirmDialog({
          title: 'Cancel Approval',
          message: 'Are you sure you want to cancel the approval for this loan? It will return to Pending Review.',
          confirmText: 'Yes, Cancel',
          type: 'warning'
        }) : confirm('Cancel approval?');
        if (!confirmed) return;

        await loanService.update(id, {
          status: 'pending',
          approved_date: null,
          approved_amount: 0
        });
        
        if (window.notify) window.notify.success('Approval cancelled. Loan returned to Pending.');
        await refreshQueue('pending');
      }
      else if (action === 'reactivate') {
        const confirmed = window.confirmDialog ? await window.confirmDialog({
          title: 'Re-activate Loan Approval',
          message: 'Re-activate this expired loan back to Pending Review?',
          confirmText: 'Yes, Re-activate',
          type: 'info'
        }) : confirm('Reactivate loan?');
        if (!confirmed) return;

        await loanService.update(id, {
          status: 'pending',
          approved_date: null,
          expired_date: null,
          approved_amount: 0
        });
        
        if (window.notify) window.notify.success('Loan re-activated to Pending Review.');
        await refreshQueue('pending');
      }
    } catch (err) {
      console.error(err);
      if (window.notify) window.notify.error('Operation failed: ' + err.message);
    } finally {
      if (action !== 'partial') {
        restoreButton();
      } else {
        restoreButton();
      }
    }
  });

  // --- Helper: Generate Repayment Schedule ---
  async function generateSchedule(loan) {
    const installmentAmount = loan.total_liability / loan.period;
    const startDate = getRepaymentScheduleAnchorDate(loan);
    for (let i = 1; i <= loan.period; i++) {
      const dueDate = addMonthsPreservingDay(startDate, i);
      await loanService.createScheduleInstallment({
        loan: loan.id,
        installment_no: i,
        due_date: dueDate.toISOString(),
        amount: installmentAmount,
        paid: 0,
        status: 'pending',
        penalty_waived: false
      });
    }
  }

  return container;
};
