import { savingsService } from '../../services/savingsService.js';
import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { authService } from '../../services/authService.js';
import { navigate } from '../../core/router.js';
import { formatDate } from '../../core/utils.js';
import { setButtonLoading } from '../../core/uiState.js';
import Fuse from 'fuse.js';

export const renderSavingsLedger = async (params = {}) => {
  const container = document.createElement('div');
  let members = [];
  let groups = [];
  const preselectedMemberId = params.memberId || params.member || '';
  const preselectedGroupId = params.groupId || params.group || '';

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 class="text-xl">Savings Ledger</h1>
      <p class="text-muted">Record deposits and withdrawals for individuals and groups.</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 24px;">
      <!-- Transaction Form -->
      <div class="card">
        <h3 style="margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">New Transaction</h3>
        <form id="savings-form">
          <div class="form-group">
            <label class="form-label">Account Type</label>
            <select id="account-type" class="form-control" required>
              <option value="individual">Individual Member</option>
              <option value="group">Group Account</option>
            </select>
          </div>

          <div class="form-group" id="member-select-wrap">
            <label class="form-label">Select Member</label>
            <input type="search" class="form-control" id="member-search" placeholder="Search name, reg no, phone, or ID" autocomplete="off" />
            <input type="hidden" name="memberId" id="member-id" />
            <div id="member-search-results" class="member-picker-results" style="margin-top: 10px;"></div>
            <div id="selected-member-summary" class="text-xs text-muted" style="margin-top: 10px;"></div>
          </div>

          <div class="form-group" id="group-select-wrap" style="display: none;">
            <label class="form-label">Select Group</label>
            <select name="groupId" class="form-control" id="group-id">
              <option value="">Loading groups...</option>
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
              <label class="form-label">Transaction Type</label>
              <select name="type" id="tx-type" class="form-control" required>
                <option value="deposit">Deposit (+)</option>
                <option value="withdrawal">Withdrawal (-)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Amount (KES)</label>
              <input type="number" name="amount" class="form-control" required min="1" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Transaction Date</label>
            <input type="date" name="date" class="form-control" value="${new Date().toISOString().split('T')[0]}" required />
          </div>

          <!-- Payment Options -->
          <div id="payment-panel">
            <div class="form-group" style="margin-bottom: 16px;">
              <label class="form-label" id="payment-panel-label" style="font-size: 0.75rem;">Payment Received Via</label>
              <div style="display: flex; gap: 8px; margin-top: 6px;">
                <button type="button" class="btn pay-pill active" data-method="mpesa" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">📱 M-Pesa</button>
                <button type="button" class="btn pay-pill" data-method="cash" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">💵 Cash</button>
                <button type="button" class="btn pay-pill" data-method="bank" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">🏦 Bank</button>
              </div>
              <input type="hidden" name="paymentMethod" id="pay-method-val" value="mpesa" />
            </div>

            <div class="form-group" id="pay-ref-group">
              <label class="form-label" style="font-size: 0.75rem;">Transaction Reference / Receipt No.</label>
              <input type="text" name="paymentReference" id="pay-ref-val" class="form-control form-control-sm" placeholder="e.g. QWE123RTY4" required />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Remarks (Optional)</label>
            <input type="text" name="remarks" class="form-control" placeholder="e.g. January savings contribution" />
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 16px;">Record Transaction</button>
        </form>
      </div>

      <!-- Quick Stats Card -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div class="card" id="selected-group-members-card" style="background: var(--bg-light); border: none; display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px;">
            <div>
              <h3 style="font-size: 1rem; margin-bottom: 2px;">Group Members</h3>
              <div id="selected-group-members-subtitle" class="text-xs text-muted"></div>
            </div>
            <span class="badge badge-primary" id="selected-group-members-count" style="font-size: 0.65rem;">0</span>
          </div>
          <div id="selected-group-members-list" style="font-size: 0.875rem;"></div>
          <button type="button" class="btn btn-outline btn-sm" id="see-more-group-members-btn" style="width: 100%; margin-top: 14px;">See More</button>
        </div>
        <div class="card" style="background: var(--bg-light); border: none;">
          <h3 style="font-size: 1rem; margin-bottom: 12px;">Recent Transactions</h3>
          <div id="recent-savings" style="font-size: 0.875rem;">
            <p class="text-muted text-center" style="padding: 20px;">No recent transactions.</p>
          </div>
        </div>
      </div>
    </div>

    <style>
      .member-picker-results { max-height: 280px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: white; }
      .member-picker-option { width: 100%; display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px; background: white; border: none; border-bottom: 1px solid var(--border-color); text-align: left; cursor: pointer; }
      .member-picker-option:last-child { border-bottom: none; }
      .member-picker-option:hover, .member-picker-option.selected { background: rgba(27, 61, 114, 0.06); }
      .member-picker-empty { padding: 18px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
    </style>
  `;

  const form = container.querySelector('#savings-form');
  const accountType = container.querySelector('#account-type');
  const mWrap = container.querySelector('#member-select-wrap');
  const gWrap = container.querySelector('#group-select-wrap');
  const txType = container.querySelector('#tx-type');
  const payPanel = container.querySelector('#payment-panel');
  const paymentPanelLabel = container.querySelector('#payment-panel-label');
  const pills = container.querySelectorAll('.pay-pill');
  const payMethodInput = container.querySelector('#pay-method-val');
  const payRefGroup = container.querySelector('#pay-ref-group');
  const payRefInput = container.querySelector('#pay-ref-val');
  const memberSelect = container.querySelector('#member-id');
  const memberSearch = container.querySelector('#member-search');
  const memberSearchResults = container.querySelector('#member-search-results');
  const selectedMemberSummary = container.querySelector('#selected-member-summary');
  const groupSelect = container.querySelector('#group-id');
  const selectedGroupMembersCard = container.querySelector('#selected-group-members-card');
  const selectedGroupMembersSubtitle = container.querySelector('#selected-group-members-subtitle');
  const selectedGroupMembersCount = container.querySelector('#selected-group-members-count');
  const selectedGroupMembersList = container.querySelector('#selected-group-members-list');
  const seeMoreGroupMembersBtn = container.querySelector('#see-more-group-members-btn');
  let memberFuse = null;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));

  const populateAccountOptions = () => {
    memberFuse = new Fuse(members, {
      keys: [
        { name: 'full_name', weight: 0.45 },
        { name: 'reg_no', weight: 0.25 },
        { name: 'phone_number', weight: 0.15 },
        { name: 'phone', weight: 0.1 },
        { name: 'id_number', weight: 0.05 }
      ],
      threshold: 0.34,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 1
    });
    renderMemberSearchResults();
    groupSelect.innerHTML = `<option value="">Select...</option>${groups.map(g => `<option value="${g.id}">${g.name} (${g.group_id})</option>`).join('')}`;
  };

  const getMemberLabel = (member) => `${member.full_name || 'Unnamed member'} (${member.reg_no || 'No reg no'})`;
  const renderMemberSearchResults = () => {
    const selectedId = memberSelect.value;
    const query = memberSearch.value.trim();
    let matches = [];

    if (members.length === 0) {
      memberSearchResults.innerHTML = `<div class="member-picker-empty">No members are available.</div>`;
      return;
    }

    if (query && memberFuse) {
      matches = memberFuse.search(query).slice(0, 8).map(result => result.item);
    } else {
      matches = members.slice(0, 8);
    }

    if (matches.length === 0) {
      memberSearchResults.innerHTML = `<div class="member-picker-empty">No matching members found.</div>`;
      return;
    }

    memberSearchResults.innerHTML = matches.map(member => `
      <button type="button" class="member-picker-option ${member.id === selectedId ? 'selected' : ''}" data-member-id="${member.id}">
        <span>
          <span class="font-semibold">${escapeHtml(member.full_name || 'Unnamed member')}</span>
          <span class="text-xs text-muted" style="display:block; margin-top: 2px;">${escapeHtml(member.reg_no || '-')} · ${escapeHtml(member.phone_number || member.phone || 'No phone')}</span>
        </span>
        <span class="badge badge-primary" style="font-size: 0.65rem;">Select</span>
      </button>
    `).join('');
  };

  const selectMember = (memberId) => {
    const member = members.find(m => m.id === memberId);
    memberSelect.value = member?.id || '';
    selectedMemberSummary.textContent = member ? `Selected: ${getMemberLabel(member)}` : '';
    if (member) memberSearch.value = getMemberLabel(member);
    renderMemberSearchResults();
  };

  const clearMemberSelection = () => {
    memberSelect.value = '';
    selectedMemberSummary.textContent = '';
    renderMemberSearchResults();
  };

  const getMembersForGroup = (groupId) => members.filter(member => member.group === groupId || member.expand?.group?.id === groupId);
  const renderSelectedGroupMembers = () => {
    if (accountType.value !== 'group' || !groupSelect.value) {
      selectedGroupMembersCard.style.display = 'none';
      return;
    }

    const selectedGroup = groups.find(group => group.id === groupSelect.value);
    const groupMembers = getMembersForGroup(groupSelect.value);
    selectedGroupMembersCard.style.display = 'block';
    selectedGroupMembersSubtitle.textContent = selectedGroup
      ? `${selectedGroup.name || 'Selected group'} member preview`
      : 'Selected group member preview';
    selectedGroupMembersCount.textContent = groupMembers.length;
    seeMoreGroupMembersBtn.disabled = !selectedGroup;

    if (groupMembers.length === 0) {
      selectedGroupMembersList.innerHTML = `<div class="member-picker-empty">No members currently assigned to this group.</div>`;
      return;
    }

    selectedGroupMembersList.innerHTML = groupMembers.slice(0, 5).map(member => `
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
        <div>
          <div class="font-semibold">${escapeHtml(member.full_name || 'Unnamed member')}</div>
          <div class="text-xs text-muted">${escapeHtml(member.reg_no || '-')} · ${escapeHtml(member.phone_number || member.phone || 'No phone')}</div>
        </div>
        <span class="badge ${member.status === 'active' ? 'badge-success' : 'badge-outline'}" style="font-size: 0.62rem;">${escapeHtml(member.status || 'active').toUpperCase()}</span>
      </div>
    `).join('');
  };

  const applyPreselection = () => {
    if (preselectedMemberId) {
      const selectedMember = members.find(m => m.id === preselectedMemberId || m.reg_no === preselectedMemberId || m.regNo === preselectedMemberId);
      if (selectedMember) {
        accountType.value = 'individual';
        accountType.onchange();
        selectMember(selectedMember.id);
        container.querySelector('[name="amount"]')?.focus();
      }
      return;
    }

    if (preselectedGroupId) {
      const selectedGroup = groups.find(g => g.id === preselectedGroupId || g.group_id === preselectedGroupId);
      if (selectedGroup) {
        accountType.value = 'group';
        accountType.onchange();
        groupSelect.value = selectedGroup.id;
        renderSelectedGroupMembers();
        container.querySelector('[name="amount"]')?.focus();
      }
    }
  };

  Promise.all([
    memberService.getAll(),
    groupService.getAll()
  ]).then(([membersData, groupsData]) => {
    members = membersData || [];
    groups = groupsData || [];
    populateAccountOptions();
    applyPreselection();
  }).catch(err => {
    console.warn('[SavingsLedger] Account options preload failed:', err);
    populateAccountOptions();
  });

  accountType.onchange = () => {
    if (accountType.value === 'individual') {
      mWrap.style.display = 'block';
      gWrap.style.display = 'none';
      renderSelectedGroupMembers();
      setTimeout(() => memberSearch.focus(), 0);
    } else {
      mWrap.style.display = 'none';
      gWrap.style.display = 'block';
      renderSelectedGroupMembers();
    }
  };

  groupSelect.onchange = renderSelectedGroupMembers;
  seeMoreGroupMembersBtn.onclick = () => {
    if (groupSelect.value) navigate(`#/groups/${groupSelect.value}`);
  };

  memberSearch.oninput = () => {
    clearMemberSelection();
  };

  memberSearchResults.onclick = (e) => {
    const option = e.target.closest('.member-picker-option');
    if (!option) return;
    selectMember(option.dataset.memberId);
  };

  const updatePaymentPanel = () => {
    const method = payMethodInput.value || 'mpesa';
    paymentPanelLabel.textContent = txType.value === 'withdrawal' ? 'Payment Sent Via' : 'Payment Received Via';
    payPanel.style.display = 'block';

    if (method === 'cash') {
      payRefGroup.style.display = 'none';
      payRefInput.removeAttribute('required');
      payRefInput.value = '';
    } else {
      payRefGroup.style.display = 'block';
      payRefInput.setAttribute('required', 'true');
      payRefInput.placeholder = method === 'mpesa' ? 'e.g. QWE123RTY4' : 'e.g. Bank transfer / cheque reference';
    }
  };

  txType.onchange = updatePaymentPanel;

  pills.forEach(pill => {
    pill.onclick = () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const val = pill.dataset.method;
      payMethodInput.value = val;
      updatePaymentPanel();
    };
  });

  updatePaymentPanel();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    const amount = parseFloat(data.amount);
    const paymentMethod = data.paymentMethod || 'mpesa';
    const paymentReference = paymentMethod === 'cash' ? 'CASH' : (data.paymentReference || '');

    const transaction = {
      type: data.type,
      amount: amount,
      date: new Date(data.date).toISOString(),
      payment_method: paymentMethod,
      reference: paymentReference,
      remarks: data.remarks || '',
      is_reversed: false
    };

    const userId = authService.getUser()?.id;
    if (userId) {
      transaction.recorded_by = userId;
    }

    if (accountType.value === 'individual') {
      if (!data.memberId) return window.notify?.error('Please select a member');
      transaction.member = data.memberId;
    } else {
      if (!data.groupId) return window.notify?.error('Please select a group');
      transaction.group = data.groupId;
    }

    const restoreButton = setButtonLoading(form.querySelector('button[type="submit"]'), 'Recording...');

    try {
      await savingsService.recordTransaction(transaction);
      
      if (window.notify) window.notify.success('Savings recorded successfully!');
      form.reset();
      clearMemberSelection();
      renderSelectedGroupMembers();
      pills.forEach(p => p.classList.toggle('active', p.dataset.method === 'mpesa'));
      payMethodInput.value = 'mpesa';
      updatePaymentPanel();
      updateRecent();
      setTimeout(() => navigate('#/savings'), 1200);
    } catch (err) {
      if (window.notify) window.notify.error('Error: ' + (err.message || 'Validation failed. Ensure member is not required if saving for a group.'));
      console.error(err);
      restoreButton();
    }
  };

  const updateRecent = async () => {
    try {
      const recentList = await savingsService.getAll({ page: 1, perPage: 5 });
      const recent = recentList.items;
      const listWrap = container.querySelector('#recent-savings');
    
    if (!recent || recent.length === 0) return;

    listWrap.innerHTML = recent.map(t => {
      let methodIcon = '';
      if (t.payment_method === 'mpesa') methodIcon = ' 📱';
      else if (t.payment_method === 'bank') methodIcon = ' 🏦';
      else if (t.payment_method) methodIcon = ' 💵';
      const targetName = t.expand?.member ? t.expand.member.full_name : (t.expand?.group ? t.expand.group.name : 'Unknown');
      
      return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
        <div>
          <div class="font-semibold">${t.type.toUpperCase()}${methodIcon} ${t.is_reversed ? '<span class="badge badge-danger">REVERSED</span>' : ''}</div>
          <div class="text-xs text-muted">${targetName} | ${formatDate(t.date)}</div>
        </div>
        <div class="font-semibold" style="color: ${t.type === 'deposit' ? 'var(--success)' : 'var(--danger)'};">
          ${t.type === 'deposit' ? '+' : '-'}${t.amount.toLocaleString()}
        </div>
      </div>`;
    }).join('');
    } catch (e) {
      console.error(e);
    }
  };

  updateRecent();

  return container;
};
