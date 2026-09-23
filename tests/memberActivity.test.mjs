import test from 'node:test';
import assert from 'node:assert/strict';
import { getLatestSavingsDate, getMemberActivityStatus } from '../src/core/memberActivity.js';

const referenceDate = '2026-09-22T12:00:00+03:00';
const groupedMember = { id: 'member-1', group: 'group-1', status: 'active' };

test('grouped members stay active through the three-calendar-month deposit boundary', () => {
  const latest = getLatestSavingsDate([{ type: 'deposit', is_reversed: false, date: '2026-06-22T09:00:00+03:00' }]);
  assert.equal(getMemberActivityStatus(groupedMember, latest, referenceDate).isActive, true);

  const expired = getLatestSavingsDate([{ type: 'deposit', is_reversed: false, date: '2026-06-21T09:00:00+03:00' }]);
  assert.equal(getMemberActivityStatus(groupedMember, expired, referenceDate).label, 'INACTIVE');
});

test('only valid deposits establish member savings activity', () => {
  const latest = getLatestSavingsDate([
    { type: 'withdrawal', is_reversed: false, date: '2026-09-20' },
    { type: 'deposit', is_reversed: true, date: '2026-09-21' },
    { type: 'deposit', is_reversed: false, date: '2026-06-01' }
  ]);

  assert.equal(latest.toISOString().slice(0, 10), '2026-06-01');
  assert.equal(getMemberActivityStatus(groupedMember, latest, referenceDate).isActive, false);
});

test('new group members remain active during the initial three-month savings grace period', () => {
  const newGroupMember = {
    ...groupedMember,
    group_joined_at: '2026-08-01T09:00:00+03:00'
  };
  const status = getMemberActivityStatus(newGroupMember, null, referenceDate);
  assert.equal(status.label, 'ACTIVE');
  assert.equal(status.isOnboardingGrace, true);

  const expiredGrace = getMemberActivityStatus({
    ...groupedMember,
    group_joined_at: '2026-06-21T09:00:00+03:00'
  }, null, referenceDate);
  assert.equal(expiredGrace.label, 'INACTIVE');
});

test('individual members remain active without a savings requirement', () => {
  assert.equal(getMemberActivityStatus({ id: 'member-2', status: 'active' }, null, referenceDate).label, 'ACTIVE');
  assert.equal(getMemberActivityStatus({ ...groupedMember, status: 'suspended' }, new Date(), referenceDate).label, 'SUSPENDED');
});
