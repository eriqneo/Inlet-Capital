import { savingsService } from '../../services/savingsService.js';
import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { authService } from '../../services/authService.js';
import { renderPagination } from '../../components/Pagination.js';
import { formatDate } from '../../core/utils.js';
import { dataCache } from '../../services/dataCache.js';
import { renderTableSkeletonRows, showDelayedLoading, setButtonLoading } from '../../core/uiState.js';
import { withReturnTo } from '../../core/navigation.js';

export const renderSavingsList = async () => {
  const container = document.createElement('div');
  
  let currentPage = 1;
  const pageSize = 10;
  let requestId = 0;
  let alphaSort = 'default';
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
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap;">
        <div id="savings-reconcile-banner" style="margin-right: auto;"></div>
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
  const alphaSortSelect = container.querySelector('#savings-alpha-sort');
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

    savingsNetTotal.textContent = `KES ${net.toLocaleString()}`;
    savingsMovementTotal.innerHTML = `
      <span style="color: var(--success); font-weight: 700;">DEP ${deposits.toLocaleString()}</span>
      <span style="color: var(--danger); font-weight: 700;">WIT ${withdrawals.toLocaleString()}</span>
    `;
    savingsEntryTotal.textContent = activeItems.length.toLocaleString();
  };

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
      
      if (alphaSort !== 'default') {
        const allTransactions = await savingsService.getFullListCached({
          sort: '-date',
          cacheKey: 'savings:list:alpha:expanded:v1'
        });
        const sortedTransactions = sortTransactionsAlphabetically(allTransactions);
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
        const query = { page: currentPage, perPage: pageSize };
        result = await savingsService.getAllCached(query, freshResult => renderResult(freshResult));
      } catch (err) {
        console.warn('[SavingsList] Expanded transaction load failed, retrying basic query:', err);
        const query = { page: currentPage, perPage: pageSize };
        result = await savingsService.getAllBasicCached(query, freshResult => renderResult(freshResult));
      }

      renderResult(result);
      const allForBanner = await savingsService.getFullListCached({
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
    assignSubtitle.textContent = `${group?.name || 'Selected group'} · ${formatDate(transaction.date)} · KES ${(Number(transaction.amount) || 0).toLocaleString()}`;
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

  try {
    [members, groups] = await Promise.all([
      memberService.getAll(),
      groupService.getAll()
    ]);
  } catch (err) {
    console.warn('[SavingsList] Could not preload members/groups for reconciliation:', err.message);
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
