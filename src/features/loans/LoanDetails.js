import { loanService } from '../../services/loanService.js';
import { authService } from '../../services/authService.js';
import { settingsService } from '../../services/settingsService.js';
import { savingsService } from '../../services/savingsService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate, formatMoney, formatPercent } from '../../core/utils.js';
import { renderCardSkeleton, setButtonLoading } from '../../core/uiState.js';
import { getScheduleRemaining, isScheduleInArrears } from '../../core/loanScheduleMetrics.js';
import { calculateLoanPenaltyState, getRepaymentPrincipalAmount } from '../../core/loanPenalty.js';
import { getReturnTo } from '../../core/navigation.js';
import { memberCommentService } from '../../services/memberCommentService.js';
import { allocateRepayment, getRepaymentContractAmount, getSettlementContractAmount } from '../../core/repaymentAllocation.js';

export const renderLoanDetails = async (params) => {
  const { id: loanNo } = params;
  const returnTo = getReturnTo(params, '#/loans');
  const todayInputValue = new Date().toISOString().split('T')[0];
  const dateInputToDate = (value) => new Date(`${value || todayInputValue}T12:00:00`);
  const dateInputToIso = (value) => dateInputToDate(value).toISOString();
  const isoToDateInput = (value) => {
    if (!value) return todayInputValue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return todayInputValue;
    return date.toISOString().split('T')[0];
  };
  const isInputDateBeforeRecordDate = (inputValue, recordValue) => {
    if (!recordValue) return false;
    const inputDate = dateInputToDate(inputValue);
    const recordDate = new Date(recordValue);
    if (Number.isNaN(inputDate.getTime()) || Number.isNaN(recordDate.getTime())) return false;
    inputDate.setHours(0, 0, 0, 0);
    recordDate.setHours(0, 0, 0, 0);
    return inputDate < recordDate;
  };
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

  // Keep optional features from blanking financial records when one request fails.
  let schedule = [], repayments = [], balanceOffs = [], memberComments = [];
  let availableSavings = 0;
  let scheduleLoadError = null;
  let repaymentLoadError = null;
  let balanceOffLoadError = null;
  let commentsLoadError = null;
  let savingsLoadError = null;
  const [scheduleResult, repaymentResult, balanceOffResult, savingsResult, commentsResult] = await Promise.allSettled([
    loanService.getScheduleForLoan(loan.id),
    loanService.getRepaymentsForLoan(loan.id),
    loanService.getBalanceOffsForLoan(loan.id),
    loan.member ? savingsService.getMemberBalance(loan.member) : Promise.resolve(0),
    loan.member ? memberCommentService.getByMember(loan.member) : Promise.resolve([])
  ]);

  if (scheduleResult.status === 'fulfilled') schedule = scheduleResult.value;
  else scheduleLoadError = scheduleResult.reason;
  if (repaymentResult.status === 'fulfilled') repayments = repaymentResult.value;
  else repaymentLoadError = repaymentResult.reason;
  if (balanceOffResult.status === 'fulfilled') balanceOffs = balanceOffResult.value;
  else balanceOffLoadError = balanceOffResult.reason;
  if (savingsResult.status === 'fulfilled') availableSavings = Number(savingsResult.value) || 0;
  else savingsLoadError = savingsResult.reason;
  if (commentsResult.status === 'fulfilled') memberComments = commentsResult.value;
  else commentsLoadError = commentsResult.reason;

  if (scheduleLoadError) console.warn('[LoanDetails] Could not load repayment schedule:', scheduleLoadError.message);
  if (repaymentLoadError) console.warn('[LoanDetails] Could not load repayments:', repaymentLoadError.message);
  if (balanceOffLoadError) console.warn('[LoanDetails] Could not load balance-offs:', balanceOffLoadError.message);
  if (savingsLoadError) console.warn('[LoanDetails] Could not load member savings balance:', savingsLoadError.message);
  if (commentsLoadError) console.warn('[LoanDetails] Could not load member comments:', commentsLoadError.message);

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
  const penaltyState = calculateLoanPenaltyState({
    schedules: schedule,
    repayments,
    settlements: balanceOffs,
    penaltyAmount: settings.penalty_amount
  });
  const totalPaid = repayments.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const totalBalancedOff = balanceOffs.reduce((sum, item) => sum + getSettlementContractAmount(item), 0);
  const principalPaid = repayments.reduce((sum, r) => sum + getRepaymentPrincipalAmount(r), 0)
    + balanceOffs.reduce((sum, item) => sum + getSettlementContractAmount(item), 0);
  const outstandingPrincipal = Math.max(0, totalLiability - principalPaid);
  const outstandingBalance = Math.max(0, outstandingPrincipal + penaltyState.outstandingFine);
  const percentRepaid = totalLiability > 0
    ? Math.min(100, (principalPaid / totalLiability) * 100)
    : (['completed', 'closed'].includes(loan.status) ? 100 : 0);

  let historyPage = 1;
  let balanceOffPage = 1;
  let schedulePage = 1;
  let commentsPage = 1;
  let editingCommentId = null;
  const pageSize = 10;
  const canEditRepayments = authService.hasRole('super_admin', 'admin');
  const canDeleteRepayments = authService.hasRole('super_admin');
  const canBalanceOff = authService.hasRole('super_admin', 'admin') && loan.member && loan.status === 'disbursed';
  const canEditComments = authService.hasRole('super_admin', 'admin');
  const canDeleteComments = authService.hasRole('super_admin');
  const canRepairSchedule = authService.hasRole('super_admin', 'admin')
    && loan.status === 'disbursed'
    && !scheduleLoadError
    && schedule.length < (Number(loan.period) || 0);

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
            <div style="font-size: 0.8rem; color: var(--text-muted);">📋 Applied Amount: <span class="font-semibold">KES ${formatMoney(loan.amount_applied)}</span></div>
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
              <span style="color: var(--text-muted);">Applied: <b>KES ${formatMoney(loan.amount_applied)}</b></span>
              <span style="color: #d97706;">Approved: <b>KES ${formatMoney(loan.approved_amount)}</b></span>
            </div>
            <div style="height: 10px; background: #fef3c7; border-radius: 5px; overflow: hidden;">
              <div style="height: 100%; width: ${Math.round(((loan.approved_amount || 0) / loan.amount_applied) * 100)}%; background: linear-gradient(90deg, #f59e0b, #d97706); border-radius: 5px;"></div>
            </div>
            <div style="margin-top: 6px; font-size: 0.75rem; color: #d97706; text-align: right; font-weight: 600;">
              KES ${formatMoney(loan.amount_applied - (loan.approved_amount || 0))} reduced (${formatPercent(((loan.amount_applied - (loan.approved_amount || 0)) / loan.amount_applied) * 100)} cut)
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
      <div class="loan-detail-tabs" style="display: flex; border-bottom: 1px solid var(--border-color); overflow-x: auto;">
        <button class="tab-btn active" data-tab="overview">📊 Overview</button>
        <button class="tab-btn" data-tab="history">📋 Repayment History</button>
        <button class="tab-btn" data-tab="record">💳 Record Payment</button>
        ${loan.member ? '<button class="tab-btn" data-tab="balanceoff">↔ Balance-Off</button>' : ''}
        <button class="tab-btn" data-tab="schedule">🗓 Schedule</button>
        <button class="tab-btn" data-tab="comments">💬 Comments</button>
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
                This loan has been successfully approved for <strong>KES ${formatMoney(loan.approved_amount || loan.amount_applied)}</strong>.<br>
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
                KES ${formatMoney(outstandingBalance)}
              </div>
              <div style="margin-top: 20px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 6px;">
                  <span>Current Loan Progress</span>
                  <span class="font-semibold">${formatPercent(percentRepaid)}</span>
                </div>
                <div style="width: 100%; height: 8px; background: var(--bg-light); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${Math.max(0, Math.min(100, percentRepaid))}%; height: 100%; background: var(--success); transition: width 0.3s ease;"></div>
                </div>
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Total Liability</div>
                <div class="font-semibold">KES ${formatMoney(totalLiability)}</div>
              </div>
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Total Repaid</div>
                <div class="font-semibold text-success">KES ${formatMoney(totalPaid)}</div>
              </div>
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Balanced Off</div>
                <div class="font-semibold" style="color: var(--secondary);">KES ${formatMoney(totalBalancedOff)}</div>
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
                  <th>Notes</th>
                  <th>Recorded By</th>
                  <th class="text-right">Fine</th>
                  <th class="text-right">Amount</th>
                  ${(canEditRepayments || canDeleteRepayments) ? '<th class="text-right">Actions</th>' : ''}
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
              <input type="number" name="amount" class="form-control" required min="1" step="1" placeholder="Enter total amount received" />
              <p class="text-xs text-muted" style="margin-top: 4px;">Loan balance due: KES ${formatMoney(outstandingBalance)}. Include any fine collected in the total amount.</p>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group" style="background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.22); border-radius: 8px; padding: 12px;">
                <label class="form-label">Automatic Late Fine Due</label>
                <div class="font-semibold" style="color: ${penaltyState.outstandingFine > 0 ? 'var(--warning)' : 'var(--text-muted)'};">KES ${formatMoney(penaltyState.outstandingFine)}</div>
                <p class="text-xs text-muted" style="margin-top: 4px;">Applied automatically when a scheduled installment is overdue.</p>
              </div>
              <div class="form-group">
                <label class="form-label">Manual Fine (Optional)</label>
                <input type="number" name="manual_fine_amount" class="form-control" min="0" step="1" value="0" placeholder="e.g. 500" />
                <p class="text-xs text-muted" style="margin-top: 4px;">Use only when an additional fine is charged and collected.</p>
              </div>
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

        ${loan.member ? `
        <div id="balanceoff-tab" style="display: none;">
          <div style="display: grid; grid-template-columns: minmax(280px, 420px) 1fr; gap: 24px; align-items: start;">
            <form id="balance-off-form" class="card" style="box-shadow: none; border: 1px solid var(--border-color);">
              <div style="display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 18px;">
                <div>
                  <h3 style="margin: 0;">Balance Off from Savings</h3>
                  <p class="text-sm text-muted" style="margin-top: 6px;">Use member savings to settle this loan partially or fully.</p>
                </div>
                <span class="badge badge-outline">NON-CASH</span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;">
                <div style="padding: 14px; background: var(--bg-light); border-radius: 8px;">
                  <div class="text-xs text-muted">Available Savings</div>
                  <div class="font-semibold" style="color: var(--success);">KES ${formatMoney(availableSavings)}</div>
                </div>
                <div style="padding: 14px; background: var(--bg-light); border-radius: 8px;">
                  <div class="text-xs text-muted">Current OLB</div>
                  <div class="font-semibold" style="color: ${outstandingBalance > 0 ? 'var(--danger)' : 'var(--success)'};">KES ${formatMoney(outstandingBalance)}</div>
                </div>
              </div>
              ${savingsLoadError ? '<div class="alert alert-warning" style="margin-bottom: 14px;">Savings balance could not be verified. Refresh before balancing off.</div>' : ''}
              ${balanceOffLoadError ? '<div class="alert alert-warning" style="margin-bottom: 14px;">Previous balance-offs could not be loaded.</div>' : ''}
              <div class="form-group">
                <label class="form-label">Balance-Off Amount (KES)</label>
                <input type="number" name="amount" class="form-control" min="1" step="1" max="${Math.max(0, Math.min(availableSavings, outstandingPrincipal))}" required placeholder="Amount to reduce from loan balance" />
                <p class="text-xs text-muted" style="margin-top: 4px;">Maximum available now: KES ${formatMoney(Math.max(0, Math.min(availableSavings, outstandingPrincipal)))}</p>
              </div>
              <div class="form-group">
                <label class="form-label">Surcharge Fee (Optional)</label>
                <input type="number" name="surcharge_amount" class="form-control" min="0" step="1" value="0" placeholder="e.g. 200" />
                <p class="text-xs text-muted" style="margin-top: 4px;">This reduces savings too, but it does not reduce the loan principal or interest.</p>
              </div>
              <div class="form-group">
                <label class="form-label">Effective Date</label>
                <input type="date" name="effective_date" class="form-control" value="${todayInputValue}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Reason</label>
                <textarea name="reason" class="form-control" rows="3" required placeholder="e.g. Client requested partial loan offset using savings balance"></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-lg" style="width: 100%;" ${!canBalanceOff || outstandingPrincipal <= 0 || availableSavings <= 0 ? 'disabled' : ''}>
                Confirm Balance-Off
              </button>
              ${!canBalanceOff ? '<p class="text-xs text-muted" style="margin-top: 10px;">Only admins can balance off active member loans.</p>' : ''}
            </form>

            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px;">
                <div>
                  <h3 style="margin: 0;">Balance-Off History</h3>
                  <div class="text-sm text-muted">${balanceOffs.length} settlement${balanceOffs.length === 1 ? '' : 's'} recorded</div>
                </div>
              </div>
              <div class="table-responsive">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reason</th>
                      <th>Recorded By</th>
                      <th class="text-right">Surcharge</th>
                      <th class="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody id="balance-off-history-body"></tbody>
                </table>
              </div>
              <div id="balance-off-pagination"></div>
            </div>
          </div>
        </div>
        ` : ''}

        <div id="schedule-tab" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div>
              <h3 style="margin: 0;">Repayment Schedule</h3>
              <div class="text-sm text-muted">${schedule.length} of ${Number(loan.period) || 0} installments</div>
            </div>
            ${canRepairSchedule ? '<button type="button" class="btn btn-primary btn-sm" id="repair-schedule-btn">Repair Schedule</button>' : ''}
          </div>
          ${scheduleLoadError ? `
            <div class="alert alert-danger" style="margin-bottom: 16px;">
              The repayment schedule could not be loaded. Please refresh or check access to the loan_schedule collection.
            </div>
          ` : ''}
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

        <div id="comments-tab" style="display: none;">
          ${loan.member ? `
            <form id="loan-comment-form" class="card" style="box-shadow: none; border: 1px solid var(--border-color); margin-bottom: 18px;">
              <div style="display: grid; grid-template-columns: minmax(180px, 220px) 1fr auto; gap: 14px; align-items: end;">
                <div class="form-group" style="margin: 0;">
                  <label class="form-label">Comment Date</label>
                  <input type="date" name="comment_date" class="form-control" value="${todayInputValue}" required />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label class="form-label">Comment</label>
                  <textarea name="comment" class="form-control" rows="2" placeholder="Capture follow-up notes, payment promise, visit outcome, or loan officer observation..." required></textarea>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <button type="submit" class="btn btn-primary" id="loan-comment-submit">Save Comment</button>
                  <button type="button" class="btn btn-outline" id="loan-comment-cancel" style="display: none;">Cancel</button>
                </div>
              </div>
            </form>
            <div class="table-responsive">
              <table class="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Comment</th>
                    <th>Recorded By</th>
                    ${(canEditComments || canDeleteComments) ? '<th class="text-right">Actions</th>' : ''}
                  </tr>
                </thead>
                <tbody id="loan-comments-body"></tbody>
              </table>
            </div>
            <div id="loan-comments-pagination"></div>
          ` : `
            <div class="text-center text-muted" style="padding: 32px;">Comments are available for member loans only. This is a group account loan.</div>
          `}
        </div>
      </div>
    </div>

    <div id="repayment-edit-modal" class="modal" style="display: none; position: fixed; z-index: 1000; inset: 0; background: rgba(15,37,69,0.48); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: min(620px, 100%); padding: 0; overflow: hidden;">
        <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; gap: 16px; align-items: center;">
          <div>
            <h2 class="text-lg">Edit Repayment</h2>
            <p class="text-xs text-muted" id="repayment-edit-subtitle" style="margin-top: 4px;">Correct repayment amount, method, date, fine, or notes.</p>
          </div>
          <button type="button" id="repayment-edit-close" aria-label="Close" style="background: transparent; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        <form id="repayment-edit-form" style="padding: 24px;">
          <input type="hidden" name="repayment_id" />
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px;">
            <div class="form-group">
              <label class="form-label">Payment Amount (KES)</label>
              <input type="number" name="amount" class="form-control" min="1" step="1" required />
            </div>
            <div class="form-group">
              <label class="form-label">Fine (Optional)</label>
              <input type="number" name="fine_amount" class="form-control" min="0" step="1" />
            </div>
            <div class="form-group">
              <label class="form-label">Date</label>
              <input type="date" name="date" class="form-control" required />
            </div>
            <div class="form-group">
              <label class="form-label">Method</label>
              <select name="method" id="edit-repayment-method" class="form-control">
                <option value="mpesa">M-Pesa</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer</option>
              </select>
            </div>
          </div>
          <div class="form-group" id="edit-repayment-ref-group">
            <label class="form-label" id="edit-repayment-ref-label">M-Pesa Transaction Code</label>
            <input type="text" name="reference" id="edit-repayment-ref-input" class="form-control" placeholder="e.g. QWE123RTY4" />
          </div>
          <div class="form-group">
            <label class="form-label">Notes (Optional)</label>
            <textarea name="note" class="form-control" rows="2"></textarea>
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 12px; padding-top: 16px; border-top: 1px solid var(--border-color);">
            <button type="button" class="btn btn-outline" id="repayment-edit-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Update Repayment</button>
          </div>
        </form>
      </div>
    </div>

    <style>
      .tab-btn {
        flex: 1;
        flex-basis: 150px;
        min-width: 150px;
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
      .loan-comment-actions,
      .loan-repayment-actions {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .loan-comment-action,
      .loan-repayment-action {
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        background: #fff;
        color: var(--primary);
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.18s ease;
      }
      .loan-comment-action:hover,
      .loan-repayment-action:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 12px rgba(15, 37, 69, 0.08);
        border-color: var(--primary);
      }
      .loan-comment-action.danger,
      .loan-repayment-action.danger {
        color: var(--danger);
      }
      .loan-comment-action.danger:hover,
      .loan-repayment-action.danger:hover {
        border-color: var(--danger);
        background: rgba(239, 68, 68, 0.06);
      }
    </style>
  `;

  const updateHistoryUI = () => {
    const start = (historyPage - 1) * pageSize;
    const paginated = repayments.slice(start, start + pageSize);
    const tbody = container.querySelector('#repayment-history-body');
    const columnCount = (canEditRepayments || canDeleteRepayments) ? 7 : 6;
    
    tbody.innerHTML = repaymentLoadError
      ? `<tr><td colspan="${columnCount}" class="text-center text-danger">Repayment history could not be loaded.</td></tr>`
      : paginated.length === 0 ? `<tr><td colspan="${columnCount}" class="text-center text-muted">No repayments recorded yet.</td></tr>` : paginated.map(r => `
      <tr>
        <td>${formatDate(r.date)}</td>
        <td><div class="font-semibold">${escapeHtml(r.reference || 'N/A')}</div><div class="text-xs text-muted">${escapeHtml(String(r.method || '-').toUpperCase())}</div></td>
        <td class="text-sm">${r.note ? escapeHtml(r.note) : '<span class="text-muted">-</span>'}</td>
        <td class="text-xs text-muted">${r.expand?.recorded_by?.name || 'System'}</td>
        <td class="text-right font-semibold ${Number(r.fine_amount) > 0 ? 'text-warning' : 'text-muted'}">${formatMoney(r.fine_amount)}</td>
        <td class="text-right font-semibold text-success">${formatMoney(r.amount)}</td>
        ${(canEditRepayments || canDeleteRepayments) ? `
          <td class="text-right">
            <div class="loan-repayment-actions">
              ${canEditRepayments ? `<button type="button" class="loan-repayment-action edit-repayment-btn" data-id="${r.id}" title="Edit repayment" aria-label="Edit repayment">✎</button>` : ''}
              ${canDeleteRepayments ? `<button type="button" class="loan-repayment-action danger delete-repayment-btn" data-id="${r.id}" title="Delete repayment" aria-label="Delete repayment">×</button>` : ''}
            </div>
          </td>
        ` : ''}
      </tr>`).join('');

    if (canEditRepayments) {
      tbody.querySelectorAll('.edit-repayment-btn').forEach(btn => {
        btn.onclick = () => {
          const repayment = repayments.find(item => item.id === btn.dataset.id);
          if (repayment) openRepaymentEditModal(repayment);
        };
      });
    }

    if (canDeleteRepayments) {
      tbody.querySelectorAll('.delete-repayment-btn').forEach(btn => {
        btn.onclick = async () => {
          const repayment = repayments.find(item => item.id === btn.dataset.id);
          if (!repayment) return;
          const confirmed = window.confirmDialog
            ? await window.confirmDialog({
                title: 'Delete Repayment',
                message: `Delete repayment of KES ${formatMoney(repayment.amount)} recorded on ${formatDate(repayment.date)}? The loan schedule and balances will be recalculated.`,
                confirmText: 'Delete',
                cancelText: 'Cancel',
                type: 'danger'
              })
            : confirm('Delete this repayment permanently?');
          if (!confirmed) return;

          const restoreButton = setButtonLoading(btn, '...');
          try {
            await loanService.deleteRepayment(repayment.id);
            await recalculateRepaymentState();
            if (window.notify) window.notify.success('Repayment deleted and loan balances recalculated.');
            await refreshLoanDetails();
          } catch (err) {
            const schemaHint = err.status === 403
              ? ' Confirm that your user is a super admin and the loan_repayments delete rule is updated in PocketHost.'
              : '';
            if (window.notify) window.notify.error('Failed to delete repayment: ' + (err.message || 'Please try again.') + schemaHint);
            restoreButton();
          }
        };
      });
    }

    const pag = container.querySelector('#repayment-history-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(repayments.length, pageSize, historyPage, (p) => { historyPage = p; updateHistoryUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateBalanceOffUI = () => {
    const tbody = container.querySelector('#balance-off-history-body');
    if (!tbody) return;
    const start = (balanceOffPage - 1) * pageSize;
    const paginated = balanceOffs.slice(start, start + pageSize);

    tbody.innerHTML = balanceOffLoadError
      ? '<tr><td colspan="5" class="text-center text-danger">Balance-off history could not be loaded. Confirm that loan_balance_offs exists in PocketHost.</td></tr>'
      : paginated.length === 0
        ? '<tr><td colspan="5" class="text-center text-muted">No balance-offs recorded for this loan.</td></tr>'
        : paginated.map(item => `
          <tr>
            <td>
              <div class="font-semibold">${formatDate(item.effective_date || item.created)}</div>
              <div class="text-xs text-muted">${item.status === 'reversed' ? 'Reversed' : 'Balanced off'}</div>
            </td>
            <td class="text-sm" style="line-height: 1.5;">${escapeHtml(item.reason || '-')}</td>
            <td class="text-xs text-muted">${escapeHtml(item.expand?.recorded_by?.name || item.expand?.recorded_by?.email || 'Admin')}</td>
            <td class="text-right">${formatMoney(item.surcharge_amount || 0)}</td>
            <td class="text-right font-semibold" style="color: var(--secondary);">${formatMoney(item.amount)}</td>
          </tr>
        `).join('');

    const pag = container.querySelector('#balance-off-pagination');
    if (!pag) return;
    pag.innerHTML = '';
    const ctrl = renderPagination(balanceOffs.length, pageSize, balanceOffPage, (p) => {
      balanceOffPage = p;
      updateBalanceOffUI();
    });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateScheduleUI = () => {
    const start = (schedulePage - 1) * pageSize;
    const paginated = schedule.slice(start, start + pageSize);
    const tbody = container.querySelector('#loan-schedule-body');
    
    let fineCollectedRemaining = penaltyState.fineCollected;
    const penaltyBalanceBySchedule = new Map();
    penaltyState.scheduleStates.forEach(item => {
      const generatedPenalty = item.penaltyAmount;
      const collectedForSchedule = Math.min(fineCollectedRemaining, generatedPenalty);
      fineCollectedRemaining -= collectedForSchedule;
      penaltyBalanceBySchedule.set(item.schedule.id, Math.max(0, generatedPenalty - collectedForSchedule));
    });
    const isAdmin = authService.hasRole('super_admin', 'admin');
    
    tbody.innerHTML = scheduleLoadError
      ? '<tr><td colspan="4" class="text-center text-danger">Repayment schedule could not be loaded.</td></tr>'
      : paginated.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No schedule found.</td></tr>' : paginated.map(s => {
      let amountDue = getScheduleRemaining(s);
      const isOverdue = isScheduleInArrears(s);
      const penaltyBalance = penaltyBalanceBySchedule.get(s.id) || 0;
      const hasPenalty = penaltyBalance > 0;
      amountDue += penaltyBalance;

      return `
      <tr style="${isOverdue ? 'background: rgba(239, 68, 68, 0.02);' : ''}">
        <td>
          <div class="font-semibold">${s.installment_no}</div>
          ${isOverdue ? `<div class="badge badge-danger" style="margin-top: 4px; font-size: 0.65rem;">OVERDUE</div>` : ''}
        </td>
        <td>${formatDate(s.due_date)}</td>
        <td class="text-right">
          <div class="font-semibold">${formatMoney(amountDue)}</div>
          ${hasPenalty ? `<div class="text-xs" style="color: var(--danger); margin-top: 2px;">+${formatMoney(penaltyBalance)} automatic fine</div>` : ''}
          ${s.penalty_waived ? `
            <div class="text-xs" style="color: var(--success); margin-top: 2px;">Fine waived</div>
            ${s.penalty_waiver_reason ? `<div class="text-xs text-muted" style="margin-top: 2px;">Reason: ${escapeHtml(s.penalty_waiver_reason)}</div>` : ''}
          ` : ''}
        </td>
        <td>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span class="badge ${s.status === 'paid' ? 'badge-success' : 'badge-warning'}">${s.status.toUpperCase()}</span>
            ${hasPenalty && isAdmin ? `<button class="btn btn-outline btn-xs waive-penalty-btn" data-id="${s.id}" style="margin-left: 8px;">Waive</button>` : ''}
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
          if (!scheduleItem) return;

          const reason = window.promptDialog
            ? await window.promptDialog({
                title: 'Waive Penalty',
                message: `Enter the reason for waiving the automatic fine for Installment #${scheduleItem.installment_no}.`,
                placeholder: 'e.g. Client paid on time but receipt was captured late',
                required: true,
                confirmText: 'Waive Fine',
                cancelText: 'Cancel'
              })
            : window.prompt('Reason for waiving this penalty:');

          const waiverReason = String(reason || '').trim();
          if (!waiverReason) return;

          const confirmed = window.confirmDialog
            ? await window.confirmDialog({
                title: 'Confirm Waiver',
                message: `Waive the automatic fine for Installment #${scheduleItem.installment_no}? Reason: ${escapeHtml(waiverReason)}`,
                confirmText: 'Confirm Waiver',
                cancelText: 'Cancel',
                type: 'warning'
              })
            : confirm(`Waive penalty for Installment #${scheduleItem.installment_no}?`);

          if (!confirmed) return;

          const restoreButton = setButtonLoading(btn, 'Waiving...');
          try {
            await loanService.updateScheduleInstallment(scheduleId, {
              penalty_waived: true,
              penalty_waiver_reason: waiverReason
            });
            if (window.notify) window.notify.success('Penalty waived successfully');
            scheduleItem.penalty_waived = true;
            scheduleItem.penalty_waiver_reason = waiverReason;
            updateScheduleUI();
          } catch (err) {
            const schemaHint = err.status === 400
              ? ' Confirm that loan_schedule has a penalty_waiver_reason text field in PocketHost.'
              : '';
            if (window.notify) window.notify.error('Penalty waiver failed: ' + err.message + schemaHint);
            restoreButton();
          }
        };
      });
    }
  };

  const updateCommentsUI = () => {
    if (!loan.member) return;
    const start = (commentsPage - 1) * pageSize;
    const paginated = memberComments.slice(start, start + pageSize);
    const tbody = container.querySelector('#loan-comments-body');
    if (!tbody) return;
    const columnCount = (canEditComments || canDeleteComments) ? 4 : 3;

    tbody.innerHTML = commentsLoadError
      ? `<tr><td colspan="${columnCount}" class="text-center text-danger">Comments could not be loaded. The loan schedule and repayments remain available.</td></tr>`
      : paginated.length === 0
      ? `<tr><td colspan="${columnCount}" class="text-center text-muted">No comments recorded for this member yet.</td></tr>`
      : paginated.map(comment => `
        <tr>
          <td class="font-semibold">${formatDate(comment.comment_date || comment.created)}</td>
          <td class="text-sm" style="line-height: 1.5;">${escapeHtml(comment.comment)}</td>
          <td class="text-xs text-muted">${escapeHtml(comment.expand?.created_by?.name || comment.expand?.created_by?.email || 'Loan officer')}</td>
          ${(canEditComments || canDeleteComments) ? `
            <td class="text-right">
              <div class="loan-comment-actions">
                ${canEditComments ? `<button type="button" class="loan-comment-action edit-comment-btn" data-id="${comment.id}" title="Edit comment" aria-label="Edit comment">✎</button>` : ''}
                ${canDeleteComments ? `<button type="button" class="loan-comment-action danger delete-comment-btn" data-id="${comment.id}" title="Delete comment" aria-label="Delete comment">×</button>` : ''}
              </div>
            </td>
          ` : ''}
        </tr>
      `).join('');

    if (canEditComments) {
      tbody.querySelectorAll('.edit-comment-btn').forEach(btn => {
        btn.onclick = () => {
          const item = memberComments.find(comment => comment.id === btn.dataset.id);
          const form = container.querySelector('#loan-comment-form');
          if (!item || !form) return;
          editingCommentId = item.id;
          form.elements.comment_date.value = isoToDateInput(item.comment_date || item.created);
          form.elements.comment.value = item.comment || '';
          const submitBtn = container.querySelector('#loan-comment-submit');
          const cancelBtn = container.querySelector('#loan-comment-cancel');
          if (submitBtn) submitBtn.textContent = 'Update Comment';
          if (cancelBtn) cancelBtn.style.display = 'inline-flex';
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          form.elements.comment.focus();
        };
      });
    }

    if (canDeleteComments) {
      tbody.querySelectorAll('.delete-comment-btn').forEach(btn => {
        btn.onclick = async () => {
          const item = memberComments.find(comment => comment.id === btn.dataset.id);
          if (!item) return;
          const confirmed = window.confirmDialog
            ? await window.confirmDialog({
                title: 'Delete Comment',
                message: 'Delete this member comment permanently? This should only be used for wrong or duplicate entries.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                type: 'danger'
              })
            : confirm('Delete this member comment permanently?');
          if (!confirmed) return;

          const restoreButton = setButtonLoading(btn, '...');
          try {
            await memberCommentService.delete(item.id, loan.member);
            memberComments = memberComments.filter(comment => comment.id !== item.id);
            if (editingCommentId === item.id) resetCommentForm();
            const totalPages = Math.max(1, Math.ceil(memberComments.length / pageSize));
            commentsPage = Math.min(commentsPage, totalPages);
            updateCommentsUI();
            if (window.notify) window.notify.success('Comment deleted.');
          } catch (err) {
            const schemaHint = err.status === 403
              ? ' Confirm that your user is a super admin and the member_comments delete rule is updated in PocketHost.'
              : '';
            if (window.notify) window.notify.error('Failed to delete comment: ' + (err.message || 'Please try again.') + schemaHint);
            restoreButton();
          }
        };
      });
    }

    const pag = container.querySelector('#loan-comments-pagination');
    if (!pag) return;
    pag.innerHTML = '';
    const ctrl = renderPagination(memberComments.length, pageSize, commentsPage, (p) => {
      commentsPage = p;
      updateCommentsUI();
    });
    if (ctrl) pag.appendChild(ctrl);
  };

  const resetCommentForm = () => {
    editingCommentId = null;
    const form = container.querySelector('#loan-comment-form');
    if (!form) return;
    form.reset();
    form.elements.comment_date.value = todayInputValue;
    const submitBtn = container.querySelector('#loan-comment-submit');
    const cancelBtn = container.querySelector('#loan-comment-cancel');
    if (submitBtn) submitBtn.textContent = 'Save Comment';
    if (cancelBtn) cancelBtn.style.display = 'none';
  };

  const refreshLoanDetails = async () => {
    const parent = container.parentNode;
    if (parent) {
      const freshContainer = await renderLoanDetails(params);
      parent.replaceChild(freshContainer, container);
    } else {
      window.location.hash = window.location.hash;
    }
  };

  const recalculateRepaymentState = async () => {
    if (scheduleLoadError) {
      throw new Error('Repayment schedule could not be loaded, so balances cannot be recalculated safely.');
    }

    const freshRepayments = await loanService.getRepaymentsForLoan(loan.id);
    const freshBalanceOffs = await loanService.getBalanceOffsForLoan(loan.id);
    const activeBalanceOffs = freshBalanceOffs.filter(item => item.status !== 'reversed');
    const orderedRepayments = [...freshRepayments].sort((a, b) => {
      const aDate = new Date(a.date || a.created || 0).getTime();
      const bDate = new Date(b.date || b.created || 0).getTime();
      return aDate - bDate;
    });
    const orderedContractEvents = [
      ...orderedRepayments.map(repayment => ({
        kind: 'repayment',
        record: repayment,
        date: new Date(repayment.date || repayment.created || 0)
      })),
      ...activeBalanceOffs.map(settlement => ({
        kind: 'settlement',
        record: settlement,
        date: new Date(settlement.effective_date || settlement.created || 0)
      }))
    ].sort((a, b) => a.date - b.date);

    let priorContractPaid = 0;
    for (const event of orderedContractEvents) {
      if (event.kind === 'settlement') {
        priorContractPaid += getSettlementContractAmount(event.record);
        continue;
      }
      const repayment = event.record;
      const amount = Number(repayment.amount) || 0;
      const fineAmount = Math.min(amount, Number(repayment.fine_amount) || 0);
      const allocation = allocateRepayment({
        loan,
        repaymentAmount: amount,
        fineAmount,
        priorContractPaid
      });
      priorContractPaid += allocation.contractAmount;

      const principalChanged = Math.abs((Number(repayment.principal_amount) || 0) - allocation.principalAmount) > 0.01;
      const interestChanged = Math.abs((Number(repayment.interest_amount) || 0) - allocation.interestAmount) > 0.01;
      const fineChanged = Math.abs((Number(repayment.fine_amount) || 0) - fineAmount) > 0.01;
      if (principalChanged || interestChanged || fineChanged) {
        await loanService.updateRepayment(repayment.id, {
          fine_amount: fineAmount,
          principal_amount: allocation.principalAmount,
          interest_amount: allocation.interestAmount
        });
        repayment.fine_amount = fineAmount;
        repayment.principal_amount = allocation.principalAmount;
        repayment.interest_amount = allocation.interestAmount;
      }
    }

    let remainingContractPaid = orderedRepayments.reduce(
      (sum, repayment) => sum + getRepaymentContractAmount(repayment),
      0
    ) + activeBalanceOffs.reduce((sum, item) => sum + getSettlementContractAmount(item), 0);

    const orderedSchedule = [...schedule].sort((a, b) => Number(a.installment_no) - Number(b.installment_no));
    for (const installment of orderedSchedule) {
      const installmentAmount = Number(installment.amount) || 0;
      const paid = Math.min(installmentAmount, Math.max(0, remainingContractPaid));
      remainingContractPaid -= paid;
      const status = paid >= installmentAmount && installmentAmount > 0
        ? 'paid'
        : paid > 0 ? 'partial' : 'pending';
      await loanService.updateScheduleInstallment(installment.id, { paid, status });
    }

    const contractPaid = orderedRepayments.reduce(
      (sum, repayment) => sum + getRepaymentContractAmount(repayment),
      0
    ) + activeBalanceOffs.reduce((sum, item) => sum + getSettlementContractAmount(item), 0);
    const loanFullyPaid = totalLiability > 0 && contractPaid >= totalLiability - 0.01;
    if (loanFullyPaid && !['completed', 'closed'].includes(loan.status)) {
      await loanService.update(loan.id, { status: 'completed' });
    } else if (!loanFullyPaid && loan.status === 'completed') {
      await loanService.update(loan.id, { status: 'disbursed' });
    }
  };

  const repaymentEditModal = container.querySelector('#repayment-edit-modal');
  const repaymentEditForm = container.querySelector('#repayment-edit-form');
  const repaymentEditSubtitle = container.querySelector('#repayment-edit-subtitle');
  const editRepaymentMethod = container.querySelector('#edit-repayment-method');
  const editRepaymentRefGroup = container.querySelector('#edit-repayment-ref-group');
  const editRepaymentRefLabel = container.querySelector('#edit-repayment-ref-label');
  const editRepaymentRefInput = container.querySelector('#edit-repayment-ref-input');

  const updateEditRepaymentReferenceState = () => {
    if (!editRepaymentMethod) return;
    const val = editRepaymentMethod.value;
    if (val === 'cash') {
      editRepaymentRefGroup.style.display = 'none';
      editRepaymentRefInput.removeAttribute('required');
    } else if (val === 'bank') {
      editRepaymentRefGroup.style.display = 'block';
      editRepaymentRefLabel.textContent = 'Bank Transfer / Cheque Reference';
      editRepaymentRefInput.placeholder = 'e.g. CHQ-987654';
      editRepaymentRefInput.setAttribute('required', 'true');
    } else {
      editRepaymentRefGroup.style.display = 'block';
      editRepaymentRefLabel.textContent = 'M-Pesa Transaction Code';
      editRepaymentRefInput.placeholder = 'e.g. QWE123RTY4';
      editRepaymentRefInput.setAttribute('required', 'true');
    }
  };

  const closeRepaymentEditModal = () => {
    if (!repaymentEditModal || !repaymentEditForm) return;
    repaymentEditModal.style.display = 'none';
    repaymentEditForm.reset();
  };

  const openRepaymentEditModal = (repayment) => {
    if (!canEditRepayments) {
      if (window.notify) window.notify.error('Only admins can edit repayment records.');
      return;
    }
    repaymentEditForm.elements.repayment_id.value = repayment.id;
    repaymentEditForm.elements.amount.value = Number(repayment.amount) || '';
    repaymentEditForm.elements.fine_amount.value = Number(repayment.fine_amount) || '';
    repaymentEditForm.elements.date.value = isoToDateInput(repayment.date || repayment.created);
    repaymentEditForm.elements.method.value = repayment.method || 'mpesa';
    repaymentEditForm.elements.reference.value = repayment.reference || '';
    repaymentEditForm.elements.note.value = repayment.note || '';
    repaymentEditSubtitle.textContent = `${formatDate(repayment.date)} · KES ${formatMoney(repayment.amount)}`;
    updateEditRepaymentReferenceState();
    repaymentEditModal.style.display = 'flex';
  };

  updateHistoryUI();
  updateBalanceOffUI();
  updateScheduleUI();
  updateCommentsUI();

  // Tab switching logic
  const tabs = container.querySelectorAll('.tab-btn');
  const contents = {
    overview: container.querySelector('#overview-tab'),
    history: container.querySelector('#history-tab'),
    record: container.querySelector('#record-tab'),
    balanceoff: container.querySelector('#balanceoff-tab'),
    schedule: container.querySelector('#schedule-tab'),
    comments: container.querySelector('#comments-tab')
  };

  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(contents).filter(Boolean).forEach(c => c.style.display = 'none');
      if (contents[tab.dataset.tab]) contents[tab.dataset.tab].style.display = 'block';
    };
  });
  const initialTab = contents[params.tab] ? params.tab : 'overview';
  const initialTabBtn = Array.from(tabs).find(tab => tab.dataset.tab === initialTab);
  if (initialTabBtn) initialTabBtn.click();

  const repairScheduleBtn = container.querySelector('#repair-schedule-btn');
  if (repairScheduleBtn) {
    repairScheduleBtn.onclick = async () => {
      const restoreButton = setButtonLoading(repairScheduleBtn, 'Repairing...');
      try {
        await loanService.ensureRepaymentSchedule(loan);
        if (window.notify) window.notify.success('Repayment schedule repaired successfully.');
        window.location.reload();
      } catch (err) {
        if (window.notify) window.notify.error('Schedule repair failed: ' + err.message);
        restoreButton();
      }
    };
  }

  const commentForm = container.querySelector('#loan-comment-form');
  if (commentForm) {
    commentForm.onsubmit = async (event) => {
      event.preventDefault();
      const formData = new FormData(commentForm);
      const comment = String(formData.get('comment') || '').trim();
      const commentDate = String(formData.get('comment_date') || '').trim();
      if (!comment || !commentDate) {
        if (window.notify) window.notify.error('Enter a dated comment before saving.');
        return;
      }

      const submitBtn = commentForm.querySelector('button[type="submit"]');
      const wasEditing = Boolean(editingCommentId);
      const editId = editingCommentId;
      const restoreButton = setButtonLoading(submitBtn, wasEditing ? 'Updating...' : 'Saving...');
      let completed = false;
      try {
        const userId = authService.getUser()?.id;
        const payload = {
          member: loan.member,
          comment,
          comment_date: new Date(`${commentDate}T12:00:00`).toISOString()
        };
        if (wasEditing) {
          if (!canEditComments) {
            throw new Error('Only admins can edit member comments.');
          }
          await memberCommentService.update(editId, payload);
        } else {
          await memberCommentService.create({
            ...payload,
            ...(userId ? { created_by: userId } : {})
          });
        }
        memberComments = await memberCommentService.getByMember(loan.member);
        commentsPage = 1;
        completed = true;
        if (window.notify) window.notify.success(wasEditing ? 'Member comment updated.' : 'Member comment saved.');
      } catch (err) {
        const schemaHint = err.status === 404 || err.status === 400
          ? ' Confirm that the member_comments collection exists in PocketHost.'
          : '';
        if (window.notify) window.notify.error(`Failed to ${wasEditing ? 'update' : 'save'} comment: ` + (err.message || 'Please try again.') + schemaHint);
      } finally {
        restoreButton();
        if (completed) {
          resetCommentForm();
          updateCommentsUI();
        }
      }
    };

    const cancelCommentEditBtn = container.querySelector('#loan-comment-cancel');
    if (cancelCommentEditBtn) {
      cancelCommentEditBtn.onclick = () => resetCommentForm();
    }
  }

  const balanceOffForm = container.querySelector('#balance-off-form');
  if (balanceOffForm) {
    balanceOffForm.onsubmit = async (event) => {
      event.preventDefault();
      if (!balanceOffForm.reportValidity()) return;

      const formData = new FormData(balanceOffForm);
      const amount = Number(formData.get('amount')) || 0;
      const surchargeAmount = Math.max(0, Number(formData.get('surcharge_amount')) || 0);
      const reason = String(formData.get('reason') || '').trim();
      const effectiveDateInput = String(formData.get('effective_date') || '').trim();
      const totalDebit = amount + surchargeAmount;

      if (!canBalanceOff) {
        if (window.notify) window.notify.error('Only admins can balance off active member loans.');
        return;
      }
      if (amount <= 0) {
        if (window.notify) window.notify.error('Enter a valid balance-off amount.');
        return;
      }
      if (!reason) {
        if (window.notify) window.notify.error('A reason is required for loan balance-off.');
        return;
      }
      if (amount > outstandingPrincipal + 0.01) {
        if (window.notify) window.notify.error(`Amount cannot exceed contractual OLB of KES ${formatMoney(outstandingPrincipal)}.`);
        return;
      }
      if (totalDebit > availableSavings + 0.01) {
        if (window.notify) window.notify.error(`Savings are insufficient. Available savings: KES ${formatMoney(availableSavings)}.`);
        return;
      }

      const confirmed = window.confirmDialog
        ? await window.confirmDialog({
            title: 'Confirm Balance-Off',
            message: `Use KES ${formatMoney(totalDebit)} from this member's savings to reduce loan ${loan.loan_no} by KES ${formatMoney(amount)}? Remaining contractual OLB will be about KES ${formatMoney(Math.max(0, outstandingPrincipal - amount))}.`,
            confirmText: 'Balance Off',
            cancelText: 'Cancel',
            type: 'warning'
          })
        : confirm(`Use KES ${formatMoney(totalDebit)} from savings to balance off this loan?`);
      if (!confirmed) return;

      const submitBtn = balanceOffForm.querySelector('button[type="submit"]');
      const restoreButton = setButtonLoading(submitBtn, 'Balancing off...');
      try {
        await loanService.recordBalanceOff({
          loan,
          amount,
          surchargeAmount,
          reason,
          availableSavings,
          effectiveDate: new Date(`${effectiveDateInput || todayInputValue}T12:00:00`).toISOString()
        });
        await recalculateRepaymentState();
        if (window.notify) window.notify.success('Loan balanced off from savings successfully.');
        await refreshLoanDetails();
      } catch (err) {
        const schemaHint = err.status === 404 || err.status === 400
          ? ' Confirm that the loan_balance_offs collection exists in PocketHost.'
          : '';
        if (window.notify) window.notify.error('Balance-off failed: ' + (err.message || 'Please try again.') + schemaHint);
        restoreButton();
      }
    };
  }

  if (repaymentEditForm) {
    container.querySelector('#repayment-edit-close').onclick = closeRepaymentEditModal;
    container.querySelector('#repayment-edit-cancel').onclick = closeRepaymentEditModal;
    repaymentEditModal.onclick = (event) => {
      if (event.target === repaymentEditModal) closeRepaymentEditModal();
    };
    editRepaymentMethod.onchange = updateEditRepaymentReferenceState;

    repaymentEditForm.onsubmit = async (event) => {
      event.preventDefault();
      if (!repaymentEditForm.reportValidity()) return;
      const formData = new FormData(repaymentEditForm);
      const data = Object.fromEntries(formData.entries());
      const repaymentId = data.repayment_id;
      const amount = Number(data.amount);
      const requestedFineAmount = Number(data.fine_amount) || 0;
      const fineAmount = Math.min(amount, requestedFineAmount);
      if (!repaymentId) return;
      if (!Number.isFinite(amount) || amount <= 0) {
        if (window.notify) window.notify.error('Enter a valid repayment amount.');
        return;
      }
      if (requestedFineAmount > amount) {
        if (window.notify) window.notify.error('Fine cannot be greater than the repayment amount.');
        return;
      }

      const currentRepayment = repayments.find(item => item.id === repaymentId);
      const editPaymentDate = new Date(`${data.date}T12:00:00`);
      const priorContractPaid = [...repayments]
        .filter(item => item.id !== repaymentId)
        .sort((a, b) => new Date(a.date || a.created || 0) - new Date(b.date || b.created || 0))
        .filter(item => new Date(item.date || item.created || 0) <= editPaymentDate)
        .reduce((sum, item) => sum + getRepaymentContractAmount(item), 0)
        + balanceOffs
          .filter(item => item.status !== 'reversed')
          .filter(item => new Date(item.effective_date || item.created || 0) <= editPaymentDate)
          .reduce((sum, item) => sum + getSettlementContractAmount(item), 0);
      const allocation = allocateRepayment({
        loan,
        repaymentAmount: amount,
        fineAmount,
        priorContractPaid
      });

      const restoreButton = setButtonLoading(repaymentEditForm.querySelector('button[type="submit"]'), 'Updating...');
      try {
        await loanService.updateRepayment(repaymentId, {
          amount,
          fine_amount: fineAmount,
          principal_amount: allocation.principalAmount,
          interest_amount: allocation.interestAmount,
          date: new Date(`${data.date}T12:00:00`).toISOString(),
          method: data.method || currentRepayment?.method || 'mpesa',
          reference: data.method === 'cash' ? '' : String(data.reference || '').trim(),
          note: String(data.note || '').trim()
        });
        await recalculateRepaymentState();
        closeRepaymentEditModal();
        if (window.notify) window.notify.success('Repayment updated and loan balances recalculated.');
        await refreshLoanDetails();
      } catch (err) {
        const schemaHint = err.status === 403
          ? ' Confirm that your user is an admin and the loan_repayments update rule is updated in PocketHost.'
          : '';
        if (window.notify) window.notify.error('Failed to update repayment: ' + (err.message || 'Please try again.') + schemaHint);
        restoreButton();
      }
    };
  }

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
    if (!paymentForm.reportValidity()) return;

    const formData = new FormData(paymentForm);
    const data = Object.fromEntries(formData.entries());
    const amount = parseFloat(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      if (window.notify) window.notify.error('Enter a valid payment amount before recording.');
      return;
    }
    const manualFineAmount = Math.max(0, Number(data.manual_fine_amount) || 0);
    if (manualFineAmount > amount) {
      if (window.notify) window.notify.error('Manual fine cannot be greater than the total amount received.');
      return;
    }
    const autoFinePaid = Math.min(penaltyState.outstandingFine, Math.max(0, amount - manualFineAmount));
    const fineAmount = autoFinePaid + manualFineAmount;
    const principalPaymentAmount = Math.max(0, amount - fineAmount);
    const paymentDate = new Date(data.date);
    const priorContractPaid = repayments.reduce(
      (sum, repaymentRecord) => sum + getRepaymentContractAmount(repaymentRecord),
      0
    ) + balanceOffs
      .filter(item => item.status !== 'reversed')
      .filter(item => new Date(item.effective_date || item.created || 0) <= paymentDate)
      .reduce((sum, item) => sum + getSettlementContractAmount(item), 0);
    const repaymentAllocation = allocateRepayment({
      loan,
      repaymentAmount: amount,
      fineAmount,
      priorContractPaid
    });

    const btn = paymentForm.querySelector('button[type="submit"]');
    const restoreButton = setButtonLoading(btn, 'Recording...');
    
    const repayment = {
      loan: loan.id,
      amount: amount,
      fine_amount: fineAmount,
      principal_amount: repaymentAllocation.principalAmount,
      interest_amount: repaymentAllocation.interestAmount,
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
      
      const balanceReduction = principalPaymentAmount + autoFinePaid;
      const outstandingAfterPayment = Math.max(0, outstandingBalance - balanceReduction);

      if (totalLiability > 0 && outstandingAfterPayment <= 0) {
        await loanService.update(loan.id, { status: 'completed' });
        if (window.notify) window.notify.success('Loan fully repaid and closed!');
      } else {
        if (window.notify) window.notify.success('Repayment recorded successfully!');
      }

      // Mark schedules as paid locally to avoid refetching complex logic
      let remaining = principalPaymentAmount;
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
        message: `Are you sure you want to disburse KES ${formatMoney(loan.approved_amount || loan.amount_applied)} to this client now? This will generate the repayment schedule.`,
        confirmText: 'Yes, Disburse 💸',
        type: 'success'
      }) : confirm('Disburse funds?');
      
      if (!confirmed) return;
      
      const restoreButton = setButtonLoading(disburseBtn, 'Disbursing...');
      const selectedDisbursementDate = container.querySelector('#details-disbursement-date')?.value;
      if (isInputDateBeforeRecordDate(selectedDisbursementDate, loan.application_date)) {
        if (window.notify) window.notify.error('Disbursement date cannot be before the application date.');
        restoreButton();
        return;
      }
      if (isInputDateBeforeRecordDate(selectedDisbursementDate, loan.approved_date)) {
        if (window.notify) window.notify.error('Disbursement date cannot be before the approval date.');
        restoreButton();
        return;
      }
      const disbursementDate = dateInputToIso(selectedDisbursementDate);
      try {
        const updatedLoan = await loanService.update(loan.id, {
          status: 'disbursed',
          disbursement_date: disbursementDate
        });
        
        await loanService.ensureRepaymentSchedule(updatedLoan);
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

  })();

  return container;
};
