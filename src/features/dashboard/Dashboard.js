import { dataCache, debounce, observeCachedView } from '../../services/dataCache.js';
import { loanFinancialSnapshotService } from '../../services/loanFinancialSnapshotService.js';
import { savingsService } from '../../services/savingsService.js';
import { withReturnTo } from '../../core/navigation.js';
import { formatMoney, formatPercent } from '../../core/utils.js';
import { getNairobiDay, getScheduleRemaining, isSchedulePaid } from '../../core/loanScheduleMetrics.js';
import { createLoanArrearsCalculator } from '../../core/loanArrears.js';
import { getArrearsRatioRating } from '../../core/arrearsRatioRating.js';
import { getParRating } from '../../core/parRating.js';
import { getLatestSavingsDate, getMemberActivityStatus } from '../../core/memberActivity.js';
import { calculateSavingsSummary, getSavingsTransactionType, selectSavingsRecords } from '../../core/savingsMetrics.js';
import { canUseOfficerFilter, createOfficerScope, getGroupOfficerId, getMemberOfficerId, loadOfficerOptions, matchesOfficer, populateOfficerSelect } from '../../core/officerScope.js';
import { createLoanPortfolioCalculator } from '../../core/loanPortfolio.js';
import { filterPortfolioFinancialRecords, getPortfolioMemberIds } from '../../core/memberLifecycle.js';
import { renderDatabaseLoaderIcon, DATABASE_LOADING_LABEL } from '../../core/uiState.js';

