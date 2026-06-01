import { pb } from '../../services/api.js';
import { renderPagination } from '../../components/Pagination.js';

export const renderAnalyticsDashboard = async () => {
  const container = document.createElement('div');
  container.innerHTML = `<div class="card text-center text-muted" style="padding:40px;">Loading analytics...</div>`;
  
  // Fetch Data
  let members, loans, repayments, groups, savings, schedules;
  try {
    [members, loans, repayments, groups, savings, schedules] = await Promise.all([
      pb.collection('members').getFullList(),
      pb.collection('loans').getFullList(),
      pb.collection('loan_repayments').getFullList(),
      pb.collection('groups').getFullList(),
      pb.collection('savings').getFullList(),
      pb.collection('loan_schedule').getFullList()
    ]);
  } catch (err) {
    console.error('Failed to load analytics data:', err);
    container.innerHTML = `<div class="card text-center text-danger" style="padding: 40px; margin: 20px;">
      <h3 style="margin-bottom: 12px;">Failed to load analytics</h3>
      <p class="text-muted" style="margin-bottom: 20px;">${err.message}</p>
      <button class="btn btn-primary" onclick="window.location.reload()">Retry Connection</button>
    </div>`;
    return container;
  }

  let currentFilter = 'all'; // '30days', 'quarter', 'ytd', 'all'
  let chartInstances = [];

  const destroyCharts = () => {
    chartInstances.forEach(c => c.destroy());
    chartInstances = [];
  };

  const renderData = () => {
    const today = new Date();
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
    const totalMembers = fMembers.length;
    const activeLoans = fLoans.filter(l => l.status === 'disbursed' || (l.status === 'approved' && l.disbursement_date));
    const loanPortfolio = activeLoans.reduce((sum, l) => sum + (l.total_liability || 0), 0);
    
    // Correct savings calculation
    const totalSavings = fSavings
      .filter(s => !s.is_reversed)
      .reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);
    
    const totalRepaid = fRepayments.reduce((sum, r) => sum + r.amount, 0);
    const totalLiabilityOverall = fLoans.filter(l => ['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date).reduce((sum, l) => sum + (l.total_liability || 0), 0);
    const repaymentRate = totalLiabilityOverall > 0 ? ((totalRepaid / totalLiabilityOverall) * 100).toFixed(1) : 0;

    // Real Trend logic (Members registered in current month vs total)
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const memberTrend = members.filter(m => m.registration_date && m.registration_date.startsWith(currentMonthKey)).length;

    // Compute Top Borrowers (Fixed Top 5) using filtered active loans and all repayments for those loans
    const borrowerMap = {};
    activeLoans.forEach(l => {
       const id = l.member || l.group;
       if (!borrowerMap[id]) borrowerMap[id] = 0;
       borrowerMap[id] += (l.total_liability || 0);
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
    
    schedules.filter(s => s.status !== 'paid' && new Date(s.due_date) < today).forEach(s => {
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
        <div style="display: flex; gap: 12px;">
          <select id="date-filter" class="form-control" style="width: auto;">
            <option value="30days" ${currentFilter === '30days' ? 'selected' : ''}>Last 30 Days</option>
            <option value="quarter" ${currentFilter === 'quarter' ? 'selected' : ''}>Last Quarter</option>
            <option value="ytd" ${currentFilter === 'ytd' ? 'selected' : ''}>Year to Date</option>
            <option value="all" ${currentFilter === 'all' ? 'selected' : ''}>All Time</option>
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
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(239, 68, 68, 0.1); color: var(--danger);">⚠️</div>
          <div class="kpi-label">Total Arrears</div>
          <div class="kpi-value">KES ${totalArrearsGlobal.toLocaleString()}</div>
          <div class="kpi-trend trend-down">Amount Overdue</div>
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

    // Reattach Event Listeners
    container.querySelector('#date-filter').onchange = (e) => {
      currentFilter = e.target.value;
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
            <td class="text-right font-semibold text-danger">KES ${a.amount.toLocaleString()}</td>
          </tr>`;
      }).join('');

      const pag = container.querySelector('#arrears-pagination');
      pag.innerHTML = '';
      const ctrl = renderPagination(arrearsList.length, pageSize, arrearsPage, (p) => { arrearsPage = p; updateArrearsUI(); });
      if (ctrl) pag.appendChild(ctrl);
    };

    updateArrearsUI();

    setTimeout(() => {
      initCharts(fLoans, fRepayments, members, fSavings); // members passed as un-filtered for cumulative count logic
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

  renderData();

  return container;
};
