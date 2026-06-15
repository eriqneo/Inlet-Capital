import { savingsService } from '../../services/savingsService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';
import { dataCache } from '../../services/dataCache.js';
import { renderTableSkeletonRows, showDelayedLoading } from '../../core/uiState.js';
import { withReturnTo } from '../../core/navigation.js';

export const renderSavingsList = async () => {
  const container = document.createElement('div');
  
  let currentPage = 1;
  const pageSize = 10;
  let requestId = 0;
  let alphaSort = 'default';
  
  // We will load the data inside updateUI


  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Savings History</h1>
        <p class="text-muted">Consolidated view of all deposits and withdrawals.</p>
      </div>
      <button class="btn btn-primary" onclick="window.location.hash = '${withReturnTo('#/savings/new', '#/savings')}'">+ Record Transaction</button>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap;">
        <select id="savings-alpha-sort" class="form-control" style="max-width: 180px;">
          <option value="default">Latest</option>
          <option value="az">Name A-Z</option>
          <option value="za">Name Z-A</option>
        </select>
      </div>
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
  const alphaSortSelect = container.querySelector('#savings-alpha-sort');

  const getTransactionTargetName = (transaction) => (
    transaction.expand?.member?.full_name
    || transaction.expand?.group?.name
    || 'Unknown'
  );

  const sortTransactionsAlphabetically = (items) => [...items].sort((a, b) => {
    const comparison = getTransactionTargetName(a).localeCompare(getTransactionTargetName(b), undefined, { sensitivity: 'base' });
    return alphaSort === 'za' ? -comparison : comparison;
  });

  const renderTransactions = (items) => {
    return items.map(t => {
      const type = t.type || 'deposit';
      const amount = Number(t.amount) || 0;
      const reference = String(t.reference || '');
      let paymentLabel = '-';
      const method = t.payment_method || (type === 'withdrawal' ? 'cash' : 'mpesa');
      const methodLabel = method === 'mpesa' ? '📱 M-Pesa' : (method === 'bank' ? '🏦 Bank' : (method === 'card' ? '💳 Card' : '💵 Cash'));
      const refPart = reference && reference !== 'N/A' && reference !== 'CASH' && !reference.startsWith('SAVE-D-') ? `: ${reference}` : '';
      paymentLabel = `${type === 'withdrawal' ? 'Sent via ' : 'Received via '}${methodLabel}${refPart}`;

      const memberGroup = t.expand?.member?.expand?.group;
      const targetName = getTransactionTargetName(t);
      const targetId = t.expand?.member ? t.expand.member.reg_no : (t.expand?.group ? t.expand.group.group_id : (t.member || t.group || 'Unknown'));
      const targetType = t.expand?.member
        ? (memberGroup ? `GROUP: ${memberGroup.name}` : 'INDIVIDUAL')
        : 'GROUP';

      return `
      <tr>
        <td class="text-sm">${formatDate(t.date)}</td>
        <td>
          <div class="font-semibold">${targetName}</div>
          <div class="text-xs text-muted">${targetId} | ${targetType}</div>
        </td>
        <td class="text-xs text-muted">${paymentLabel}</td>
        <td>
          <span class="badge ${type === 'deposit' ? 'badge-success' : 'badge-danger'}">
            ${type.toUpperCase()} ${t.is_reversed ? '(REVERSED)' : ''}
          </span>
        </td>
        <td style="text-align: right;" class="font-semibold ${type === 'deposit' ? 'text-success' : 'text-danger'}">
          ${type === 'deposit' ? '+' : '-'}${amount.toLocaleString()}
        </td>
      </tr>`;
    }).join('');
  };

  const updateUI = async () => {
    const thisRequest = ++requestId;
    const cancelLoading = showDelayedLoading(() => {
      if (thisRequest !== requestId) return;
      tableBody.innerHTML = renderTableSkeletonRows(5, 6);
      paginationWrapper.innerHTML = '';
    });
    try {
      const renderResult = (result) => {
        if (thisRequest !== requestId) return;
        cancelLoading();
        const paginatedItems = result.items;

        tableBody.innerHTML = paginatedItems.length === 0 ? `
          <tr><td colspan="5" class="text-center text-muted" style="padding: 40px;">No transactions recorded.</td></tr>
        ` : renderTransactions(paginatedItems);

        paginationWrapper.innerHTML = '';
        const pagination = renderPagination(result.totalItems, pageSize, currentPage, (newPage) => {
          currentPage = newPage;
          updateUI();
        });
        if (pagination) paginationWrapper.appendChild(pagination);
      };
      
      if (alphaSort !== 'default') {
        const allTransactions = await savingsService.getFullListCached({
          sort: '-date',
          cacheKey: 'savings:list:alpha:expanded:v1'
        });
        const sortedTransactions = sortTransactionsAlphabetically(allTransactions);
        const start = (currentPage - 1) * pageSize;
        renderResult({
          items: sortedTransactions.slice(start, start + pageSize),
          totalItems: sortedTransactions.length
        });
        return;
      }

      let result;
      try {
        const query = { page: currentPage, perPage: pageSize };
        result = await savingsService.getAllCached(query, freshResult => renderResult(freshResult));
      } catch (err) {
        console.warn('[SavingsList] Expanded transaction load failed, retrying basic query:', err);
        const query = { page: currentPage, perPage: pageSize };
        result = await savingsService.getAllBasicCached(query, freshResult => renderResult(freshResult));
      }

      renderResult(result);
    } catch (e) {
      cancelLoading();
      console.error('[SavingsList] Failed to load transactions:', e);
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger" style="padding: 40px;">Failed to load transactions. ${e.message || ''}</td></tr>`;
    }
  };

  alphaSortSelect.onchange = () => {
    alphaSort = alphaSortSelect.value;
    currentPage = 1;
    updateUI();
  };

  updateUI();

  // Real-time updates
  container.__subscriptionPromise = savingsService.subscribeToChanges(async () => {
    await dataCache.invalidatePrefix('savings:');
    updateUI();
  })
    .then(unsub => [unsub]);

  return container;
};
