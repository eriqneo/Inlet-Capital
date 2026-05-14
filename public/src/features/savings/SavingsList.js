import { getAll } from '../../core/db.js';
import { renderPagination } from '../../components/Pagination.js';

export const renderSavingsList = async () => {
  const container = document.createElement('div');
  const [transactions, members, groups] = await Promise.all([
    getAll('savings'),
    getAll('members'),
    getAll('groups')
  ]);
  
  let currentPage = 1;
  const pageSize = 10;
  const sortedTransactions = [...transactions].sort((a,b) => new Date(b.date) - new Date(a.date));

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

  const updateUI = () => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginatedItems = sortedTransactions.slice(start, end);

    tableBody.innerHTML = paginatedItems.length === 0 ? `
      <tr><td colspan="5" class="text-center text-muted" style="padding: 40px;">No transactions recorded.</td></tr>
    ` : paginatedItems.map(t => `
      <tr>
        <td class="text-sm">${new Date(t.date).toLocaleDateString()}</td>
        <td>
          <div class="font-semibold">${t.accountType === 'individual' ? (members.find(m => m.regNo === t.memberId)?.fullName || t.memberId) : (groups.find(g => g.groupId === t.groupId)?.name || t.groupId)}</div>
          <div class="text-xs text-muted">${t.memberId || t.groupId} | ${t.accountType.toUpperCase()}</div>
        </td>
        <td class="text-xs text-muted">${t.reference || '-'}</td>
        <td>
          <span class="badge ${t.amount > 0 ? 'badge-success' : 'badge-danger'}">
            ${t.amount > 0 ? 'DEPOSIT' : 'WITHDRAWAL'}
          </span>
        </td>
        <td style="text-align: right;" class="font-semibold ${t.amount > 0 ? 'text-success' : 'text-danger'}">
          ${t.amount.toLocaleString()}
        </td>
      </tr>
    `).join('');

    paginationWrapper.innerHTML = '';
    const pagination = renderPagination(sortedTransactions.length, pageSize, currentPage, (newPage) => {
      currentPage = newPage;
      updateUI();
    });
    if (pagination) paginationWrapper.appendChild(pagination);
  };

  updateUI();

  return container;
};
