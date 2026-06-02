import { savingsService } from '../../services/savingsService.js';
import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { authService } from '../../services/authService.js';
import { navigate } from '../../core/router.js';
import { formatDate } from '../../core/utils.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderSavingsLedger = async () => {
  const container = document.createElement('div');
  let members = [];
  let groups = [];

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
            <select name="memberId" class="form-control" id="member-id">
              <option value="">Loading members...</option>
            </select>
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

          <!-- Payment Options for Deposits -->
          <div id="payment-panel">
            <div class="form-group" style="margin-bottom: 16px;">
              <label class="form-label" style="font-size: 0.75rem;">Payment Received Via</label>
              <div style="display: flex; gap: 8px; margin-top: 6px;">
                <button type="button" class="btn pay-pill active" data-method="mpesa" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">📱 M-Pesa</button>
                <button type="button" class="btn pay-pill" data-method="cash" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">💵 Cash</button>
                <button type="button" class="btn pay-pill" data-method="card" style="flex: 1; padding: 6px 12px; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px;">💳 Card</button>
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
        <div class="card" style="background: var(--bg-light); border: none;">
          <h3 style="font-size: 1rem; margin-bottom: 12px;">Recent Transactions</h3>
          <div id="recent-savings" style="font-size: 0.875rem;">
            <p class="text-muted text-center" style="padding: 20px;">No recent transactions.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#savings-form');
  const accountType = container.querySelector('#account-type');
  const mWrap = container.querySelector('#member-select-wrap');
  const gWrap = container.querySelector('#group-select-wrap');
  const txType = container.querySelector('#tx-type');
  const payPanel = container.querySelector('#payment-panel');
  const pills = container.querySelectorAll('.pay-pill');
  const payMethodInput = container.querySelector('#pay-method-val');
  const payRefGroup = container.querySelector('#pay-ref-group');
  const payRefInput = container.querySelector('#pay-ref-val');
  const memberSelect = container.querySelector('#member-id');
  const groupSelect = container.querySelector('#group-id');

  const populateAccountOptions = () => {
    memberSelect.innerHTML = `<option value="">Select...</option>${members.map(m => `<option value="${m.id}">${m.full_name} (${m.reg_no})</option>`).join('')}`;
    groupSelect.innerHTML = `<option value="">Select...</option>${groups.map(g => `<option value="${g.id}">${g.name} (${g.group_id})</option>`).join('')}`;
  };

  Promise.all([
    memberService.getAll(),
    groupService.getAll()
  ]).then(([membersData, groupsData]) => {
    members = membersData || [];
    groups = groupsData || [];
    populateAccountOptions();
  }).catch(err => {
    console.warn('[SavingsLedger] Account options preload failed:', err);
    populateAccountOptions();
  });

  accountType.onchange = () => {
    if (accountType.value === 'individual') {
      mWrap.style.display = 'block';
      gWrap.style.display = 'none';
    } else {
      mWrap.style.display = 'none';
      gWrap.style.display = 'block';
    }
  };

  txType.onchange = () => {
    if (txType.value === 'deposit') {
      payPanel.style.display = 'block';
      if (payMethodInput.value === 'cash') {
        payRefInput.removeAttribute('required');
      } else {
        payRefInput.setAttribute('required', 'true');
      }
    } else {
      payPanel.style.display = 'none';
      payRefInput.removeAttribute('required');
    }
  };

  pills.forEach(pill => {
    pill.onclick = () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const val = pill.dataset.method;
      payMethodInput.value = val;

      if (val === 'cash') {
        payRefGroup.style.display = 'none';
        payRefInput.removeAttribute('required');
        payRefInput.value = '';
      } else {
        payRefGroup.style.display = 'block';
        payRefInput.setAttribute('required', 'true');
        payRefInput.placeholder = val === 'mpesa' ? 'e.g. QWE123RTY4' : 'e.g. Card Slip / Receipt No.';
      }
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    const amount = parseFloat(data.amount);

    const transaction = {
      type: data.type,
      amount: amount,
      date: new Date(data.date).toISOString(),
      payment_method: data.type === 'deposit' ? data.paymentMethod : 'cash',
      reference: data.type === 'deposit' 
        ? (data.paymentMethod === 'cash' ? `CASH` : (data.paymentReference || '')) 
        : '',
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
      if (t.type === 'deposit') {
        if (t.payment_method === 'mpesa') methodIcon = ' 📱';
        else if (t.payment_method === 'card') methodIcon = ' 💳';
        else methodIcon = ' 💵';
      }
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
