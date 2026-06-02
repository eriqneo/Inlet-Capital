import { expenseService } from '../../services/expenseService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';
import { dataCache, debounce } from '../../services/dataCache.js';
import { pb } from '../../services/api.js';

export const renderExpenseList = async () => {
  const container = document.createElement('div');
  let expenses = [];
  let voteheads = [];
  
  const refresh = async () => {
    try {
      const [eRes, vRes] = await Promise.all([
        dataCache.get('expenses', () => expenseService.getFullList()),
        dataCache.get('voteheads', () => expenseService.getVoteheads())
      ]);
      expenses = eRes;
      voteheads = vRes;
    } catch (err) {
      console.error('Failed to load expenses', err);
      container.innerHTML = `<div class="card text-center text-danger">Failed to load expenses: ${err.message}</div>`;
      return;
    }
  };

  await refresh();

  // Map votehead ID to name
  let vMap = Object.fromEntries(voteheads.map(v => [v.id, v.name]));

  let currentPage = 1;
  const pageSize = 10;
  const sortedExpenses = [...expenses].sort((a,b) => new Date(b.date) - new Date(a.date));

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

  const updateUI = () => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginatedItems = sortedExpenses.slice(start, end);

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

    paginationWrapper.innerHTML = '';
    const pagination = renderPagination(sortedExpenses.length, pageSize, currentPage, (newPage) => {
      currentPage = newPage;
      updateUI();
    });
    if (pagination) paginationWrapper.appendChild(pagination);
  };

  // Debounced refresh for real-time events
  const debouncedRefresh = debounce(async () => {
    await refresh();
    vMap = Object.fromEntries(voteheads.map(v => [v.id, v.name]));
    sortedExpenses.length = 0;
    sortedExpenses.push(...[...expenses].sort((a,b) => new Date(b.date) - new Date(a.date)));
    updateUI();
  }, 500);

  // Helper to safely invalidate cache and refresh
  const handleUpdate = (collection) => async () => {
    await dataCache.invalidate(collection);
    debouncedRefresh();
  };

  const subs = await Promise.all([
    pb.collection('expenses').subscribe('*', handleUpdate('expenses')),
    pb.collection('voteheads').subscribe('*', handleUpdate('voteheads'))
  ]);
  container.__subscriptions = subs;

  return container;
};
