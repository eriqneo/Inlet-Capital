import { loanService } from '../../services/loanService.js';
import { authService } from '../../services/authService.js';
import { settingsService } from '../../services/settingsService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';
import { renderCardSkeleton, setButtonLoading } from '../../core/uiState.js';
import { getScheduleRemaining, isScheduleInArrears } from '../../core/loanScheduleMetrics.js';
import { getReturnTo } from '../../core/navigation.js';
import { addMonthsPreservingDay, getRepaymentScheduleAnchorDate } from '../../core/repaymentSchedule.js';

export const renderLoanDetails = async (params) => {
  const { id: loanNo } = params;
  const returnTo = getReturnTo(params, '#/loans');
  const todayInputValue = new Date().toISOString().split('T')[0];
  const dateInputToIso = (value) => new Date(`${value || todayInputValue}T12:00:00`).toISOString();
  const container = document.createElement('div');
  container.innerHTML = `
    ${renderCardSkeleton({ title: 'Loading loan file from PocketHost...', rows: 5 })}
    <div style="height: 16px;"></div>
    ${renderCardSkeleton({ title: 'Preparing repayments and schedule...', rows: 4 })}
  `;
  
  (async () => {
  let loan;
  try {
    loan = await loanService.getByLoanNo(loanNo);
  } catch (err) {
    console.error("Loan not found:", err);
  }

  if (!loan) {
    container.innerHTML = `<div class="card text-center"><h2>Loan Not Found</h2><button class="btn btn-primary" onclick="window.location.hash = '${returnTo}'">Back</button></div>`;
    return;
  }

  // Fetch related data — fall back to empty arrays on error (new collections may have auth issues)
  let schedule = [], repayments = [];
  try {
    [schedule, repayments] = await Promise.all([
      loanService.getScheduleForLoan(loan.id),
      loanService.getRepaymentsForLoan(loan.id)
    ]);
  } catch (err) {
    console.warn('[LoanDetails] Could not load schedule/repayments:', err.message);
  }

  // PocketBase Settings
  const settings = {
    penalty_amount: await settingsService.getNumber('penalty_amount', 500),
    penalty_grace_weeks: await settingsService.getNumber('penalty_grace_weeks', 4)
  };

  const clientName = loan.expand?.member?.full_name || loan.expand?.group?.name || 'Unknown Client';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
  const guarantor = loan.guarantor || {};
  const guarantorName = guarantor.name || guarantor.full_name || '-';
  const guarantorPhone = guarantor.phone || guarantor.phone_number || guarantor.guarantorPhone || '-';
  const guarantorId = guarantor.id_number || guarantor.idNo || guarantor.id_no || guarantor.national_id || '-';
  const guarantorRelationship = guarantor.relationship || guarantor.relation || '-';
  const guarantorPhoto = String(guarantor.photo || '').startsWith('data:image/')
    ? guarantor.photo
    : '';

  // Calculate Financials
  const getLoanLiability = (loanRecord) => {
    const storedLiability = Number(loanRecord.total_liability) || 0;
    if (storedLiability > 0) return storedLiability;
    const principal = Number(loanRecord.approved_amount || loanRecord.amount_applied) || 0;
    const interest = Number(loanRecord.interest_amount) || 0;
    return principal + interest;
  };
  const totalLiability = getLoanLiability(loan);
  const totalPaid = repayments.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const outstandingBalance = Math.max(0, totalLiability - totalPaid);
  const percentRepaid = totalLiability > 0
    ? Math.min(100, (totalPaid / totalLiability) * 100)
    : (['completed', 'closed'].includes(loan.status) ? 100 : 0);

  let historyPage = 1;
  let schedulePage = 1;
  const pageSize = 10;

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash = '${returnTo}'">← Back</button>
        <div>
          <h1 class="text-xl">Loan Management: ${loan.loan_no}</h1>
          <div class="text-sm text-muted" style="margin-top: 4px;">Client: <span class="font-semibold" style="color: var(--primary);">${clientName}</span></div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span class="badge ${
          loan.status === 'disbursed' ? 'badge-success' :
          loan.status === 'completed' ? 'badge-success' :
          loan.status === 'rejected' ? 'badge-danger' :
          loan.status === 'expired' ? 'badge-danger' :
          (loan.status === 'approved' || loan.status === 'partial_approved') ? 'badge-primary' :
          'badge-warning'
        }" style="${
          loan.status === 'approved' || loan.status === 'partial_approved' ? 'background: #0d9488; color: white;' : ''
        }">
          ${loan.status === 'disbursed' ? 'DISBURSED' :
            loan.status === 'approved' ? 'APPROVED' :
            loan.status === 'partial_approved' ? 'PARTIAL APPROVED' :
            loan.status.toUpperCase()}
        </span>
      </div>
    </div>

    ${loan.status === 'rejected' && loan.rejectionReason ? `
    <div style="margin-bottom: 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(239,68,68,0.02) 100%); border: 1px solid rgba(239,68,68,0.25); overflow: hidden;">
      <div style="display: flex; align-items: stretch;">
        <div style="background: linear-gradient(180deg, #ef4444, #b91c1c); padding: 24px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 80px; gap: 8px;">
          <div style="font-size: 1.75rem;">🚫</div>
          <div style="color: white; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; text-align: center; line-height: 1.3;">Loan<br>Rejected</div>
        </div>
        <div style="padding: 20px 24px; flex: 1;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <div style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%;"></div>
            <div style="font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #ef4444;">Decision Verdict — Application Declined</div>
          </div>
          <div style="background: white; border-left: 3px solid #ef4444; border-radius: 0 8px 8px 0; padding: 14px 16px; font-size: 0.95rem; color: var(--text-main); font-style: italic; line-height: 1.6; box-shadow: 0 2px 8px rgba(239,68,68,0.08);">
            "${loan.rejectionReason}"
          </div>
          <div style="margin-top: 12px; display: flex; gap: 20px; flex-wrap: wrap;">
            <div style="font-size: 0.8rem; color: var(--text-muted);">📋 Applied Amount: <span class="font-semibold">KES ${loan.amount_applied.toLocaleString()}</span></div>
            <div style="font-size: 0.8rem; color: #ef4444;">❌ Approved Amount: <span class="font-semibold">Nil</span></div>
          </div>
        </div>
      </div>
    </div>` : ''}

    ${(loan.approved_amount && loan.approved_amount < loan.amount_applied) && loan.status !== 'rejected' ? `
    <div style="margin-bottom: 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(245,158,11,0.02) 100%); border: 1px solid rgba(245,158,11,0.3); overflow: hidden;">
      <div style="display: flex; align-items: stretch;">
        <div style="background: linear-gradient(180deg, #f59e0b, #d97706); padding: 24px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 80px; gap: 8px;">
          <div style="font-size: 1.75rem;">⚖️</div>
          <div style="color: white; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; text-align: center; line-height: 1.3;">Partial<br>Approval</div>
        </div>
        <div style="padding: 20px 24px; flex: 1;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <div style="width: 8px; height: 8px; background: #f59e0b; border-radius: 50%;"></div>
            <div style="font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #d97706;">Decision Verdict — Partially Approved</div>
          </div>
          <div style="margin-bottom: 14px; background: white; border-radius: 8px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(245,158,11,0.08);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.8rem;">
              <span style="color: var(--text-muted);">Applied: <b>KES ${loan.amount_applied.toLocaleString()}</b></span>
              <span style="color: #d97706;">Approved: <b>KES ${(loan.approved_amount || 0).toLocaleString()}</b></span>
            </div>
            <div style="height: 10px; background: #fef3c7; border-radius: 5px; overflow: hidden;">
              <div style="height: 100%; width: ${Math.round(((loan.approved_amount || 0) / loan.amount_applied) * 100)}%; background: linear-gradient(90deg, #f59e0b, #d97706); border-radius: 5px;"></div>
            </div>
            <div style="margin-top: 6px; font-size: 0.75rem; color: #d97706; text-align: right; font-weight: 600;">
              KES ${(loan.amount_applied - (loan.approved_amount || 0)).toLocaleString()} reduced (${Math.round(((loan.amount_applied - (loan.approved_amount || 0)) / loan.amount_applied) * 100)}% cut)
            </div>
          </div>
          ${loan.approval_comment ? `
            <div style="background: white; border-left: 3px solid #f59e0b; border-radius: 0 8px 8px 0; padding: 12px 14px; font-size: 0.9rem; color: var(--text-main); line-height: 1.5; box-shadow: 0 2px 8px rgba(245,158,11,0.08);">
              <div style="font-size: 0.72rem; font-weight: 700; color: #d97706; text-transform: uppercase; margin-bottom: 4px;">Approval Comment</div>
              ${escapeHtml(loan.approval_comment)}
            </div>
          ` : ''}
        </div>
      </div>
    </div>` : ''}

    ${loan.approval_comment && loan.approved_amount >= loan.amount_applied && loan.status !== 'rejected' ? `
    <div style="margin-bottom: 24px; border-radius: 12px; background: rgba(13, 148, 136, 0.07); border: 1px solid rgba(13, 148, 136, 0.24); padding: 18px 20px;">
      <div style="font-size: 0.72rem; font-weight: 700; color: #0d9488; text-transform: uppercase; margin-bottom: 6px;">Approval Comment</div>
      <div style="font-size: 0.95rem; line-height: 1.6;">${escapeHtml(loan.approval_comment)}</div>
    </div>
    ` : ''}


    <!-- Main Content Tabs -->
    <div class="card" style="padding: 0; margin-bottom: 24px;">
      <div style="display: flex; border-bottom: 1px solid var(--border-color);">
        <button class="tab-btn active" data-tab="overview">📊 Overview</button>
        <button class="tab-btn" data-tab="history">📋 Repayment History</button>
        <button class="tab-btn" data-tab="record">💳 Record Payment</button>
        <button class="tab-btn" data-tab="schedule">🗓 Schedule</button>
      </div>

      <div id="tab-content" style="padding: 24px;">
        <div id="overview-tab">
          ${['approved', 'partial_approved'].includes(loan.status) ? `
          <div style="background: rgba(13, 148, 136, 0.08); border: 1px solid rgba(13, 148, 136, 0.3); border-radius: 12px; padding: 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px;">
            <div>
              <h3 style="margin: 0; color: #0d9488; font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
                🟢 Approved & Awaiting Disbursement
              </h3>
              <p class="text-sm text-muted" style="margin: 8px 0 0 0; line-height: 1.5;">
                This loan has been successfully approved for <strong>KES ${loan.approved_amount?.toLocaleString() || loan.amount_applied.toLocaleString()}</strong>.<br>
                The physical funds are pending release to the applicant.
              </p>
              <div style="margin-top: 12px; font-size: 0.8rem; font-weight: 600; color: #b91c1c;">
                ⏰ Expiry: Approved on ${formatDate(loan.approved_date)} — Must be disbursed within 14 days.
              </div>
            </div>
            <div style="display: grid; gap: 10px; min-width: 220px;">
              <div class="form-group" style="margin: 0;">
                <label class="form-label" style="font-size: 0.72rem;">Disbursement Date</label>
                <input type="date" class="form-control form-control-sm" id="details-disbursement-date" value="${todayInputValue}" />
              </div>
              <button class="btn btn-primary" id="details-disburse-btn" style="background: var(--success); border: none; padding: 12px 24px; font-weight: bold; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(16,185,129,0.2);">
                Disburse Funds Now 💸
              </button>
            </div>
          </div>
          ` : ''}

          ${loan.status === 'expired' ? `
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <h3 style="margin: 0; color: var(--danger); font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
              🔴 Approved Loan Expired
            </h3>
            <p class="text-sm text-muted" style="margin: 8px 0 0 0; line-height: 1.5;">
              This loan approval has expired because the 14-day disbursement window closed without releasing the funds.<br>
              Approved on: <strong>${formatDate(loan.approved_date)}</strong> | Expired on: <strong>${formatDate(loan.expired_date)}</strong>.
            </p>
            <div style="margin-top: 16px;">
              <button class="btn btn-outline" id="details-reactivate-btn" style="border-color: var(--primary); color: var(--primary);">
                Re-activate Approval 🔄
              </button>
            </div>
          </div>
          ` : ''}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
            <div>
              <div class="text-sm text-muted" style="margin-bottom: 8px;">Outstanding Balance</div>
              <div style="font-size: 2.5rem; font-weight: 700; color: ${outstandingBalance > 0 ? 'var(--danger)' : 'var(--success)'};">
                KES ${outstandingBalance.toLocaleString()}
              </div>
              <div style="margin-top: 20px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 6px;">
                  <span>Current Loan Progress</span>
                  <span class="font-semibold">${percentRepaid.toFixed(1)}%</span>
                </div>
                <div style="width: 100%; height: 8px; background: var(--bg-light); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${Math.max(0, Math.min(100, percentRepaid))}%; height: 100%; background: var(--success); transition: width 0.3s ease;"></div>
                </div>
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Total Liability</div>
                <div class="font-semibold">KES ${totalLiability.toLocaleString()}</div>
              </div>
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Total Repaid</div>
                <div class="font-semibold text-success">KES ${totalPaid.toLocaleString()}</div>
              </div>
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Period</div>
                <div class="font-semibold">${loan.period} Months</div>
              </div>
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Application Date</div>
                <div class="font-semibold">${formatDate(loan.application_date)}</div>
              </div>
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Approval Date</div>
                <div class="font-semibold">${loan.approved_date ? formatDate(loan.approved_date) : 'Pending approval'}</div>
              </div>
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Disbursement Date</div>
                <div class="font-semibold">${loan.disbursement_date ? formatDate(loan.disbursement_date) : 'Pending release'}</div>
              </div>
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Applicant Reference</div>
                <div class="font-semibold">${loan.member || loan.group || 'N/A'}</div>
              </div>
            </div>
          </div>

          <div style="margin-top: 24px; border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden;">
            <div style="padding: 14px 18px; background: var(--bg-light); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; gap: 12px;">
              <div>
                <div class="text-xs text-muted" style="font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">Guarantor Details</div>
                <div class="text-sm text-muted">Security contact attached to this loan file</div>
              </div>
              <span class="badge badge-outline" style="font-size: 0.65rem;">GUARANTOR</span>
            </div>
            <div style="padding: 18px; display: grid; grid-template-columns: auto 1fr; gap: 18px; align-items: center;">
              <div style="width: 72px; height: 72px; border-radius: 50%; background: var(--bg-light); border: 1px solid var(--border-color); overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);">
                ${guarantorPhoto
                  ? `<img src="${guarantorPhoto}" alt="Guarantor photo" style="width: 100%; height: 100%; object-fit: cover;" />`
                  : '<span style="font-size: 1.6rem;">👤</span>'}
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px;">
                <div>
                  <div class="text-xs text-muted">Name</div>
                  <div class="font-semibold">${escapeHtml(guarantorName)}</div>
                </div>
                <div>
                  <div class="text-xs text-muted">Phone Number</div>
                  <div class="font-semibold">${escapeHtml(guarantorPhone)}</div>
                </div>
                <div>
                  <div class="text-xs text-muted">ID Number</div>
                  <div class="font-semibold">${escapeHtml(guarantorId)}</div>
                </div>
                <div>
                  <div class="text-xs text-muted">Relationship</div>
                  <div class="font-semibold">${escapeHtml(guarantorRelationship)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div id="history-tab" style="display: none;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ref / Method</th>
                  <th>Recorded By</th>
                  <th class="text-right">Amount</th>
                </tr>
              </thead>
              <tbody id="repayment-history-body"></tbody>
            </table>
          </div>
          <div id="repayment-history-pagination"></div>
        </div>

        <div id="record-tab" style="display: none;">
          <form id="payment-form" style="max-width: 500px;">
            <div class="form-group">
              <label class="form-label">Payment Amount (KES)</label>
              <input type="number" name="amount" class="form-control" required min="1" max="${outstandingBalance}" value="${outstandingBalance > 0 ? outstandingBalance : ''}" />
              <p class="text-xs text-muted" style="margin-top: 4px;">Max payable: KES ${outstandingBalance.toLocaleString()}</p>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label class="form-label">Method</label>
                <select name="method" id="repayment-method" class="form-control">
                  <option value="mpesa">M-Pesa</option>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Date</label>
                <input type="date" name="date" class="form-control" value="${new Date().toISOString().split('T')[0]}" required />
              </div>
            </div>
            <div class="form-group" id="repayment-ref-group">
              <label class="form-label" id="repayment-ref-label">M-Pesa Transaction Code</label>
              <input type="text" name="reference" id="repayment-ref-input" class="form-control" required placeholder="e.g. QWE123RTY4" />
            </div>
            <div class="form-group">
              <label class="form-label">Notes (Optional)</label>
              <textarea name="note" class="form-control" rows="2"></textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-lg" style="width: 100%; margin-top: 16px;" ${outstandingBalance === 0 ? 'disabled' : ''}>
              Confirm Repayment
            </button>
          </form>
        </div>

        <div id="schedule-tab" style="display: none;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Due Date</th>
                  <th class="text-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="loan-schedule-body"></tbody>
            </table>
          </div>
          <div id="loan-schedule-pagination"></div>
        </div>
      </div>
    </div>

    <style>
      .tab-btn {
        flex: 1;
        padding: 16px;
        background: transparent;
        border: none;
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        cursor: pointer;
        color: var(--text-muted);
        border-bottom: 2px solid transparent;
      }
      .tab-btn.active {
        color: var(--primary);
        border-bottom-color: var(--secondary);
        background: rgba(27, 61, 114, 0.02);
      }
    </style>
  `;

  const updateHistoryUI = () => {
    const start = (historyPage - 1) * pageSize;
    const paginated = repayments.slice(start, start + pageSize);
    const tbody = container.querySelector('#repayment-history-body');
    
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No repayments recorded yet.</td></tr>' : paginated.map(r => `
      <tr>
        <td>${formatDate(r.date)}</td>
        <td><div class="font-semibold">${r.reference || 'N/A'}</div><div class="text-xs text-muted">${r.method.toUpperCase()}</div></td>
        <td class="text-xs text-muted">${r.expand?.recorded_by?.name || 'System'}</td>
        <td class="text-right font-semibold text-success">${(Number(r.amount) || 0).toLocaleString()}</td>
      </tr>`).join('');

    const pag = container.querySelector('#repayment-history-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(repayments.length, pageSize, historyPage, (p) => { historyPage = p; updateHistoryUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateScheduleUI = () => {
    const start = (schedulePage - 1) * pageSize;
    const paginated = schedule.slice(start, start + pageSize);
    const tbody = container.querySelector('#loan-schedule-body');
    
    const penaltyAmount = settings.penalty_amount;
    const graceWeeks = settings.penalty_grace_weeks;
    const graceMs = graceWeeks * 7 * 24 * 60 * 60 * 1000;
    const today = new Date().getTime();
    
    // In PB, you could check authService.getUser()?.role, but we just show waive for all admins
    const isAdmin = authService.getUser()?.role === 'admin' || true; 
    
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No schedule found.</td></tr>' : paginated.map(s => {
      let hasPenalty = false;
      let amountDue = getScheduleRemaining(s);
      const dueTime = new Date(s.due_date).getTime();
      const isOverdue = isScheduleInArrears(s);
      
      if (isOverdue) {
        if ((today - dueTime) > graceMs) {
          hasPenalty = true;
        }
      }
      
      if (hasPenalty && !s.penalty_waived) {
        amountDue += penaltyAmount;
      }

      return `
      <tr style="${isOverdue ? 'background: rgba(239, 68, 68, 0.02);' : ''}">
        <td>
          <div class="font-semibold">${s.installment_no}</div>
          ${isOverdue ? `<div class="badge badge-danger" style="margin-top: 4px; font-size: 0.65rem;">OVERDUE</div>` : ''}
        </td>
        <td>${formatDate(s.due_date)}</td>
        <td class="text-right">
          <div class="font-semibold">${amountDue.toLocaleString()}</div>
          ${hasPenalty && !s.penalty_waived ? `<div class="text-xs" style="color: var(--danger); margin-top: 2px;">+${penaltyAmount.toLocaleString()} penalty</div>` : ''}
          ${hasPenalty && s.penalty_waived ? `<div class="text-xs" style="color: var(--success); margin-top: 2px;">Penalty waived</div>` : ''}
        </td>
        <td>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span class="badge ${s.status === 'paid' ? 'badge-success' : 'badge-warning'}">${s.status.toUpperCase()}</span>
            ${hasPenalty && !s.penalty_waived && isAdmin ? `<button class="btn btn-outline btn-xs waive-penalty-btn" data-id="${s.id}" style="margin-left: 8px;">Waive</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    const pag = container.querySelector('#loan-schedule-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(schedule.length, pageSize, schedulePage, (p) => { schedulePage = p; updateScheduleUI(); });
    if (ctrl) pag.appendChild(ctrl);

    // Attach Waive events
    if (isAdmin) {
      const waiveBtns = tbody.querySelectorAll('.waive-penalty-btn');
      waiveBtns.forEach(btn => {
        btn.onclick = async () => {
          const scheduleId = btn.dataset.id;
          const scheduleItem = schedule.find(s => s.id === scheduleId);
          if (scheduleItem) {
            if (window.confirmDialog) {
              window.confirmDialog(
                'Waive Penalty',
                `Are you sure you want to waive the KES ${penaltyAmount} penalty for Installment #${scheduleItem.installment_no}?`,
                async () => {
                  const restoreButton = setButtonLoading(btn, 'Waiving...');
                  try {
                    await loanService.updateScheduleInstallment(scheduleId, { penalty_waived: true });
                    if (window.notify) window.notify.success('Penalty waived successfully');
                    scheduleItem.penalty_waived = true;
                    updateScheduleUI();
                  } catch (err) {
                    if (window.notify) window.notify.error('Penalty waiver failed: ' + err.message);
                    restoreButton();
                  }
                }
              );
            } else {
              if (confirm('Waive penalty?')) {
                const restoreButton = setButtonLoading(btn, 'Waiving...');
                try {
                  await loanService.updateScheduleInstallment(scheduleId, { penalty_waived: true });
                  scheduleItem.penalty_waived = true;
                  updateScheduleUI();
                } catch (err) {
                  if (window.notify) window.notify.error('Penalty waiver failed: ' + err.message);
                  restoreButton();
                }
              }
            }
          }
        };
      });
    }
  };

  updateHistoryUI();
  updateScheduleUI();

  // Tab switching logic
  const tabs = container.querySelectorAll('.tab-btn');
  const contents = {
    overview: container.querySelector('#overview-tab'),
    history: container.querySelector('#history-tab'),
    record: container.querySelector('#record-tab'),
    schedule: container.querySelector('#schedule-tab')
  };

  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(contents).forEach(c => c.style.display = 'none');
      contents[tab.dataset.tab].style.display = 'block';
    };
  });
  const initialTab = contents[params.tab] ? params.tab : 'overview';
  const initialTabBtn = Array.from(tabs).find(tab => tab.dataset.tab === initialTab);
  if (initialTabBtn) initialTabBtn.click();

  // Dynamic Payment Method Logic
  const repaymentMethod = container.querySelector('#repayment-method');
  const repaymentRefGroup = container.querySelector('#repayment-ref-group');
  const repaymentRefLabel = container.querySelector('#repayment-ref-label');
  const repaymentRefInput = container.querySelector('#repayment-ref-input');

  if (repaymentMethod) {
    repaymentMethod.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'cash') {
        repaymentRefGroup.style.display = 'none';
        repaymentRefInput.removeAttribute('required');
        repaymentRefInput.value = ''; // clear out
      } else if (val === 'bank') {
        repaymentRefGroup.style.display = 'block';
        repaymentRefLabel.textContent = 'Bank Transfer / Cheque Reference';
        repaymentRefInput.placeholder = 'e.g. CHQ-987654';
        repaymentRefInput.setAttribute('required', 'true');
      } else { // mpesa
        repaymentRefGroup.style.display = 'block';
        repaymentRefLabel.textContent = 'M-Pesa Transaction Code';
        repaymentRefInput.placeholder = 'e.g. QWE123RTY4';
        repaymentRefInput.setAttribute('required', 'true');
      }
    });
  }

  // Handle Repayment Submission
  const paymentForm = container.querySelector('#payment-form');
  paymentForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = paymentForm.querySelector('button[type="submit"]');
    const restoreButton = setButtonLoading(btn, 'Recording...');

    const formData = new FormData(paymentForm);
    const data = Object.fromEntries(formData.entries());
    const amount = parseFloat(data.amount);
    
    const repayment = {
      loan: loan.id,
      amount: amount,
      date: new Date(data.date).toISOString(),
      method: data.method,
      reference: data.reference,
      note: data.note
    };

    if (loan.member) repayment.member = loan.member;
    const userId = authService.getUser()?.id;
    if (userId) repayment.recorded_by = userId;

    try {
      await loanService.recordRepayment(repayment);
      
      const totalRepaidNow = totalPaid + amount;

      if (totalLiability > 0 && totalRepaidNow >= totalLiability) {
        await loanService.update(loan.id, { status: 'completed' });
        if (window.notify) window.notify.success('Loan fully repaid and closed!');
      } else {
        if (window.notify) window.notify.success('Repayment recorded successfully!');
      }

      // Mark schedules as paid locally to avoid refetching complex logic
      let remaining = amount;
      for (const s of schedule) {
        if (remaining <= 0) break;
        const installmentRemaining = getScheduleRemaining(s);
        if (installmentRemaining > 0) {
          const currentPaid = Number(s.paid) || 0;
          if (remaining >= installmentRemaining) {
            await loanService.updateScheduleInstallment(s.id, { status: 'paid', paid: Number(s.amount) || 0 });
            remaining -= installmentRemaining;
          } else {
            await loanService.updateScheduleInstallment(s.id, { status: 'partial', paid: currentPaid + remaining });
            remaining = 0;
          }
        }
      }

      const parent = container.parentNode;
      if (parent) {
        const freshContainer = await renderLoanDetails(params);
        parent.replaceChild(freshContainer, container);
      } else {
        window.location.hash = window.location.hash;
      }
    } catch (err) {
      console.error(err);
      if (window.notify) window.notify.error('Error: ' + err.message);
      restoreButton();
    }
  };

  // --- Physical Disbursement Action ---
  const disburseBtn = container.querySelector('#details-disburse-btn');
  if (disburseBtn) {
    disburseBtn.onclick = async () => {
      const confirmed = window.confirmDialog ? await window.confirmDialog({
        title: 'Disburse Funds',
        message: `Are you sure you want to disburse KES ${(loan.approved_amount || loan.amount_applied).toLocaleString()} to this client now? This will generate the repayment schedule.`,
        confirmText: 'Yes, Disburse 💸',
        type: 'success'
      }) : confirm('Disburse funds?');
      
      if (!confirmed) return;
      
      const restoreButton = setButtonLoading(disburseBtn, 'Disbursing...');
      const disbursementDate = dateInputToIso(container.querySelector('#details-disbursement-date')?.value);
      try {
        const updatedLoan = await loanService.update(loan.id, {
          status: 'disbursed',
          disbursement_date: disbursementDate
        });
        
        await generateSchedule(updatedLoan);
        if (window.notify) window.notify.success('Funds disbursed successfully! Repayment schedule generated.');
        window.location.reload();
      } catch (err) {
        if (window.notify) window.notify.error('Disbursement failed: ' + err.message);
        restoreButton();
      }
    };
  }

  // --- Re-activate Expired Approval ---
  const reactivateBtn = container.querySelector('#details-reactivate-btn');
  if (reactivateBtn) {
    reactivateBtn.onclick = async () => {
      const confirmed = window.confirmDialog ? await window.confirmDialog({
        title: 'Re-activate Loan Approval',
        message: 'Re-activate this expired loan back to Pending Review?',
        confirmText: 'Yes, Re-activate',
        type: 'info'
      }) : confirm('Reactivate?');
      if (!confirmed) return;
      
      const restoreButton = setButtonLoading(reactivateBtn, 'Re-activating...');
      try {
        await loanService.update(loan.id, {
          status: 'pending',
          approved_date: null,
          expired_date: null,
          approved_amount: 0
        });

        if (window.notify) window.notify.success('Loan re-activated to Pending Review.');
        window.location.reload();
      } catch (err) {
        if (window.notify) window.notify.error('Re-activation failed: ' + err.message);
        restoreButton();
      }
    };
  }

  // --- Helper: Generate Repayment Schedule ---
  async function generateSchedule(loanObj) {
    const installmentAmount = getLoanLiability(loanObj) / loanObj.period;
    const startDate = getRepaymentScheduleAnchorDate(loanObj);
    for (let i = 1; i <= loanObj.period; i++) {
      const dueDate = addMonthsPreservingDay(startDate, i);
      await loanService.createScheduleInstallment({
        loan: loanObj.id,
        installment_no: i,
        due_date: dueDate.toISOString(),
        amount: installmentAmount,
        paid: 0,
        status: 'pending',
        penalty_waived: false
      });
    }
  }

  })();

  return container;
};
