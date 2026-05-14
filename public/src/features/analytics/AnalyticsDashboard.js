import { getAll } from '../../core/db.js';
import { renderPagination } from '../../components/Pagination.js';

export const renderAnalyticsDashboard = async () => {
  const container = document.createElement('div');
  
  // Fetch Data
  const [members, loans, repayments, groups, savings, schedules] = await Promise.all([
    getAll('members'),
    getAll('loans'),
    getAll('loan_repayments'),
    getAll('groups'),
    getAll('savings'),
    getAll('loan_schedule')
  ]);

  // Calculations
  const totalMembers = members.length;
  const activeLoans = loans.filter(l => l.status === 'approved');
  const loanPortfolio = activeLoans.reduce((sum, l) => sum + l.totalLiability, 0);
  const totalSavings = members.reduce((sum, m) => sum + (m.totalSavings || 0), 0) + groups.reduce((sum, g) => sum + (g.totalSavings || 0), 0);
  
  const totalRepaid = repayments.reduce((sum, r) => sum + r.amount, 0);
  const totalLiabilityOverall = loans.filter(l => l.status === 'approved' || l.status === 'completed').reduce((sum, l) => sum + l.totalLiability, 0);
  const repaymentRate = totalLiabilityOverall > 0 ? ((totalRepaid / totalLiabilityOverall) * 100).toFixed(1) : 0;

  // Real Trend logic (Members registered in current month)
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const memberTrend = members.filter(m => m.registrationDate && m.registrationDate.startsWith(currentMonthKey)).length;

  // Compute Top Borrowers (Fixed Top 5)
  const borrowerMap = {};
  activeLoans.forEach(l => {
     const id = l.memberId || l.groupId;
     if (!borrowerMap[id]) borrowerMap[id] = 0;
     borrowerMap[id] += l.totalLiability;
     const reps = repayments.filter(r => r.loanNo === l.loanNo).reduce((sum, r) => sum + r.amount, 0);
     borrowerMap[id] -= reps;
  });
  
  const topBorrowers = Object.keys(borrowerMap)
    .map(id => {
      const member = members.find(m => m.regNo === id);
      const group = groups.find(g => g.groupId === id);
      const name = member ? member.fullName : (group ? group.name : 'Unknown');
      return { name, id, balance: Math.max(0, borrowerMap[id]) };
    })
    .filter(b => b.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);

  // Compute Arrears Aging (With Pagination)
  const arrearsMap = {};
  schedules.filter(s => s.status !== 'paid' && new Date(s.dueDate) < today).forEach(s => {
     const loan = loans.find(l => l.loanNo === s.loanId);
     if (loan) {
        const id = loan.memberId || loan.groupId;
        if (!arrearsMap[id]) arrearsMap[id] = { name: '', id, amount: 0, daysOverdue: 0 };
        const member = members.find(m => m.regNo === id);
        const group = groups.find(g => g.groupId === id);
        arrearsMap[id].name = member ? member.fullName : (group ? group.name : 'Unknown');
        arrearsMap[id].amount += s.amount;
        const daysOverdue = Math.floor((today - new Date(s.dueDate)) / (1000 * 60 * 60 * 24));
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
      <div style="display: flex; gap: 12px;">
        <select class="form-control" style="width: auto;">
          <option>Last 30 Days</option>
          <option>Last Quarter</option>
          <option>Year to Date</option>
          <option selected>All Time</option>
        </select>
        <button class="btn btn-outline" onclick="window.print()">🖨️ Export</button>
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
        <div class="kpi-trend trend-up">Total outstanding expected</div>
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
        <div class="kpi-trend ${repaymentRate > 90 ? 'trend-up' : 'trend-down'}">${repaymentRate > 90 ? '🎯 Healthy Portfolio' : '⚠ Action Required'}</div>
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
                  <td class="text-right font-semibold text-danger">KES ${b.balance.toLocaleString()}</td>
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
          <td class="text-right font-semibold text-danger">KES ${a.amount.toLocaleString()}</td>
        </tr>`;
    }).join('');

    const pag = container.querySelector('#arrears-pagination');
    pag.innerHTML = '';
    const ctrl = renderPagination(arrearsList.length, pageSize, arrearsPage, (p) => { arrearsPage = p; updateArrearsUI(); });
    if (ctrl) pag.appendChild(ctrl);
  };

  updateArrearsUI();

  // Wait for DOM
  setTimeout(() => {
    initCharts(loans, repayments, members, savings);
  }, 100);

  return container;
};

const initCharts = (loans, repayments, members, savings) => {
  // 1. Loan Status Chart
  const statusCounts = {
    pending: loans.filter(l => l.status === 'pending').length,
    approved: loans.filter(l => l.status === 'approved').length,
    completed: loans.filter(l => l.status === 'completed').length,
    rejected: loans.filter(l => l.status === 'rejected').length
  };

  const canvas1 = document.getElementById('loanStatusChart');
  if (canvas1) {
    new Chart(canvas1, {
      type: 'doughnut',
      data: {
        labels: ['Pending', 'Approved', 'Completed', 'Rejected'],
        datasets: [{
          data: [statusCounts.pending, statusCounts.approved, statusCounts.completed, statusCounts.rejected],
          backgroundColor: ['#F59E0B', '#2A5A9E', '#10B981', '#EF4444'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        cutout: '70%'
      }
    });
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
    return repayments
      .filter(r => r.date && r.date.startsWith(mk))
      .reduce((sum, r) => sum + r.amount, 0);
  });

  const canvas2 = document.getElementById('repaymentBarChart');
  if (canvas2) {
    new Chart(canvas2, {
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
    });
  }

  // 3. Member Growth
  let cumulativeMembers = members.filter(m => {
    if (!m.registrationDate) return false;
    const regDate = new Date(m.registrationDate);
    const limit = new Date();
    limit.setMonth(limit.getMonth() - 5);
    limit.setDate(1); 
    return regDate < limit;
  }).length;

  const growthData = monthKeys.map(mk => {
    const newMembers = members.filter(m => m.registrationDate && m.registrationDate.startsWith(mk)).length;
    cumulativeMembers += newMembers;
    return cumulativeMembers;
  });

  const canvas3 = document.getElementById('memberGrowthChart');
  if (canvas3) {
    new Chart(canvas3, {
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
    });
  }

  // 4. Savings vs Disbursements
  const savingsData = monthKeys.map(mk => {
    return savings
      .filter(s => s.date && s.date.startsWith(mk) && s.type === 'deposit')
      .reduce((sum, s) => sum + s.amount, 0);
  });

  const disbData = monthKeys.map(mk => {
    return loans
      .filter(l => (l.status === 'approved' || l.status === 'completed' || l.status === 'closed') && l.disbursementDate && l.disbursementDate.startsWith(mk))
      .reduce((sum, l) => sum + l.approvedAmount, 0);
  });

  const canvas4 = document.getElementById('savingsVsDisbursedChart');
  if (canvas4) {
    new Chart(canvas4, {
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
    });
  }
};
