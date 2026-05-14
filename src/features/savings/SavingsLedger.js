import { add, getAll, getById, put } from '../../core/db.js';
import { navigate } from '../../core/router.js';

export const renderSavingsLedger = async () => {
  const container = document.createElement('div');
  const members = await getAll('members');
  const groups = await getAll('groups');

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
              <option value="">Select...</option>
              ${members.map(m => `<option value="${m.regNo}">${m.fullName} (${m.regNo})</option>`).join('')}
            </select>
          </div>

          <div class="form-group" id="group-select-wrap" style="display: none;">
            <label class="form-label">Select Group</label>
            <select name="groupId" class="form-control" id="group-id">
              <option value="">Select...</option>
              ${groups.map(g => `<option value="${g.groupId}">${g.name} (${g.groupId})</option>`).join('')}
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div class="form-group">
              <label class="form-label">Transaction Type</label>
              <select name="type" class="form-control" required>
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

          <div class="form-group">
            <label class="form-label">Reference / Remarks</label>
            <input type="text" name="reference" class="form-control" placeholder="e.g. Mpesa Ref, Receipt No" />
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

  accountType.onchange = () => {
    if (accountType.value === 'individual') {
      mWrap.style.display = 'block';
      gWrap.style.display = 'none';
    } else {
      mWrap.style.display = 'none';
      gWrap.style.display = 'block';
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    const amount = parseFloat(data.amount);
    const multiplier = data.type === 'deposit' ? 1 : -1;
    const finalAmount = amount * multiplier;

    const transaction = {
      ...data,
      amount: finalAmount,
      accountType: accountType.value,
      timestamp: new Date().toISOString()
    };

    try {
      await add('savings', transaction);
      
      // Update totals in entity record
      if (accountType.value === 'individual') {
        const member = await getById('members', data.memberId);
        if (member) {
          member.totalSavings = (member.totalSavings || 0) + finalAmount;
          await put('members', member);
        }
      } else {
        const group = await getById('groups', data.groupId);
        if (group) {
          group.totalSavings = (group.totalSavings || 0) + finalAmount;
          await put('groups', group);
        }
      }

      notify.success('Savings recorded successfully!');
      form.reset();
      updateRecent();
      setTimeout(() => navigate('#/savings'), 1200);
    } catch (err) {
      notify.error('Error: ' + err.message);
    }
  };

  const updateRecent = async () => {
    const all = await getAll('savings');
    const recent = all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);
    const listWrap = container.querySelector('#recent-savings');
    
    if (recent.length === 0) return;

    listWrap.innerHTML = recent.map(t => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
        <div>
          <div class="font-semibold">${t.type.toUpperCase()}</div>
          <div class="text-xs text-muted">${t.memberId || t.groupId} | ${new Date(t.date).toLocaleDateString()}</div>
        </div>
        <div class="font-semibold" style="color: ${t.amount > 0 ? 'var(--success)' : 'var(--danger)'};">
          ${t.amount > 0 ? '+' : ''}${t.amount.toLocaleString()}
        </div>
      </div>
    `).join('');
  };

  updateRecent();

  return container;
};
