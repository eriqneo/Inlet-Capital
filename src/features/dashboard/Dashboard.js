import { pb } from '../../services/api.js';
import { dataCache, debounce } from '../../services/dataCache.js';
import { memberService } from '../../services/memberService.js';
import { groupService } from '../../services/groupService.js';
import { loanService } from '../../services/loanService.js';
import { savingsService } from '../../services/savingsService.js';
import { withReturnTo } from '../../core/navigation.js';
import { getArrearsTotal, getScheduleRemaining, isScheduleInArrears, isSchedulePaid } from '../../core/loanScheduleMetrics.js';
import { getLatestSavingsDate, getMemberActivityStatus } from '../../core/memberActivity.js';

export const renderDashboard = async () => {
  const container = document.createElement('div');
  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 class="text-xl">Dashboard Overview</h1>
      <p class="text-muted">Welcome to the Inlet Capital management system.</p>
    </div>
    <div class="card text-center" style="padding: 48px;">
      <div class="spinner" style="margin: 0 auto 16px;"></div>
      <p class="text-muted">Loading dashboard insights...</p>
    </div>
  `;

  const safe = async (label, fn, fallback) => {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[Dashboard] ${label} failed:`, err);
      return fallback;
    }
  };

  const maybeShowWelcomeTour = () => {
    if (localStorage.getItem('inlet_show_welcome_tour') !== 'true') return;
    localStorage.removeItem('inlet_show_welcome_tour');

    const stepDefs = [
      {
        target: 'h1',
        title: 'Dashboard',
        body: 'This is your daily command center: alerts, portfolio health, recent activity, and quick actions.'
      },
      {
        target: '[data-nav-path="#/members"]',
        title: 'Members',
        body: 'Use this area to find clients, open profiles, and work with their savings or loan history.'
      },
      {
        target: '[data-nav-path="#/loans"]',
        title: 'Loans',
        body: 'This is where loan applications, approvals, disbursements, and repayments are managed.'
      },
      {
        target: '[data-nav-path="#/savings"]',
        title: 'Savings',
        body: 'Record member or group deposits and withdrawals here, based on your assigned role.'
      },
      {
        target: '[data-nav-path="#/reports"]',
        title: 'Reports',
        body: 'Use reports for audits, disbursement analysis, cashflow, collections, and export-ready tables.'
      },
      {
        target: '[data-nav-path="#/settings"]',
        title: 'Settings',
        body: 'Admins manage users, roles, organization details, rates, and audit settings here.'
      }
    ];

    const steps = stepDefs
      .map(step => ({ ...step, element: document.querySelector(step.target) }))
      .filter(step => step.element);
    if (steps.length === 0) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; inset: 0; z-index: 20000; pointer-events: none;';
    overlay.innerHTML = `
      <div id="tour-scrim" style="position: absolute; inset: 0; background: rgba(15, 37, 69, 0.42); pointer-events: auto;"></div>
      <div id="tour-highlight" style="position: absolute; border: 2px solid var(--secondary); border-radius: 10px; box-shadow: 0 0 0 9999px rgba(15, 37, 69, 0.42), 0 12px 30px rgba(0,0,0,0.18); transition: all 0.2s ease;"></div>
      <div id="tour-card" class="card" style="position: absolute; width: min(360px, calc(100vw - 32px)); pointer-events: auto; padding: 18px; box-shadow: 0 18px 48px rgba(15, 37, 69, 0.28);">
        <div class="text-xs text-muted" id="tour-count" style="margin-bottom: 6px;"></div>
        <h3 id="tour-title" style="margin-bottom: 8px;"></h3>
        <p id="tour-body" class="text-sm text-muted" style="line-height: 1.6; margin-bottom: 16px;"></p>
        <div style="display: flex; justify-content: space-between; gap: 10px;">
          <button type="button" class="btn btn-outline btn-sm" id="tour-skip-btn">Skip</button>
          <button type="button" class="btn btn-primary btn-sm" id="tour-next-btn">Next</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const highlight = overlay.querySelector('#tour-highlight');
    const card = overlay.querySelector('#tour-card');
    const title = overlay.querySelector('#tour-title');
    const body = overlay.querySelector('#tour-body');
    const count = overlay.querySelector('#tour-count');
    const nextBtn = overlay.querySelector('#tour-next-btn');
    const skipBtn = overlay.querySelector('#tour-skip-btn');
    let index = 0;

    const closeTour = () => {
      window.removeEventListener('resize', renderStep);
      overlay.remove();
    };

    function renderStep() {
      const step = steps[index];
      const rect = step.element.getBoundingClientRect();
      const pad = 8;
      highlight.style.left = `${Math.max(8, rect.left - pad)}px`;
      highlight.style.top = `${Math.max(8, rect.top - pad)}px`;
      highlight.style.width = `${Math.min(window.innerWidth - 16, rect.width + pad * 2)}px`;
      highlight.style.height = `${rect.height + pad * 2}px`;
      title.textContent = step.title;
      body.textContent = step.body;
      count.textContent = `Step ${index + 1} of ${steps.length}`;
      nextBtn.textContent = index === steps.length - 1 ? 'Finish' : 'Next';

      const cardTop = rect.bottom + 16 + card.offsetHeight < window.innerHeight
        ? rect.bottom + 16
        : Math.max(16, rect.top - card.offsetHeight - 16);
      const cardLeft = Math.min(window.innerWidth - card.offsetWidth - 16, Math.max(16, rect.left));
      card.style.top = `${cardTop}px`;
      card.style.left = `${cardLeft}px`;
    }

    nextBtn.onclick = () => {
      if (index >= steps.length - 1) {
        closeTour();
        return;
      }
      index += 1;
      renderStep();
    };
    skipBtn.onclick = closeTour;
    overlay.querySelector('#tour-scrim').onclick = closeTour;
    window.addEventListener('resize', renderStep);
    setTimeout(renderStep, 50);
  };
  
  const refresh = async () => {
    try {
    let members, groups, loans, savings, schedules;
    const today = new Date();
    const upcomingThreshold = new Date();
    upcomingThreshold.setDate(upcomingThreshold.getDate() + 7);

    [
      members,
      groups,
      loans,
      savings,
      schedules
    ] = await Promise.all([
      safe('members', () => memberService.getAll(), []),
      safe('groups', () => groupService.getAll(), []),
      safe('loans', () => loanService.getFullListCached({ cacheKey: 'loans:dashboard:expanded:v1' }), []),
      safe('savings ledger', () => savingsService.getFullListCached({
        filter: 'is_reversed=false',
        expand: 'member,group',
        cacheKey: 'savings:dashboard:active:v1'
      }), []),
      safe('loan schedules', () => dataCache.getLocalFirst('loan_schedule:dashboard:all', () => pb.collection('loan_schedule').getFullList()), [])
    ]);

    const savingsByMember = savings.reduce((map, saving) => {
      if (!saving.member) return map;
      const rows = map.get(saving.member) || [];
      rows.push(saving);
      map.set(saving.member, rows);
      return map;
    }, new Map());
    const activeMembers = members.filter(member => {
      const lastSavingsDate = getLatestSavingsDate(savingsByMember.get(member.id) || []);
      return getMemberActivityStatus(member, lastSavingsDate).isActive;
    }).length;
    const activeGroups = groups.length;
    const pendingLoans = loans.filter(l => l.status === 'pending').length;
    const loansById = new Map(loans.map(loan => [loan.id, loan]));
    const isCollectibleLoan = (loan) => loan?.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan?.status) && loan?.disbursement_date);
    const overdueSchedules = schedules.filter(s => isCollectibleLoan(loansById.get(s.loan)) && isScheduleInArrears(s, today));
    const alertSchedules = schedules.filter(s => !isSchedulePaid(s) && new Date(s.due_date) <= upcomingThreshold);

  // calculate savings correctly
  const totalSavings = savings
    .reduce((sum, s) => s.type === 'deposit' ? sum + s.amount : sum - s.amount, 0);

  const totalArrears = getArrearsTotal(overdueSchedules, today);

  const totalAlerts = alertSchedules.map(s => {
    const loan = loans.find(l => l.id === s.loan);
    if (getScheduleRemaining(s) <= 0) return null;
    if (!isCollectibleLoan(loan)) return null;
    return true;
  }).filter(Boolean).length;

  // Compile Recent Activity
  let activities = [];
  
  // Add member registrations to activity
  members
    .slice()
    .sort((a, b) => new Date(b.created || b.registration_date) - new Date(a.created || a.registration_date))
    .slice(0, 5)
    .forEach(m => {
    activities.push({
      date: new Date(m.registration_date || m.created),
      type: 'member',
      title: 'New Member Registered',
      description: `${m.full_name} (${m.reg_no}) joined the system.`
    });
  });

  // Add loans to activity
  loans
    .slice()
    .sort((a, b) => new Date(b.application_date || b.created) - new Date(a.application_date || a.created))
    .slice(0, 5)
    .forEach(l => {
    activities.push({
      date: new Date(l.application_date || l.created),
      type: 'loan',
      title: 'Loan Application',
      description: `Loan ${l.loan_no} for KES ${(l.amount_applied || 0).toLocaleString()} was submitted.`
    });
  });

  loans
    .filter(l => ['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date)
    .slice()
    .sort((a, b) => new Date(b.disbursement_date) - new Date(a.disbursement_date))
    .slice(0, 5)
    .forEach(l => {
    activities.push({
      date: new Date(l.disbursement_date),
      type: 'disbursement',
      title: 'Loan Disbursed',
      description: `Loan ${l.loan_no} (KES ${(l.approved_amount || 0).toLocaleString()}) was disbursed.`
    });
  });

  // Add savings deposits to activity
  savings
    .filter(s => s.type === 'deposit' && !s.is_reversed)
    .slice()
    .sort((a, b) => new Date(b.date || b.created) - new Date(a.date || a.created))
    .slice(0, 5)
    .forEach(s => {
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
      <button class="btn btn-secondary" onclick="window.location.hash = '${withReturnTo('#/loans/new', '#/')}';">Apply for Loan</button>
      <button class="btn btn-outline" onclick="window.location.hash = '${withReturnTo('#/savings/new', '#/')}';">Record Savings</button>
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
      setTimeout(maybeShowWelcomeTour, 80);
    } catch (err) {
      console.error('[Dashboard] Refresh failed:', err);
      container.innerHTML = `
        <div style="margin-bottom: 24px;">
          <h1 class="text-xl">Dashboard Overview</h1>
          <p class="text-muted">Welcome to the Inlet Capital management system.</p>
        </div>
        <div class="card" style="border-top: 4px solid var(--warning);">
          <h3 style="margin-bottom: 8px;">Dashboard data did not load</h3>
          <p class="text-muted" style="margin-bottom: 16px;">Your session is still active. This is usually a temporary data or network issue.</p>
          <button class="btn btn-primary" id="dashboard-retry-btn">Retry Dashboard</button>
        </div>
      `;
      const retryBtn = container.querySelector('#dashboard-retry-btn');
      if (retryBtn) retryBtn.onclick = () => refresh();
    }
  };

  refresh().catch(err => console.error('[Dashboard] Initial refresh failed:', err));

  // Keep the overview fresh without holding PocketBase realtime SSE streams open.
  // Realtime over Cloudflare/PocketHost can surface Chrome QUIC errors on long-lived streams.
  const debouncedRefresh = debounce(async () => {
    await refresh();
  }, 500);

  const pollInterval = setInterval(() => {
    debouncedRefresh();
  }, 30000);

  container.__subscriptions = [
    () => clearInterval(pollInterval)
  ];

  return container;
};
