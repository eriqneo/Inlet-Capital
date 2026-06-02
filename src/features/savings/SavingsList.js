import { savingsService } from '../../services/savingsService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';

export const renderSavingsList = async () => {
  const container = document.createElement('div');
  
  let currentPage = 1;
  const pageSize = 10;
  
  // We will load the data inside updateUI


  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Savings History</h1>
        <p class="text-muted">Consolidated view of all deposits and withdrawals.</p>
      </div>
      <button class="btn btn-primary" onclick="window.location.hash = '#/savings/new'">+ Record Transaction</button>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Member / Group Name</th>
              <th>Reference</th>
              <th>Transaction</th>
              <th style="text-align: right;">Amount (KES)</th>
            </tr>
          </thead>
          <tbody id="savings-table-body">
            <!-- Content will be injected here -->
          </tbody>
        </table>
      </div>
      <div id="pagination-wrapper"></div>
    </div>
  `;

  const tableBody = container.querySelector('#savings-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');

  const updateUI = async () => {
    try {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding: 40px;">Loading transactions...</td></tr>';
      
      const result = await savingsService.getAll({ page: currentPage, perPage: pageSize });
      const paginatedItems = result.items;

      tableBody.innerHTML = paginatedItems.length === 0 ? `
        <tr><td colspan="5" class="text-center text-muted" style="padding: 40px;">No transactions recorded.</td></tr>
      ` : paginatedItems.map(t => {
        let paymentLabel = '-';
        if (t.type === 'deposit') {
          const method = t.payment_method || 'mpesa';
          const icon = method === 'mpesa' ? '📱 M-Pesa' : (method === 'card' ? '💳 Card' : '💵 Cash');
          const refPart = t.reference && t.reference !== 'N/A' && t.reference !== 'CASH' && !t.reference.startsWith('SAVE-D-') ? `: ${t.reference}` : '';
          paymentLabel = `${icon}${refPart}`;
        } else {
          paymentLabel = t.reference || 'Withdrawal';
        }

        const targetName = t.expand?.member ? t.expand.member.full_name : (t.expand?.group ? t.expand.group.name : 'Unknown');
        const targetId = t.expand?.member ? t.expand.member.reg_no : (t.expand?.group ? t.expand.group.group_id : 'Unknown');
        const targetType = t.expand?.member ? 'INDIVIDUAL' : 'GROUP';

        return `
        <tr>
          <td class="text-sm">${formatDate(t.date)}</td>
          <td>
            <div class="font-semibold">${targetName}</div>
            <div class="text-xs text-muted">${targetId} | ${targetType}</div>
          </td>
          <td class="text-xs text-muted">${paymentLabel}</td>
          <td>
            <span class="badge ${t.type === 'deposit' ? 'badge-success' : 'badge-danger'}">
              ${t.type.toUpperCase()} ${t.is_reversed ? '(REVERSED)' : ''}
            </span>
          </td>
          <td style="text-align: right;" class="font-semibold ${t.type === 'deposit' ? 'text-success' : 'text-danger'}">
            ${t.type === 'deposit' ? '+' : '-'}${t.amount.toLocaleString()}
          </td>
        </tr>`;
      }).join('');

      paginationWrapper.innerHTML = '';
      const pagination = renderPagination(result.totalItems, pageSize, currentPage, (newPage) => {
        currentPage = newPage;
        updateUI();
      });
      if (pagination) paginationWrapper.appendChild(pagination);
    } catch (e) {
      console.error(e);
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger" style="padding: 40px;">Failed to load transactions.</td></tr>';
    }
  };

  updateUI();

  // Real-time updates
  const unsub = await savingsService.subscribeToChanges(() => updateUI());
  container.__subscriptions = [unsub];

  return container;
};
