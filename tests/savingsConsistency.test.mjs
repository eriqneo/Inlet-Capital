import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSavingsConsistency, savingsDay } from '../src/core/savingsConsistency.js';
import { reviewSavingsBeforeDisbursement } from '../src/services/savingsDisbursementReview.js';

const member = { id: 'member1', group: 'group1', registration_date: '2026-06-01' };
const group = { id: 'group1', meeting_day: 'Monday', registration_date: '2026-06-01' };
const deposit = (date, amount, extra = {}) => ({ member: member.id, type: 'deposit', date, amount, ...extra });
const assess = (savings, extra = {}) => calculateSavingsConsistency({ member, group, savings, referenceDate: '2026-06-16', ...extra });

test('200 each meeting covers three weeks on time', () => {
  const result = assess([deposit('2026-06-01', 200), deposit('2026-06-08', 200), deposit('2026-06-15', 200)]);
  assert.equal(result.status, 'consistent');
  assert.equal(result.onTimeRate, 100);
  assert.equal(result.expected, 600);
  assert.equal(result.requiresReview, false);
});
test('400 catch-up covers the missed week and current week', () => {
  const result = assess([deposit('2026-06-08', 400)], { referenceDate: '2026-06-09' });
  assert.equal(result.coveredWeeks, 2);
  assert.equal(result.shortfall, 0);
  assert.equal(result.lateWeeks, 1);
  assert.equal(result.status, 'caught_up');
  assert.equal(result.onTimeRate, 50);
});
test('600 catch-up covers three weeks, preserving two late weeks', () => {
  const result = assess([deposit('2026-06-15', 600)]);
  assert.equal(result.coveredWeeks, 3);
  assert.equal(result.lateWeeks, 2);
  assert.equal(result.shortfall, 0);
  assert.equal(result.requiresReview, true);
});
test('advance deposits cover future obligations on time', () => {
  const result = assess([deposit('2026-06-01', 800)]);
  assert.equal(result.onTimeRate, 100);
  assert.equal(result.advance, 200);
});
test('split deposits and decimals allocate oldest first without rounding losses', () => {
  const result = assess([deposit('2026-06-01', 99.99), deposit('2026-06-01', 100.01), deposit('2026-06-08', 50)]);
  assert.equal(result.shortfall, 350);
  assert.equal(result.weeks[1].status, 'partial');
  assert.equal(result.weeks[1].shortfall, 150);
});
test('withdrawals, reversals, other members and future deposits do not count', () => {
  const result = assess([deposit('2026-06-01', 200), deposit('2026-06-02', 200, { type: 'withdrawal' }), deposit('2026-06-08', 200, { is_reversed: true }), deposit('2026-06-08', 200, { member: 'other' }), deposit('2026-06-20', 600)]);
  assert.equal(result.deposited, 200);
  assert.equal(result.shortfall, 400);
});
test('meeting remains payable for the whole meeting day', () => {
  const result = assess([], { referenceDate: '2026-06-01' });
  assert.equal(result.expectedWeeks, 0);
  assert.equal(result.status, 'not_due');
});
test('individual members are exempt, grouped members without a meeting day are unverifiable', () => {
  assert.equal(assess([], { member: { ...member, group: '' } }).status, 'exempt');
  assert.equal(assess([], { group: {} }).status, 'unavailable');
});
test('membership start excludes older history, imported created timestamp does not override registration', () => {
  assert.equal(assess([], { member: { ...member, created: '2026-09-01' } }).expectedWeeks, 3);
  const result = assess([deposit('2026-06-01', 600)], { member: { ...member, group_joined_at: '2026-06-09' } });
  assert.equal(result.expectedWeeks, 1);
  assert.equal(result.deposited, 0);
});
test('Nairobi midnight is stable and invalid dates are rejected', () => {
  assert.equal(savingsDay('2026-06-01T21:30:00Z'), savingsDay('2026-06-02'));
  assert.equal(savingsDay('2026-02-30'), null);
});

const reviewFixture = (overrides = {}) => {
  const api = {
    filter: () => 'member filter',
    collection: name => ({
      getOne: async () => name === 'members' ? { ...member, expand: { group } } : group,
      getFullList: async () => []
    })
  };
  return { api, loan: { member: member.id, status: 'approved' }, disbursementDate: '2026-06-16', now: new Date('2026-06-16T12:00:00Z'), getUser: () => ({ id: 'super1', role: 'super_admin', name: 'Reviewer' }), ...overrides };
};
test('only superadmins can authorize savings exceptions', async () => {
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({ getUser: () => ({ id: 'admin1', role: 'admin' }) })), /superadmin/);
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({ getUser: () => ({ role: 'loan_officer' }) })), /Only admins/);
});
test('cancel stops disbursement and continuing records reviewer, reason and shortfall', async () => {
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({ confirmException: async () => null })), { code: 'SAVINGS_REVIEW_CANCELLED' });
  const review = await reviewSavingsBeforeDisbursement(reviewFixture({ confirmException: async () => 'Emergency exception' }));
  assert.equal(review.reviewed_by, 'super1');
  assert.equal(review.assessment.shortfall, 600);
  assert.equal(review.reason, 'Emergency exception');
  assert.equal(review.overridden, true);
});
test('missing callback, empty reason, pending and future disbursement are blocked', async () => {
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture()), /review is required/);
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({ confirmException: async () => ' ' })), /reason/);
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({ loan: { member: member.id, status: 'pending' } })), /Only approved/);
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({ disbursementDate: '2026-06-20' })), /future/);
});
test('records changed while reviewing require a new decision', async () => {
  let changed = false;
  const api = reviewFixture().api;
  api.collection = name => ({
    getOne: async () => ({ ...member, expand: { group } }),
    getFullList: async () => changed ? [deposit('2026-06-15', 600)] : []
  });
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({ api, confirmException: async () => { changed = true; return 'Proceed'; } })), /changed during review/);
});
test('network failure blocks disbursement rather than treating missing savings as zero', async () => {
  const api = { collection: () => ({ getOne: async () => { throw new Error('Network unavailable'); } }) };
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({ api })), /Network unavailable/);
});

test('a consistent member needs no exception, including for ordinary admins', async () => {
  const api = reviewFixture().api;
  api.collection = () => ({
    getOne: async () => ({ ...member, expand: { group } }),
    getFullList: async () => [deposit('2026-06-01', 600)]
  });
  const result = await reviewSavingsBeforeDisbursement(reviewFixture({ api, getUser: () => ({ id: 'admin1', role: 'admin' }) }));
  assert.equal(result, null);
});
test('individual and group account loans do not inherit the member savings requirement', async () => {
  const api = { collection: () => ({ getOne: async () => ({ ...member, group: '' }) }) };
  assert.equal(await reviewSavingsBeforeDisbursement(reviewFixture({ api })), null);
  assert.equal(await reviewSavingsBeforeDisbursement(reviewFixture({ loan: { status: 'approved', group: 'group1' } })), null);
});
test('authorization changes during the warning invalidate the exception', async () => {
  let role = 'super_admin';
  await assert.rejects(reviewSavingsBeforeDisbursement(reviewFixture({
    getUser: () => ({ id: 'super1', role }),
    confirmException: async () => { role = 'admin'; return 'Proceed'; }
  })), /authorization changed/);
});
