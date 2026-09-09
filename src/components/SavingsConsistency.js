import { formatMoney, formatDate } from '../core/utils.js';

const labels = { consistent: 'Consistent', caught_up: 'Caught up after late savings', behind: 'Savings behind', not_due: 'No completed weeks yet' };
const statuses = { on_time: 'On time', late: 'Covered late', partial: 'Partly covered', missed: 'Missed' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export const renderSavingsConsistency = (assessment, { history = false } = {}) => {
  if (!assessment || assessment.status === 'unavailable') return '<p role="status" class="text-muted">Savings consistency unavailable. Check the savings records, group meeting day and membership start date.</p>';
  if (!assessment.applicable) return '<p class="text-muted text-sm">Individual member: weekly group savings requirement does not apply.</p>';
  const tone = assessment.requiresReview ? 'badge-warning' : 'badge-success';
  return `
    <div class="savings-consistency-heading"><h3 class="text-sm">Weekly Savings Consistency</h3><span class="badge ${tone}">${labels[assessment.status]}</span></div>
    <p class="text-xs text-muted">KES ${formatMoney(assessment.weeklyAmount)} every ${escapeHtml(assessment.meetingDay)} · ${formatDate(assessment.periodStart)} to ${formatDate(assessment.asOf)}</p>
    <dl class="savings-consistency-metrics">
      <div><dt>Expected deposits</dt><dd>KES ${formatMoney(assessment.expected)}</dd></div>
      <div><dt>Deposits received</dt><dd>KES ${formatMoney(assessment.deposited)}</dd></div>
      <div><dt>Savings shortfall</dt><dd class="${assessment.shortfall ? 'text-danger' : 'text-success'}">KES ${formatMoney(assessment.shortfall)}</dd></div>
      <div><dt>Paid on time</dt><dd>${assessment.onTimeRate === null ? '-' : `${formatMoney(assessment.onTimeRate)}%`}</dd></div>
    </dl>
    <p class="text-sm">${assessment.coveredWeeks} of ${assessment.expectedWeeks} weeks covered · ${assessment.lateWeeks} covered late · ${assessment.outstandingWeeks} outstanding</p>
    ${assessment.advance > 0 ? `<p class="text-xs text-muted">Credit towards future weeks: KES ${formatMoney(assessment.advance)}</p>` : ''}
    ${history && assessment.weeks.length ? `<details class="savings-consistency-history"><summary>Weekly collection history</summary><div class="table-responsive"><table class="table"><thead><tr><th>Meeting date</th><th>Expected</th><th>Covered</th><th>Shortfall</th><th>Fully covered on</th><th>Status</th></tr></thead><tbody>${[...assessment.weeks].reverse().map(week => `<tr><td>${formatDate(week.dueDate)}</td><td>${formatMoney(assessment.weeklyAmount)}</td><td>${formatMoney(week.paid)}</td><td>${formatMoney(week.shortfall)}</td><td>${week.coveredDate ? formatDate(week.coveredDate) : '-'}</td><td><span class="badge ${week.status === 'on_time' ? 'badge-success' : 'badge-warning'}">${statuses[week.status]}</span></td></tr>`).join('')}</tbody></table></div></details>` : ''}
  `;
};

export const confirmSavingsException = ({ assessment, member }) => new Promise(resolve => {
  const dialog = document.createElement('dialog');
  dialog.className = 'savings-review-dialog';
  dialog.setAttribute('aria-labelledby', 'savings-review-title');
  dialog.innerHTML = `
    <form><h2 id="savings-review-title" class="text-lg">Savings consistency warning</h2>
    <p><strong>${escapeHtml(member.full_name || member.reg_no)}</strong> has not saved consistently. ${assessment.shortfall ? 'Some weekly contributions are still outstanding.' : 'The missed contributions have been caught up, but some were paid late.'}</p>
    ${renderSavingsConsistency(assessment)}
    <label class="form-label" for="savings-exception-reason">Reason for proceeding</label>
    <textarea id="savings-exception-reason" class="form-control" rows="3" required maxlength="1000"></textarea>
    <div class="savings-review-actions"><button type="button" class="btn btn-outline" data-cancel autofocus>Do not disburse</button><button type="submit" class="btn btn-primary">Continue anyway</button></div>
    </form>`;
  const previousFocus = document.activeElement;
  let settled = false;
  const finish = value => {
    if (settled) return;
    settled = true;
    window.removeEventListener('hashchange', onNavigation);
    dialog.close();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    resolve(value);
  };
  const onNavigation = () => finish(null);
  window.addEventListener('hashchange', onNavigation);
  dialog.querySelector('[data-cancel]').onclick = () => finish(null);
  dialog.oncancel = event => { event.preventDefault(); finish(null); };
  dialog.onclick = event => { if (event.target === dialog) finish(null); };
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    const input = dialog.querySelector('textarea');
    const reason = input.value.trim();
    input.setCustomValidity(reason ? '' : 'Enter a reason for proceeding.');
    if (!input.reportValidity()) return;
    finish(reason);
  };
  dialog.querySelector('textarea').oninput = event => event.target.setCustomValidity('');
  document.body.appendChild(dialog);
  dialog.showModal();
});
