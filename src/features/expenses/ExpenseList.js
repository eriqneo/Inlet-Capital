import { expenseService } from '../../services/expenseService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate, formatMoney } from '../../core/utils.js';
import { dataCache, debounce } from '../../services/dataCache.js';
import { pb } from '../../services/api.js';
import { renderTableSkeletonRows, setButtonLoading, showDelayedLoading } from '../../core/uiState.js';

export const renderExpenseList = async () => {
  const container = document.createElement('div');
  let voteheads = [];
  let currentPage = 1;
  const pageSize = 10;
  let requestId = 0;
  let vMap = {};
  let dateRange = { from: '', to: '' };

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Expenses Tracking</h1>
        <p class="text-muted">Overview of institutional spending.</p>
      </div>
      <div style="display: flex; gap: 12px; align-items: center;">
        <button class="btn btn-outline" id="export-expenses-excel-btn" style="border-color: #10b981; color: #10b981;">📥 Export Excel</button>
        <button class="btn btn-primary" onclick="window.location.hash = '#/expenses/new'">+ Record Expense</button>
      </div>
    </div>

    <div id="expenses-summary-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-bottom: 16px;">
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--danger);">
        <div class="text-xs text-muted">Total Expenses</div>
        <div class="text-xl font-semibold text-danger" id="expenses-total-amount">KES 0</div>
        <div class="text-xs text-muted" id="expenses-total-period" style="margin-top: 6px;">All dates</div>
      </div>
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
        <div class="text-xs text-muted">Expense Entries</div>
        <div class="text-xl font-semibold text-primary" id="expenses-total-count">0</div>
      </div>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap;">
        <label class="text-xs text-muted" for="expense-date-from">From</label>
        <input type="date" id="expense-date-from" class="form-control" style="width: 145px; padding: 6px 8px; font-size: 0.75rem;" />
        <label class="text-xs text-muted" for="expense-date-to">To</label>
        <input type="date" id="expense-date-to" class="form-control" style="width: 145px; padding: 6px 8px; font-size: 0.75rem;" />
        <button type="button" class="btn btn-outline btn-sm" id="expense-date-clear" style="font-size: 0.75rem;">Clear</button>
      </div>
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
  const exportBtn = container.querySelector('#export-expenses-excel-btn');
  const dateFromInput = container.querySelector('#expense-date-from');
  const dateToInput = container.querySelector('#expense-date-to');
  const dateClearBtn = container.querySelector('#expense-date-clear');
  const expensesTotalAmount = container.querySelector('#expenses-total-amount');
  const expensesTotalPeriod = container.querySelector('#expenses-total-period');
  const expensesTotalCount = container.querySelector('#expenses-total-count');

  const buildDateFilter = () => {
    const filters = [];
    if (dateRange.from) filters.push(`date >= "${dateRange.from} 00:00:00"`);
    if (dateRange.to) filters.push(`date <= "${dateRange.to} 23:59:59"`);
    return filters.join(' && ');
  };

  const sanitizeCell = (value) => String(value ?? '-')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const getDateRangeLabel = () => {
    if (dateRange.from && dateRange.to) return `${formatDate(dateRange.from)} to ${formatDate(dateRange.to)}`;
    if (dateRange.from) return `From ${formatDate(dateRange.from)}`;
    if (dateRange.to) return `Until ${formatDate(dateRange.to)}`;
    return 'All dates';
  };

  const renderExpenseSummary = (items) => {
    const total = items.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
    expensesTotalAmount.textContent = `KES ${formatMoney(total)}`;
    expensesTotalPeriod.textContent = getDateRangeLabel();
    expensesTotalCount.textContent = items.length.toLocaleString();
  };

  const exportExpensesToExcel = async () => {
    const restoreButton = setButtonLoading(exportBtn, 'Exporting...');
    try {
      const [allExpenses, allVoteheads] = await Promise.all([
        expenseService.getFullList({ filter: buildDateFilter() }),
        voteheads.length > 0 ? Promise.resolve(voteheads) : expenseService.getVoteheads()
      ]);
      const voteheadMap = Object.fromEntries((allVoteheads || []).map(v => [v.id, v.name]));
      const generatedAt = new Date();
      const rangeLabel = dateRange.from || dateRange.to
        ? `Period: ${dateRange.from || 'Start'} to ${dateRange.to || 'Today'}`
        : 'Period: All Dates';
      let tsv = `Inlet Capital\nExpenses Report\n${rangeLabel}\nGenerated ${generatedAt.toLocaleString()}\n\n`;
      tsv += ['Date', 'Votehead', 'Description', 'Amount', 'Recorded By'].join('\t') + '\n';

      allExpenses.forEach(expense => {
        const row = [
          formatDate(expense.date),
          expense.expand?.votehead?.name || voteheadMap[expense.votehead] || 'Unknown',
          expense.description || '-',
          formatMoney(expense.amount),
          expense.expand?.recorded_by?.name || expense.expand?.recorded_by?.email || '-'
        ].map(sanitizeCell);
        tsv += row.join('\t') + '\n';
      });

      const blob = new Blob([tsv], { type: 'application/vnd.ms-excel' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inlet_expenses_${generatedAt.toISOString().split('T')[0]}.xls`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (window.notify) window.notify.success(`Exported ${allExpenses.length} expenses to Excel.`);
    } catch (err) {
      console.error('Failed to export expenses', err);
      if (window.notify) window.notify.error('Failed to export expenses: ' + (err.message || 'Unknown error'));
    } finally {
      restoreButton();
    }
  };

  exportBtn.onclick = exportExpensesToExcel;

  const updateUI = async () => {
    const thisRequest = ++requestId;
    const cancelLoading = showDelayedLoading(() => {
      if (thisRequest !== requestId) return;
      tableBody.innerHTML = renderTableSkeletonRows(4, 6);
      paginationWrapper.innerHTML = '';
    });

    try {
      const renderResult = (expenseResult, voteheadsResult, fullExpenses = null) => {
        if (thisRequest !== requestId) return;
        cancelLoading();
        voteheads = voteheadsResult || [];
        vMap = Object.fromEntries(voteheads.map(v => [v.id, v.name]));
        const paginatedItems = expenseResult.items;
        if (fullExpenses) renderExpenseSummary(fullExpenses);

        tableBody.innerHTML = paginatedItems.length === 0 ? `
          <tr><td colspan="4" class="text-center text-muted" style="padding: 40px;">No expenses recorded yet.</td></tr>
        ` : paginatedItems.map(e => `
          <tr>
            <td class="text-sm">${formatDate(e.date)}</td>
            <td><span class="badge badge-primary">${e.expand?.votehead?.name || vMap[e.votehead] || 'Unknown'}</span></td>
            <td class="text-sm">${e.description || '-'}</td>
            <td style="text-align: right;" class="font-semibold text-danger">
              ${formatMoney(e.amount)}
            </td>
          </tr>
        `).join('');

        paginationWrapper.innerHTML = '';
        const pagination = renderPagination(expenseResult.totalItems, pageSize, currentPage, (newPage) => {
          currentPage = newPage;
          updateUI();
        });
        if (pagination) paginationWrapper.appendChild(pagination);
      };

      const [expenseResult, voteheadsResult, allExpenses] = await Promise.all([
        expenseService.getAllCached({ page: currentPage, perPage: pageSize, filter: buildDateFilter() }, freshResult => {
          renderResult(freshResult, voteheads);
        }),
        voteheads.length > 0 ? Promise.resolve(voteheads) : expenseService.getVoteheads(),
        expenseService.getFullList({ filter: buildDateFilter() })
      ]);

      renderResult(expenseResult, voteheadsResult, allExpenses);
    } catch (err) {
      cancelLoading();
      console.error('Failed to load expenses', err);
      tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger" style="padding: 40px;">Failed to load expenses: ${err.message || ''}</td></tr>`;
    }
  };

  const applyDateRange = () => {
    dateRange = {
      from: dateFromInput?.value || '',
      to: dateToInput?.value || ''
    };
    currentPage = 1;
    updateUI();
  };

  if (dateFromInput) dateFromInput.onchange = applyDateRange;
  if (dateToInput) dateToInput.onchange = applyDateRange;
  if (dateClearBtn) {
    dateClearBtn.onclick = () => {
      if (dateFromInput) dateFromInput.value = '';
      if (dateToInput) dateToInput.value = '';
      applyDateRange();
    };
  }

  updateUI();

  // Debounced refresh for real-time events
  const debouncedRefresh = debounce(async () => {
    await updateUI();
  }, 500);

  // Helper to safely invalidate cache and refresh
  const handleUpdate = (collection) => async () => {
    if (collection === 'voteheads') {
      voteheads = [];
      await dataCache.invalidatePrefix('voteheads:');
    } else {
      await dataCache.invalidatePrefix('expenses:');
    }
    debouncedRefresh();
  };

  container.__subscriptionPromise = Promise.all([
    pb.collection('expenses').subscribe('*', handleUpdate('expenses')),
    pb.collection('voteheads').subscribe('*', handleUpdate('voteheads'))
  ]);

  return container;
};
