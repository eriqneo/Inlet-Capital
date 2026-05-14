import { add, getAll } from '../../core/db.js';
import { navigate } from '../../core/router.js';

export const renderExpenseEntry = async () => {
  const container = document.createElement('div');
  const voteheads = await getAll('voteheads');

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 class="text-xl">Record Expense</h1>
      <p class="text-muted">Track money moving out of the system.</p>
    </div>

    <div class="card" style="max-width: 500px; margin: 0 auto;">
      <form id="expense-form">
        <div class="form-group">
          <label class="form-label">Votehead (Category)</label>
          <select name="votehead" class="form-control" required>
            <option value="">Select category...</option>
            ${voteheads.map(v => `<option value="${v.id}">${v.name}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Amount (KES)</label>
          <input type="number" name="amount" class="form-control" required min="1" />
        </div>

        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" name="date" class="form-control" value="${new Date().toISOString().split('T')[0]}" required />
        </div>

        <div class="form-group">
          <label class="form-label">Description / Particulars</label>
          <textarea name="description" class="form-control" rows="3" required placeholder="e.g. Electricity bill for April"></textarea>
        </div>

        <div style="margin-top: 32px; display: flex; justify-content: flex-end; gap: 16px;">
          <button type="button" class="btn btn-outline" onclick="window.location.hash = '#/expenses'">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Expense</button>
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector('#expense-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    const expense = {
      ...data,
      amount: parseFloat(data.amount),
      timestamp: new Date().toISOString(),
      officerId: 'admin'
    };

    try {
      await add('expenses', expense);
      notify.success('Expense recorded successfully!');
      setTimeout(() => navigate('#/expenses'), 1200);
    } catch (err) {
      notify.error('Error: ' + err.message);
    }
  };

  return container;
};
