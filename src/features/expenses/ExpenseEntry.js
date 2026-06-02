import { expenseService } from '../../services/expenseService.js';
import { navigate } from '../../core/router.js';
import { setButtonLoading } from '../../core/uiState.js';

export const renderExpenseEntry = async () => {
  const container = document.createElement('div');
  let voteheads = [];
  const todayInputValue = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; align-items: center; gap: 16px;">
      <button class="btn btn-outline btn-sm" onclick="window.location.hash = '#/expenses'">← Back</button>
      <div>
        <h1 class="text-xl">Record Expense</h1>
        <p class="text-muted">Log a new institutional expenditure.</p>
      </div>
    </div>

    <div class="card" style="max-width: 600px;">
      <form id="expense-form">
        <div class="form-group">
          <label class="form-label">Expense Category (Votehead)</label>
          <div style="display: flex; gap: 8px;">
            <select name="votehead" class="form-control" required style="flex: 1;">
              <option value="">Loading categories...</option>
            </select>
            <button type="button" class="btn btn-outline" id="new-votehead-btn" title="Add new category">+</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Amount (KES)</label>
          <input type="number" name="amount" class="form-control" required min="1" placeholder="e.g. 5000" />
        </div>

        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" name="date" class="form-control" required value="${todayInputValue}" />
        </div>

        <div class="form-group">
          <label class="form-label">Description / Narration</label>
          <textarea name="description" class="form-control" rows="3" placeholder="What was this expense for?" required></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px;">
          <button type="button" class="btn btn-outline" onclick="window.location.hash = '#/expenses'">Cancel</button>
          <button type="submit" class="btn btn-primary" id="submit-btn">Record Expense</button>
        </div>
      </form>
    </div>

    <!-- Quick Add Votehead Modal -->
    <div id="quick-votehead-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 400px;">
        <h3 style="margin-bottom: 24px;">Quick Add Category</h3>
        <form id="quick-votehead-form">
          <div class="form-group">
            <label class="form-label">Name</label>
            <input type="text" name="name" class="form-control" required />
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
            <button type="button" class="btn btn-outline" id="close-modal">Cancel</button>
            <button type="submit" class="btn btn-primary">Add Category</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector('#expense-form');
  const btn = container.querySelector('#submit-btn');
  
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    data.amount = parseFloat(data.amount);
    
    // ISO string handling if pb requires it
    data.date = new Date(data.date).toISOString();
    
    const restoreButton = setButtonLoading(btn, 'Recording...');

    try {
      await expenseService.create(data);
      if (window.notify) window.notify.success('Expense recorded successfully');
      navigate('#/expenses');
    } catch (err) {
      if (window.notify) window.notify.error('Failed to record: ' + err.message);
      restoreButton();
    }
  };

  // Quick Add Modal Logic
  const modal = container.querySelector('#quick-votehead-modal');
  const qForm = container.querySelector('#quick-votehead-form');
  const select = container.querySelector('[name="votehead"]');

  const populateVoteheads = () => {
    select.innerHTML = `<option value="">Select category...</option>${voteheads.map(v => `<option value="${v.id}">${v.name}</option>`).join('')}`;
  };

  expenseService.getVoteheads().then(result => {
    voteheads = result || [];
    populateVoteheads();
  }).catch(err => {
    console.error('Failed to load voteheads', err);
    select.innerHTML = '<option value="">Failed to load categories</option>';
  });

  container.querySelector('#new-votehead-btn').onclick = () => modal.style.display = 'flex';
  container.querySelector('#close-modal').onclick = () => modal.style.display = 'none';

  qForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = qForm.querySelector('[name="name"]').value;
    const restoreButton = setButtonLoading(qForm.querySelector('button[type="submit"]'), 'Adding...');
    try {
      const v = await expenseService.createVotehead({ name, description: '' });
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      opt.selected = true;
      select.appendChild(opt);
      modal.style.display = 'none';
      qForm.reset();
      restoreButton();
      if (window.notify) window.notify.success('Category added');
    } catch (err) {
      if (window.notify) window.notify.error(err.message);
      restoreButton();
    }
  };

  return container;
};
