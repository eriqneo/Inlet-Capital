import { pb } from '../../services/api.js';
import { renderPagination } from '../../components/Pagination.js';
import { dataCache, debounce, observeCachedView } from '../../services/dataCache.js';
import { loanFinancialSnapshotService } from '../../services/loanFinancialSnapshotService.js';
import { getFinancialTimestamp, getPortfolioCutoff } from '../../core/financialRecords.js';
import { savingsService } from '../../services/savingsService.js';
import { expenseService } from '../../services/expenseService.js';
import { calculateExpenseTrend } from '../../core/expenseMetrics.js';
import { formatMoney, formatPercent } from '../../core/utils.js';
import { buildEffectiveSchedulePaidMap } from '../../core/loanScheduleMetrics.js';
import { createLoanArrearsCalculator } from '../../core/loanArrears.js';
import { canUseOfficerFilter, createOfficerScope, getGlobalOfficerFilter, getGroupOfficerId, getMemberOfficerId, getOfficerDataScopeId, getOfficerScopeCacheKey } from '../../core/officerScope.js';
import { createLoanPortfolioCalculator, isCollectibleLoanRecord, isDisbursedLoanRecord } from '../../core/loanPortfolio.js';
import {
  getLoanLiabilityAmount,
  getLoanPrincipalAmount,
  getRepaymentContractAmount,
  getSettlementContractAmount
} from '../../core/repaymentAllocation.js';
import { filterPortfolioFinancialRecords, getPortfolioMemberIds } from '../../core/memberLifecycle.js';
import { renderDatabaseLoaderIcon, DATABASE_LOADING_LABEL } from '../../core/uiState.js';
import { calculateSavingsSummary, getSavingsDateBounds, getSavingsTimestamp, isSavingsInDateRange, selectSavingsRecords } from '../../core/savingsMetrics.js';

