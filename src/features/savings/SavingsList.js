import { savingsService } from '../../services/savingsService.js';
import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { authService } from '../../services/authService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate, formatMoney } from '../../core/utils.js';
import { dataCache } from '../../services/dataCache.js';
import { renderTableSkeletonRows, showDelayedLoading, setButtonLoading } from '../../core/uiState.js';
import { withReturnTo } from '../../core/navigation.js';
import { canUseOfficerFilter, createOfficerScope, loadOfficerOptions, matchesOfficer, populateOfficerSelect } from '../../core/officerScope.js';

export const renderSavingsList = async () => {
  const container = document.createElement('div');
  
  let currentPage = 1;
  const pageSize = 10;
  let requestId = 0;
  let alphaSort = 'default';
  let officerFilter = 'all';
  let dateFrom = '';
  let dateTo = '';
  let members = [];
  let groups = [];
  let latestTransactions = [];
  const canManageSavings = ['super_admin', 'admin'].includes(authService.getUser()?.role);
  
  // We will load the data inside updateUI


  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="text-xl">Savings History</h1>
        <p class="text-muted">Consolidated view of all deposits and withdrawals.</p>
      </div>
      <button class="btn btn-primary" onclick="window.location.hash = '${withReturnTo('#/savings/new', '#/savings')}'">+ Record Transaction</button>
    </div>

    <div id="savings-summary-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-bottom: 16px;">
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--success);">
        <div class="text-xs text-muted">Total Savings Net</div>
        <div class="text-xl font-semibold text-success" id="savings-net-total">KES 0</div>
        <div class="text-xs" id="savings-movement-total" style="margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap;">
          <span style="color: var(--success); font-weight: 700;">DEP 0</span>
          <span style="color: var(--danger); font-weight: 700;">WIT 0</span>
        </div>
      </div>
      <div class="card" style="background: var(--bg-light); border-left: 4px solid var(--primary);">
        <div class="text-xs text-muted">Transactions</div>
        <div class="text-xl font-semibold text-primary" id="savings-entry-total">0</div>
      </div>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <div class="savings-filter-bar">
        <div id="savings-reconcile-banner" class="savings-reconcile-slot"></div>
        <div class="savings-filter-controls">
          <div class="savings-date-range">
            <span class="savings-filter-label">Date Range</span>
            <label class="savings-date-field" for="savings-date-from">
              <span>From</span>
              <input type="date" id="savings-date-from" />
            </label>
            <label class="savings-date-field" for="savings-date-to">
              <span>To</span>
              <input type="date" id="savings-date-to" />
            </label>
            <button type="button" class="savings-clear-filter" id="savings-date-clear">Clear</button>
          </div>
          <select id="savings-alpha-sort" class="form-control savings-filter-select">
            <option value="default">Latest</option>
            <option value="az">Name A-Z</option>
            <option value="za">Name Z-A</option>
          </select>
          ${canUseOfficerFilter() ? '<select id="savings-officer-filter" class="form-control savings-filter-select savings-officer-select"><option value="all">All Loan Officers</option></select>' : ''}
        </div>
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
              ${canManageSavings ? '<th style="text-align: right;">Actions</th>' : ''}
            </tr>
          </thead>
          <tbody id="savings-table-body">
            <!-- Content will be injected here -->
          </tbody>
        </table>
      </div>
      <div id="pagination-wrapper"></div>
    </div>

    <style>
      .savings-filter-bar {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        background: linear-gradient(180deg, #fff 0%, rgba(248, 250, 252, 0.72) 100%);
      }
      .savings-reconcile-slot {
        flex: 1 1 260px;
        min-width: 220px;
      }
      .savings-filter-controls {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex: 2 1 640px;
        flex-wrap: wrap;
      }
      .savings-date-range {
        height: 40px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: #fff;
      }
      .savings-filter-label {
        padding: 0 8px;
        font-size: 0.68rem;
        font-weight: 800;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        white-space: nowrap;
      }
      .savings-date-field {
        height: 30px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0 8px;
        border-left: 1px solid var(--border-color);
        color: var(--text-muted);
        font-size: 0.72rem;
        font-weight: 700;
        white-space: nowrap;
      }
      .savings-date-field input {
        width: 130px;
        height: 28px;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text-main);
        font: inherit;
        font-size: 0.82rem;
        font-weight: 500;
      }
      .savings-clear-filter {
        height: 30px;
        padding: 0 12px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: var(--bg-light);
        color: var(--primary);
        font-size: 0.74rem;
        font-weight: 800;
        cursor: pointer;
      }
      .savings-clear-filter:hover {
        border-color: var(--primary);
        background: rgba(27, 61, 114, 0.06);
      }
      .savings-filter-select {
        width: auto;
        min-width: 150px;
        max-width: 190px;
        height: 40px;
        padding: 8px 34px 8px 12px;
        border-radius: 8px;
      }
      .savings-officer-select {
        min-width: 210px;
        max-width: 240px;
      }
      @media (max-width: 820px) {
        .savings-filter-controls,
        .savings-date-range,
        .savings-filter-select {
          width: 100%;
        }
        .savings-date-range {
          height: auto;
          flex-wrap: wrap;
          padding: 8px;
        }
        .savings-date-field {
          flex: 1 1 180px;
          border-left: 0;
          border-top: 1px solid var(--border-color);
          padding-top: 8px;
        }
        .savings-date-field input {
          width: 100%;
        }
      }
    </style>

    <div id="assign-savings-modal" class="modal" style="display: none; position: fixed; z-index: 1000; inset: 0; background: rgba(15,37,69,0.48); backdrop-filter: blur(6px); align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: min(520px, 100%); padding: 0; overflow: hidden;">
        <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; gap: 16px; align-items: center;">
          <div>
            <h2 class="text-lg">Assign Saving to Member</h2>
            <p class="text-xs text-muted" id="assign-savings-subtitle" style="margin-top: 4px;">Move this old group-account transaction to the correct group member.</p>
          </div>
          <button type="button" id="assign-savings-close" aria-label="Close" style="background: transparent; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted);">&times;</button>
        </div>
        <form id="assign-savings-form" style="padding: 24px;">
          <input type="hidden" name="savingId" id="assign-saving-id" />
          <div class="form-group">
            <label class="form-label">Group Member</label>
            <select name="memberId" id="assign-member-id" class="form-control" required></select>
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
            <button type="button" class="btn btn-outline" id="assign-savings-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Assign Member</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const tableBody = container.querySelector('#savings-table-body');
  const paginationWrapper = container.querySelector('#pagination-wrapper');
  const dateFromInput = container.querySelector('#savings-date-from');
  const dateToInput = container.querySelector('#savings-date-to');
  const dateClearBtn = container.querySelector('#savings-date-clear');
  const alphaSortSelect = container.querySelector('#savings-alpha-sort');
  const officerFilterSelect = container.querySelector('#savings-officer-filter');
  const savingsNetTotal = container.querySelector('#savings-net-total');
  const savingsMovementTotal = container.querySelector('#savings-movement-total');
  const savingsEntryTotal = container.querySelector('#savings-entry-total');
  const reconcileBanner = container.querySelector('#savings-reconcile-banner');
  const assignModal = container.querySelector('#assign-savings-modal');
  const assignForm = container.querySelector('#assign-savings-form');
  const assignMemberSelect = container.querySelector('#assign-member-id');
  const assignSavingId = container.querySelector('#assign-saving-id');
  const assignSubtitle = container.querySelector('#assign-savings-subtitle');

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
  const getRelationId = (value) => typeof value === 'string' ? value : (value?.id || '');
  const getTransactionMemberId = (transaction) => getRelationId(transaction?.member) || transaction?.expand?.member?.id || '';
  const getTransactionGroupId = (transaction) => getRelationId(transaction?.group) || transaction?.expand?.group?.id || '';
  const getGroupMembers = (groupId) => members.filter(member => member.group === groupId || member.expand?.group?.id === groupId);
  const isAssignableGroupSaving = (transaction) => Boolean(getTransactionGroupId(transaction) && !getTransactionMemberId(transaction) && !transaction.is_reversed);
  const getSavingsSignedAmount = (transaction) => {
    const amount = Number(transaction?.amount) || 0;
    return transaction?.type === 'withdrawal' ? -amount : amount;
  };
  const toStartOfDayIso = (value) => value ? new Date(`${value}T00:00:00`).toISOString() : '';
  const toEndOfDayIso = (value) => value ? new Date(`${value}T23:59:59.999`).toISOString() : '';
  const getDateFilter = () => {
    const filters = [];
    if (dateFrom) filters.push(`date>="${toStartOfDayIso(dateFrom)}"`);
    if (dateTo) filters.push(`date<="${toEndOfDayIso(dateTo)}"`);
    return filters.join(' && ');
  };

  const getTransactionTargetName = (transaction) => (
    transaction.expand?.member?.full_name
    || transaction.expand?.group?.name
    || 'Unknown'
  );

  const renderReconcileBanner = (items) => {
    if (!canManageSavings) {
      reconcileBanner.innerHTML = '';
      return;
    }

    const assignable = items.filter(isAssignableGroupSaving);
    const autoFixable = assignable.filter(transaction => getGroupMembers(getTransactionGroupId(transaction)).length === 1);
    if (assignable.length === 0) {
      reconcileBanner.innerHTML = '';
      return;
    }

    reconcileBanner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <span class="badge badge-warning" style="font-size: 0.7rem;">${assignable.length} group savings need member assignment</span>
        ${autoFixable.length > 0 ? `<button type="button" class="btn btn-outline btn-sm" id="auto-fix-group-savings-btn">Auto-fix ${autoFixable.length}</button>` : ''}
      </div>
    `;

    const autoFixBtn = reconcileBanner.querySelector('#auto-fix-group-savings-btn');
    if (autoFixBtn) {
      autoFixBtn.onclick = async () => {
        const confirmed = window.confirmDialog ? await window.confirmDialog({
          title: 'Auto-fix group member savings?',
          message: `Assign ${autoFixable.length} group-account savings transaction(s) to the only member in each group. This will make Individual Performance and Group reports tally correctly.`,
          confirmText: 'Auto-fix',
          type: 'info'
        }) : confirm(`Auto-fix ${autoFixable.length} group savings?`);
        if (!confirmed) return;

        const restoreButton = setButtonLoading(autoFixBtn, 'Fixing...');
        try {
          for (const transaction of autoFixable) {
            const groupId = getTransactionGroupId(transaction);
            const [member] = getGroupMembers(groupId);
            await savingsService.update(transaction.id, { member: member.id, group: groupId });
          }
          if (window.notify) window.notify.success('Group member savings reconciled.');
          await dataCache.invalidatePrefix('savings:');
          await updateUI();
        } catch (err) {
          if (window.notify) window.notify.error('Failed to reconcile savings: ' + (err.message || 'Please try again.'));
        } finally {
          restoreButton();
        }
      };
    }
  };

  const renderSavingsSummary = (items) => {
    const activeItems = items.filter(item => !item.is_reversed);
    const deposits = activeItems
      .filter(item => (item.type || 'deposit') === 'deposit')
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const withdrawals = activeItems
      .filter(item => item.type === 'withdrawal')
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const net = activeItems.reduce((sum, item) => sum + getSavingsSignedAmount(item), 0);

    savingsNetTotal.textContent = `KES ${formatMoney(net)}`;
    savingsMovementTotal.innerHTML = `
      <span style="color: var(--success); font-weight: 700;">DEP ${formatMoney(deposits)}</span>
      <span style="color: var(--danger); font-weight: 700;">WIT ${formatMoney(withdrawals)}</span>
    `;
    savingsEntryTotal.textContent = activeItems.length.toLocaleString();
  };

  const sortTransactionsAlphabetically = (items) => [...items].sort((a, b) => {
    const comparison = getTransactionTargetName(a).localeCompare(getTransactionTargetName(b), undefined, { sensitivity: 'base' });
    return alphaSort === 'za' ? -comparison : comparison;
  });
  const filterTransactionsByOfficer = (items) => {
    if (officerFilter === 'all') return items;
    const { getSavingOfficerId } = createOfficerScope({ members, groups });
    return items.filter(item => matchesOfficer(getSavingOfficerId(item), officerFilter));
  };

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
          ${type === 'deposit' ? '+' : '-'}${formatMoney(amount)}
        </td>
        ${canManageSavings ? `
          <td style="text-align: right;">
            ${isAssignableGroupSaving(t) ? `<button type="button" class="btn btn-outline btn-sm assign-saving-btn" data-id="${t.id}">Assign</button>` : '<span class="text-xs text-muted">-</span>'}
          </td>
        ` : ''}
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
      const dateFilter = getDateFilter();
      const renderResult = (result) => {
        if (thisRequest !== requestId) return;
        cancelLoading();
        const paginatedItems = result.items;

        tableBody.innerHTML = paginatedItems.length === 0 ? `
          <tr><td colspan="${canManageSavings ? 6 : 5}" class="text-center text-muted" style="padding: 40px;">No transactions recorded.</td></tr>
        ` : renderTransactions(paginatedItems);

        paginationWrapper.innerHTML = '';
        const pagination = renderPagination(result.totalItems, pageSize, currentPage, (newPage) => {
          currentPage = newPage;
          updateUI();
        });
        if (pagination) paginationWrapper.appendChild(pagination);
      };
      
      if (alphaSort !== 'default' || officerFilter !== 'all') {
        const allTransactions = await savingsService.getFullListCached({
          filter: dateFilter,
          sort: '-date',
          cacheKey: 'savings:list:alpha:expanded:v1'
        });
        const officerTransactions = filterTransactionsByOfficer(allTransactions);
        const sortedTransactions = alphaSort === 'default'
          ? officerTransactions
          : sortTransactionsAlphabetically(officerTransactions);
        latestTransactions = sortedTransactions;
        renderSavingsSummary(sortedTransactions);
        renderReconcileBanner(sortedTransactions);
        const start = (currentPage - 1) * pageSize;
        renderResult({
          items: sortedTransactions.slice(start, start + pageSize),
          totalItems: sortedTransactions.length
        });
        return;
      }

      let result;
      try {
        const query = { page: currentPage, perPage: pageSize, filter: dateFilter };
        result = await savingsService.getAllCached(query, freshResult => renderResult(freshResult));
      } catch (err) {
        console.warn('[SavingsList] Expanded transaction load failed, retrying basic query:', err);
        const query = { page: currentPage, perPage: pageSize, filter: dateFilter };
        result = await savingsService.getAllBasicCached(query, freshResult => renderResult(freshResult));
      }

      renderResult(result);
      const allForBanner = await savingsService.getFullListCached({
        filter: dateFilter,
        sort: '-date',
        cacheKey: 'savings:reconcile:expanded:v1'
      });
      latestTransactions = allForBanner;
      renderSavingsSummary(allForBanner);
      renderReconcileBanner(allForBanner);
    } catch (e) {
      cancelLoading();
      console.error('[SavingsList] Failed to load transactions:', e);
      tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger" style="padding: 40px;">Failed to load transactions. ${e.message || ''}</td></tr>`;
    }
  };

  const openAssignModal = (transaction) => {
    const groupId = getTransactionGroupId(transaction);
    const group = groups.find(item => item.id === groupId) || transaction.expand?.group;
    const groupMembers = getGroupMembers(groupId);
    assignSavingId.value = transaction.id;
    assignSubtitle.textContent = `${group?.name || 'Selected group'} · ${formatDate(transaction.date)} · KES ${formatMoney(transaction.amount)}`;
    assignMemberSelect.innerHTML = groupMembers.length === 0
      ? '<option value="">No members found in this group</option>'
      : groupMembers.map(member => `<option value="${member.id}">${escapeHtml(member.full_name || 'Unnamed member')} (${escapeHtml(member.reg_no || member.id_number || '-')})</option>`).join('');
    assignModal.style.display = 'flex';
  };

  const closeAssignModal = () => {
    assignModal.style.display = 'none';
    assignForm.reset();
  };

  tableBody.onclick = (event) => {
    const btn = event.target.closest('.assign-saving-btn');
    if (!btn) return;
    const transaction = latestTransactions.find(item => item.id === btn.dataset.id);
    if (transaction) openAssignModal(transaction);
  };

  container.querySelector('#assign-savings-close').onclick = closeAssignModal;
  container.querySelector('#assign-savings-cancel').onclick = closeAssignModal;
  assignModal.onclick = (event) => {
    if (event.target === assignModal) closeAssignModal();
  };
  assignForm.onsubmit = async (event) => {
    event.preventDefault();
    const transaction = latestTransactions.find(item => item.id === assignSavingId.value);
    if (!transaction) return;
    const memberId = assignMemberSelect.value;
    if (!memberId) return window.notify?.error('Select the member who made this saving.');
    const groupId = getTransactionGroupId(transaction);
    const restoreButton = setButtonLoading(assignForm.querySelector('button[type="submit"]'), 'Assigning...');
    try {
      await savingsService.update(transaction.id, { member: memberId, group: groupId });
      closeAssignModal();
      if (window.notify) window.notify.success('Saving assigned to member.');
      await dataCache.invalidatePrefix('savings:');
      await updateUI();
    } catch (err) {
      if (window.notify) window.notify.error('Failed to assign saving: ' + (err.message || 'Please try again.'));
    } finally {
      restoreButton();
    }
  };

  alphaSortSelect.onchange = () => {
    alphaSort = alphaSortSelect.value;
    currentPage = 1;
    updateUI();
  };

  const onDateFilterChange = () => {
    dateFrom = dateFromInput.value;
    dateTo = dateToInput.value;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      if (window.notify) window.notify.error('From date cannot be after To date.');
      dateToInput.value = '';
      dateTo = '';
    }
    currentPage = 1;
    updateUI();
  };

  dateFromInput.onchange = onDateFilterChange;
  dateToInput.onchange = onDateFilterChange;
  dateClearBtn.onclick = () => {
    dateFrom = '';
    dateTo = '';
    dateFromInput.value = '';
    dateToInput.value = '';
    currentPage = 1;
    updateUI();
  };

  try {
    [members, groups] = await Promise.all([
      memberService.getAll(),
      groupService.getAll()
    ]);
  } catch (err) {
    console.warn('[SavingsList] Could not preload members/groups for reconciliation:', err.message);
  }

  if (officerFilterSelect) {
    const officerOptions = await loadOfficerOptions({ members, groups });
    populateOfficerSelect(officerFilterSelect, officerOptions, officerFilter);
    officerFilterSelect.onchange = () => {
      officerFilter = officerFilterSelect.value;
      currentPage = 1;
      updateUI();
    };
  }

  updateUI();

  // Real-time updates
  container.__subscriptionPromise = savingsService.subscribeToChanges(async () => {
    await dataCache.invalidatePrefix('savings:');
    updateUI();
  })
    .then(unsub => [unsub]);

  return container;
};
