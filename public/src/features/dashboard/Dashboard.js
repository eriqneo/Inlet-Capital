import { getAll } from '../../core/db.js';

export const renderDashboard = async () => {
  const container = document.createElement('div');
  
  // Fetch real-time data from IndexedDB
  const [members, groups, loans, savings] = await Promise.all([
    getAll('members'),
    getAll('groups'),
    getAll('loans'),
    getAll('savings')
  ]);

  // Calculate Metrics
  const activeMembers = members.filter(m => m.status !== 'inactive').length;
  const activeGroups = groups.length; // Assuming all groups are active for now
  const pendingLoans = loans.filter(l => l.status === 'pending').length;
  
  const totalSavings = savings.reduce((sum, tx) => {
    return sum + (tx.type === 'deposit' ? tx.amount : -tx.amount);
  }, 0);

  // Compile Recent Activity
  let activities = [];
  
  // Add member registrations to activity
  members.forEach(m => {
    activities.push({
      date: new Date(m.registrationDate),
      type: 'member',
      title: 'New Member Registered',
      description: `${m.fullName} (${m.regNo}) joined the system.`
    });
  });

  // Add loans to activity
  loans.forEach(l => {
    activities.push({
      date: new Date(l.applicationDate),
      type: 'loan',
      title: 'Loan Application',
      description: `Loan ${l.loanNo} for KES ${l.amountApplied.toLocaleString()} was submitted.`
    });
    
    if (l.status === 'approved' && l.disbursementDate) {
      activities.push({
        date: new Date(l.disbursementDate),
        type: 'disbursement',
        title: 'Loan Disbursed',
        description: `Loan ${l.loanNo} (KES ${l.approvedAmount.toLocaleString()}) was disbursed.`
      });
    }
  });

  // Add savings deposits to activity
  savings.filter(s => s.type === 'deposit').forEach(s => {
    activities.push({
      date: new Date(s.date),
      type: 'savings',
      title: 'Savings Deposit',
      description: `KES ${s.amount.toLocaleString()} deposited by ${s.memberId || s.groupId}.`
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

  return container;
};