export const renderAnalyticsDashboard = async () => {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="card text-center" style="padding:40px;">
      <div class="database-loading-copy">
        ${renderDatabaseLoaderIcon()}
        <span>${DATABASE_LOADING_LABEL}</span>
      </div>
    </div>
  `;
  
  // Data variables
  let members = [], loans = [], repayments = [], settlements = [], groups = [], savings = [], schedules = [], users = [];
  let automaticPenaltyAmount = 500;
  let hasLoadedAnalyticsData = false;
  let expenses = [], expensesUnavailable = false;

  const loadAnalyticsData = async () => {
    try {
      const [financial, savingRecords, loanUsers, expenseResult] = await Promise.all([
        loanFinancialSnapshotService.get(),
        savingsService.getFinancialRecordsCached(),
        dataCache.get('users:analytics:loan-users:v1', () => pb.collection('users').getFullList({
          filter: 'role="loan_officer" || role="group_officer" || role="manager" || role="admin" || role="super_admin"',
          sort: 'email'
        })).catch(err => {
          console.warn('[Analytics] Loan user list unavailable, using loan records fallback:', err.message);
          return [];
        }),
        dataCache.get(`expenses:reports:${getOfficerScopeCacheKey()}`, () => expenseService.getFullList())
          .then(records => ({ records }))
          .catch(error => {
            if (error.isCacheObsolete) throw error;
            console.warn('[Analytics] Expense records unavailable:', error.message);
            return { error };
          }),
      ]);
      expensesUnavailable = Boolean(expenseResult.error);
      expenses = expenseResult.records || [];
      ({ loans, repayments, settlements, schedules, penaltyAmount: automaticPenaltyAmount } = financial);
      members = financial.members.filter(member => !['suspended', 'closed'].includes(member.status));
      groups = financial.groups.filter(group => !['suspended', 'closed'].includes(group.status));
      savings = savingRecords;
      users = loanUsers;
      const portfolioMemberIds = getPortfolioMemberIds(members);
      loans = filterPortfolioFinancialRecords(loans, portfolioMemberIds);
      savings = selectSavingsRecords(filterPortfolioFinancialRecords(savings, portfolioMemberIds), { members });
      calculateSavingsSummary(savings);
      savings.forEach(getSavingsTimestamp);
      const visibleLoanIds = new Set(loans.map(loan => loan.id));
      schedules = schedules.filter(schedule => visibleLoanIds.has(schedule.loan));
      repayments = repayments.filter(repayment => visibleLoanIds.has(repayment.loan));
      settlements = settlements.filter(settlement => visibleLoanIds.has(settlement.loan) && settlement.status !== 'reversed');
    } catch (err) {
      if (err.isCacheObsolete) return false;
      console.error('Failed to load analytics data:', err);
      if (!hasLoadedAnalyticsData) {
        container.innerHTML = `<div class="card text-center text-danger" style="padding: 40px; margin: 20px;">
          <h3 style="margin-bottom: 12px;">Failed to load analytics</h3>
          <p class="text-muted" style="margin-bottom: 20px;">${err.message}</p>
          <button class="btn btn-primary" onclick="window.location.reload()">Retry Connection</button>
        </div>`;
      }
      else {
        let notice = container.querySelector('[data-financial-stale]');
        if (!notice) { notice = document.createElement('p'); notice.dataset.financialStale = ''; notice.className = 'text-warning'; container.prepend(notice); }
        notice.textContent = 'Updates unavailable - showing previously loaded records';
      }
      return false;
    }
    hasLoadedAnalyticsData = true;
    return true;
  };

  let analyticsRefreshPromise = null;
  const refresh = () => {
    if (!analyticsRefreshPromise) {
      analyticsRefreshPromise = loadAnalyticsData()
        .finally(() => { analyticsRefreshPromise = null; });
    }
    return analyticsRefreshPromise;
  };

  let dateRange = { from: '', to: '' };
  let currentOfficerFilter = getGlobalOfficerFilter();
  let currentCollectionWindow = 'this_month';
  let chartInstances = [];
  let chartTimer;

  const destroyCharts = () => {
    chartInstances.forEach(c => c.destroy());
    chartInstances = [];
  };

  const renderData = () => {
    if (container.__disposed) return;
    clearTimeout(chartTimer);
    destroyCharts();
    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const toValidDate = (value) => {
      if (!value) return null;
      const date = new Date(getFinancialTimestamp(value));
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const fromDate = dateRange.from ? new Date(getPortfolioCutoff(dateRange.from).getTime() - 86399999) : null;
    const toDate = dateRange.to ? getPortfolioCutoff(dateRange.to) : null;
    const hasAnalyticsDateRange = Boolean(fromDate || toDate);
    const snapshotDate = getPortfolioCutoff(dateRange.to);
    const isWithinDateRange = (value) => {
      if (!dateRange.from && !dateRange.to) return true;
      const date = toValidDate(value);
      if (!date) return false;
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      return true;
    };
    const formatShortDate = (date) => date.toLocaleDateString(undefined, { timeZone: 'Africa/Nairobi', month: 'short', day: 'numeric', year: 'numeric' });
    const analyticsRangeLabel = dateRange.from && dateRange.to
      ? `${formatShortDate(fromDate)} - ${formatShortDate(toDate)}`
      : dateRange.from
        ? `From ${formatShortDate(fromDate)}`
        : dateRange.to
          ? `Until ${formatShortDate(toDate)}`
          : 'All Time';
    let expenseTrend = null;
    if (!expensesUnavailable) {
      try {
        expenseTrend = calculateExpenseTrend(expenses, { ...dateRange, officer: getOfficerDataScopeId(), now: today });
      } catch (error) { console.warn('[Analytics] Expense chart unavailable:', error.message); }
    }

    // Filter datasets
    const fMembers = members.filter(m => isWithinDateRange(m.registration_date || m.created));
    const fLoans = loans.filter(l => isWithinDateRange(l.application_date || l.created));
    const fDisbursedLoans = loans.filter(l => l.disbursement_date && isWithinDateRange(l.disbursement_date));
    const fRepayments = repayments.filter(r => isWithinDateRange(r.date || r.created));
    const fSavings = savings.filter(s => isSavingsInDateRange(s, dateRange));

    // Calculations based on filtered data
    const getLoanLiability = getLoanLiabilityAmount;
    const getLoanPrincipal = getLoanPrincipalAmount;
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
    const isGivenLoan = isDisbursedLoanRecord;
    const getOfficerName = (loan) => {
      const officer = loan.expand?.processed_by;
      if (officer) return officer.name || officer.email || officer.username || 'Loan Officer';
      const user = users.find(u => u.id === loan.processed_by);
      if (user) return user.name || user.email || user.username || 'Loan Officer';
      return loan.processed_by ? `User ${String(loan.processed_by).slice(0, 6)}` : 'Unassigned';
    };
    const getUserName = (userId) => {
      const user = users.find(u => u.id === userId);
      if (user) return user.name || user.email || user.username || 'Loan User';
      return userId ? `User ${String(userId).slice(0, 6)}` : 'Unassigned';
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
    members.forEach(member => {
      if (member.assigned_officer && !officerOptionMap[member.assigned_officer]) {
        officerOptionMap[member.assigned_officer] = getUserName(member.assigned_officer);
      }
      if (member.registered_by && !officerOptionMap[member.registered_by]) {
        officerOptionMap[member.registered_by] = getUserName(member.registered_by);
      }
    });
    groups.forEach(group => {
      if (group.assigned_officer && !officerOptionMap[group.assigned_officer]) {
        officerOptionMap[group.assigned_officer] = getUserName(group.assigned_officer);
      }
      if (group.created_by && !officerOptionMap[group.created_by]) {
        officerOptionMap[group.created_by] = getUserName(group.created_by);
      }
    });
    const officerOptions = Object.entries(officerOptionMap)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const membersById = new Map(members.map(member => [member.id, member]));
    const groupsById = new Map(groups.map(group => [group.id, group]));
    const getRelationId = (value) => typeof value === 'string' ? value : (value?.id || '');
    const getSavingMemberId = (saving) => getRelationId(saving?.member) || saving?.expand?.member?.id || '';
    const getSavingGroupId = (saving) => getRelationId(saving?.group) || saving?.expand?.group?.id || '';
    const getMemberAssignedOfficer = getMemberOfficerId;
    const getGroupAssignedOfficer = getGroupOfficerId;
    const { getLoanOfficerId: getLoanResponsibleOfficer } = createOfficerScope({ members, groups });
    const getResponsibleOfficerName = (loan) => {
      const officerId = getLoanResponsibleOfficer(loan);
      return getUserName(officerId) || getOfficerName(loan);
    };
    const filterByOfficer = (loan) => currentOfficerFilter === 'all' || getLoanResponsibleOfficer(loan) === currentOfficerFilter;
    const filterMemberByOfficer = (member) => currentOfficerFilter === 'all' || getMemberAssignedOfficer(member) === currentOfficerFilter;
    const filterGroupByOfficer = (group) => currentOfficerFilter === 'all' || getGroupAssignedOfficer(group) === currentOfficerFilter;
    const filterSavingsByOfficer = (saving) => {
      if (currentOfficerFilter === 'all') return true;
      const memberId = getSavingMemberId(saving);
      const groupId = getSavingGroupId(saving);
      if (memberId) return getMemberAssignedOfficer(membersById.get(memberId)) === currentOfficerFilter;
      if (groupId) return getGroupAssignedOfficer(groupsById.get(groupId)) === currentOfficerFilter;
      return false;
    };
    const loansById = new Map(loans.map(loan => [loan.id, loan]));
    const getCollectionWindow = () => {
      if (hasAnalyticsDateRange) {
        return { label: 'Selected Period', start: fromDate, end: toDate, includeOverdue: false };
      }
      const allowedWindows = ['overdue', 'all_upcoming', 'next_7_days', 'last_month', 'this_month', 'next_month'];
      if (!allowedWindows.includes(currentCollectionWindow)) {
        currentCollectionWindow = 'this_month';
      }
      const monthWindow = (offset, label) => {
        const start = new Date(todayStart.getFullYear(), todayStart.getMonth() + offset, 1);
        const end = new Date(todayStart.getFullYear(), todayStart.getMonth() + offset + 1, 0, 23, 59, 59, 999);
        return { label, start, end, includeOverdue: false };
      };
      if (currentCollectionWindow === 'overdue') {
        const end = new Date(todayStart);
        end.setMilliseconds(-1);
        return { label: 'Overdue', start: null, end, includeOverdue: true };
      }
      if (currentCollectionWindow === 'all_upcoming') {
        return { label: 'All Upcoming', start: todayStart, end: null, includeOverdue: false };
      }
      if (currentCollectionWindow === 'next_7_days') {
        const end = new Date(todayStart);
        end.setDate(end.getDate() + 7);
        end.setHours(23, 59, 59, 999);
        return { label: 'Next 7 Days', start: todayStart, end, includeOverdue: false };
      }
      if (currentCollectionWindow === 'last_month') return monthWindow(-1, 'Last Month');
      if (currentCollectionWindow === 'this_month') return monthWindow(0, 'This Month');
      if (currentCollectionWindow === 'next_month') return monthWindow(1, 'Next Month');
      const end = new Date(todayStart);
      end.setMilliseconds(-1);
      return { label: 'Overdue', start: null, end, includeOverdue: true };
    };
    const collectionWindow = getCollectionWindow();
    const collectionWindowRange = collectionWindow.start && collectionWindow.end
      ? `${formatShortDate(collectionWindow.start)} - ${formatShortDate(collectionWindow.end)}`
      : collectionWindow.end
        ? `Until ${formatShortDate(collectionWindow.end)}`
        : `From ${formatShortDate(collectionWindow.start || todayStart)}`;
    const thisMonthCollectionWindow = {
      label: 'This Month',
      start: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1),
      end: new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0, 23, 59, 59, 999),
      includeOverdue: false
    };
    const scheduleMatchesWindow = (schedule, windowDef) => {
      const dueDate = new Date(schedule.due_date);
      if (Number.isNaN(dueDate.getTime())) return false;
      if (windowDef.start && dueDate < windowDef.start) return false;
      if (windowDef.end && dueDate > windowDef.end) return false;
      return true;
    };
    const scheduleMatchesCollectionWindow = (schedule) => scheduleMatchesWindow(schedule, collectionWindow);
    const recordMatchesCollectionWindow = (value) => {
      const recordDate = toValidDate(value);
      if (!recordDate) return false;
      if (collectionWindow.start && recordDate < collectionWindow.start) return false;
      if (collectionWindow.end && recordDate > collectionWindow.end) return false;
      return true;
    };

    const scopedMembers = fMembers.filter(filterMemberByOfficer);
    const scopedSavings = fSavings.filter(filterSavingsByOfficer);
    const totalMembers = scopedMembers.length;
    const scopedLoans = fLoans.filter(filterByOfficer);
    const scopedRepayments = currentOfficerFilter === 'all'
      ? fRepayments
      : fRepayments.filter(r => loans.some(l => l.id === r.loan && filterByOfficer(l)));
    const scopedSchedules = currentOfficerFilter === 'all'
      ? schedules
      : schedules.filter(s => loans.some(l => l.id === s.loan && filterByOfficer(l)));
    const recordIsOnOrBeforeSnapshot = (record, fields = ['date', 'effective_date', 'created']) => {
      const value = fields.map(field => record?.[field]).find(Boolean);
      const recordDate = toValidDate(value);
      return Boolean(recordDate && recordDate <= snapshotDate);
    };
    const snapshotRepayments = hasAnalyticsDateRange
      ? repayments.filter(record => recordIsOnOrBeforeSnapshot(record))
      : repayments;
    const snapshotSettlements = hasAnalyticsDateRange
      ? settlements.filter(record => recordIsOnOrBeforeSnapshot(record, ['effective_date', 'created']))
      : settlements;
    const effectiveSchedulePaidMap = buildEffectiveSchedulePaidMap({
      schedules,
      repayments: hasAnalyticsDateRange ? snapshotRepayments : repayments,
      settlements: hasAnalyticsDateRange ? snapshotSettlements : settlements,
      referenceDate: snapshotDate,
      useRecordedPaid: false
    });
    const getEffectiveSchedulePaid = (schedule) => effectiveSchedulePaidMap.get(schedule.id) ?? Math.min(Number(schedule.amount) || 0, Math.max(0, Number(schedule.paid) || 0));
    const getEffectiveScheduleRemaining = (schedule) => Math.max(0, (Number(schedule.amount) || 0) - getEffectiveSchedulePaid(schedule));
    const portfolioCalculator = createLoanPortfolioCalculator({
      repayments: snapshotRepayments,
      settlements: snapshotSettlements,
      schedules,
      penaltyAmount: automaticPenaltyAmount,
      referenceDate: snapshotDate,
      useRecordedSchedulePaid: false,
      asOf: dateRange.to ? snapshotDate : undefined,
      loans
    });
    const getLoanOutstandingBalance = portfolioCalculator.getOutstanding;
    const snapshotLoans = loans.filter(filterByOfficer).filter(loan => getLoanOutstandingBalance(loan) > 0);
    const outstandingPortfolioLoans = snapshotLoans.filter(loan => getLoanOutstandingBalance(loan) > 0);
    const activeLoans = outstandingPortfolioLoans;
    const loanPortfolio = portfolioCalculator.sumOutstanding(outstandingPortfolioLoans);
    const totalDisbursedLoans = fDisbursedLoans
      .filter(filterByOfficer)
      .reduce((sum, loan) => sum + getLoanPrincipal(loan), 0);
    const forecastSchedules = scopedSchedules
      .filter(schedule => {
        const loan = loansById.get(schedule.loan);
        if (!loan || !filterByOfficer(loan)) return false;
        if (!isGivenLoan(loan)) return false;
        return scheduleMatchesCollectionWindow(schedule);
      });
    const outstandingForecastSchedules = forecastSchedules.filter(schedule => getEffectiveScheduleRemaining(schedule) > 0);
    const expectedCollection = forecastSchedules.reduce((sum, schedule) => sum + getEffectiveScheduleRemaining(schedule), 0);
    const scheduledGrossCollection = forecastSchedules.reduce((sum, schedule) => sum + (Number(schedule.amount) || 0), 0);
    const scheduledPaidCollection = forecastSchedules.reduce((sum, schedule) => sum + getEffectiveSchedulePaid(schedule), 0);
    const windowRepaymentRateNumber = scheduledGrossCollection > 0
      ? Math.min(100, (scheduledPaidCollection / scheduledGrossCollection) * 100)
      : 0;
    const windowRepaymentRate = formatPercent(windowRepaymentRateNumber);
    const expectedCollectionClients = new Set(outstandingForecastSchedules.map(schedule => {
      const loan = loansById.get(schedule.loan);
      return loan?.member || loan?.group || schedule.loan;
    })).size;
    const forecastLoanIds = new Set(forecastSchedules.map(schedule => schedule.loan).filter(Boolean));
    const collectionRepaymentsInWindow = repayments.filter(repayment => {
      const loan = loansById.get(repayment.loan);
      if (!loan || !forecastLoanIds.has(repayment.loan)) return false;
      if (!filterByOfficer(loan)) return false;
      return recordMatchesCollectionWindow(repayment.date || repayment.created);
    });
    const collectedInWindowByOfficer = collectionRepaymentsInWindow.reduce((map, repayment) => {
      const loan = loansById.get(repayment.loan);
      const officerKey = getLoanResponsibleOfficer(loan) || 'unassigned';
      map.set(officerKey, (map.get(officerKey) || 0) + getRepaymentContractAmount(repayment));
      return map;
    }, new Map());
    const collectedInWindowTotal = collectionRepaymentsInWindow.reduce(
      (sum, repayment) => sum + getRepaymentContractAmount(repayment),
      0
    );
    const thisMonthRepaymentByOfficer = {};
    scopedSchedules
      .filter(schedule => {
        const loan = loansById.get(schedule.loan);
        if (!loan || !filterByOfficer(loan)) return false;
        if (!isGivenLoan(loan)) return false;
        return scheduleMatchesWindow(schedule, thisMonthCollectionWindow);
      })
      .forEach(schedule => {
        const loan = loansById.get(schedule.loan);
        const officerKey = getLoanResponsibleOfficer(loan) || 'unassigned';
        if (!thisMonthRepaymentByOfficer[officerKey]) {
          thisMonthRepaymentByOfficer[officerKey] = { gross: 0, paid: 0 };
        }
        thisMonthRepaymentByOfficer[officerKey].gross += Number(schedule.amount) || 0;
        thisMonthRepaymentByOfficer[officerKey].paid += getEffectiveSchedulePaid(schedule);
      });
    const collectionOfficerMap = {};
    forecastSchedules.forEach(schedule => {
      const loan = loansById.get(schedule.loan);
      const officerKey = getLoanResponsibleOfficer(loan) || 'unassigned';
      if (!collectionOfficerMap[officerKey]) {
        collectionOfficerMap[officerKey] = {
          id: officerKey,
          name: loan ? getResponsibleOfficerName(loan) : 'Unassigned',
          installments: 0,
          clients: new Set(),
          gross: 0,
          paid: 0,
          collectedInWindow: 0,
          expected: 0
        };
      }
      collectionOfficerMap[officerKey].installments += 1;
      collectionOfficerMap[officerKey].clients.add(loan?.member || loan?.group || schedule.loan);
      collectionOfficerMap[officerKey].gross += Number(schedule.amount) || 0;
      collectionOfficerMap[officerKey].paid += getEffectiveSchedulePaid(schedule);
      collectionOfficerMap[officerKey].expected += getEffectiveScheduleRemaining(schedule);
    });
    collectedInWindowByOfficer.forEach((collected, officerKey) => {
      if (!collectionOfficerMap[officerKey]) {
        collectionOfficerMap[officerKey] = {
          id: officerKey,
          name: officerKey === 'unassigned' ? 'Unassigned' : getUserName(officerKey),
          installments: 0,
          clients: new Set(),
          gross: 0,
          paid: 0,
          collectedInWindow: 0,
          expected: 0
        };
      }
      collectionOfficerMap[officerKey].collectedInWindow = collected;
    });
    const getCollectionPerformanceRating = (rate, gross) => {
      if (gross <= 0) return { label: 'No Due', color: 'var(--text-muted)' };
      if (rate >= 95) return { label: 'Excellent', color: 'var(--success)', detail: 'Target operational performance. Cash flow is predictable, and defaults are minimal.' };
      if (rate >= 80) return { label: 'Good / On Track', color: '#1e3a8a', detail: 'Acceptable variance. Minor missed repayments can be cleared within 7-14 days.' };
      if (rate >= 75) return { label: 'Needs Attention', color: '#ca8a04', detail: 'Moderate credit risk. Requires active follow-up and weekly field monitoring.' };
      if (rate >= 65) return { label: 'Poor / Moderate Risk', color: '#f97316', detail: 'High portfolio contamination risk.' };
      return { label: 'Below Average', color: 'var(--danger)', detail: 'Threatens liquidity and requires escalation to recovery teams.' };
    };
    const collectionOfficerRows = Object.values(collectionOfficerMap)
      .map(row => {
        const thisMonthStats = thisMonthRepaymentByOfficer[row.id] || { gross: 0, paid: 0 };
        const thisMonthRepaymentRate = thisMonthStats.gross > 0
          ? Math.min(100, (thisMonthStats.paid / thisMonthStats.gross) * 100)
          : 0;
        const efficiency = row.gross > 0 ? Math.min(100, (row.collectedInWindow / row.gross) * 100) : 0;
        return {
          ...row,
          clients: row.clients.size,
          thisMonthGross: thisMonthStats.gross,
          thisMonthPaid: thisMonthStats.paid,
          thisMonthRepaymentRate,
          efficiency,
          forecastRating: getCollectionPerformanceRating(thisMonthRepaymentRate, thisMonthStats.gross),
          efficiencyRating: getCollectionPerformanceRating(efficiency, row.gross)
        };
      })
      .sort((a, b) => b.expected - a.expected);
    const collectionEfficiencyRows = collectionOfficerRows
      .map(row => {
        return {
          ...row,
          targetGap: Math.max(0, row.gross - row.collectedInWindow)
        };
      })
      .sort((a, b) => b.efficiency - a.efficiency);
    const overallCollectionEfficiencyNumber = scheduledGrossCollection > 0
      ? Math.min(100, (collectedInWindowTotal / scheduledGrossCollection) * 100)
      : 0;
    const overallCollectionEfficiency = formatPercent(overallCollectionEfficiencyNumber);
    const overallCollectionEfficiencyRating = getCollectionPerformanceRating(overallCollectionEfficiencyNumber, scheduledGrossCollection);
    
    // Correct savings calculation
    const totalSavings = calculateSavingsSummary(scopedSavings).net;

    const getMonthBounds = (offset = 0) => {
      const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0, 23, 59, 59, 999);
      return { start, end };
    };
    const isWithinBounds = (value, bounds) => {
      const date = toValidDate(value);
      if (!date) return false;
      return date >= bounds.start && date <= bounds.end;
    };
    const calculateGrowthRate = (current, previous) => {
      if (previous > 0) return ((current - previous) / previous) * 100;
      if (current > 0) return 100;
      return 0;
    };
    const getGrowthHealth = (rate) => rate >= 0
      ? { color: 'var(--success)', label: `+${formatPercent(rate)}`, note: 'Growing' }
      : { color: 'var(--danger)', label: formatPercent(rate), note: 'Declining' };
    let currentMonthBounds = getMonthBounds(0);
    let previousMonthBounds = getMonthBounds(-1);
    let growthCurrentLabel = 'This month';
    let growthPreviousLabel = 'last month';
    if (hasAnalyticsDateRange) {
      const selectedStart = fromDate || new Date(snapshotDate.getFullYear(), snapshotDate.getMonth(), 1);
      const selectedEnd = toDate || snapshotDate;
      const periodDuration = Math.max(1, selectedEnd.getTime() - selectedStart.getTime());
      const comparisonEnd = new Date(selectedStart.getTime() - 1);
      const comparisonStart = new Date(comparisonEnd.getTime() - periodDuration);
      currentMonthBounds = { start: selectedStart, end: selectedEnd };
      previousMonthBounds = { start: comparisonStart, end: comparisonEnd };
      growthCurrentLabel = 'Selected period';
      growthPreviousLabel = 'previous comparable period';
    }
    const officerScopedSavingsAllTime = savings.filter(filterSavingsByOfficer);
    const officerScopedLoansAllTime = loans.filter(filterByOfficer);
    const getSavingsDepositsForPeriod = (bounds) => calculateSavingsSummary(officerScopedSavingsAllTime
      .filter(s => isWithinBounds(s.date || s.created, bounds))).deposits;
    const getLoanDisbursedForMonth = (bounds) => officerScopedLoansAllTime
      .filter(l => ['disbursed', 'approved', 'completed', 'closed'].includes(l.status) && l.disbursement_date)
      .filter(l => isWithinBounds(l.disbursement_date, bounds))
      .reduce((sum, l) => sum + (Number(l.approved_amount || l.amount_applied) || 0), 0);
    const currentMonthSavings = getSavingsDepositsForPeriod(currentMonthBounds);
    const previousMonthSavings = getSavingsDepositsForPeriod(previousMonthBounds);
    const savingsGrowthRate = calculateGrowthRate(currentMonthSavings, previousMonthSavings);
    const savingsGrowthHealth = getGrowthHealth(savingsGrowthRate);
    const currentMonthLoans = getLoanDisbursedForMonth(currentMonthBounds);
    const previousMonthLoans = getLoanDisbursedForMonth(previousMonthBounds);
    const loanGrowthRate = calculateGrowthRate(currentMonthLoans, previousMonthLoans);
    const loanGrowthHealth = getGrowthHealth(loanGrowthRate);
    
    const snapshotLoanIds = new Set(snapshotLoans.map(loan => loan.id));
    const paidByLoan = new Map();
    snapshotRepayments.forEach(repayment => {
      if (!snapshotLoanIds.has(repayment.loan)) return;
      paidByLoan.set(repayment.loan, (paidByLoan.get(repayment.loan) || 0) + getRepaymentContractAmount(repayment));
    });
    snapshotSettlements.forEach(settlement => {
      if (!snapshotLoanIds.has(settlement.loan)) return;
      paidByLoan.set(settlement.loan, (paidByLoan.get(settlement.loan) || 0) + getSettlementContractAmount(settlement));
    });
    const totalLiabilityOverall = snapshotLoans.reduce((sum, loan) => sum + getLoanLiability(loan), 0);
    const totalRepaid = snapshotLoans.reduce(
      (sum, loan) => sum + Math.min(getLoanLiability(loan), paidByLoan.get(loan.id) || 0),
      0
    );
    const repaymentRateNumber = totalLiabilityOverall > 0 ? (totalRepaid / totalLiabilityOverall) * 100 : 0;
    const repaymentRate = formatPercent(repaymentRateNumber);
    const windowRepaymentHealth = scheduledGrossCollection <= 0
      ? { label: 'No scheduled target', color: 'var(--text-muted)' }
      : windowRepaymentRateNumber <= 50
        ? { label: 'Action Required', color: 'var(--danger)' }
        : windowRepaymentRateNumber <= 70
          ? { label: 'Average Target', color: 'var(--warning)' }
          : { label: 'On Track', color: 'var(--success)' };

    // Real Trend logic (Members registered in current month vs total)
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const memberTrend = hasAnalyticsDateRange
      ? scopedMembers.length
      : members.filter(m => filterMemberByOfficer(m) && m.registration_date && m.registration_date.startsWith(currentMonthKey)).length;

    // Compute Top Borrowers (Fixed Top 5) using filtered active loans and all repayments for those loans
    const borrowerMap = {};
    activeLoans.forEach(l => {
       const id = l.member || l.group;
       if (!borrowerMap[id]) borrowerMap[id] = 0;
       borrowerMap[id] += getLoanOutstandingBalance(l);
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

    const saverMap = new Map();
    scopedSavings
      .filter(saving => !saving.is_reversed)
      .forEach(saving => {
        const memberId = getSavingMemberId(saving);
        const groupId = getSavingGroupId(saving);
        const accountId = memberId || groupId;
        if (!accountId) return;

        const member = memberId ? membersById.get(memberId) : null;
        const group = groupsById.get(member ? (member.group?.id || member.group) : groupId);
        const accountKey = `${memberId ? 'member' : 'group'}:${accountId}`;
        const current = saverMap.get(accountKey) || {
          id: member?.reg_no || group?.group_id || accountId,
          name: member?.full_name || group?.name || 'Unknown saver',
          account: member
            ? (group?.name || member?.expand?.group?.name || 'Individual')
            : 'Group Account',
          records: []
        };

        current.records.push(saving);
        saverMap.set(accountKey, current);
      });
    const topSavers = [...saverMap.values()]
      .map(saver => {
        const summary = calculateSavingsSummary(saver.records);
        return { ...saver, ...summary, netSavings: summary.net };
      })
      .filter(saver => saver.netSavings > 0)
      .sort((a, b) => b.netSavings - a.netSavings || b.deposits - a.deposits)
      .slice(0, 5);

    // Compute Arrears Aging (All Time logic for arrears)
    const arrearsMap = {};
    const arrearsSummary = createLoanArrearsCalculator({ loans, schedules, repayments, settlements,
      referenceDate: snapshotDate, portfolioCalculator }).summarize(snapshotLoans);
    const totalArrearsGlobal = arrearsSummary.total;
    arrearsSummary.rows.forEach(({ loan, arrearsAmount, daysLate }) => {
          const id = loan.member || loan.group;
          if (!arrearsMap[id]) arrearsMap[id] = { name: '', id: '', amount: 0, daysOverdue: 0 };
          const member = members.find(m => m.id === id);
          const group = groups.find(g => g.id === id);
          arrearsMap[id].name = member ? member.full_name : (group ? group.name : 'Unknown');
          arrearsMap[id].id = member?.reg_no || group?.group_id || id;
          arrearsMap[id].amount += arrearsAmount;
          if (daysLate > arrearsMap[id].daysOverdue) {
             arrearsMap[id].daysOverdue = daysLate;
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
          ${canUseOfficerFilter() ? `
            <select id="loan-user-filter" class="form-control" style="width: auto; min-width: 220px;">
              <option value="all" ${currentOfficerFilter === 'all' ? 'selected' : ''}>All Loan Users</option>
              ${officerOptions.map(o => `<option value="${escapeHtml(o.id)}" ${currentOfficerFilter === o.id ? 'selected' : ''}>${escapeHtml(o.name)}</option>`).join('')}
            </select>
          ` : ''}
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <label class="text-xs text-muted" for="analytics-date-from">From</label>
            <input type="date" id="analytics-date-from" class="form-control" value="${dateRange.from}" ${dateRange.to ? `max="${dateRange.to}"` : ''} style="width: 145px;" />
            <label class="text-xs text-muted" for="analytics-date-to">To</label>
            <input type="date" id="analytics-date-to" class="form-control" value="${dateRange.to}" ${dateRange.from ? `min="${dateRange.from}"` : ''} style="width: 145px;" />
            <button type="button" class="btn btn-outline btn-sm" id="analytics-date-clear" style="font-size: 0.75rem;">Clear</button>
          </div>
          ${hasAnalyticsDateRange ? `
            <select id="collection-window-filter" class="form-control" style="width: auto; min-width: 190px;" disabled title="Clear the custom date range to use collection presets">
              <option>Collections: Selected Period</option>
            </select>
          ` : `
            <select id="collection-window-filter" class="form-control" style="width: auto; min-width: 170px;">
              <option value="overdue" ${currentCollectionWindow === 'overdue' ? 'selected' : ''}>Collections: Overdue</option>
              <option value="all_upcoming" ${currentCollectionWindow === 'all_upcoming' ? 'selected' : ''}>Collections: All Upcoming</option>
              <option value="next_7_days" ${currentCollectionWindow === 'next_7_days' ? 'selected' : ''}>Collections: Next 7 Days</option>
              <option value="last_month" ${currentCollectionWindow === 'last_month' ? 'selected' : ''}>Collections: Last Month</option>
              <option value="this_month" ${currentCollectionWindow === 'this_month' ? 'selected' : ''}>Collections: This Month</option>
              <option value="next_month" ${currentCollectionWindow === 'next_month' ? 'selected' : ''}>Collections: Next Month</option>
            </select>
          `}
        </div>
      </div>

      <!-- KPI Row -->
      <div class="analytics-grid">
        <div class="card" style="grid-column: 1 / -1; padding: 12px 16px; background: var(--bg-light); border-left: 4px solid var(--primary);">
          <div class="text-xs text-muted">Analytics Period</div>
          <div class="font-semibold">${analyticsRangeLabel}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(27, 61, 114, 0.1); color: var(--primary);">👥</div>
          <div class="kpi-label">Total Members</div>
          <div class="kpi-value">${totalMembers}</div>
          <div class="kpi-trend trend-up">+${memberTrend} ${hasAnalyticsDateRange ? 'registered in period' : 'this month'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(232, 105, 42, 0.1); color: var(--secondary);">💰</div>
          <div class="kpi-label">Active Loan Portfolio</div>
          <div class="kpi-value">KES ${formatMoney(loanPortfolio)}</div>
          <div class="kpi-trend trend-up">Outstanding as at ${formatShortDate(snapshotDate)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(42, 90, 158, 0.1); color: var(--primary-light);">💵</div>
          <div class="kpi-label">Total Disbursed Loans</div>
          <div class="kpi-value">KES ${formatMoney(totalDisbursedLoans)}</div>
          <div class="kpi-trend trend-up">Principal disbursed ${hasAnalyticsDateRange ? 'in selected period' : 'all time'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(232, 105, 42, 0.1); color: var(--secondary);">📈</div>
          <div class="kpi-label">Loan Growth</div>
          <div class="kpi-value" style="color: ${loanGrowthHealth.color};">${loanGrowthHealth.label}</div>
          <div class="kpi-trend" style="color: ${loanGrowthHealth.color};">${loanGrowthHealth.note} · ${growthCurrentLabel} KES ${formatMoney(currentMonthLoans)} vs ${growthPreviousLabel} KES ${formatMoney(previousMonthLoans)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(13, 148, 136, 0.1); color: #0d9488;">🧾</div>
          <div class="kpi-label">Officer Collection Efficiency</div>
          <div class="kpi-value" style="color: ${overallCollectionEfficiencyRating.color};">${overallCollectionEfficiency}</div>
          <div class="kpi-trend" title="${overallCollectionEfficiencyRating.detail || ''}" style="color: ${overallCollectionEfficiencyRating.color};">${overallCollectionEfficiencyRating.label} · Collected KES ${formatMoney(collectedInWindowTotal)} of KES ${formatMoney(scheduledGrossCollection)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(124, 58, 237, 0.1); color: #7c3aed;">📅</div>
          <div class="kpi-label">Outstanding Collections ${collectionWindow.label}</div>
          <div class="kpi-value">KES ${formatMoney(expectedCollection)}</div>
          <div class="kpi-trend ${expectedCollection > 0 ? 'trend-up' : 'trend-down'}">${expectedCollectionClients} clients · ${outstandingForecastSchedules.length} outstanding of ${forecastSchedules.length} due</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">🎯</div>
          <div class="kpi-label">${collectionWindow.label} Repayment Rate</div>
          <div class="kpi-value">${windowRepaymentRate}</div>
          <div class="kpi-trend" style="color: ${windowRepaymentHealth.color};">${windowRepaymentHealth.label} · Paid KES ${formatMoney(scheduledPaidCollection)} of KES ${formatMoney(scheduledGrossCollection)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">🏦</div>
          <div class="kpi-label">${hasAnalyticsDateRange ? 'Net Savings Movement' : 'Total Savings Base'}</div>
          <div class="kpi-value">KES ${formatMoney(totalSavings)}</div>
          <div class="kpi-trend trend-up">${hasAnalyticsDateRange ? 'Deposits less withdrawals in selected period' : (currentOfficerFilter === 'all' ? 'System Liquidity' : 'Savings from assigned clients')}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success);">📊</div>
          <div class="kpi-label">Savings Growth</div>
          <div class="kpi-value" style="color: ${savingsGrowthHealth.color};">${savingsGrowthHealth.label}</div>
          <div class="kpi-trend" style="color: ${savingsGrowthHealth.color};">${savingsGrowthHealth.note} · deposits ${growthCurrentLabel} KES ${formatMoney(currentMonthSavings)} vs ${growthPreviousLabel} KES ${formatMoney(previousMonthSavings)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(201, 168, 76, 0.1); color: var(--accent);">✅</div>
          <div class="kpi-label">Global Repayment Rate</div>
          <div class="kpi-value">${repaymentRate}</div>
          <div class="kpi-trend" style="color: var(--success);">Historical Repayment Progress</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background: rgba(239, 68, 68, 0.1); color: var(--danger);">⚠️</div>
          <div class="kpi-label">Total Arrears</div>
          <div class="kpi-value">KES ${formatMoney(totalArrearsGlobal)}</div>
          <div class="kpi-trend trend-down">Amount overdue as at ${formatShortDate(snapshotDate)}</div>
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
            <span class="badge badge-primary">Due: KES ${formatMoney(scheduledGrossCollection)}</span>
            <span class="badge badge-success">Paid: KES ${formatMoney(scheduledPaidCollection)}</span>
            <span class="badge badge-warning">Remaining: KES ${formatMoney(expectedCollection)}</span>
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
                <th class="text-right">This Month Repayment Rate</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              ${collectionOfficerRows.length === 0 ? '<tr><td colspan="8" class="text-center text-muted">No scheduled collections for this forecast window.</td></tr>' : collectionOfficerRows.map(row => `
                <tr>
                  <td>
                    <div class="font-semibold">${escapeHtml(row.name)}</div>
                    <div class="text-xs text-muted">${row.id === 'unassigned' ? 'No officer recorded' : escapeHtml(row.id)}</div>
                  </td>
                  <td>${row.clients.toLocaleString()}</td>
                  <td>${row.installments.toLocaleString()}</td>
                  <td class="text-right">${formatMoney(row.gross)}</td>
                  <td class="text-right text-success">${formatMoney(row.paid)}</td>
                  <td class="text-right font-semibold text-danger">${formatMoney(row.expected)}</td>
                  <td class="text-right">
                    ${row.thisMonthGross > 0
                      ? `<div class="font-semibold" style="color: ${row.forecastRating.color};">${formatPercent(row.thisMonthRepaymentRate)}</div><div class="text-xs text-muted">${formatMoney(row.thisMonthPaid)} / ${formatMoney(row.thisMonthGross)}</div>`
                      : '<span class="text-muted">No due</span>'}
                  </td>
                  <td><span class="badge" title="${row.forecastRating.detail || ''}" style="background: ${row.forecastRating.color}; color: white; font-size: 0.65rem;">${row.forecastRating.label}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="text-xs text-muted" style="margin-top: 10px;">
          Due and paid are calculated from all installments due in the selected window. Expected collection is the remaining balance: installment amount minus amount already paid.
        </div>
        <div class="text-xs" style="display: flex; flex-wrap: wrap; gap: 12px 18px; margin-top: 14px; color: var(--text-muted);">
          <div style="border-left: 3px solid var(--success); padding-left: 8px; flex: 1 1 190px;"><strong style="color: var(--success);">Excellent 95-100%</strong><br>Target operational performance. Cash flow is predictable, and defaults are minimal.</div>
          <div style="border-left: 3px solid #1e3a8a; padding-left: 8px; flex: 1 1 190px;"><strong style="color: #1e3a8a;">Good / On Track 80-94.99%</strong><br>Acceptable variance; minor missed repayments can be cleared within 7-14 days.</div>
          <div style="border-left: 3px solid #ca8a04; padding-left: 8px; flex: 1 1 190px;"><strong style="color: #ca8a04;">Needs Attention 75-79.99%</strong><br>Moderate credit risk; requires active follow-up and weekly field monitoring.</div>
          <div style="border-left: 3px solid #f97316; padding-left: 8px; flex: 1 1 190px;"><strong style="color: #f97316;">Poor / Moderate Risk 65-74.99%</strong><br>High portfolio contamination risk.</div>
          <div style="border-left: 3px solid var(--danger); padding-left: 8px; flex: 1 1 190px;"><strong style="color: var(--danger);">Below Average below 65%</strong><br>Threatens liquidity and requires escalation to recovery teams.</div>
        </div>
      </div>

      <div class="chart-card" style="min-height: auto; margin-top: 24px;">
        <div class="chart-header">
          <div>
            <div class="chart-title">Officer Collection Efficiency</div>
            <div class="text-xs text-muted" style="margin-top: 4px;">Efficiency is actual repayment cash collected during the selected window divided by scheduled amount due in that window.</div>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table" style="font-size: 0.875rem;">
            <thead>
              <tr>
                <th>Loan Officer</th>
                <th>Clients</th>
                <th>Installments</th>
                <th class="text-right">Due</th>
                <th class="text-right">Collected in Window</th>
                <th class="text-right">Target Gap</th>
                <th class="text-right">Efficiency</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              ${collectionEfficiencyRows.length === 0 ? '<tr><td colspan="8" class="text-center text-muted">No officer collections due in this window.</td></tr>' : collectionEfficiencyRows.map(o => `
                <tr>
                  <td>
                    <div class="font-semibold">${escapeHtml(o.name)}</div>
                    <div class="text-xs text-muted">${o.id === 'unassigned' ? 'No officer recorded' : escapeHtml(o.id)}</div>
                  </td>
                  <td>${o.clients.toLocaleString()}</td>
                  <td>${o.installments.toLocaleString()}</td>
                  <td class="text-right">${formatMoney(o.gross)}</td>
                  <td class="text-right text-success">${formatMoney(o.collectedInWindow)}</td>
                  <td class="text-right font-semibold text-danger">${formatMoney(o.targetGap)}</td>
                  <td class="text-right font-semibold" style="color: ${o.efficiencyRating.color};">${formatPercent(o.efficiency)}</td>
                  <td><span class="badge" title="${o.efficiencyRating.detail || ''}" style="background: ${o.efficiencyRating.color}; color: white; font-size: 0.65rem;">${o.efficiencyRating.label}</span></td>
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

      <div class="charts-grid" style="margin-top: 24px;">
        <div class="chart-card analytics-expenses-chart" style="grid-column: 1 / -1;">
          <div class="chart-header">
            <div>
              <div class="chart-title" id="expenses-chart-title">Expenses (KES)</div>
              <div class="text-xs text-muted" id="expenses-chart-period" style="margin-top: 4px;">${analyticsRangeLabel}${expenseTrend ? ` · ${expenseTrend.interval === 'year' ? 'Annual' : 'Monthly'} totals · ${expenseTrend.count.toLocaleString()} entries` : ''}</div>
            </div>
            <div class="text-lg font-semibold text-danger" id="expenses-chart-total">${expenseTrend ? `KES ${formatMoney(expenseTrend.total)}` : 'Unavailable'}</div>
          </div>
          ${!expenseTrend ? '<div class="text-center text-muted" role="status" style="padding: 40px 16px;">Expense records unavailable. <button type="button" class="btn btn-outline btn-sm" id="expenses-chart-retry">Retry</button></div>'
            : !expenseTrend.count ? '<div class="text-center text-muted" role="status" style="padding: 40px 16px;">No expenses recorded for this period.</div>'
            : `<div class="chart-canvas-wrapper"><canvas id="expensesBarChart" role="img" aria-labelledby="expenses-chart-title" aria-describedby="expenses-chart-period expenses-chart-total">${expenseTrend.labels.map((label, index) => `${label}: KES ${formatMoney(expenseTrend.amounts[index])}`).join('; ')}</canvas></div>`}
        </div>
      </div>

      <div class="charts-grid" style="margin-top: 24px;">
        <div class="chart-card" style="grid-column: 1 / -1;">
          <div class="chart-header">
            <div class="chart-title">Loan Growth vs Savings Growth (%)</div>
          </div>
          <div class="chart-canvas-wrapper">
            <canvas id="loanSavingsGrowthChart"></canvas>
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
                    <td class="text-right font-semibold text-danger">${formatMoney(b.balance)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Top Savers -->
        <div class="chart-card" style="min-height: auto; border-color: rgba(16, 185, 129, 0.3);">
          <div class="chart-header">
            <div>
              <div class="chart-title" style="color: var(--success);">Top 5 Savers</div>
              <div class="text-xs text-muted" style="margin-top: 4px;">${hasAnalyticsDateRange ? 'Net savings movement in the selected period' : 'Current net savings balance'}</div>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table" style="font-size: 0.875rem;">
              <thead>
                <tr>
                  <th>Saver</th>
                  <th class="text-right">Deposits</th>
                  <th class="text-right">Withdrawals</th>
                  <th class="text-right">Net Savings</th>
                </tr>
              </thead>
              <tbody>
                ${topSavers.length === 0 ? '<tr><td colspan="4" class="text-center text-muted">No positive savings balances</td></tr>' : topSavers.map(saver => `
                  <tr>
                    <td>
                      <div class="font-semibold">${escapeHtml(saver.name)}</div>
                      <div class="text-xs text-muted">${escapeHtml(saver.id)} · ${escapeHtml(saver.account)}</div>
                    </td>
                    <td class="text-right text-success">${formatMoney(saver.deposits)}</td>
                    <td class="text-right text-danger">${formatMoney(saver.withdrawals)}</td>
                    <td class="text-right font-semibold">${formatMoney(saver.netSavings)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="charts-grid" style="margin-top: 24px;">
        <!-- Arrears Aging -->
        <div class="chart-card" style="min-height: auto; border-color: rgba(239, 68, 68, 0.3); grid-column: 1 / -1;">
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
    const loanUserFilter = container.querySelector('#loan-user-filter');
    if (loanUserFilter) {
      loanUserFilter.onchange = (e) => {
        currentOfficerFilter = e.target.value;
        renderData();
      };
    }

    const applyAnalyticsDateRange = () => {
      const nextRange = {
        from: container.querySelector('#analytics-date-from')?.value || '',
        to: container.querySelector('#analytics-date-to')?.value || ''
      };
      try { getSavingsDateBounds(nextRange); } catch (error) {
        container.querySelector('#analytics-date-from').value = dateRange.from;
        container.querySelector('#analytics-date-to').value = dateRange.to;
        window.notify?.error(error.message);
        return;
      }
      dateRange = nextRange;
      renderData();
    };
    container.querySelector('#analytics-date-from').onchange = applyAnalyticsDateRange;
    container.querySelector('#analytics-date-to').onchange = applyAnalyticsDateRange;
    container.querySelector('#analytics-date-clear').onclick = () => {
      dateRange = { from: '', to: '' };
      renderData();
    };
    container.querySelector('#collection-window-filter').onchange = (e) => {
      currentCollectionWindow = e.target.value;
      renderData();
    };
    const expenseRetry = container.querySelector('#expenses-chart-retry');
    if (expenseRetry) expenseRetry.onclick = async () => {
      expenseRetry.disabled = true;
      expenseRetry.textContent = 'Fetching...';
      try { await dataCache.invalidatePrefix('expenses:'); }
      catch (error) { expenseRetry.disabled = false; expenseRetry.textContent = 'Retry'; window.notify?.error(error.message); }
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
            <td class="text-right font-semibold text-danger">${formatMoney(a.amount)}</td>
          </tr>`;
      }).join('');

      const pag = container.querySelector('#arrears-pagination');
      pag.innerHTML = '';
      const ctrl = renderPagination(arrearsList.length, pageSize, arrearsPage, (p) => { arrearsPage = p; updateArrearsUI(); });
      if (ctrl) pag.appendChild(ctrl);
    };

    updateArrearsUI();

    chartTimer = setTimeout(() => {
      if (!container.__disposed) initCharts(scopedLoans, scopedRepayments, scopedMembers, scopedSavings, expenseTrend);
    }, 100);
  };

  const initCharts = (fLoans, fRepayments, allMembers, fSavings, expenseTrend) => {
    destroyCharts();
    if (typeof window.Chart !== 'function') {
      const wrapper = container.querySelector('#expensesBarChart')?.parentElement;
      if (wrapper) wrapper.textContent = 'Chart unavailable. Please reload to try again.';
      return;
    }

    const expenseCanvas = container.querySelector('#expensesBarChart');
    if (expenseCanvas && expenseTrend) chartInstances.push(new Chart(expenseCanvas, {
      type: 'bar',
      data: {
        labels: expenseTrend.labels,
        datasets: [{ label: 'Expenses', data: expenseTrend.amounts, backgroundColor: '#dc2626',
          hoverBackgroundColor: '#991b1b', borderRadius: 4, maxBarThickness: 48 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `Expenses: KES ${formatMoney(context.raw)}` } } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'KES' }, ticks: { callback: value => formatMoney(value) } },
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } }
        }
      }
    }));

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

    // Setup time axes from the selected analytics period, defaulting to the last 6 months.
    const parseDate = (value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const datasetDates = [
      ...fLoans.map(l => parseDate(l.application_date || l.disbursement_date || l.created)),
      ...fRepayments.map(r => parseDate(r.date || r.created)),
      ...allMembers.map(m => parseDate(m.registration_date || m.created)),
      ...fSavings.map(s => parseDate(s.date || s.created))
    ].filter(Boolean).sort((a, b) => a - b);
    let axisStart = dateRange.from ? new Date(`${dateRange.from}T00:00:00`) : null;
    let axisEnd = dateRange.to ? new Date(`${dateRange.to}T23:59:59.999`) : null;
    if (!axisStart && datasetDates.length) axisStart = datasetDates[0];
    if (!axisEnd && datasetDates.length) axisEnd = datasetDates[datasetDates.length - 1];
    if (!axisStart || !axisEnd || axisEnd < axisStart) {
      axisEnd = new Date();
      axisStart = new Date(axisEnd.getFullYear(), axisEnd.getMonth() - 5, 1);
    }
    axisStart = new Date(axisStart.getFullYear(), axisStart.getMonth(), 1);
    axisEnd = new Date(axisEnd.getFullYear(), axisEnd.getMonth(), 1);
    const monthSpan = ((axisEnd.getFullYear() - axisStart.getFullYear()) * 12) + (axisEnd.getMonth() - axisStart.getMonth());
    if (monthSpan > 11) axisStart = new Date(axisEnd.getFullYear(), axisEnd.getMonth() - 11, 1);

    const months = [];
    const monthKeys = [];
    for (let d = new Date(axisStart); d <= axisEnd; d.setMonth(d.getMonth() + 1)) {
      months.push(d.toLocaleString('default', { month: 'short' }));
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // 2. Repayment Performance (Bar)
    const repaymentData = monthKeys.map(mk => {
      return fRepayments
        .filter(r => r.date && r.date.startsWith(mk))
        .reduce((sum, repayment) => sum + getRepaymentContractAmount(repayment), 0);
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
    const savingsData = monthKeys.map(mk => calculateSavingsSummary(fSavings.filter(s =>
      new Date(getSavingsTimestamp(s) + 3 * 60 * 60 * 1000).toISOString().startsWith(mk)
    )).deposits);

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

    // 5. Loan Growth vs Savings Growth
    const savingsDepositGrowthBase = savingsData;
    const calculateGrowthSeries = (values) => values.map((value, index) => {
      if (index === 0) return 0;
      const previous = Number(values[index - 1]) || 0;
      const current = Number(value) || 0;
      if (previous > 0) return ((current - previous) / previous) * 100;
      if (current > 0) return 100;
      return 0;
    });
    const savingsGrowthData = calculateGrowthSeries(savingsDepositGrowthBase);
    const loanGrowthData = calculateGrowthSeries(disbData);

    const canvas5 = document.getElementById('loanSavingsGrowthChart');
    if (canvas5) {
      chartInstances.push(new Chart(canvas5, {
        type: 'line',
        data: {
          labels: months,
          datasets: [
            {
              label: 'Savings Growth %',
              data: savingsGrowthData,
              borderColor: '#10B981',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              fill: false,
              tension: 0.35,
              pointRadius: 3
            },
            {
              label: 'Loan Growth %',
              data: loanGrowthData,
              borderColor: '#E8692A',
              backgroundColor: 'rgba(232, 105, 42, 0.08)',
              fill: false,
              tension: 0.35,
              pointRadius: 3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: (context) => `${context.dataset.label}: ${formatPercent(Number(context.raw) || 0)}`
              }
            }
          },
          scales: {
            y: {
              ticks: {
                callback: (value) => `${value}%`
              }
            },
            x: { grid: { display: false } }
          }
        }
      }));
    }
  };

  refresh().then(ok => {
    if (ok) renderData();
  });

  // Realtime handles normal updates; conservative polling is only a fallback.
  // This keeps Analytics current without repeatedly loading full collections.
  const debouncedRefresh = debounce(async () => {
    const ok = await refresh();
    if (ok) renderData();
  }, 500);

  const pollInterval = setInterval(() => {
    if (!document.hidden) debouncedRefresh();
  }, 2 * 60 * 1000);

  container.__subscriptions = [observeCachedView(
    ['savings:', 'members:', 'groups:', 'loans:', 'loan_repayments', 'loan_schedule', 'loan_balance_offs:', 'settings:', 'expenses:'],
    async () => { if (await refresh()) renderData(); }
  )];

  const expenseChanged = debounce(() => {
    if (!container.__disposed) void dataCache.invalidatePrefix('expenses:').catch(error => console.warn('[Analytics] Expense refresh unavailable:', error.message));
  }, 200);
  container.__subscriptionPromise = expenseService.subscribeToChanges(expenseChanged)
    .then(stop => [stop]).catch(error => { console.warn('[Analytics] Expense stream unavailable:', error.message); return []; });
  container.__subscriptions.push(() => {
    clearInterval(pollInterval); debouncedRefresh.cancel(); expenseChanged.cancel();
    clearTimeout(chartTimer); destroyCharts();
  });

  return container;
};
