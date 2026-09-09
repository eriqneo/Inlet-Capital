import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGroupSavingsPerformance } from '../src/core/groupSavingsPerformance.js';

const group = { id: 'group1', meeting_day: 'Monday', registration_date: '2026-06-01' };
const members = Array.from({ length: 10 }, (_, index) => ({
  id: `member${index + 1}`,
  group: group.id,
  registration_date: '2026-06-01'
}));
const deposit = (member, date, amount, extra = {}) => ({
  member,
  group: group.id,
  type: 'deposit',
  date,
  amount,
  ...extra
});

test('rates group savings performance by contributed amount against expected weekly target', () => {
  const savings = members.map(member => deposit(member.id, '2026-06-28', 800));
  const result = calculateGroupSavingsPerformance({
    group,
    members,
    savings,
    periodStartDate: '2026-06-01',
    referenceDate: '2026-06-28'
  });

  assert.equal(result.meetingCycles, 4);
  assert.equal(result.expectedParticipations, 40);
  assert.equal(result.expectedAmount, 8000);
  assert.equal(result.contributedAmount, 8000);
  assert.equal(result.contributionRate, 100);
  assert.equal(result.rating, 5);
});

test('date range changes expected amount and rating', () => {
  const savings = [
    deposit('member1', '2026-06-01', 200),
    deposit('member2', '2026-06-08', 200)
  ];
  const result = calculateGroupSavingsPerformance({
    group,
    members: members.slice(0, 2),
    savings,
    periodStartDate: '2026-06-01',
    referenceDate: '2026-06-14'
  });

  assert.equal(result.meetingCycles, 2);
  assert.equal(result.expectedAmount, 800);
  assert.equal(result.contributedAmount, 400);
  assert.equal(result.contributionRate, 50);
  assert.equal(result.rating, 2);
});

test('ignores withdrawals, reversed savings, group account savings and suspended members passed out by caller', () => {
  const result = calculateGroupSavingsPerformance({
    group,
    members: members.slice(0, 1),
    savings: [
      deposit('member1', '2026-06-01', 200),
      deposit('member1', '2026-06-02', 200, { type: 'withdrawal' }),
      deposit('member1', '2026-06-08', 200, { is_reversed: true }),
      deposit('', '2026-06-08', 200)
    ],
    periodStartDate: '2026-06-01',
    referenceDate: '2026-06-14'
  });

  assert.equal(result.expectedAmount, 400);
  assert.equal(result.contributedAmount, 200);
  assert.equal(result.rating, 2);
});
