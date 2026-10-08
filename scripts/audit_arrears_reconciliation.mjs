import { buildEffectiveSchedulePaidMap, applyEffectiveSchedulePayments, getArrearsTotal, isScheduleInArrears } from '../src/core/loanScheduleMetrics.js';
import { isCollectibleLoanRecord, createLoanPortfolioCalculator } from '../src/core/loanPortfolio.js';
import { getPortfolioMemberIds, filterPortfolioFinancialRecords } from '../src/core/memberLifecycle.js';
import { createLoanArrearsCalculator } from '../src/core/loanArrears.js';

// Invoked by audit_olb_reconciliation.mjs --arrears; no additional network reads.
export const auditArrears = ({ members, groups, loans, repayments, settlements, schedules, settings, started, requests }) => {
  const cents = value => Math.round(Number(value) * 100);
  const sum = (rows, value) => rows.reduce((total, row) => total + cents(value(row)), 0) / 100;
  const operational = filterPortfolioFinancialRecords(loans, getPortfolioMemberIds(members));
  const activeIds = new Set(operational.filter(loan => isCollectibleLoanRecord(loan) && !loan.renewed_to).map(loan => loan.id));
  const scoped = schedules.filter(row => activeIds.has(row.loan));
  const paidMap = buildEffectiveSchedulePaidMap({ schedules, repayments, settlements });
  const effective = applyEffectiveSchedulePayments(scoped, paidMap);
  const recordedOrAllocated = scoped.map(row => ({ ...row, paid: Math.min(Number(row.amount), Math.max(Number(row.paid) || 0, paidMap.get(row.id) || 0)) }));
  const overdue = effective.filter(row => isScheduleInArrears(row, started));
  const duplicateInstallments = new Map();
  schedules.forEach(row => {
    if (!row.loan) return;
    const key = `${row.loan}:${row.installment_no}`;
    const rows = duplicateInstallments.get(key) || [];
    rows.push(row.id);
    duplicateInstallments.set(key, rows);
  });
  const fractional = schedules.filter(row => Math.abs(Number(row.amount) * 100 - cents(row.amount)) > 0.00001);
  const setting = settings.find(row => row.key === 'penalty_amount');
  const penaltyAmount = setting && setting.value !== '' ? Number(setting.value) : 500;
  let portfolio = null, portfolioError = null;
  let sharedArrears = null;
  try {
    const calculator = createLoanPortfolioCalculator({ loans, repayments, settlements, schedules, penaltyAmount, referenceDate: started });
    portfolio = calculator.sumOutstanding(operational);
    const result = createLoanArrearsCalculator({ loans, repayments, settlements, schedules, referenceDate: started, portfolioCalculator: calculator }).summarize(operational);
    sharedArrears = { total: result.total, loan_count: result.loanCount, installment_count: result.installmentCount,
      arrears_ratio: result.arrearsRatio, gpar_rate: result.gparRate, buckets: result.buckets };
  } catch (error) { portfolioError = error.message; }
  const membersById = new Map(members.map(row => [row.id, row]));
  const legacyArrears = rows => rows.reduce((total, row) => {
    if (row.status === 'paid' || Number(row.amount) <= Number(row.paid || 0)) return total;
    const due = new Date(row.due_date); due.setHours(0, 0, 0, 0);
    const today = new Date(started); today.setHours(0, 0, 0, 0);
    return due < today ? total + Math.max(0, Number(row.amount) - Number(row.paid || 0)) : total;
  }, 0);
  return {
    started: started.toISOString(), finished: new Date().toISOString(), requests,
    caveat: 'Read-only sequential snapshot, not deployed UI verification. Legacy formula comparisons; cents-rounded diagnostic totals are not certified historical balances.',
    counts: { loans: loans.length, repayments: repayments.length, settlements: settlements.length, schedules: schedules.length, overdue_schedules: overdue.length, overdue_loans: new Set(overdue.map(row => row.loan)).size },
    totals: {
      ledger_allocated_arrears: getArrearsTotal(effective, started),
      raw_schedule_arrears: legacyArrears(scoped),
      group_max_recorded_allocated_arrears: legacyArrears(recordedOrAllocated),
      shared_olb: portfolio, olb_error: portfolioError
    },
    shared_arrears: sharedArrears,
    fractional_installments: { count: fractional.length, loan_count: new Set(fractional.map(row => row.loan)).size,
      samples: fractional.slice(0, 5).map(row => ({ schedule_id: row.id, loan_id: row.loan, installment_no: row.installment_no, amount: row.amount })) },
    orphan_schedule_count: schedules.filter(row => !row.loan || !loans.some(loan => loan.id === row.loan)).length,
    duplicate_installments: [...duplicateInstallments].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids })),
    recorded_paid_differences: scoped.filter(row => cents(row.paid || 0) !== cents(paidMap.get(row.id) || 0)).map(row => ({ schedule_id: row.id, loan_id: row.loan, stored_paid: row.paid, allocated_paid: paidMap.get(row.id) || 0, status: row.status })),
    groups: groups.map(group => {
      const ids = new Set(operational.filter(loan => loan.member ? membersById.get(loan.member)?.group === group.id : loan.group === group.id).map(loan => loan.id));
      return { group_id: group.id, ledger_arrears: getArrearsTotal(effective.filter(row => ids.has(row.loan)), started), stored_arrears: legacyArrears(scoped.filter(row => ids.has(row.loan))) };
    }).filter(row => cents(row.ledger_arrears) !== cents(row.stored_arrears)),
    fractional_scheduled_total: sum(fractional, row => row.amount),
    future_receipt_ids: repayments.filter(row => new Date(row.date || row.created) > started).map(row => row.id),
    changed_during_audit_ids: [...members, ...groups, ...loans, ...repayments, ...settlements, ...schedules].filter(row => new Date(row.updated) > started).map(row => row.id)
  };
};
