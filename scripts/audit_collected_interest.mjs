import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  calculateCollectedInterest,
  getLoanInterestAmount,
  getLoanLiabilityAmount,
  getLoanPrincipalAmount,
  getRepaymentContractAmount
} from '../src/core/repaymentAllocation.js';
import { createLoanPortfolioCalculator } from '../src/core/loanPortfolio.js';

const source = fs.readFileSync(new URL('../setup_collections.mjs', import.meta.url), 'utf8');
const readConstant = (name) => {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*['\"]([^'\"]+)['\"]`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
};

const baseUrl = 'https://inletcapital.pockethost.io/api';
const execFileAsync = promisify(execFile);
const requestWithCurl = async (path, options = {}) => {
  const args = [
    '--silent', '--show-error', '--http1.1',
    '--connect-timeout', '20', '--max-time', '60', '--retry', '2',
    '--request', options.method || 'GET', `${baseUrl}/${path}`,
    '--header', 'Content-Type: application/json'
  ];
  if (options.headers?.Authorization) args.push('--header', `Authorization: ${options.headers.Authorization}`);
  if (options.body) args.push('--data', options.body);
  args.push('--write-out', '\n%{http_code}');
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
  const lines = stdout.trim().split('\n');
  const status = Number(lines.pop());
  const data = JSON.parse(lines.join('\n') || '{}');
  if (status < 200 || status >= 300) throw new Error(`${status}: ${JSON.stringify(data)}`);
  return data;
};
const request = async (path, options = {}) => {
  try {
    const response = await fetch(`${baseUrl}/${path}`, options);
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
    return data;
  } catch (error) {
    if (error?.message && !error.message.includes('fetch failed')) throw error;
    return requestWithCurl(path, options);
  }
};

const auth = await request('collections/_superusers/auth-with-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    identity: readConstant('ADMIN_EMAIL'),
    password: readConstant('ADMIN_PASS')
  })
});

const headers = { Authorization: auth.token };
const getFullList = async (collection, extraQuery = '') => {
  let page = 1;
  const items = [];
  while (true) {
    const data = await request(
      `collections/${collection}/records?page=${page}&perPage=200${extraQuery}`,
      { headers }
    );
    items.push(...data.items);
    if (page >= data.totalPages) return items;
    page += 1;
  }
};

const [loans, repayments, schedules, settings] = await Promise.all([
  getFullList('loans', '&expand=member,group'),
  getFullList('loan_repayments'),
  getFullList('loan_schedule'),
  getFullList('settings')
]);
const penaltySettingValue = settings.find(setting => setting.key === 'penalty_amount')?.value;
const parsedPenaltyAmount = Number(penaltySettingValue);
const penaltyAmount = penaltySettingValue === null
  || penaltySettingValue === undefined
  || penaltySettingValue === ''
  || !Number.isFinite(parsedPenaltyAmount)
  ? 500
  : parsedPenaltyAmount;
const portfolioCalculator = createLoanPortfolioCalculator({ repayments, schedules, penaltyAmount });
const contractPortfolioCalculator = createLoanPortfolioCalculator({
  repayments,
  schedules,
  penaltyAmount,
  includeOutstandingFines: false
});

const repaymentsByLoan = repayments.reduce((map, repayment) => {
  const loanId = typeof repayment.loan === 'string' ? repayment.loan : repayment.loan?.id;
  if (!loanId) return map;
  if (!map.has(loanId)) map.set(loanId, []);
  map.get(loanId).push(repayment);
  return map;
}, new Map());

const rows = loans
  .map(loan => {
    const loanRepayments = repaymentsByLoan.get(loan.id) || [];
    return {
      loan_no: loan.loan_no,
      client: loan.expand?.member?.full_name || loan.expand?.group?.name || 'Unknown',
      amount_applied_raw: Number(loan.amount_applied) || 0,
      approved_amount_raw: Number(loan.approved_amount) || 0,
      interest_rate_raw: Number(loan.interest_rate) || 0,
      interest_amount_raw: Number(loan.interest_amount) || 0,
      total_liability_raw: Number(loan.total_liability) || 0,
      principal: getLoanPrincipalAmount(loan),
      expected_interest: getLoanInterestAmount(loan),
      liability: getLoanLiabilityAmount(loan),
      repayment_count: loanRepayments.length,
      contract_repaid: loanRepayments.reduce(
        (sum, repayment) => sum + getRepaymentContractAmount(repayment),
        0
      ),
      fines: loanRepayments.reduce((sum, repayment) => sum + (Number(repayment.fine_amount) || 0), 0),
      collected_interest: calculateCollectedInterest({ loan, repayments: loanRepayments }),
      olb: portfolioCalculator.getOutstanding(loan)
    };
  })
  .filter(row => row.repayment_count > 0)
  .sort((a, b) => b.collected_interest - a.collected_interest);

const totals = rows.reduce((result, row) => {
  result.loans += 1;
  result.repayments += row.repayment_count;
  result.contract_repaid += row.contract_repaid;
  result.fines += row.fines;
  result.collected_interest += row.collected_interest;
  result.expected_interest += row.expected_interest;
  result.olb += row.olb;
  return result;
}, {
  loans: 0,
  repayments: 0,
  contract_repaid: 0,
  fines: 0,
  collected_interest: 0,
  expected_interest: 0,
  olb: 0
});
const outstandingLoans = loans.filter(loan => portfolioCalculator.getOutstanding(loan) > 0);
totals.portfolio_loans = outstandingLoans.length;
totals.portfolio_olb = outstandingLoans.reduce(
  (sum, loan) => sum + portfolioCalculator.getOutstanding(loan),
  0
);
totals.penalty_amount = penaltyAmount;
totals.penalty_setting_raw = penaltySettingValue ?? null;
totals.contract_portfolio_olb = loans.reduce(
  (sum, loan) => sum + contractPortfolioCalculator.getOutstanding(loan),
  0
);
totals.outstanding_fines = totals.portfolio_olb - totals.contract_portfolio_olb;

console.log(JSON.stringify(process.argv.includes('--summary') ? { totals } : { totals, rows }, null, 2));
