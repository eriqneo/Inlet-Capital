import { loanService } from '../../services/loanService.js';
import { formatDate, formatMoney } from '../../core/utils.js';

export const openDebtRecoveryRenewal = (loan, onRenewed) => {
  const previousFocus = document.activeElement;
  const toDateInput = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const addMonths = (value, months) => {
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + months);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    return toDateInput(date);
  };
  const restartDate = toDateInput(new Date());
  const initialPeriod = Number(loan.period) || 6;
  const dialog = document.createElement('dialog');
  dialog.className = 'recovery-dialog';
  dialog.setAttribute('aria-labelledby', 'recovery-title');
  dialog.innerHTML = `
    <form>
      <h2 id="recovery-title">Renew loan</h2>
      <p class="text-muted recovery-loan-name"></p>
      <label class="form-label" for="recovery-period">New repayment period (months)</label>
      <input class="form-control" id="recovery-period" name="period" type="number" min="1" max="120" step="1" required />
      <label class="form-label" for="recovery-interest-rate">Interest rate (%)</label>
      <input class="form-control" id="recovery-interest-rate" name="interest_rate" type="number" min="0" max="100" step="0.01" value="20" required />
      <label class="form-label" for="recovery-restart-date">Restart date</label>
      <input class="form-control" id="recovery-restart-date" name="renewal_date" type="date" value="${restartDate}" required />
      <label class="form-label" for="recovery-final-due-date">Final due date</label>
      <input class="form-control" id="recovery-final-due-date" name="final_due_date" type="date" value="${addMonths(restartDate, initialPeriod)}" required />
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
  const interestRateInput = form.elements.interest_rate;
  const restartDateInput = form.elements.renewal_date;
  const finalDueDateInput = form.elements.final_due_date;
  periodInput.value = String(initialPeriod);
  const submit = form.querySelector('[type="submit"]');
  const cancel = form.querySelector('.recovery-cancel');
  const quoteArea = form.querySelector('.recovery-quote');
  const errorArea = form.querySelector('.recovery-error');
  let quote = null;
  let displayedQuote = null;
  let busy = false;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.focus(); });
  cancel.onclick = () => dialog.close();
  const clearQuote = () => {
    quote = null;
    displayedQuote = null;
    quoteArea.replaceChildren();
    submit.textContent = 'Review renewal';
  };
  const renderQuote = (quoteToRender, notice = '') => {
    quoteArea.innerHTML = `
      <dl class="recovery-totals">
        <dt>Renewal unit</dt><dd>${quoteToRender.sourceUnit === 'du' ? 'D.U' : 'D.R.U'}</dd>
        <dt>Renewal base (Current OLB)</dt><dd>${formatMoney(quoteToRender.renewalBase ?? quoteToRender.principal)}</dd>
        <dt>Interest (${quoteToRender.interestRate}%)</dt><dd>${formatMoney(quoteToRender.interest)}</dd>
        <dt>Accrued fines in OLB</dt><dd>${formatMoney(quoteToRender.fines)}</dd>
        <dt><strong>Total payable (KES)</strong></dt><dd><strong>${formatMoney(quoteToRender.totalPayable)}</strong></dd>
        <dt>Restart date</dt><dd>${formatDate(quoteToRender.renewalDate)}</dd>
        <dt>Final due date</dt><dd>${formatDate(quoteToRender.installments.at(-1).due_date)}</dd>
      </dl>
      ${notice ? `<p class="text-sm" style="margin-top: 12px; color: var(--warning); font-weight: 600;">${notice}</p>` : ''}
      <p class="text-sm text-muted">The current OLB is the renewal base. Any accrued fines are already included in that base and are not added a second time. The approved interest rate and dates above define this renewed loan cycle.</p>
      <details><summary>New repayment schedule</summary>
        <div class="table-responsive"><table class="table"><thead><tr><th>Due date</th><th>Installment</th></tr></thead>
        <tbody>${quoteToRender.installments.map(row => `<tr><td>${formatDate(row.due_date)}</td><td>${formatMoney(row.amount)}</td></tr>`).join('')}</tbody></table></div>
      </details>`;
  };
  const refreshInterestPreview = () => {
    const interestRate = Number(interestRateInput.value);
    if (!displayedQuote || !Number.isFinite(interestRate)) {
      clearQuote();
      return;
    }
    const renewalBase = Number(displayedQuote.renewalBase ?? displayedQuote.principal) || 0;
    const interest = Math.round(renewalBase * interestRate) / 100;
    const totalPayable = Math.round((renewalBase + interest) * 100) / 100;
    const installmentTotalCents = Math.round(totalPayable * 100);
    const regularInstallmentCents = Math.floor(installmentTotalCents / displayedQuote.installments.length);
    const installments = displayedQuote.installments.map((installment, index) => ({
      ...installment,
      amount: (index === displayedQuote.installments.length - 1
        ? installmentTotalCents - (regularInstallmentCents * index)
        : regularInstallmentCents) / 100
    }));
    quote = null;
    renderQuote({
      ...displayedQuote,
      interestRate,
      interest,
      liability: totalPayable,
      totalPayable,
      installments
    }, 'Interest preview updated. Review renewal before confirming these terms.');
    submit.textContent = 'Review renewal';
  };
  const syncFinalDueDate = () => {
    const period = Number.parseInt(periodInput.value, 10);
    if (!restartDateInput.value || !Number.isInteger(period) || period < 1) return;
    finalDueDateInput.value = addMonths(restartDateInput.value, period);
  };
  const syncPeriodFromFinalDueDate = () => {
    const restart = new Date(`${restartDateInput.value}T12:00:00`);
    const finalDue = new Date(`${finalDueDateInput.value}T12:00:00`);
    if (Number.isNaN(restart.getTime()) || Number.isNaN(finalDue.getTime()) || finalDue <= restart) return;
    const months = (finalDue.getFullYear() - restart.getFullYear()) * 12 + finalDue.getMonth() - restart.getMonth();
    if (months >= 1 && months <= 120) periodInput.value = String(months);
  };
  periodInput.oninput = () => { syncFinalDueDate(); clearQuote(); };
  interestRateInput.oninput = refreshInterestPreview;
  interestRateInput.onchange = refreshInterestPreview;
  restartDateInput.onchange = () => { syncFinalDueDate(); clearQuote(); };
  finalDueDateInput.onchange = () => { syncPeriodFromFinalDueDate(); clearQuote(); };
  const getRenewalTerms = () => ({
    period: Number(periodInput.value),
    interest_rate: Number(interestRateInput.value),
    renewal_date: restartDateInput.value,
    final_due_date: finalDueDateInput.value
  });
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
        const terms = getRenewalTerms();
        quote = await loanService.recoveryAction(loan.id, { action: 'preview', ...terms });
        if (Number(quote.interestRate) !== terms.interest_rate) {
          throw new Error('The server did not apply the selected interest rate. Upload the latest debt recovery hook, then review again.');
        }
        displayedQuote = quote;
        renderQuote(quote);
      } else {
        await loanService.recoveryAction(loan.id, { action: 'renew', ...getRenewalTerms(),
          fingerprint: quote.fingerprint, reason: form.elements.reason.value.trim() });
        committed = true;
        dialog.close();
        window.notify?.success('Loan renewed. The new repayment schedule is ready.');
      }
    } catch (error) {
      errorArea.textContent = error.message;
      clearQuote();
    } finally {
      busy = false;
      Array.from(form.elements).forEach(element => { element.disabled = false; });
      submit.textContent = quote ? 'Confirm renewal' : 'Review renewal';
    }
    if (committed) await onRenewed();
  };
};
