import { pb } from '../../services/api.js';

export const renderDashboard = async () => {
  const container = document.createElement('div');
  
  const refresh = async () => {
    let members, groups, loans, savings, schedules;
    try {
      [members, groups, loans, savings, schedules] = await Promise.all([
        pb.collection('members').getFullList(),
        pb.collection('groups').getFullList(),
        pb.collection('loans').getFullList(),
        pb.collection('savings').getFullList(),
        pb.collection('loan_schedule').getFullList()
      ]);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      container.innerHTML = `<div class="card text-center text-danger" style="padding: 40px; margin: 20px;">
        <h3 style="margin-bottom: 12px;">Failed to load dashboard</h3>
        <p class="text-muted" style="margin-bottom: 20px;">${err.message}</p>
        <button class="btn btn-primary" onclick="window.location.reload()">Retry Connection</button>
      </div>`;
      return;
    }

  // Calculate Metrics
  const activeMembers = members.filter(m => m.status !== 'inactive').length;
  const activeGroups = groups.length; // Assuming all groups are active for now
  const pendingLoans = loans.filter(l => l.status === 'pending').length;
  
  // calculate savings correctly
  const totalSavings = savings
    .filter(s => !s.is_reversed)
    .reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);

  const today = new Date();
  const totalArrears = schedules
    .filter(s => s.status !== 'paid' && new Date(s.due_date) < today)
    .reduce((sum, s) => sum + s.amount, 0);

  // Calculate Alerts
  const upcomingThreshold = new Date();
  upcomingThreshold.setDate(today.getDate() + 7);

  const totalAlerts = schedules.filter(s => s.status !== 'paid').map(s => {
    const loan = loans.find(l => l.id === s.loan);
    if (!loan || !['disbursed', 'approved', 'completed', 'closed'].includes(loan.status) || !loan.disbursement_date) return null;
    
    const dueDate = new Date(s.due_date);
    if (dueDate <= upcomingThreshold) return true;
    return null;
  }).filter(Boolean).length;

  // Compile Recent Activity
  let activities = [];
  
  // Add member registrations to activity
  members.forEach(m => {
    activities.push({
      date: new Date(m.registration_date || m.created),
      type: 'member',
      title: 'New Member Registered',
      description: `${m.full_name} (${m.reg_no}) joined the system.`
    });
  });

  // Add loans to activity
  loans.forEach(l => {
    activities.push({
      date: new Date(l.application_date || l.created),
      type: 'loan',
      title: 'Loan Application',
      description: `Loan ${l.loan_no} for KES ${(l.amount_applied || 0).toLocaleString()} was submitted.`
    });
    
    if ((l.status === 'disbursed' || l.status === 'approved') && l.disbursement_date) {
      activities.push({
        date: new Date(l.disbursement_date),
        type: 'disbursement',
        title: 'Loan Disbursed',
        description: `Loan ${l.loan_no} (KES ${(l.approved_amount || 0).toLocaleString()}) was disbursed.`
      });
    }
  });

  // Add savings deposits to activity
  savings.filter(s => s.type === 'deposit').forEach(s => {
    activities.push({
      date: new Date(s.date || s.created),
      type: 'savings',
      title: 'Savings Deposit',
      description: `KES ${s.amount.toLocaleString()} deposited by client.` // Client mapping omitted for brevity
    });
  });

  // Sort activities by date descending (newest first)
  activities.sort((a, b) => b.date - a.date);
  
  // Take top 5 recent activities
  const recentActivities = activities.slice(0, 5);

  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 class="text-xl">Dashboard Overview</h1>
      <p class="text-muted">Welcome to the Inlet Capital management system.</p>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; margin-bottom: 32px;">
      <div class="card">
        <h3 class="text-sm text-muted" style="margin-bottom: 8px;">Total Active Members</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: var(--primary);">${activeMembers}</p>
      </div>
      <div class="card">
        <h3 class="text-sm text-muted" style="margin-bottom: 8px;">Active Groups</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: var(--primary);">${activeGroups}</p>
      </div>
      <div class="card">
        <h3 class="text-sm text-muted" style="margin-bottom: 8px;">Pending Loans</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: var(--warning);">${pendingLoans}</p>
      </div>
      <div class="card">
        <h3 class="text-sm text-muted" style="margin-bottom: 8px;">Total Savings (KES)</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: var(--success);">${totalSavings.toLocaleString()}</p>
      </div>
      <div class="card">
        <h3 class="text-sm text-muted" style="margin-bottom: 8px;">Total Arrears (KES)</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: var(--danger);">${totalArrears.toLocaleString()}</p>
      </div>
      <div class="card" onclick="window.location.hash = '#/reports?tab=alerts'" style="cursor: pointer; border-left: 4px solid var(--warning); background: rgba(245, 158, 11, 0.05); transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='var(--shadow-md)';" onmouseout="this.style.transform='none'; this.style.boxShadow='var(--shadow-sm)';">
        <h3 class="text-sm" style="margin-bottom: 8px; color: var(--warning); font-weight: 600;">Active Alerts & Reminders ⚠️</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: var(--warning);">${totalAlerts}</p>
        <p class="text-xs text-muted" style="margin-top: 8px;">Click to view follow-ups</p>
      </div>
    </div>

    <!-- Quick Actions -->
    <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 32px;">
      <button class="btn btn-primary" onclick="window.location.hash = '#/members/new'">+ Register Member</button>
      <button class="btn btn-secondary" onclick="window.location.hash = '#/loans/new'">Apply for Loan</button>
      <button class="btn btn-outline" onclick="window.location.hash = '#/savings/new'">Record Savings</button>
    </div>
    
    <div class="card">
      <h3 style="margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">Recent Activity</h3>
      <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
        ${recentActivities.length === 0 ? `
          <p class="text-muted text-sm text-center" style="padding: 20px 0;">No recent activity in the system.</p>
        ` : recentActivities.map(act => `
          <div style="display: flex; gap: 16px; align-items: flex-start; padding: 12px; border-radius: 8px; background: var(--bg-light);">
            <div style="
              width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;
              background: ${
                act.type === 'member' ? 'rgba(27, 61, 114, 0.1)' : 
                act.type === 'loan' ? 'rgba(245, 158, 11, 0.1)' :
                act.type === 'disbursement' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(37, 99, 235, 0.1)'
              };
            ">
              ${
                act.type === 'member' ? '👤' : 
                act.type === 'loan' ? '📄' :
                act.type === 'disbursement' ? '💰' : '💳'
              }
            </div>
            <div style="flex: 1;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <h4 style="font-size: 0.95rem; margin: 0;">${act.title}</h4>
                <span class="text-xs text-muted">${act.date.toLocaleString()}</span>
              </div>
              <p class="text-sm text-muted" style="margin-top: 4px;">${act.description}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  };

  await refresh();

  // Real-time updates
  const subs = await Promise.all([
    pb.collection('members').subscribe('*', refresh),
    pb.collection('groups').subscribe('*', refresh),
    pb.collection('loans').subscribe('*', refresh),
    pb.collection('savings').subscribe('*', refresh),
    pb.collection('loan_schedule').subscribe('*', refresh)
  ]);
  container.__subscriptions = subs;

  return container;
};
