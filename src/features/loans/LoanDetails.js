import { getById, getAll, put, add } from '../../core/db.js';
import { renderPagination } from '../../components/Pagination.js';

export const renderLoanDetails = async (params) => {
  const { id } = params;
  const loan = await getById('loans', id);

  if (!loan) {
    const el = document.createElement('div');
    el.innerHTML = `<div class="card text-center"><h2>Loan Not Found</h2><button class="btn btn-primary" onclick="window.location.hash = '#/loans'">Back to List</button></div>`;
    return el;
  }

  // Fetch all related data
  const [schedule, repayments, members, groups] = await Promise.all([
    getAll('loan_schedule'),
    getAll('loan_repayments'),
    getAll('members'),
    getAll('groups')
  ]);

  let clientName = 'Unknown';
  if (loan.memberId) {
    const member = members.find(m => m.regNo === loan.memberId);
    if (member) clientName = member.fullName;
  } else if (loan.groupId) {
    const group = groups.find(g => g.groupId === loan.groupId);
    if (group) clientName = group.name;
  }

  const loanSchedule = schedule.filter(s => s.loanId === id);
  const loanRepayments = repayments.filter(r => r.loanNo === id).sort((a, b) => new Date(b.date) - new Date(a.date));

  // Calculate Financials
  const totalPaid = loanRepayments.reduce((sum, r) => sum + r.amount, 0);
  const outstandingBalance = Math.max(0, loan.totalLiability - totalPaid);
  const percentRepaid = Math.min(100, (totalPaid / loan.totalLiability) * 100);

  let historyPage = 1;
  let schedulePage = 1;
  const pageSize = 10;

  const container = document.createElement('div');
  
  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/loans'">← Back</button>
        <div>
          <h1 class="text-xl">Loan Management: ${loan.loanNo}</h1>
          <div class="text-sm text-muted" style="margin-top: 4px;">Client: <span class="font-semibold" style="color: var(--primary);">${clientName}</span></div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span class="badge ${
          loan.status === 'completed' ? 'badge-success' :
          loan.status === 'rejected' ? 'badge-danger' :
          (loan.status === 'approved' && loan.partialReason) ? 'badge-warning' :
          'badge-primary'
        }">${loan.status.toUpperCase()}${loan.partialReason ? ' (PARTIAL)' : ''}</span>
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
            <div style="font-size: 0.8rem; color: var(--text-muted);">📋 Applied Amount: <span class="font-semibold">KES ${loan.amountApplied.toLocaleString()}</span></div>
            <div style="font-size: 0.8rem; color: #ef4444;">❌ Approved Amount: <span class="font-semibold">Nil</span></div>
          </div>
        </div>
      </div>
    </div>` : ''}

    ${(loan.partialReason || (loan.approvedAmount && loan.approvedAmount < loan.amountApplied)) && loan.status !== 'rejected' ? `
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
              <span style="color: var(--text-muted);">Applied: <b>KES ${loan.amountApplied.toLocaleString()}</b></span>
              <span style="color: #d97706;">Approved: <b>KES ${(loan.approvedAmount || 0).toLocaleString()}</b></span>
            </div>
            <div style="height: 10px; background: #fef3c7; border-radius: 5px; overflow: hidden;">
              <div style="height: 100%; width: ${Math.round(((loan.approvedAmount || 0) / loan.amountApplied) * 100)}%; background: linear-gradient(90deg, #f59e0b, #d97706); border-radius: 5px;"></div>
            </div>
            <div style="margin-top: 6px; font-size: 0.75rem; color: #d97706; text-align: right; font-weight: 600;">
              KES ${(loan.amountApplied - (loan.approvedAmount || 0)).toLocaleString()} reduced (${Math.round(((loan.amountApplied - (loan.approvedAmount || 0)) / loan.amountApplied) * 100)}% cut)
            </div>
          </div>
          ${loan.partialReason ? `
          <div style="background: white; border-left: 3px solid #f59e0b; border-radius: 0 8px 8px 0; padding: 14px 16px; font-size: 0.95rem; color: var(--text-main); font-style: italic; line-height: 1.6; box-shadow: 0 2px 8px rgba(245,158,11,0.08);">
            "${loan.partialReason}"
          </div>` : ''}
        </div>
      </div>
    </div>` : ''}


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
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
            <div>
              <div class="text-sm text-muted" style="margin-bottom: 8px;">Outstanding Balance</div>
              <div style="font-size: 2.5rem; font-weight: 700; color: ${outstandingBalance > 0 ? 'var(--danger)' : 'var(--success)'};">
                KES ${outstandingBalance.toLocaleString()}
              </div>
              <div style="margin-top: 20px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 6px;">
                  <span>Repayment Progress</span>
                  <span class="font-semibold">${percentRepaid.toFixed(1)}%</span>
                </div>
                <div style="width: 100%; height: 8px; background: var(--bg-light); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${percentRepaid}%; height: 100%; background: var(--success); transition: width 0.3s ease;"></div>
                </div>
              </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div style="padding: 16px; background: var(--bg-light); border-radius: 8px;">
                <div class="text-xs text-muted">Total Liability</div>
                <div class="font-semibold">KES ${loan.totalLiability.toLocaleString()}</div>
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
                <div class="text-xs text-muted">Applicant ID</div>
                <div class="font-semibold">${loan.memberId || loan.groupId}</div>
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
                <select name="method" class="form-control">
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
            <div class="form-group">
              <label class="form-label">Reference (M-Pesa Code / Receipt)</label>
              <input type="text" name="reference" class="form-control" required />
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
    const paginated = loanRepayments.slice(start, start + pageSize);
    const tbody = container.querySelector('#repayment-history-body');
    
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No repayments recorded yet.</td></tr>' : paginated.map(r => `
      <tr>
        <td>${new Date(r.date).toLocaleDateString()}</td>
        <td><div class="font-semibold">${r.reference || 'N/A'}</div><div class="text-xs text-muted">${r.method.toUpperCase()}</div></td>
        <td class="text-xs text-muted">${r.recordedBy}</td>
        <td class="text-right font-semibold text-success">KES ${r.amount.toLocaleString()}</td>
      </tr>`).join('');

    const pag = container.querySelector('#repayment-history-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(loanRepayments.length, pageSize, historyPage, (p) => { historyPage = p; updateHistoryUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  const updateScheduleUI = () => {
    const start = (schedulePage - 1) * pageSize;
    const paginated = loanSchedule.slice(start, start + pageSize);
    const tbody = container.querySelector('#loan-schedule-body');
    
    tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No schedule found.</td></tr>' : paginated.map(s => `
      <tr>
        <td>${s.installmentNo}</td>
        <td>${new Date(s.dueDate).toLocaleDateString()}</td>
        <td class="text-right">KES ${s.amount.toLocaleString()}</td>
        <td><span class="badge ${s.status === 'paid' ? 'badge-success' : 'badge-warning'}">${s.status.toUpperCase()}</span></td>
      </tr>`).join('');

    const pag = container.querySelector('#loan-schedule-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(loanSchedule.length, pageSize, schedulePage, (p) => { schedulePage = p; updateScheduleUI(); });
    if (ctrl) pag.appendChild(ctrl);
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

  // Handle Repayment Submission
  const paymentForm = container.querySelector('#payment-form');
  paymentForm.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(paymentForm);
    const data = Object.fromEntries(formData.entries());
    const amount = parseFloat(data.amount);
    
    const repayment = {
      loanNo: id,
      memberId: loan.memberId,
      amount: amount,
      date: data.date,
      method: data.method,
      reference: data.reference,
      note: data.note,
      recordedBy: 'admin',
      timestamp: new Date().toISOString()
    };

    try {
      await add('loan_repayments', repayment);
      const updatedRepayments = await getAll('loan_repayments');
      const totalRepaidNow = updatedRepayments.filter(r => r.loanNo === id).reduce((sum, r) => sum + r.amount, 0);

      if (totalRepaidNow >= loan.totalLiability) {
        loan.status = 'completed';
        await put('loans', loan);
        notify.success('Loan fully repaid and closed!');
      } else {
        notify.success('Repayment recorded successfully!');
      }
      window.location.reload();
    } catch (err) {
      notify.error('Error: ' + err.message);
    }
  };

  return container;
};
