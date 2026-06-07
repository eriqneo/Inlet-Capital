import { pb } from '../../services/api.js';
import { renderPagination } from '../../components/Pagination.js';
import { dataCache, debounce } from '../../services/dataCache.js';
import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { loanService } from '../../services/loanService.js';
import { savingsService } from '../../services/savingsService.js';

export const renderAnalyticsDashboard = async () => {
  const container = document.createElement('div');
  container.innerHTML = `<div class="card text-center text-muted" style="padding:40px;">Loading analytics...</div>`;
  
  // Data variables
  let members = [], loans = [], repayments = [], groups = [], savings = [], schedules = [], users = [];

  const refresh = async () => {
    try {
      [members, loans, repayments, groups, savings, schedules, users] = await Promise.all([
        memberService.getAll(),
        loanService.getFullListCached({ cacheKey: 'loans:analytics:expanded:v1' }),
        dataCache.get('loan_repayments', () => pb.collection('loan_repayments').getFullList()),
        groupService.getAll(),
        savingsService.getFullListCached({ expand: '', cacheKey: 'savings:analytics:basic:v1' }),
        dataCache.get('loan_schedule', () => pb.collection('loan_schedule').getFullList()),
        dataCache.get('users:analytics:loan-users:v1', () => pb.collection('users').getFullList({
          filter: 'role="loan_officer" || role="group_officer" || role="manager" || role="admin" || role="super_admin"',
          sort: 'email'
        })).catch(err => {
          console.warn('[Analytics] Loan user list unavailable, using loan records fallback:', err.message);
          return [];
        })
      ]);
    } catch (err) {
      console.error('Failed to load analytics data:', err);
      container.innerHTML = `<div class="card text-center text-danger" style="padding: 40px; margin: 20px;">
        <h3 style="margin-bottom: 12px;">Failed to load analytics</h3>
        <p class="text-muted" style="margin-bottom: 20px;">${err.message}</p>
        <button class="btn btn-primary" onclick="window.location.reload()">Retry Connection</button>
      </div>`;
      return false;
    }
    return true;
  };

  let currentFilter = 'all'; // '30days', 'quarter', 'ytd', 'all'
  let currentOfficerFilter = 'all';
  let currentCollectionWindow = 'this_month';
  let chartInstances = [];

  const destroyCharts = () => {
    chartInstances.forEach(c => c.destroy());
    chartInstances = [];
  };

  const renderData = () => {
    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    let filterDate = new Date(0); // all time

    if (currentFilter === '30days') {
      filterDate = new Date();
      filterDate.setDate(today.getDate() - 30);
    } else if (currentFilter === 'quarter') {
      filterDate = new Date();
      filterDate.setMonth(today.getMonth() - 3);
    } else if (currentFilter === 'ytd') {
      filterDate = new Date(today.getFullYear(), 0, 1);
    }

    // Filter datasets
    const fMembers = members.filter(m => new Date(m.registration_date || m.created) >= filterDate);
    const fLoans = loans.filter(l => new Date(l.application_date || l.created) >= filterDate);
    const fRepayments = repayments.filter(r => new Date(r.date || r.created) >= filterDate);
    const fSavings = savings.filter(s => new Date(s.date || s.created) >= filterDate);

    // Calculations based on filtered data
    const getLoanLiability = (loan) => {
      const storedLiability = Number(loan.total_liability) || 0;
      if (storedLiability > 0) return storedLiability;

      const principal = Number(loan.approved_amount || loan.amount_applied) || 0;
      const interest = Number(loan.interest_amount) || 0;
      return principal + interest;
    };
    const getLoanPrincipal = (loan) => {
      const approved = Number(loan.approved_amount) || 0;
      if (approved > 0) return approved;

      const liability = Number(loan.total_liability) || 0;
      const interest = Number(loan.interest_amount) || 0;
      if (liability > 0) return Math.max(0, liability - interest);

      return Number(loan.amount_applied) || 0;
    };
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
    const isActiveDisbursedLoan = (loan) => loan.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan.status) && loan.disbursement_date);
    const isGivenLoan = (loan) => ['disbursed', 'completed', 'closed'].includes(loan.status) || (['approved', 'partial_approved'].includes(loan.status) && loan.disbursement_date);
    const getOfficerName = (loan) => {
      const officer = loan.expand?.processed_by;
      if (officer) return officer.name || officer.email || officer.username || 'Loan Officer';
      const user = users.find(u => u.id === loan.processed_by);
      if (user) return user.name || user.email || user.username || 'Loan Officer';
      return loan.processed_by ? `User ${String(loan.processed_by).slice(0, 6)}` : 'Unassigned';
    };
    const officerOptionMap = {};
    users.forEach(user => {
      officerOptionMap[user.id] = user.name || user.email || user.username || 'Loan Officer';
    });
    loans.forEach(loan => {
      if (loan.processed_by && !officerOptionMap[loan.processed_by]) {
        officerOptionMap[loan.processed_by] = getOfficerName(loan);
      }
    });
    const officerOptions = Object.entries(officerOptionMap)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const filterByOfficer = (loan) => currentOfficerFilter === 'all' || loan.processed_by === currentOfficerFilter;
    const loansById = new Map(loans.map(loan => [loan.id, loan]));
    const formatShortDate = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const getCollectionWindow = () => {
      const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
      const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
      const addDays = (date, days) => {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
      };

      if (currentCollectionWindow === 'next_7_days') {
        const end = addDays(todayStart, 7);
        end.setHours(23, 59, 59, 999);
        return { label: 'Next 7 Days', start: todayStart, end, includeOverdue: false };
      }
      if (currentCollectionWindow === 'next_month') {
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        return { label: 'Next Month', start: startOfMonth(nextMonth), end: endOfMonth(nextMonth), includeOverdue: false };
      }
      if (currentCollectionWindow === 'overdue') {
        const end = new Date(todayStart);
        end.setMilliseconds(-1);
        return { label: 'Overdue', start: null, end, includeOverdue: true };
      }
      if (currentCollectionWindow === 'all_upcoming') {
        return { label: 'All Upcoming', start: todayStart, end: null, includeOverdue: false };
      }
      return { label: 'This Month', start: startOfMonth(today), end: endOfMonth(today), includeOverdue: false };
    };
    const collectionWindow = getCollectionWindow();
    const collectionWindowRange = collectionWindow.start && collectionWindow.end
      ? `${formatShortDate(collectionWindow.start)} - ${formatShortDate(collectionWindow.end)}`
      : collectionWindow.end
        ? `Before ${formatShortDate(todayStart)}`
        : `From ${formatShortDate(todayStart)}`;
    const scheduleRemaining = (schedule) => Math.max(0, (Number(schedule.amount) || 0) - (Number(schedule.paid) || 0));
    const scheduleMatchesCollectionWindow = (schedule) => {
      const dueDate = new Date(schedule.due_date);
      if (Number.isNaN(dueDate.getTime())) return false;
      if (collectionWindow.start && dueDate < collectionWindow.start) return false;
      if (collectionWindow.end && dueDate > collectionWindow.end) return false;
      return true;
    };

    const totalMembers = fMembers.length;
    const activeLoans = loans.filter(l => isActiveDisbursedLoan(l) && filterByOfficer(l));
    const scopedLoans = fLoans.filter(filterByOfficer);
    const scopedRepayments = currentOfficerFilter === 'all'
      ? fRepayments
      : fRepayments.filter(r => loans.some(l => l.id === r.loan && filterByOfficer(l)));
    const scopedSchedules = currentOfficerFilter === 'all'
      ? schedules
      : schedules.filter(s => loans.some(l => l.id === s.loan && filterByOfficer(l)));
    const loanPortfolio = activeLoans.reduce((sum, l) => sum + getLoanLiability(l), 0);
    const totalDisbursedLoans = activeLoans.reduce((sum, l) => sum + getLoanPrincipal(l), 0);
    const officerTargetsMap = {};
    activeLoans.forEach(loan => {
      const officerKey = loan.processed_by || 'unassigned';
      if (!officerTargetsMap[officerKey]) {
        officerTargetsMap[officerKey] = {
          id: officerKey,
          name: getOfficerName(loan),
          expected: 0,
          principal: 0,
          loans: 0
        };
      }
      officerTargetsMap[officerKey].expected += getLoanLiability(loan);
      officerTargetsMap[officerKey].principal += getLoanPrincipal(loan);
      officerTargetsMap[officerKey].loans += 1;
    });
    const officerTargets = Object.values(officerTargetsMap).sort((a, b) => b.expected - a.expected);
    const officerAssignedExpected = officerTargets
      .filter(o => o.id !== 'unassigned')
      .reduce((sum, o) => sum + o.expected, 0);
    const collectionSchedules = scopedSchedules
      .filter(schedule => {
        const loan = loansById.get(schedule.loan);
        if (!loan || !filterByOfficer(loan)) return false;
        if (schedule.status === 'paid' || scheduleRemaining(schedule) <= 0) return false;
        return scheduleMatchesCollectionWindow(schedule);
      });
    const expectedCollection = collectionSchedules.reduce((sum, schedule) => sum + scheduleRemaining(schedule), 0);
    const scheduledGrossCollection = collectionSchedules.reduce((sum, schedule) => sum + (Number(schedule.amount) || 0), 0);
    const scheduledPaidCollection = collectionSchedules.reduce((sum, schedule) => sum + (Number(schedule.paid) || 0), 0);
    const expectedCollectionLoans = new Set(collectionSchedules.map(schedule => schedule.loan)).size;
    const expectedCollectionClients = new Set(collectionSchedules.map(schedule => {
      const loan = loansById.get(schedule.loan);
      return loan?.member || loan?.group || schedule.loan;
    })).size;
    const collectionOfficerMap = {};
    collectionSchedules.forEach(schedule => {
      const loan = loansById.get(schedule.loan);
      const officerKey = loan?.processed_by || 'unassigned';
      if (!collectionOfficerMap[officerKey]) {
        collectionOfficerMap[officerKey] = {
          id: officerKey,
          name: loan ? getOfficerName(loan) : 'Unassigned',
          installments: 0,
          clients: new Set(),
          gross: 0,
          paid: 0,
          expected: 0
        };
      }
      collectionOfficerMap[officerKey].installments += 1;
      collectionOfficerMap[officerKey].clients.add(loan?.member || loan?.group || schedule.loan);
      collectionOfficerMap[officerKey].gross += Number(schedule.amount) || 0;
      collectionOfficerMap[officerKey].paid += Number(schedule.paid) || 0;
      collectionOfficerMap[officerKey].expected += scheduleRemaining(schedule);
    });
    const collectionOfficerRows = Object.values(collectionOfficerMap)
      .map(row => ({ ...row, clients: row.clients.size }))
      .sort((a, b) => b.expected - a.expected);
    
    // Correct savings calculation
    const totalSavings = fSavings
      .filter(s => !s.is_reversed)
      .reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);
    
    const totalRepaid = scopedRepayments.reduce((sum, r) => sum + r.amount, 0);
    const totalLiabilityOverall = scopedLoans.filter(isGivenLoan).reduce((sum, l) => sum + getLoanLiability(l), 0);
    const repaymentRate = totalLiabilityOverall > 0 ? ((totalRepaid / totalLiabilityOverall) * 100).toFixed(1) : 0;
    const repaymentRateNumber = Number(repaymentRate) || 0;
    const repaymentHealth = repaymentRateNumber <= 50
      ? { label: 'Action Required', color: 'var(--danger)' }
      : repaymentRateNumber <= 70
        ? { label: 'Average Portfolio', color: 'var(--warning)' }
        : { label: 'Healthy Portfolio', color: 'var(--success)' };

    // Real Trend logic (Members registered in current month vs total)
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const memberTrend = members.filter(m => m.registration_date && m.registration_date.startsWith(currentMonthKey)).length;

    // Compute Top Borrowers (Fixed Top 5) using filtered active loans and all repayments for those loans
    const borrowerMap = {};
    activeLoans.forEach(l => {
       const id = l.member || l.group;
       if (!borrowerMap[id]) borrowerMap[id] = 0;
       borrowerMap[id] += getLoanLiability(l);
       const reps = repayments.filter(r => r.loan === l.id).reduce((sum, r) => sum + r.amount, 0);
       borrowerMap[id] -= reps;
    });
    
    const topBorrowers = Object.keys(borrowerMap)
      .map(id => {
        const member = members.find(m => m.id === id);
        const group = groups.find(g => g.id === id);
        const name = member ? member.full_name : (group ? group.name : 'Unknown');
        return { name, id: (member?.reg_no || group?.group_id || id), balance: Math.max(0, borrowerMap[id]) };
      })
      .filter(b => b.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);

    // Compute Arrears Aging (All Time logic for arrears)
    const arrearsMap = {};
    let totalArrearsGlobal = 0;
    
    scopedSchedules.filter(s => s.status !== 'paid' && new Date(s.due_date) < today).forEach(s => {
       const loan = loans.find(l => l.id === s.loan);
       if (loan) {
          totalArrearsGlobal += s.amount;
          const id = loan.member || loan.group;
          if (!arrearsMap[id]) arrearsMap[id] = { name: '', id: '', amount: 0, daysOverdue: 0 };
          const member = members.find(m => m.id === id);
          const group = groups.find(g => g.id === id);
          arrearsMap[id].name = member ? member.full_name : (group ? group.name : 'Unknown');
          arrearsMap[id].id = member?.reg_no || group?.group_id || id;
          arrearsMap[id].amount += s.amount;
          const daysOverdue = Math.floor((today - new Date(s.due_date)) / (1000 * 60 * 60 * 24));
          if (daysOverdue > arrearsMap[id].daysOverdue) {
             arrearsMap[id].daysOverdue = daysOverdue;
          }
       }
    });
    const arrearsList = Object.values(arrearsMap).sort((a, b) => b.daysOverdue - a.daysOverdue);

    let arrearsPage = 1;
    const pageSize = 10;

    container.innerHTML = `
      <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h1 class="text-xl">Analytics & Insights</h1>
          <p class="text-muted">Real-time performance and portfolio metrics.</p>
        </div>
        <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end;">
          <select id="loan-user-filter" class="form-control" style="width: auto; min-width: 220px;">
            <option value="all" ${currentOfficerFilter === 'all' ? 'selected' : ''}>All Loan Users</option>
            ${officerOptions.map(o => `<option value="${escapeHtml(o.id)}" ${currentOfficerFilter === o.id ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
          </select>
          <select id="date-filter" class="form-control" style="width: auto;">
            <option value="30days" ${currentFilter === '30days' ? 'selected' : ''}>Last 30 Days</option>
            <option value="quarter" ${currentFilter === 'quarter' ? 'selected' : ''}>Last Quarter</option>
            <option value="ytd" ${currentFilter === 'ytd' ? 'selected' : ''}>Year to Date</option>
            <option value="all" ${currentFilter === 'all' ? 'selected' : ''}>All Time</option>
          </select>
          <select id="collection-window-filter" class="form-control" style="width: auto; min-width: 170px;">
            <option value="this_month" ${currentCollectionWindow === 'this_month' ? 'selected' : ''}>Collections: This Month</option>
            <option value="next_7_days" ${currentCollectionWindow === 'next_7_days' ? 'selected' : ''}>Collections: Next 7 Days</option>
            <option value="next_month" ${currentCollectionWindow === 'next_month' ? 'selected' : ''}>Collections: Next Month</option>
            <option value="overdue" ${currentCollectionWindow === 'overdue' ? 'selected' : ''}>Collections: Overdue</option>
            <option value="all_upcoming" ${currentCollectionWindow === 'all_upcoming' ? 'selected' : ''}>Collections: All Upcoming</option>
          </select>
        </div>
      </div>

      <!-- KPI Row -->
      <div class="analytics-grid">
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(27, 61, 114, 0.1); color: var(--primary);">👥</div>
          <div class="kpi-label">Total Members</div>
          <div class="kpi-value">${totalMembers}</div>
          <div class="kpi-trend trend-up">↑ +${memberTrend} this month</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(232, 105, 42, 0.1); color: var(--secondary);">💰</div>
          <div class="kpi-label">Active Loan Portfolio</div>
          <div class="kpi-value">KES ${loanPortfolio.toLocaleString()}</div>
          <div class="kpi-trend trend-up">Disbursed principal + interest</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(42, 90, 158, 0.1); color: var(--primary-light);">💵</div>
          <div class="kpi-label">Total Disbursed Loans</div>
          <div class="kpi-value">KES ${totalDisbursedLoans.toLocaleString()}</div>
          <div class="kpi-trend trend-up">Principal disbursed only</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(13, 148, 136, 0.1); color: #0d9488;">🧾</div>
          <div class="kpi-label">Officer Collection Targets</div>
          <div class="kpi-value">KES ${officerAssignedExpected.toLocaleString()}</div>
          <div class="kpi-trend trend-up">${currentOfficerFilter === 'all' ? `${officerTargets.filter(o => o.id !== 'unassigned').length} officers assigned` : 'Selected officer view'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(124, 58, 237, 0.1); color: #7c3aed;">📅</div>
          <div class="kpi-label">${collectionWindow.label} Collections Expected</div>
          <div class="kpi-value">KES ${expectedCollection.toLocaleString()}</div>
          <div class="kpi-trend ${expectedCollection > 0 ? 'trend-up' : 'trend-down'}">${expectedCollectionClients} clients · ${collectionSchedules.length} installments</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">🏦</div>
          <div class="kpi-label">Total Savings Base</div>
          <div class="kpi-value">KES ${totalSavings.toLocaleString()}</div>
          <div class="kpi-trend trend-up">System Liquidity</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(201, 168, 76, 0.1); color: var(--accent);">✅</div>
          <div class="kpi-label">Global Repayment Rate</div>
          <div class="kpi-value">${repaymentRate}%</div>
          <div class="kpi-trend" style="color: ${repaymentHealth.color};">${repaymentHealth.label}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(239, 68, 68, 0.1); color: var(--danger);">⚠️</div>
          <div class="kpi-label">Total Arrears</div>
          <div class="kpi-value">KES ${totalArrearsGlobal.toLocaleString()}</div>
          <div class="kpi-trend trend-down">Amount Overdue</div>
        </div>
      </div>

      <div class="chart-card" style="min-height: auto; margin-top: 24px; border-left: 4px solid #7c3aed;">
        <div class="chart-header">
          <div>
            <div class="chart-title">Collection Forecast</div>
            <div class="text-xs text-muted" style="margin-top: 4px;">
              ${collectionWindow.label} · ${collectionWindowRange} · ${currentOfficerFilter === 'all' ? 'All loan users' : 'Selected loan user'}
            </div>
          </div>
          <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end; font-size: 0.8rem;">
            <span class="badge badge-primary">Due: KES ${scheduledGrossCollection.toLocaleString()}</span>
            <span class="badge badge-success">Paid: KES ${scheduledPaidCollection.toLocaleString()}</span>
            <span class="badge badge-warning">Remaining: KES ${expectedCollection.toLocaleString()}</span>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table" style="font-size: 0.875rem;">
            <thead>
              <tr>
                <th>Loan Officer</th>
                <th>Clients</th>
                <th>Installments</th>
                <th class="text-right">Scheduled Due</th>
                <th class="text-right">Already Paid</th>
                <th class="text-right">Expected Collection</th>
              </tr>
            </thead>
            <tbody>
              ${collectionOfficerRows.length === 0 ? '<tr><td colspan="6" class="text-center text-muted">No scheduled collections for this forecast window.</td></tr>' : collectionOfficerRows.map(row => `
                <tr>
                  <td>
                    <div class="font-semibold">${escapeHtml(row.name)}</div>
                    <div class="text-xs text-muted">${row.id === 'unassigned' ? 'No officer recorded' : escapeHtml(row.id)}</div>
                  </td>
                  <td>${row.clients.toLocaleString()}</td>
                  <td>${row.installments.toLocaleString()}</td>
                  <td class="text-right">${row.gross.toLocaleString()}</td>
                  <td class="text-right text-success">${row.paid.toLocaleString()}</td>
                  <td class="text-right font-semibold text-danger">${row.expected.toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="text-xs text-muted" style="margin-top: 10px;">
          Expected collection is calculated from unpaid repayment schedule balances: installment amount minus amount already paid.
        </div>
      </div>

      <div class="chart-card" style="min-height: auto; margin-top: 24px;">
        <div class="chart-header">
          <div>
            <div class="chart-title">Loan Officer Collection Targets</div>
            <div class="text-xs text-muted" style="margin-top: 4px;">Expected collection is disbursed principal plus interest for loans handled by each officer.</div>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table" style="font-size: 0.875rem;">
            <thead>
              <tr>
                <th>Loan Officer</th>
                <th>Active Loans</th>
                <th class="text-right">Principal</th>
                <th class="text-right">Expected Collection</th>
              </tr>
            </thead>
            <tbody>
              ${officerTargets.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No active officer targets.</td></tr>' : officerTargets.map(o => `
                <tr>
                  <td>
                    <div class="font-semibold">${escapeHtml(o.name)}</div>
                    <div class="text-xs text-muted">${o.id === 'unassigned' ? 'No officer recorded' : escapeHtml(o.id)}</div>
                  </td>
                  <td>${o.loans.toLocaleString()}</td>
                  <td class="text-right">${o.principal.toLocaleString()}</td>
                  <td class="text-right font-semibold text-danger">${o.expected.toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Charts Row -->
      <div class="charts-grid">
        <div class="chart-card">
          <div class="chart-header">
            <div class="chart-title">Loan Distribution by Status</div>
          </div>
          <div class="chart-canvas-wrapper">
            <canvas id="loanStatusChart"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-header">
            <div class="chart-title">Repayment Performance (KES)</div>
          </div>
          <div class="chart-canvas-wrapper">
            <canvas id="repaymentBarChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Charts Row 2 -->
      <div class="charts-grid" style="margin-top: 24px;">
        <div class="chart-card">
          <div class="chart-header">
            <div class="chart-title">Member Onboarding Trend</div>
          </div>
          <div class="chart-canvas-wrapper">
            <canvas id="memberGrowthChart"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-header">
            <div class="chart-title">Savings Deposits vs. Disbursements</div>
          </div>
          <div class="chart-canvas-wrapper">
            <canvas id="savingsVsDisbursedChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Tables Row -->
      <div class="charts-grid" style="margin-top: 24px;">
        <!-- Top Borrowers -->
        <div class="chart-card" style="min-height: auto;">
          <div class="chart-header">
            <div class="chart-title">Top 5 Active Borrowers</div>
          </div>
          <div class="table-responsive">
            <table class="table" style="font-size: 0.875rem;">
              <thead>
                <tr>
                  <th>Client Name</th>
                  <th class="text-right">Outstanding Balance</th>
                </tr>
              </thead>
              <tbody>
                ${topBorrowers.length === 0 ? '<tr><td colspan="2" class="text-center text-muted">No active loans</td></tr>' : topBorrowers.map(b => `
                  <tr>
                    <td>
                      <div class="font-semibold">${b.name}</div>
                      <div class="text-xs text-muted">${b.id}</div>
                    </td>
                    <td class="text-right font-semibold text-danger">${b.balance.toLocaleString()}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Arrears Aging -->
        <div class="chart-card" style="min-height: auto; border-color: rgba(239, 68, 68, 0.3);">
          <div class="chart-header">
            <div class="chart-title" style="color: var(--danger);">Arrears & Aging Watchlist</div>
          </div>
          <div class="table-responsive">
            <table class="table" style="font-size: 0.875rem;">
              <thead>
                <tr>
                  <th>Client Name</th>
                  <th>Days Overdue</th>
                  <th class="text-right">Amount in Arrears</th>
                </tr>
              </thead>
              <tbody id="arrears-table-body"></tbody>
            </table>
            <div id="arrears-pagination"></div>
          </div>
        </div>
      </div>
    `;

    // Reattach Event Listeners
    container.querySelector('#loan-user-filter').onchange = (e) => {
      currentOfficerFilter = e.target.value;
      renderData();
    };

    container.querySelector('#date-filter').onchange = (e) => {
      currentFilter = e.target.value;
      renderData();
    };
    container.querySelector('#collection-window-filter').onchange = (e) => {
      currentCollectionWindow = e.target.value;
      renderData();
    };

    const updateArrearsUI = () => {
      const start = (arrearsPage - 1) * pageSize;
      const paginated = arrearsList.slice(start, start + pageSize);
      const tbody = container.querySelector('#arrears-table-body');
      
      tbody.innerHTML = paginated.length === 0 ? '<tr><td colspan="3" class="text-center text-success font-semibold">Clean Portfolio! No arrears.</td></tr>' : paginated.map(a => {
        let badge = 'badge-warning';
        if (a.daysOverdue > 30) badge = 'badge-secondary';
        if (a.daysOverdue > 60) badge = 'badge-danger';
        return `
          <tr>
            <td><div class="font-semibold">${a.name}</div><div class="text-xs text-muted">${a.id}</div></td>
            <td><span class="badge ${badge}">${a.daysOverdue} Days</span></td>
            <td class="text-right font-semibold text-danger">${a.amount.toLocaleString()}</td>
          </tr>`;
      }).join('');

      const pag = container.querySelector('#arrears-pagination');
      pag.innerHTML = '';
      const ctrl = renderPagination(arrearsList.length, pageSize, arrearsPage, (p) => { arrearsPage = p; updateArrearsUI(); });
      if (ctrl) pag.appendChild(ctrl);
    };

    updateArrearsUI();

    setTimeout(() => {
      initCharts(scopedLoans, scopedRepayments, members, fSavings); // members passed as un-filtered for cumulative count logic
    }, 100);
  };

  const initCharts = (fLoans, fRepayments, allMembers, fSavings) => {
    destroyCharts();

    // 1. Loan Status Chart
    const statusCounts = {
      pending: fLoans.filter(l => l.status === 'pending').length,
      awaiting: fLoans.filter(l => ['approved', 'partial_approved'].includes(l.status) && !l.disbursement_date).length,
      disbursed: fLoans.filter(l => l.status === 'disbursed' || (['approved', 'partial_approved'].includes(l.status) && l.disbursement_date)).length,
      completed: fLoans.filter(l => l.status === 'completed').length,
      expired: fLoans.filter(l => l.status === 'expired').length,
      rejected: fLoans.filter(l => l.status === 'rejected').length
    };

    const canvas1 = document.getElementById('loanStatusChart');
    if (canvas1) {
      chartInstances.push(new Chart(canvas1, {
        type: 'doughnut',
        data: {
          labels: ['Pending', 'Awaiting Disb', 'Disbursed', 'Completed', 'Expired', 'Rejected'],
          datasets: [{
            data: [statusCounts.pending, statusCounts.awaiting, statusCounts.disbursed, statusCounts.completed, statusCounts.expired, statusCounts.rejected],
            backgroundColor: ['#F59E0B', '#0D9488', '#2A5A9E', '#10B981', '#7C2D12', '#EF4444'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          cutout: '70%'
        }
      }));
    }

    // Setup time axes for last 6 months
    const months = [];
    const monthKeys = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push(d.toLocaleString('default', { month: 'short' }));
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // 2. Repayment Performance (Bar)
    const repaymentData = monthKeys.map(mk => {
      return fRepayments
        .filter(r => r.date && r.date.startsWith(mk))
        .reduce((sum, r) => sum + r.amount, 0);
    });

    const canvas2 = document.getElementById('repaymentBarChart');
    if (canvas2) {
      chartInstances.push(new Chart(canvas2, {
        type: 'bar',
        data: {
          labels: months,
          datasets: [{
            label: 'Repayments Collected',
            data: repaymentData,
            backgroundColor: '#1B3D72',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { display: false } },
            x: { grid: { display: false } }
          }
        }
      }));
    }

    // 3. Member Growth
    let cumulativeMembers = allMembers.filter(m => {
      if (!m.registration_date) return false;
      const regDate = new Date(m.registration_date);
      const limit = new Date();
      limit.setMonth(limit.getMonth() - 5);
      limit.setDate(1); 
      return regDate < limit;
    }).length;

    const growthData = monthKeys.map(mk => {
      const newMembers = allMembers.filter(m => m.registration_date && m.registration_date.startsWith(mk)).length;
      cumulativeMembers += newMembers;
      return cumulativeMembers;
    });

    const canvas3 = document.getElementById('memberGrowthChart');
    if (canvas3) {
      chartInstances.push(new Chart(canvas3, {
        type: 'line',
        data: {
          labels: months,
          datasets: [{
            label: 'Total Members',
            data: growthData,
            borderColor: '#E8692A',
            backgroundColor: 'rgba(232, 105, 42, 0.1)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true },
            x: { grid: { display: false } }
          }
        }
      }));
    }

    // 4. Savings vs Disbursements
    const savingsData = monthKeys.map(mk => {
      return fSavings
        .filter(s => s.date && s.date.startsWith(mk) && s.type === 'deposit')
        .reduce((sum, s) => sum + s.amount, 0);
    });

    const disbData = monthKeys.map(mk => {
      return fLoans
        .filter(l => ['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date && l.disbursement_date.startsWith(mk))
        .reduce((sum, l) => sum + (l.approved_amount || 0), 0);
    });

    const canvas4 = document.getElementById('savingsVsDisbursedChart');
    if (canvas4) {
      chartInstances.push(new Chart(canvas4, {
        type: 'line',
        data: {
          labels: months,
          datasets: [
            {
              label: 'Savings Deposits',
              data: savingsData,
              borderColor: '#10B981',
              backgroundColor: 'rgba(16, 185, 129, 0.05)',
              fill: true,
              tension: 0.4
            },
            {
              label: 'Loan Disbursements',
              data: disbData,
              borderColor: '#EF4444',
              backgroundColor: 'rgba(239, 68, 68, 0.05)',
              fill: true,
              tension: 0.4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: {
            y: { beginAtZero: true },
            x: { grid: { display: false } }
          }
        }
      }));
    }
  };

  refresh().then(ok => {
    if (ok) renderData();
  });

  // Keep analytics fresh without holding multiple PocketBase realtime SSE streams open.
  // Realtime over Cloudflare/PocketHost can surface Chrome QUIC errors on long-lived streams.
  const debouncedRefresh = debounce(async () => {
    const ok = await refresh();
    if (ok) renderData();
  }, 500);

  const pollInterval = setInterval(() => {
    debouncedRefresh();
  }, 30000);

  container.__subscriptions = [
    () => clearInterval(pollInterval)
  ];

  return container;
};
