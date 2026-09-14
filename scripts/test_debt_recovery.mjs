// Runs only against a disposable local database created by this script.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import PocketBase from 'pocketbase';
import { addMonthsPreservingDay } from '../src/core/repaymentSchedule.js';

const binary = process.env.TEST_POCKETBASE_BIN;
if (!binary) throw new Error('Set TEST_POCKETBASE_BIN to a local PocketBase executable.');
const directory = await mkdtemp(join(tmpdir(), 'inlet-recovery-test-'));
const password = randomUUID();
const rootEmail = 'root@example.test';
const base = 'http://127.0.0.1:8098';
let server;
let logs = '';
try {
  const seed = spawnSync(binary, ['superuser', 'upsert', rootEmail, password, `--dir=${directory}`, `--migrationsDir=${directory}/migrations`], { encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  server = spawn(binary, ['serve', `--http=127.0.0.1:8098`, `--dir=${directory}`, `--migrationsDir=${directory}/migrations`, `--hooksDir=${resolve('pb_hooks')}`]);
  server.stdout.on('data', data => { logs += data; });
  server.stderr.on('data', data => { logs += data; });
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Disposable PocketBase failed to start.');
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const root = new PocketBase(base);
  root.autoCancellation(false);
  await root.collection('_superusers').authWithPassword(rootEmail, password);
  const create = (name, fields, extra = {}) => root.collections.create({ name, type: 'base', fields, ...extra });
  const text = name => ({ name, type: 'text' });
  const num = name => ({ name, type: 'number' });
  const date = name => ({ name, type: 'date' });
  const relation = (name, collectionId) => ({ name, type: 'relation', collectionId, maxSelect: 1 });
  const initialUsers = await root.collections.getOne('users');
  const users = await root.collections.update(initialUsers.id, { fields: [...initialUsers.fields, text('role'), text('status')] });
  const groups = await create('groups', [text('status'), relation('assigned_officer', users.id), relation('created_by', users.id)]);
  const members = await create('members', [text('status'), relation('assigned_officer', users.id), relation('registered_by', users.id)]);
  const loans = await create('loans', [relation('member', members.id), relation('group', groups.id), text('status'), text('loan_no'),
    num('period'), num('approved_amount'), num('amount_applied'), num('interest_amount'), num('interest_rate'), num('total_liability'),
    date('disbursement_date'), date('application_date'), { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }],
  { updateRule: '@request.auth.role = "super_admin"' });
  await create('loan_schedule', [relation('loan', loans.id), num('installment_no'), num('amount'), num('paid'), date('due_date'),
    text('status'), { name: 'penalty_waived', type: 'bool' }], { updateRule: '@request.auth.role = "super_admin"' });
  await create('loan_repayments', [relation('loan', loans.id), num('amount'), num('fine_amount'), date('date')]);
  await create('loan_balance_offs', [relation('loan', loans.id), num('amount'), text('status'), date('effective_date')]);
  await create('settings', [text('key'), text('value')]);
  const setup = spawn(process.execPath, ['scripts/setup_debt_recovery.mjs'], {
    env: { ...process.env, PB_URL: base, ADMIN_EMAIL: rootEmail, ADMIN_PASS: password }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let setupOutput = '';
  setup.stdout.on('data', data => { setupOutput += data; });
  setup.stderr.on('data', data => { setupOutput += data; });
  assert.equal(await new Promise(resolve => setup.on('exit', resolve)), 0, setupOutput);
  const clients = {};
  for (const role of ['super_admin', 'admin', 'loan_officer']) {
    const email = `${role}@example.test`;
    await root.collection('users').create({ email, password, passwordConfirm: password, role, status: 'active' });
    const client = new PocketBase(base);
    client.autoCancellation(false);
    await client.collection('users').authWithPassword(email, password);
    clients[role] = client;
  }
  await root.collection('settings').create({ key: 'penalty_amount', value: '500' });
  const member = await root.collection('members').create({ status: 'active' });
  const start = new Date();
  start.setDate(start.getDate() - 100);
  const loan = await root.collection('loans').create({ member: member.id, status: 'disbursed', loan_no: 'RECOVERY-TEST',
    period: 6, amount_applied: 15000, approved_amount: 15000, interest_rate: 20, interest_amount: 3000,
    total_liability: 18000, application_date: start.toISOString(), disbursement_date: start.toISOString() });
  for (let i = 1; i <= 6; i++) await root.collection('loan_schedule').create({ loan: loan.id,
    installment_no: i, amount: 3000, paid: 0, due_date: addMonthsPreservingDay(start, i).toISOString(), status: 'pending' });
  const actionFor = (loanId, client, body) => client.send(`/api/inlet/loans/${loanId}/recovery`, { method: 'POST', body });
  const action = (client, body) => actionFor(loan.id, client, body);
  for (const role of ['admin', 'loan_officer']) await assert.rejects(action(clients[role], { action: 'preview', period: 6 }), error => error.status === 403);
  const client = clients.super_admin;
  await assert.rejects(client.collection('loans').update(loan.id, { renewal_date: new Date().toISOString() }), error => error.status === 403);
  const quote = await action(client, { action: 'preview', period: 6 });
  assert.equal(quote.interest, 3000);
  assert.ok(quote.fines > 0);
  assert.equal((await root.collection('loan_renewals').getFullList()).length, 0);
  const payment = await root.collection('loan_repayments').create({ loan: loan.id, amount: 1 });
  await assert.rejects(action(client, { action: 'renew', period: 6, fingerprint: quote.fingerprint, reason: 'Client has agreed to restart payments.' }), error => error.status === 400);
  await root.collection('loan_repayments').delete(payment.id);

  // Force a validation failure after the loan and archive writes to prove rollback.
  const schema = await root.collections.getOne('loan_schedule');
  await root.collections.update(schema.id, { fields: schema.fields.map(field => field.name === 'amount' ? { ...field, max: 4000 } : field) });
  const failingQuote = await action(client, { action: 'preview', period: 1 });
  await assert.rejects(action(client, { action: 'renew', period: 1, fingerprint: failingQuote.fingerprint, reason: 'Client has agreed to restart payments.' }));
  assert.equal((await root.collection('loans').getOne(loan.id)).renewal_date, '');
  assert.equal((await root.collection('loan_renewals').getFullList()).length, 0);
  assert.equal((await root.collection('loan_schedule').getFullList()).length, 6);
  await root.collections.update(schema.id, { fields: schema.fields });

  const duStart = new Date();
  duStart.setMonth(duStart.getMonth() - 8);
  const duLoan = await root.collection('loans').create({ member: member.id, status: 'disbursed', loan_no: 'DU-TEST',
    period: 3, amount_applied: 12000, approved_amount: 12000, interest_rate: 20, interest_amount: 2400,
    total_liability: 14400, application_date: duStart.toISOString(), disbursement_date: duStart.toISOString() });
  for (let i = 1; i <= 3; i++) await root.collection('loan_schedule').create({ loan: duLoan.id,
    installment_no: i, amount: 4800, paid: 0, due_date: addMonthsPreservingDay(duStart, i).toISOString(), status: 'pending' });
  await root.collection('loan_repayments').create({ loan: duLoan.id, amount: 4800, fine_amount: 0, date: addMonthsPreservingDay(duStart, 1).toISOString() });
  const duQuote = await actionFor(duLoan.id, client, { action: 'preview', period: 5 });
  assert.equal(duQuote.sourceUnit, 'du');
  assert.equal(duQuote.principal, 8000);
  assert.equal(duQuote.interest, 1600);
  assert.equal(duQuote.liability, 9600);

  const finalQuote = await action(client, { action: 'preview', period: 7 });
  const body = { action: 'renew', period: 7, fingerprint: finalQuote.fingerprint, reason: 'Client has agreed to restart payments.' };
  const concurrent = await Promise.allSettled([action(client, body), action(client, body)]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  const renewed = await root.collection('loans').getOne(loan.id);
  assert.equal(renewed.disbursement_date, loan.disbursement_date);
  assert.equal(renewed.application_date, loan.application_date);
  assert.equal(renewed.period, 7);
  const archive = await root.collection('loan_renewals').getFullList();
  assert.equal(archive.length, 1);
  assert.equal(archive[0].previous_schedule.length, 6);
  assert.equal(archive[0].previous_terms.period, 6);
  const installments = await root.collection('loan_schedule').getFullList({ filter: `loan="${loan.id}"` });
  assert.equal(installments.length, 7);
  assert.equal(installments.reduce((sum, row) => sum + Math.round(row.amount * 100), 0), 1800000);
  assert.equal(installments.reduce((sum, row) => sum + row.carried_fine, 0), finalQuote.fines);
  assert.equal((await root.collection('loan_repayments').getFullList({ filter: `loan="${loan.id}"` })).length, 0);
  await assert.rejects(client.collection('loan_renewals').delete(archive[0].id), error => error.status === 403);
  console.log('Recovery integration passed: roles, protected fields, quotes, payment race, rollback, concurrent renewal, archive and exact schedule totals.');
} catch (error) {
  console.error(logs.split('\n').filter(line => /ERROR|Error:|ReferenceError|TypeError/.test(line)).join('\n'));
  console.error(error.message, error.response || '');
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.on('exit', resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