export const renderDashboard = async () => {
  const container = document.createElement('div');
  let currentOfficerFilter = 'all';
  let officerOptions = [];
  let hasCompleteDashboard = false;
  container.innerHTML = `
    <div style="margin-bottom: 24px;">
      <h1 class="text-xl">Dashboard Overview</h1>
      <p class="text-muted">Welcome to the Inlet Capital management system.</p>
    </div>
    <div class="card text-center" style="padding: 48px;">
      <div class="database-loading-copy">
        ${renderDatabaseLoaderIcon()}
        <span>${DATABASE_LOADING_LABEL}</span>
      </div>
    </div>
  `;

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
    let members, groups, loans, savings, schedules, repayments, settlements, automaticPenaltyAmount;
    const today = new Date();

    const [financial, savingsRecords] = await Promise.all([
      loanFinancialSnapshotService.get(), savingsService.getFinancialRecordsCached()
    ]);
    ({ loans, schedules, repayments, settlements, penaltyAmount: automaticPenaltyAmount } = financial);
    members = financial.members.filter(member => !['suspended', 'closed'].includes(member.status));
    groups = financial.groups.filter(group => !['suspended', 'closed'].includes(group.status));
    savings = savingsRecords;

    const portfolioMemberIds = getPortfolioMemberIds(members);
    loans = filterPortfolioFinancialRecords(loans, portfolioMemberIds);
    savings = selectSavingsRecords(filterPortfolioFinancialRecords(savings, portfolioMemberIds), { members });

    if (canUseOfficerFilter()) {
      officerOptions = await loadOfficerOptions({ members, groups, loans });
      const officerScope = createOfficerScope({ members, groups });
      members = members.filter(member => matchesOfficer(getMemberOfficerId(member), currentOfficerFilter));
      groups = groups.filter(group => matchesOfficer(getGroupOfficerId(group), currentOfficerFilter));
      loans = loans.filter(loan => matchesOfficer(officerScope.getLoanOfficerId(loan), currentOfficerFilter));
      savings = savings.filter(saving => matchesOfficer(officerScope.getSavingOfficerId(saving), currentOfficerFilter));
      const scopedLoanIds = new Set(loans.map(loan => loan.id));
      schedules = schedules.filter(schedule => scopedLoanIds.has(schedule.loan));
      repayments = repayments.filter(repayment => scopedLoanIds.has(repayment.loan));
      settlements = settlements.filter(settlement => scopedLoanIds.has(settlement.loan));
    }

    const visibleLoanIds = new Set(loans.map(loan => loan.id));
    schedules = schedules.filter(schedule => visibleLoanIds.has(schedule.loan));
    repayments = repayments.filter(repayment => visibleLoanIds.has(repayment.loan));
    settlements = settlements.filter(settlement => visibleLoanIds.has(settlement.loan) && settlement.status !== 'reversed');

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
    const portfolioCalculator = createLoanPortfolioCalculator({
      repayments,
      settlements,
      schedules,
      penaltyAmount: automaticPenaltyAmount,
      referenceDate: today
    });
    const getLoanOutstandingBalance = portfolioCalculator.getOutstanding;
    const arrearsCalculator = createLoanArrearsCalculator({ loans, schedules, repayments, settlements,
      referenceDate: today, portfolioCalculator });
    const arrearsSummary = arrearsCalculator.summarize(loans);
    const alertSchedules = arrearsCalculator.effectiveSchedules.filter(s => !isSchedulePaid(s)
      && getNairobiDay(s.due_date) <= getNairobiDay(today) + 7);

  // calculate savings correctly
  const totalSavings = calculateSavingsSummary(savings).net;

  const totalArrears = arrearsSummary.total;
  const activeOutstandingLoanPortfolio = arrearsSummary.outstanding;
  const parRateNumber = arrearsSummary.arrearsRatio;
  const parRate = formatPercent(parRateNumber);
  const parHealth = getArrearsRatioRating(parRateNumber);
  const totalOverdueOutstandingLoans = arrearsSummary.overdueOutstanding;
  const gparRateNumber = arrearsSummary.gparRate;
  const gparRate = formatPercent(gparRateNumber);
  const gparHealth = getParRating(gparRateNumber);
  const parAging = arrearsSummary.buckets;
  const getParAgingRate = bucket => bucket.rate;

  const alertLoanIds = new Set();
  alertSchedules.forEach(s => {
    const loanId = typeof s.loan === 'string' ? s.loan : s.loan?.id;
    const loan = loans.find(l => l.id === loanId);
    if (!loanId || getScheduleRemaining(s) <= 0 || getLoanOutstandingBalance(loan) <= 0) return;
    alertLoanIds.add(loanId);
  });
  const totalAlerts = alertLoanIds.size;

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
      description: `Loan ${l.loan_no} for KES ${formatMoney(l.amount_applied)} was submitted.`
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
      description: `Loan ${l.loan_no} (KES ${formatMoney(l.approved_amount)}) was disbursed.`
    });
  });

  // Add savings deposits to activity
  savings
    .filter(s => getSavingsTransactionType(s) === 'deposit' && !s.is_reversed)
    .slice()
    .sort((a, b) => new Date(b.date || b.created) - new Date(a.date || a.created))
    .slice(0, 5)
    .forEach(s => {
    activities.push({
      date: new Date(s.date || s.created),
      type: 'savings',
      title: 'Savings Deposit',
      description: `KES ${formatMoney(s.amount)} deposited by client.` // Client mapping omitted for brevity
    });
  });

  // Sort activities by date descending (newest first)
  activities.sort((a, b) => b.date - a.date);
  
  // Take top 5 recent activities
  const recentActivities = activities.slice(0, 5);

  container.innerHTML = `
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
      <div>
        <h1 class="text-xl">Dashboard Overview</h1>
        <p class="text-muted">Welcome to the Inlet Capital management system.</p>
      </div>
      ${canUseOfficerFilter() ? '<select id="dashboard-officer-filter" class="form-control" style="min-width: 220px; width: auto;"><option value="all">All Loan Officers</option></select>' : ''}
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
        <p style="font-size: 2.5rem; font-weight: 700; color: var(--success);">${formatMoney(totalSavings)}</p>
      </div>
      <div class="card">
        <h3 class="text-sm text-muted" style="margin-bottom: 8px;">Total Arrears (KES)</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: var(--danger);">${formatMoney(totalArrears)}</p>
      </div>
      <div class="card" style="border-left: 4px solid ${parHealth.accent};">
        <h3 class="text-sm text-muted" style="margin-bottom: 8px;">Arrears Ratio</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: ${parHealth.color};">${parRate}</p>
        <p class="text-xs" style="margin-top: 8px; color: ${parHealth.color}; font-weight: 700;">${parHealth.label}</p>
        <p class="text-xs text-muted" style="margin-top: 4px;">${parHealth.detail}</p>
        <p class="text-xs text-muted" style="margin-top: 4px;">Arrears / Outstanding Loan Balance</p>
        <p class="text-xs text-muted" style="margin-top: 4px;">OLB KES ${formatMoney(activeOutstandingLoanPortfolio)}</p>
      </div>
      <div class="card" style="border-left: 4px solid ${gparHealth.accent};">
        <h3 class="text-sm text-muted" style="margin-bottom: 8px;">Global Portfolio at Risk (GPAR)</h3>
        <p style="font-size: 2.5rem; font-weight: 700; color: ${gparHealth.color};">${gparRate}</p>
        <p class="text-xs" style="margin-top: 8px; color: ${gparHealth.color}; font-weight: 700;">${gparHealth.label}</p>
        <p class="text-xs text-muted" style="margin-top: 4px;">${gparHealth.detail}</p>
        <p class="text-xs text-muted" style="margin-top: 4px;">Overdue Outstanding / Loan Portfolio</p>
      </div>
      <div class="card" role="button" tabindex="0" aria-label="Open Arrears Aging report" onclick="window.location.hash = '#/reports?tab=arrears'" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.location.hash = '#/reports?tab=arrears'; }" style="border-left: 4px solid var(--primary); min-width: 0; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='var(--shadow-md)';" onmouseout="this.style.transform='none'; this.style.boxShadow='var(--shadow-sm)';">
        <h3 class="text-sm text-muted" style="margin-bottom: 12px;">PAR Aging Analysis</h3>
        <div style="display: grid; gap: 8px;">
          ${[
            { label: 'PAR 30', bucket: parAging.par30, color: '#10b981' },
            { label: 'PAR 60', bucket: parAging.par60, color: '#f59e0b' },
            { label: 'PAR 90', bucket: parAging.par90, color: '#ef4444' }
          ].map((item, index) => `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; ${index ? 'border-top: 1px solid var(--border-color); padding-top: 8px;' : ''}">
              <div style="border-left: 3px solid ${item.color}; padding-left: 8px; min-width: 64px;">
                <div class="text-xs" style="font-weight: 700; color: ${item.color}; white-space: nowrap;">${item.label}</div>
                <div class="text-xs text-muted" style="margin-top: 2px; white-space: nowrap;">${item.bucket.loanCount} ${item.bucket.loanCount === 1 ? 'loan' : 'loans'}</div>
              </div>
              <div style="min-width: 0; text-align: right;">
                <div style="color: ${item.color}; font-size: 1.25rem; font-weight: 800; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums;">${formatPercent(getParAgingRate(item.bucket))}</div>
                <div class="text-xs text-muted" style="margin-top: 5px; white-space: nowrap; font-variant-numeric: tabular-nums;">OLB: KES ${formatMoney(item.bucket.olb)}</div>
              </div>
            </div>
          `).join('')}
        </div>
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
      const dashboardOfficerSelect = container.querySelector('#dashboard-officer-filter');
      if (dashboardOfficerSelect) {
        populateOfficerSelect(dashboardOfficerSelect, officerOptions, currentOfficerFilter);
        dashboardOfficerSelect.onchange = () => {
          currentOfficerFilter = dashboardOfficerSelect.value;
          refresh();
        };
      }
      setTimeout(maybeShowWelcomeTour, 80);
      hasCompleteDashboard = true;
    } catch (err) {
      if (err.isCacheObsolete) return;
      console.error('[Dashboard] Refresh failed:', err);
      if (hasCompleteDashboard) {
        let notice = container.querySelector('[data-financial-stale]');
        if (!notice) { notice = document.createElement('p'); notice.dataset.financialStale = ''; notice.className = 'text-warning'; container.prepend(notice); }
        notice.textContent = 'Updates unavailable - showing previously loaded records';
        return;
      }
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

  // Realtime invalidation is owned by the session-level financial sync service.
  const debouncedRefresh = debounce(async () => {
    await refresh();
  }, 500);

  const pollInterval = setInterval(() => {
    if (!document.hidden) debouncedRefresh();
  }, 120000);

  container.__subscriptions = [
    () => { clearInterval(pollInterval); debouncedRefresh.cancel(); },
    observeCachedView(['savings:', 'members:', 'groups:', 'loans:', 'loan_repayments', 'loan_schedule', 'loan_balance_offs:', 'settings:'], refresh)
  ];

  return container;
};
