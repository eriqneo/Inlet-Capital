import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSavingsSummary,
  calculateSavingsPeriod,
  getSavingsSignedAmount,
  getSavingsTransactionType,
  getInternalSavingsTransactionIds,
  isSavingsInDateRange,
  selectSavingsRecords
} from '../src/core/savingsMetrics.js';

test('savings summary uses deposits less withdrawals and excludes reversals', () => {
  const result = calculateSavingsSummary([
    { type: 'deposit', amount: 1000 },
    { type: 'withdrawal', amount: 250 },
    { type: 'deposit', amount: 500, is_reversed: true }
  ]);

  assert.deepEqual(result, { deposits: 1000, withdrawals: 250, net: 750, count: 2 });
});

test('legacy transactions with a blank type remain deposits everywhere', () => {
  const legacy = { amount: '400' };
  assert.equal(getSavingsTransactionType(legacy), 'deposit');
  assert.equal(getSavingsSignedAmount(legacy), 400);
  assert.deepEqual(calculateSavingsSummary([legacy]), {
    deposits: 400,
    withdrawals: 0,
    net: 400,
    count: 1
  });
});

test('invalid amounts and unknown types block a misleading verified total', () => {
  for (const amount of ['not-a-number', null, 0, -5, Infinity, 1.005]) {
    assert.throws(() => calculateSavingsSummary([{ amount }]), /amount needs review/);
  }
  assert.throws(() => calculateSavingsSummary([{ type: 'other', amount: 100 }]), /transaction type needs review/);
});

test('legacy deposits, normalized types, reversal, IDs and cents share one calculation', () => {
  const records = [
    { id: 'a', amount: '1000', type: ' Deposit ' },
    { id: 'b', amount: 400, type: '' },
    { id: 'c', amount: 200, type: 'WITHDRAWAL' },
    { id: 'a', amount: '1000', type: ' Deposit ' },
    { id: 'd', amount: 300, is_reversed: true }
  ];
  assert.deepEqual(calculateSavingsSummary(records), { deposits: 1400, withdrawals: 200, net: 1200, count: 3 });
  assert.equal(calculateSavingsSummary([{ amount: 0.1 }, { amount: 0.2 }]).net, 0.3);
  assert.deepEqual(calculateSavingsSummary([...records].reverse()), calculateSavingsSummary(records));
});

test('newest revision of an overlapping transaction wins, including reversal', () => {
  const old = { id: 'a', amount: 400, updated: '2026-10-01' };
  const fresh = { ...old, amount: 600, updated: '2026-10-02' };
  assert.equal(calculateSavingsSummary([fresh, old]).net, 600);
  assert.equal(calculateSavingsSummary([old, { ...fresh, is_reversed: true }]).net, 0);
});

test('Nairobi date bounds include the whole day independent of device timezone', () => {
  const range = { from: '2026-10-07', to: '2026-10-07' };
  assert.equal(isSavingsInDateRange({ date: '2026-10-06T20:59:59Z' }, range), false);
  assert.equal(isSavingsInDateRange({ date: '2026-10-06T21:00:00Z' }, range), true);
  assert.equal(isSavingsInDateRange({ date: '2026-10-07 20:59:59.999Z' }, range), true);
  assert.equal(isSavingsInDateRange({ date: '2026-10-07T21:00:00Z' }, range), false);
  assert.equal(isSavingsInDateRange({ date: '2026-10-07' }, range), true);
  assert.equal(isSavingsInDateRange({ date: new Date('2026-10-07T00:00:00Z') }, range), true);
  assert.equal(isSavingsInDateRange({ created: '2026-10-07T00:00:00Z' }, range), true);
  assert.throws(() => isSavingsInDateRange({ date: 'broken', created: '2026-10-07' }, range), /transaction date/);
  assert.throws(() => isSavingsInDateRange({}, range), /transaction date/);
  assert.throws(() => selectSavingsRecords([], { from: '2026-10-08', to: '2026-10-07' }), /From date/);
  assert.throws(() => selectSavingsRecords([], { from: '2026-02-30' }), /calendar date/);
});

test('period movement does not discard opening balance from closing balance', () => {
  assert.deepEqual(calculateSavingsPeriod([
    { amount: 1000, date: '2026-09-30' },
    { amount: 2000, date: '2026-10-07' },
    { amount: 500, type: 'withdrawal', date: '2026-10-07' },
    { amount: 5000, date: '2026-10-08' }
  ], { from: '2026-10-01', to: '2026-10-07' }), {
    deposits: 2000, withdrawals: 500, net: 1500, count: 2, opening: 1000, closing: 2500
  });
});

test('member ownership, current group, lifecycle and officer scopes reconcile', () => {
  const members = [
    { id: 'individual', assigned_officer: 'A' },
    { id: 'grouped', group: 'G', assigned_officer: 'B', status: 'inactive' },
    { id: 'suspended', group: 'G', assigned_officer: 'B', status: 'suspended' }
  ];
  const groups = [{ id: 'G', assigned_officer: 'B' }];
  const records = [
    { id: 'a', member: 'individual', amount: 1000 },
    { id: 'b', member: 'grouped', group: 'old-group', amount: 1200 },
    { id: 'c', group: 'G', amount: 500 },
    { id: 'd', member: 'suspended', group: 'G', amount: 700 }
  ];
  const total = options => calculateSavingsSummary(selectSavingsRecords(records, { members, groups, ...options })).net;
  assert.equal(total({}), 2700);
  assert.equal(total({ account: 'members' }), 2200);
  assert.equal(total({ group: 'G' }), 1700);
  assert.equal(total({ group: 'G', account: 'members' }), 1200);
  assert.equal(total({ account: 'groups' }), 500);
  assert.equal(total({ group: 'old-group' }), 0);
  assert.equal(total({ officer: 'A' }), 1000);
  assert.equal(total({ officer: 'B' }), 1700);
  members[0].assigned_officer = 'B';
  assert.equal(total({ officer: 'A' }), 0);
  assert.equal(total({ officer: 'B' }), 2700);
  assert.equal(total({ lifecycle: 'history', member: 'suspended' }), 700);
  assert.throws(() => selectSavingsRecords([{ member: 'missing', amount: 50 }], { members }), /ownership/);
});

test('balance-off debit counts once while remaining distinguishable from cash', () => {
  const records = [{ id: 'dep', amount: 5000 }, { id: 'off', amount: 1100, type: 'withdrawal', payment_method: 'cash' }];
  const ids = getInternalSavingsTransactionIds([{ savings_transaction: 'off' }, { savings_transaction: 'reversed', status: 'reversed' }]);
  assert.deepEqual([...ids], ['off']);
  assert.equal(calculateSavingsSummary(records).net, 3900);
  assert.equal(calculateSavingsSummary(records.filter(record => !ids.has(record.id))).net, 5000);
  assert.equal(calculateSavingsSummary(records).deposits, 5000);
});
