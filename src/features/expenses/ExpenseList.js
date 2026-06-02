import { expenseService } from '../../services/expenseService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';
import { debounce } from '../../services/dataCache.js';
import { pb } from '../../services/api.js';

export const renderExpenseList = async () => {
  const container = document.createElement('div');
  let voteheads = [];
  let currentPage = 1;
  const pageSize = 10;
  let requestId = 0;
  let vMap = {};

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Expenses Tracking</h1>
        <p class="text-muted">Overview of institutional spending.</p>
      </div>
      <button class="btn btn-primary" onclick="window.location.hash = '#/expenses/new'">+ Record Expense</button>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div class="table-responsive">
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Votehead</th>
              <th>Description</th>
              <th style="text-align: right;">Amount (KES)</th>
            </tr>
          </thead>
          <tbody id="expense-table-body">
            <!-- Content will be injected here -->
          </tbody>
        </table>
      </div>
      <div id="pagination-wrapper"></div>
    </div>
  `;

  const tableBody = container.querySelector('#expense-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');

  const updateUI = async () => {
    const thisRequest = ++requestId;
    tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding: 40px;">Loading expenses...</td></tr>`;
    paginationWrapper.innerHTML = '';

    try {
      const [expenseResult, voteheadsResult] = await Promise.all([
        expenseService.getAll({ page: currentPage, perPage: pageSize }),
        voteheads.length > 0 ? Promise.resolve(voteheads) : expenseService.getVoteheads()
      ]);

      if (thisRequest !== requestId) return;
      voteheads = voteheadsResult || [];
      vMap = Object.fromEntries(voteheads.map(v => [v.id, v.name]));
      const paginatedItems = expenseResult.items;

      tableBody.innerHTML = paginatedItems.length === 0 ? `
        <tr><td colspan="4" class="text-center text-muted" style="padding: 40px;">No expenses recorded yet.</td></tr>
      ` : paginatedItems.map(e => `
        <tr>
          <td class="text-sm">${formatDate(e.date)}</td>
          <td><span class="badge badge-primary">${e.expand?.votehead?.name || vMap[e.votehead] || 'Unknown'}</span></td>
          <td class="text-sm">${e.description || '-'}</td>
          <td style="text-align: right;" class="font-semibold text-danger">
            ${(e.amount || 0).toLocaleString()}
          </td>
        </tr>
      `).join('');

      const pagination = renderPagination(expenseResult.totalItems, pageSize, currentPage, (newPage) => {
        currentPage = newPage;
        updateUI();
      });
      if (pagination) paginationWrapper.appendChild(pagination);
    } catch (err) {
      console.error('Failed to load expenses', err);
      tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger" style="padding: 40px;">Failed to load expenses: ${err.message || ''}</td></tr>`;
    }
  };

  updateUI();

  // Debounced refresh for real-time events
  const debouncedRefresh = debounce(async () => {
    await updateUI();
  }, 500);

  // Helper to safely invalidate cache and refresh
  const handleUpdate = (collection) => async () => {
    if (collection === 'voteheads') voteheads = [];
    debouncedRefresh();
  };

  container.__subscriptionPromise = Promise.all([
    pb.collection('expenses').subscribe('*', handleUpdate('expenses')),
    pb.collection('voteheads').subscribe('*', handleUpdate('voteheads'))
  ]);

  return container;
};
