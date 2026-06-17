import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getArrearsTotal, isScheduleInArrears } from './src/core/loanScheduleMetrics.js';

const execFileAsync = promisify(execFile);

const PB_URL = 'https://inletcapital.pockethost.io';
const ADMIN_EMAIL = 'aturaerick@gmail.com';
const ADMIN_PASS = 'dGY@SrzA86PQc5n';

async function fetchPb(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${PB_URL}/api/${path}`, options);
  } catch {
    return curlPb(path, method, body, token);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API Error ${res.status} ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function curlPb(path, method = 'GET', body = null, token = null) {
  const args = ['-sS', '-X', method, `${PB_URL}/api/${path}`, '-H', 'Content-Type: application/json'];
  if (token) args.push('-H', `Authorization: ${token}`);
  if (body) args.push('-d', JSON.stringify(body));
  args.push('-w', '\n%{http_code}');

  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
  const lines = stdout.trim().split('\n');
  const status = Number(lines.pop());
  const rawBody = lines.join('\n');
  const data = rawBody ? JSON.parse(rawBody) : {};
  if (status < 200 || status >= 300) throw new Error(`API Error ${status} ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function getFullList(collection, token, query = '') {
  const items = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const separator = query ? '&' : '';
    const result = await fetchPb(
      `collections/${collection}/records?page=${page}&perPage=${perPage}${separator}${query}`,
      'GET',
      null,
      token
    );
    items.push(...(result.items || []));
    if (page >= result.totalPages || (result.items || []).length === 0) break;
    page += 1;
  }
  return items;
}

const encodeFilter = (filter) => `filter=${encodeURIComponent(filter)}`;
const scopedGroupRecordFilter = (groupId) => `group="${groupId}" || member.group="${groupId}"`;
const scopedLoanChildFilter = (groupId) => `loan.group="${groupId}" || loan.member.group="${groupId}"`;

const calculateSavingsTotal = (records) => records
  .filter(record => !record.is_reversed)
  .reduce((sum, record) => {
    const amount = Number(record.amount) || 0;
    return record.type === 'deposit' ? sum + amount : sum - amount;
  }, 0);

const isDisbursedLoanForBalance = (loan) => Boolean(loan?.disbursement_date)
  && ['disbursed', 'approved', 'partial_approved', 'completed', 'closed'].includes(loan.status);
const isCollectibleLoan = (loan) => loan?.status === 'disbursed' || (['approved', 'partial_approved'].includes(loan?.status) && loan?.disbursement_date);

const getLoanLiability = (loan) => {
  const storedLiability = Number(loan.total_liability) || 0;
  if (storedLiability > 0) return storedLiability;
  const principal = Number(loan.approved_amount || loan.amount_applied) || 0;
  const interest = Number(loan.interest_amount) || 0;
  return principal + interest;
};

const calculateLoanBalance = (loan, repayments) => {
  if (!isDisbursedLoanForBalance(loan)) return 0;
  const paid = repayments
    .filter(repayment => repayment.loan === loan.id)
    .reduce((sum, repayment) => sum + (Number(repayment.amount) || 0), 0);
  return Math.max(0, getLoanLiability(loan) - paid);
};

const buildSummaryPayload = (groupId, members, loans, savings, repayments, schedules) => {
  const activeMemberCutoff = Date.now() - (90 * 24 * 60 * 60 * 1000);
  const activeGroupLoanIds = new Set(loans.filter(loan => !loan.member && isCollectibleLoan(loan)).map(loan => loan.id));
  let totalArrears = getArrearsTotal(schedules.filter(schedule => activeGroupLoanIds.has(schedule.loan) && isScheduleInArrears(schedule)));
  let membersInArrears = 0;
  let inactiveMembers = 0;

  members.forEach(member => {
    const memberSavings = savings.filter(record => record.member === member.id);
    const memberLoans = loans.filter(loan => loan.member === member.id);
    const activeMemberLoanIds = new Set(memberLoans.filter(isCollectibleLoan).map(loan => loan.id));
    const memberArrears = getArrearsTotal(schedules.filter(schedule => activeMemberLoanIds.has(schedule.loan) && isScheduleInArrears(schedule)));
    const lastSavingsDate = memberSavings.length > 0
      ? new Date(Math.max(...memberSavings.map(record => new Date(record.date))))
      : null;
    const isActive = lastSavingsDate && lastSavingsDate.getTime() >= activeMemberCutoff;

    totalArrears += memberArrears;
    if (memberArrears > 0) membersInArrears += 1;
    if (!isActive) inactiveMembers += 1;
  });

  return {
    group: groupId,
    member_count: members.length,
    total_savings: calculateSavingsTotal(savings),
    outstanding_loan: loans
      .filter(isDisbursedLoanForBalance)
      .reduce((sum, loan) => sum + calculateLoanBalance(loan, repayments), 0),
    total_arrears: totalArrears,
    members_in_arrears: membersInArrears,
    inactive_members: inactiveMembers,
    last_calculated_at: new Date().toISOString()
  };
};

async function upsertSummary(groupId, payload, token) {
  const existing = await getFullList('group_summary', token, encodeFilter(`group="${groupId}"`));
  if (existing[0]) {
    return await fetchPb(`collections/group_summary/records/${existing[0].id}`, 'PATCH', payload, token);
  }
  return await fetchPb('collections/group_summary/records', 'POST', payload, token);
}

async function run() {
  console.log('Authenticating to PocketHost...');
  const auth = await fetchPb('collections/_superusers/auth-with-password', 'POST', {
    identity: ADMIN_EMAIL,
    password: ADMIN_PASS
  });
  const token = auth.token;

  const groups = await getFullList('groups', token, 'sort=name');
  console.log(`Rebuilding summaries for ${groups.length} group(s)...`);

  for (const group of groups) {
    const [members, loans, savings] = await Promise.all([
      getFullList('members', token, encodeFilter(`group="${group.id}"`)),
      getFullList('loans', token, encodeFilter(scopedGroupRecordFilter(group.id))),
      getFullList('savings', token, encodeFilter(scopedGroupRecordFilter(group.id)))
    ]);

    const hasLoans = loans.some(loan => isCollectibleLoan(loan) || ['completed', 'closed'].includes(loan.status));
    const [repayments, schedules] = hasLoans
      ? await Promise.all([
          getFullList('loan_repayments', token, encodeFilter(scopedLoanChildFilter(group.id))),
          getFullList('loan_schedule', token, encodeFilter(scopedLoanChildFilter(group.id)))
        ])
      : [[], []];

    const payload = buildSummaryPayload(group.id, members, loans, savings, repayments, schedules);
    await upsertSummary(group.id, payload, token);
    console.log(`${group.name}: members=${payload.member_count}, savings=${payload.total_savings}, olb=${payload.outstanding_loan}, arrears=${payload.total_arrears}`);
  }

  console.log('Group summaries rebuilt.');
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
