import { loanService } from '../../services/loanService.js';
import { formatDate, formatMoney } from '../../core/utils.js';

export const openDebtRecoveryRenewal = (loan, onRenewed) => {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'recovery-dialog';
  dialog.setAttribute('aria-labelledby', 'recovery-title');
  dialog.innerHTML = `
    <form>
      <h2 id="recovery-title">Renew loan</h2>
      <p class="text-muted recovery-loan-name"></p>
      <label class="form-label" for="recovery-period">New repayment period (months)</label>
      <input class="form-control" id="recovery-period" name="period" type="number" min="1" max="120" step="1" required />
      <label class="form-label" for="recovery-reason">Agreement / reason</label>
      <textarea class="form-control" id="recovery-reason" name="reason" rows="3" minlength="10" maxlength="2000" required></textarea>
      <div class="recovery-quote" aria-live="polite"></div>
      <p class="text-danger recovery-error" role="alert"></p>
      <div class="recovery-dialog-actions">
        <button type="button" class="btn btn-outline recovery-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Review renewal</button>
      </div>
    </form>`;
  dialog.querySelector('.recovery-loan-name').textContent = loan.loan_no;
  document.body.append(dialog);
  dialog.showModal();
  const form = dialog.querySelector('form');
  const periodInput = form.elements.period;
  periodInput.value = String(loan.period || 6);
  const submit = form.querySelector('[type="submit"]');
  const cancel = form.querySelector('.recovery-cancel');
  const quoteArea = form.querySelector('.recovery-quote');
  const errorArea = form.querySelector('.recovery-error');
  let quote = null;
  let busy = false;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.focus(); });
  cancel.onclick = () => dialog.close();
  periodInput.oninput = () => { quote = null; quoteArea.replaceChildren(); submit.textContent = 'Review renewal'; };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    errorArea.textContent = '';
    Array.from(form.elements).forEach(element => { element.disabled = true; });
    const renewing = Boolean(quote);
    submit.textContent = renewing ? 'Renewing...' : 'Calculating...';
    let committed = false;
    try {
      if (!quote) {
        quote = await loanService.recoveryAction(loan.id, { action: 'preview', period: Number(periodInput.value) });
        quoteArea.innerHTML = `
          <dl class="recovery-totals">
            <dt>Unpaid principal</dt><dd>${formatMoney(quote.principal)}</dd>
            <dt>Interest (${quote.interestRate}%)</dt><dd>${formatMoney(quote.interest)}</dd>
            <dt>Carried fines</dt><dd>${formatMoney(quote.fines)}</dd>
            <dt><strong>Total payable (KES)</strong></dt><dd><strong>${formatMoney(quote.totalPayable)}</strong></dd>
            <dt>Restart date</dt><dd>${formatDate(quote.renewalDate)}</dd>
            <dt>Final due date</dt><dd>${formatDate(quote.installments.at(-1).due_date)}</dd>
          </dl>
          <p class="text-sm text-muted">Interest replaces the previous unpaid interest. Fines are carried separately and do not attract interest.</p>
          <details><summary>New repayment schedule</summary>
            <div class="table-responsive"><table class="table"><thead><tr><th>Due date</th><th>Installment</th><th>Carried fines</th></tr></thead>
            <tbody>${quote.installments.map(row => `<tr><td>${formatDate(row.due_date)}</td><td>${formatMoney(row.amount)}</td><td>${formatMoney(row.carried_fine)}</td></tr>`).join('')}</tbody></table></div>
          </details>`;
      } else {
        await loanService.recoveryAction(loan.id, { action: 'renew', period: quote.period,
          fingerprint: quote.fingerprint, reason: form.elements.reason.value.trim() });
        committed = true;
        dialog.close();
        window.notify?.success('Loan renewed. The new repayment schedule is ready.');
      }
    } catch (error) {
      errorArea.textContent = error.message;
      quote = null;
      quoteArea.replaceChildren();
    } finally {
      busy = false;
      Array.from(form.elements).forEach(element => { element.disabled = false; });
      submit.textContent = quote ? 'Confirm renewal' : 'Review renewal';
    }
    if (committed) await onRenewed();
  };
};
