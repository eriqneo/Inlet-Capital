import { createLoanPortfolioCalculator, OLB_DEFINITION_VERSION } from './loanPortfolio.js';
import { getPortfolioMemberIds, filterPortfolioFinancialRecords } from './memberLifecycle.js';
import { selectFinancialRecords } from './financialRecords.js';
import { normalizeLoanSchedules } from './loanInstallments.js';

export const createLoanFinancialSnapshot = ({ members, groups, loans, repayments, settlements, schedules, penaltyAmount, capturedAt = new Date().toISOString() }) => {
  for (const [name, records] of Object.entries({ members, groups, loans, repayments, settlements, schedules })) {
    if (!Array.isArray(records)) throw new Error(`Incomplete loan snapshot: ${name} unavailable`);
  }
  loans = selectFinancialRecords(loans, { fields: [] });
  if (penaltyAmount === null || penaltyAmount === undefined || !Number.isFinite(Number(penaltyAmount)) || Number(penaltyAmount) < 0) throw new Error('Incomplete loan snapshot: penalty setting unavailable');
  const membersById = new Map(members.map(member => [member.id, member]));
  const groupsById = new Map(groups.map(group => [group.id, group]));
  for (const loan of loans) {
    if (loan.member ? !membersById.has(loan.member) : !groupsById.has(loan.group)) throw new Error(`Loan owner unavailable for ${loan.loan_no || loan.id}`);
  }
  const loanIds = new Set(loans.map(loan => loan.id));
  const children = records => selectFinancialRecords(records, { fields: [] }).filter(record => loanIds.has(typeof record.loan === 'string' ? record.loan : record.loan?.id));
  const snapshot = { version: OLB_DEFINITION_VERSION, capturedAt, members, groups, loans,
    repayments: children(repayments), settlements: children(settlements), schedules: normalizeLoanSchedules(children(schedules)), penaltyAmount };
  const calculator = createLoanPortfolioCalculator({ ...snapshot, referenceDate: new Date(capturedAt) });
  filterPortfolioFinancialRecords(loans, getPortfolioMemberIds(members)).forEach(loan => calculator.getOutstanding(loan));
  return snapshot;
};
