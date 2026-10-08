import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { calculateSavingsSummary, getSavingsTimestamp, isSavingsInDateRange, selectSavingsRecords, getInternalSavingsTransactionIds } from '../src/core/savingsMetrics.js';
import { isPortfolioMember } from '../src/core/memberLifecycle.js';

// Authentication is the only POST. All collection access below is GET-only.
const baseUrl = 'https://inletcapital.pockethost.io/api';
const source = fs.readFileSync(new URL('../setup_collections.mjs', import.meta.url), 'utf8');
const credential = name => process.env[name] || source.match(new RegExp(`const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`))?.[1];
const started = new Date().toISOString();
const asOf = process.argv.find(arg => arg.startsWith('--as-of='))?.slice(8)
  || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const calendarDate = new Date(`${asOf}T00:00:00Z`);
if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== asOf) throw new Error('Use --as-of=YYYY-MM-DD');
const monthStart = `${asOf.slice(0, 7)}-01`;
const previousEnd = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
let requests = 0;
const requestWithCurl = (path, options) => new Promise((resolve, reject) => {
  // Secrets travel through stdin, not process arguments or diagnostic output.
  const config = [`url = ${JSON.stringify(`${baseUrl}/${path}`)}`, `request = ${JSON.stringify(options.method || 'GET')}`];
  for (const [key, value] of Object.entries(options.headers || {})) config.push(`header = ${JSON.stringify(`${key}: ${value}`)}`);
  if (options.body) config.push(`data = ${JSON.stringify(options.body)}`);
  const child = spawn('curl', ['--silent', '--show-error', '--http1.1', '--connect-timeout', '20', '--max-time', '60', '--config', '-', '--write-out', '\n%{http_code}'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.resume();
  child.on('error', () => reject(new Error('HTTP/1.1 audit transport unavailable')));
  child.on('close', code => {
    if (code !== 0) return reject(new Error(`HTTP/1.1 audit transport failed (${code})`));
    const split = output.lastIndexOf('\n');
    const status = Number(output.slice(split + 1));
    if (status < 200 || status >= 300) return reject(new Error(`PocketHost HTTP ${status}; audit stopped without retry.`));
    try { resolve(JSON.parse(output.slice(0, split))); } catch { reject(new Error('PocketHost returned invalid JSON')); }
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
    return requestWithCurl(path, options);
  }
  if (!response.ok) throw new Error(`PocketHost HTTP ${response.status}; audit stopped without retry. Retry-After: ${response.headers.get('retry-after') || 'not provided'}`);
  return response.json();
};

try {
  const identity = credential('ADMIN_EMAIL');
  const password = credential('ADMIN_PASS');
  if (!identity || !password) throw new Error('Audit authentication is unavailable. Set ADMIN_EMAIL and ADMIN_PASS locally.');
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
  const groups = await read('groups', 'id,name,status,assigned_officer,created_by,updated');
  const savings = await read('savings', 'id,member,group,amount,type,date,created,updated,is_reversed');
  const settlements = await read('loan_balance_offs', 'id,savings_transaction,status');
  const summaries = await read('group_summary', 'id,group,total_savings,last_calculated_at');
  const membersById = new Map(members.map(member => [member.id, member]));
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const exceptions = [];
  const valid = savings.filter(record => {
    if (record.is_reversed) return false;
    try {
      calculateSavingsSummary([record]);
      getSavingsTimestamp(record);
      if (record.member ? !membersById.has(record.member) : !groupsById.has(record.group)) throw new Error('Unresolved account owner');
      return true;
    } catch (error) { exceptions.push({ id: record.id, reason: error.message }); return false; }
  });
  const operational = selectSavingsRecords(valid, { members, groups });
  const money = records => calculateSavingsSummary(records);
  const netCents = records => records.reduce((sum, record) => sum + Math.round(Number(record.amount) * 100)
    * (String(record.type || '').trim().toLowerCase() === 'withdrawal' ? -1 : 1), 0);
  const internalIds = getInternalSavingsTransactionIds(settlements);
  const dates = [
    { label: 'All dates (existing application policy)' },
    { label: 'Month to date', from: monthStart, to: asOf },
    { label: 'Previous month', from: `${previousEnd.slice(0, 7)}-01`, to: previousEnd }
  ];
  const periods = dates.map(range => {
    const selected = operational.filter(record => isSavingsInDateRange(record, range));
    const memberRows = selected.filter(record => record.member);
    const groupRows = selected.filter(record => !record.member);
    const expected = money(selected);
    const internal = money(selected.filter(record => internalIds.has(record.id))).withdrawals;
    return {
      ...range, ...expected,
      member_owned: money(memberRows).net, group_accounts: money(groupRows).net,
      internal_debits: internal, savings_cash_movement: (Math.round(expected.net * 100) + Math.round(internal * 100)) / 100,
      independent_reconciliation: Math.round(expected.net * 100) === netCents(selected)
        && Math.round(expected.net * 100) === netCents(memberRows) + netCents(groupRows)
    };
  });
  const officers = [...new Set([
    ...members.map(m => m.assigned_officer || m.registered_by || ''),
    ...groups.map(g => g.assigned_officer || g.created_by || '')
  ])].filter(Boolean).sort().map(officer => ({ officer_id: officer,
    ...money(selectSavingsRecords(valid, { members, groups, officer }))
  }));
  const groupDifferences = groups.map(group => {
    const correct = selectSavingsRecords(valid, { members, groups, group: group.id });
    const legacy = valid.filter(record => record.group === group.id || membersById.get(record.member)?.group === group.id);
    const stored = summaries.find(summary => summary.group === group.id);
    return { group_id: group.id, group_name: group.name, status: group.status, calculated: money(correct).net,
      old_group_card: money(legacy).net, stored_summary: stored ? Number(stored.total_savings) : null,
      summary_calculated_at: stored?.last_calculated_at || null,
      records_changed_since_summary: stored?.last_calculated_at ? correct
        .filter(record => new Date(record.updated || record.created) > new Date(stored.last_calculated_at))
        .map(record => ({ id: record.id, type: record.type, amount: record.amount, effective_date: record.date, updated: record.updated })) : [] };
  }).filter(row => row.calculated !== row.old_group_card || (row.stored_summary !== null && row.calculated !== row.stored_summary));
  const oldStrictTotal = operational.reduce((sum, record) => sum + (record.type === 'deposit' ? 1 : -1) * Math.round(Number(record.amount) * 100), 0) / 100;
  const result = {
    source: baseUrl, as_of_nairobi: asOf, started, finished: new Date().toISOString(), requests,
    complete: exceptions.length === 0,
    caveat: 'Read-only sequential snapshot, not a database transaction. Does not inspect deployed UI or browser caches. Totals are provisional if exceptions exist.',
    counts: { savings: savings.length, members: members.length, groups: groups.length, reversed: savings.filter(s => s.is_reversed).length },
    periods, officers,
    officer_partition_matches: officers.reduce((sum, row) => sum + Math.round(row.net * 100), 0) === netCents(operational),
    excluded_member_lifecycle: money(valid.filter(s => s.member && !isPortfolioMember(membersById.get(s.member)))),
    future_effective_after_as_of: money(operational.filter(s => getSavingsTimestamp(s) >= Date.parse(`${asOf}T21:00:00Z`))),
    legacy_blank_type_ids: operational.filter(s => !String(s.type || '').trim()).map(s => s.id),
    old_strict_type_total: oldStrictTotal,
    transferred_member_transaction_ids: operational.filter(s => s.member && s.group && s.group !== membersById.get(s.member)?.group).map(s => s.id),
    lifecycle_group_account_exposure: money(operational.filter(s => !s.member && !isPortfolioMember(groupsById.get(s.group)))),
    missing_settlement_transaction_ids: settlements.filter(s => s.status !== 'reversed' && (!s.savings_transaction || !savings.some(record => record.id === s.savings_transaction))).map(s => s.id),
    group_differences: groupDifferences,
    updated_during_audit: [...members, ...groups, ...savings].filter(record => record.updated && new Date(record.updated) > new Date(started)).map(record => record.id),
    exceptions
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Read-only savings audit stopped: ${error.message}`);
  process.exitCode = 1;
}
