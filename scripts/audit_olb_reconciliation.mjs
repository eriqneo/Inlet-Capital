import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createLoanPortfolioCalculator, isCollectibleLoanRecord, isDisbursedLoanRecord } from '../src/core/loanPortfolio.js';
import { getLoanLiabilityAmount, getRepaymentContractAmount, getSettlementContractAmount } from '../src/core/repaymentAllocation.js';
import { getPortfolioMemberIds, filterPortfolioFinancialRecords } from '../src/core/memberLifecycle.js';

// Authentication is the only POST; business collections are GET-only.
process.env.TZ = 'Africa/Nairobi';
const baseUrl = 'https://inletcapital.pockethost.io/api';
const source = fs.readFileSync(new URL('../setup_collections.mjs', import.meta.url), 'utf8');
const credential = name => process.env[name] || source.match(new RegExp(`const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`))?.[1];
const started = new Date();
let requests = 0;
const curlRequest = (path, options) => new Promise((resolve, reject) => {
  const config = [`url = ${JSON.stringify(`${baseUrl}/${path}`)}`, `request = ${JSON.stringify(options.method || 'GET')}`];
  for (const [key, value] of Object.entries(options.headers || {})) config.push(`header = ${JSON.stringify(`${key}: ${value}`)}`);
  if (options.body) config.push(`data = ${JSON.stringify(options.body)}`);
  const child = spawn('curl', ['--silent', '--show-error', '--http1.1', '--connect-timeout', '20', '--max-time', '60', '--config', '-', '--write-out', '\n%{http_code}'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.resume();
  child.on('error', () => reject(new Error('Audit transport unavailable')));
  child.on('close', code => {
    if (code !== 0) return reject(new Error(`Audit transport failed (${code})`));
    const split = output.lastIndexOf('\n');
    const status = Number(output.slice(split + 1));
    if (status < 200 || status >= 300) return reject(new Error(`PocketHost HTTP ${status}; stopped without retry`));
    try { resolve(JSON.parse(output.slice(0, split))); } catch { reject(new Error('Invalid audit response')); }
  });
  child.stdin.on('error', () => {});
  child.stdin.end(config.join('\n'));
});
const request = async (path, options = {}) => {
  requests++;
  let response;
  try { response = await fetch(`${baseUrl}/${path}`, { ...options, signal: AbortSignal.timeout(60000) }); }
  catch (error) {
    if (error.message !== 'fetch failed') throw error;
    return curlRequest(path, options);
  }
  if (!response.ok) throw new Error(`PocketHost HTTP ${response.status}; stopped without retry`);
  return response.json();
};
const cents = value => Math.round(value * 100);
const sum = (records, getValue) => records.reduce((total, record) => total + cents(getValue(record)), 0) / 100;

try {
  const identity = credential('ADMIN_EMAIL'), password = credential('ADMIN_PASS');
  if (!identity || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASS locally');
  const auth = await request('collections/_superusers/auth-with-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity, password })
  });
  const read = async (collection, fields) => {
    const records = [];
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({ page: String(page), perPage: '500', sort: 'id', fields });
      const data = await request(`collections/${collection}/records?${query}`, { headers: { Authorization: auth.token } });
      records.push(...data.items);
      if (page >= data.totalPages) return records;
    }
  };
  const members = await read('members', 'id,group,status,assigned_officer,registered_by,updated');
  const groups = await read('groups', 'id,status,assigned_officer,created_by,updated');
  const allLoans = await read('loans', 'id,loan_no,member,group,status,approved_amount,amount_applied,total_liability,interest_amount,interest_rate,disbursement_date,application_date,renewed_to,renewed_from,written_off_at,updated,processed_by');
  const repayments = await read('loan_repayments', 'id,loan,amount,fine_amount,date,created,updated,is_reversed,status');
  const settlements = await read('loan_balance_offs', 'id,loan,amount,status,effective_date,created,updated');
  const schedules = await read('loan_schedule', 'id,loan,installment_no,amount,paid,due_date,penalty_waived,carried_fine,updated');
  const settings = await read('settings', 'id,key,value');
  if (process.argv.includes('--arrears')) {
    const { auditArrears } = await import('./audit_arrears_reconciliation.mjs');
    console.log(JSON.stringify(auditArrears({ members, groups, loans: allLoans, repayments, settlements, schedules, settings, started, requests }), null, 2));
    process.exitCode = 0;
  } else {
  const setting = settings.find(record => record.key === 'penalty_amount');
  const penaltyAmount = setting && setting.value !== '' ? Number(setting.value) : 500;
  if (!Number.isFinite(penaltyAmount) || penaltyAmount < 0) throw new Error('Invalid penalty setting');
  const loans = filterPortfolioFinancialRecords(allLoans, getPortfolioMemberIds(members));
  const calculator = createLoanPortfolioCalculator({ repayments, settlements, schedules, penaltyAmount, referenceDate: started });
  const ledgerOnly = createLoanPortfolioCalculator({ repayments, settlements, schedules, penaltyAmount, referenceDate: started, useRecordedSchedulePaid: false });
  const current = loan => calculator.getOutstanding(loan);
  const localLiability = loan => Number(loan.total_liability) || (Number(loan.approved_amount || loan.amount_applied) || 0) + (Number(loan.interest_amount) || 0);
  const localContract = (loan, includeSettlements) => {
    if (!isDisbursedLoanRecord(loan) || loan.renewed_to) return 0;
    const paid = sum(calculator.getRepayments(loan.id), getRepaymentContractAmount)
      + (includeSettlements ? sum(calculator.getSettlements(loan.id), getSettlementContractAmount) : 0);
    return Math.max(0, localLiability(loan) - paid);
  };
  const membersById = new Map(members.map(member => [member.id, member]));
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const getOfficer = loan => {
    const owner = loan.member ? membersById.get(loan.member) : groupsById.get(loan.group);
    return owner?.assigned_officer || owner?.registered_by || owner?.created_by || loan.processed_by || '';
  };
  const monthEnd = new Date(started.getFullYear(), started.getMonth(), 0, 23, 59, 59, 999);
  const before = (record, fields) => {
    const value = fields.map(field => record[field]).find(Boolean);
    return Boolean(value && new Date(value) <= monthEnd);
  };
  const historicalCalculator = createLoanPortfolioCalculator({
    repayments: repayments.filter(record => before(record, ['date', 'created'])),
    settlements: settlements.filter(record => before(record, ['effective_date', 'created'])),
    schedules, penaltyAmount, referenceDate: monthEnd, useRecordedSchedulePaid: false
  });
  const historicalLoans = loans.filter(loan => before(loan, ['disbursement_date'])
    && (isDisbursedLoanRecord(loan) || (loan.status === 'written_off' && new Date(loan.written_off_at) > monthEnd)))
    .map(loan => loan.status === 'written_off' ? { ...loan, status: 'disbursed' } : loan);
  const differences = loans.map(loan => ({
    loan_id: loan.id, loan_no: loan.loan_no, status: loan.status,
    shared_olb: current(loan), group_profile_olb: localContract(loan, true), group_report_olb: localContract(loan, false),
    liability: getLoanLiabilityAmount(loan), local_liability: localLiability(loan),
    contract_paid: sum(calculator.getRepayments(loan.id), getRepaymentContractAmount),
    balanced_off: sum(calculator.getSettlements(loan.id), getSettlementContractAmount),
    ledger_only_olb: ledgerOnly.getOutstanding(loan)
  })).filter(row => cents(row.shared_olb) !== cents(row.group_profile_olb)
    || cents(row.shared_olb) !== cents(row.group_report_olb) || cents(row.shared_olb) !== cents(row.ledger_only_olb));
  const missingOwnerIds = allLoans.filter(loan => loan.member ? !membersById.has(loan.member) : !groupsById.has(loan.group)).map(loan => loan.id);
  console.log(JSON.stringify({
    source: baseUrl, started: started.toISOString(), finished: new Date().toISOString(), requests, penalty_amount: penaltyAmount,
    caveat: 'Sequential read-only snapshot; formulas reconstructed from source, not deployed UI. Shared totals are comparison baselines, not independent certification. No business records changed.',
    counts: { loans: allLoans.length, operational_loans: loans.length, repayments: repayments.length, schedules: schedules.length, settlements: settlements.length },
    totals: {
      dashboard_active_olb: sum(loans.filter(isCollectibleLoanRecord), current),
      analytics_all_time_olb: sum(loans.filter(loan => isCollectibleLoanRecord(loan) && new Date(loan.disbursement_date) <= started), current),
      individual_and_repayments_report_olb: sum(loans.filter(isDisbursedLoanRecord), current),
      group_profile_formula_all_accounts: sum(loans, loan => localContract(loan, true)),
      group_report_formula_all_accounts: sum(loans, loan => localContract(loan, false)),
      shared_contract_only: sum(loans, loan => isDisbursedLoanRecord(loan) && !loan.renewed_to
        ? Math.max(0, getLoanLiabilityAmount(loan) - sum(calculator.getRepayments(loan.id), getRepaymentContractAmount) - sum(calculator.getSettlements(loan.id), getSettlementContractAmount)) : 0),
      prior_month_end_analytics_source_formula: sum(historicalLoans, loan => historicalCalculator.getOutstanding(loan)),
      prior_month_end_nairobi: monthEnd.toISOString()
    },
    groups: groups.map(group => {
      const related = loans.filter(loan => loan.member ? membersById.get(loan.member)?.group === group.id : loan.group === group.id);
      return { group_id: group.id, shared_olb: sum(related, current), profile_olb: sum(related, loan => localContract(loan, true)), report_olb: sum(related, loan => localContract(loan, false)) };
    }).filter(row => row.shared_olb !== row.profile_olb || row.shared_olb !== row.report_olb),
    officer_partition: [...new Set(loans.map(getOfficer))].sort().map(id => ({ officer_id: id, olb: sum(loans.filter(loan => getOfficer(loan) === id), current) })),
    differences,
    checks: {
      completed_or_closed_positive_olb: loans.filter(loan => ['completed', 'closed'].includes(loan.status) && current(loan) > 0).map(loan => loan.id),
      future_disbursement_ids: loans.filter(loan => new Date(loan.disbursement_date) > started).map(loan => loan.id),
      future_repayment_ids: repayments.filter(record => new Date(record.date || record.created) > started).map(record => record.id),
      reversed_repayment_ids: repayments.filter(record => record.is_reversed || record.status === 'reversed').map(record => record.id),
      missing_owner_ids: missingOwnerIds,
      excluded_lifecycle_olb: sum(allLoans.filter(loan => !loans.includes(loan)), current),
      schedule_paid_without_receipts: schedules.filter(record => Number(record.paid) > 0 && !calculator.getRepayments(record.loan).length && !calculator.getSettlements(record.loan).length).map(record => {
        const loan = allLoans.find(item => item.id === record.loan);
        return { schedule_id: record.id, loan_id: record.loan, paid: record.paid, loan_exists: Boolean(loan), status: loan?.status || null, renewed_to: loan?.renewed_to || null };
      }),
      changed_during_audit_ids: [...members, ...groups, ...allLoans, ...repayments, ...settlements, ...schedules].filter(record => new Date(record.updated) > started).map(record => record.id)
    }
  }, null, 2));
  }
} catch (error) {
  console.error(`Read-only OLB audit stopped: ${error.message}`);
  process.exitCode = 1;
}
