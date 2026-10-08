import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoanFinancialSnapshot } from '../src/core/loanFinancialSnapshot.js';
import { getFinancialTimestamp, getPortfolioCutoff } from '../src/core/financialRecords.js';

const input = { members: [{ id: 'member1' }], groups: [], loans: [{ id: 'loan1', member: 'member1', status: 'pending' }],
  repayments: [], settlements: [], schedules: [], penaltyAmount: 500 };
test('only complete financial datasets become snapshots', () => {
  assert.equal(createLoanFinancialSnapshot(input).version, 'olb-v1');
  for (const name of ['members', 'groups', 'loans', 'repayments', 'settlements', 'schedules']) {
    assert.throws(() => createLoanFinancialSnapshot({ ...input, [name]: undefined }), /Incomplete/);
  }
  assert.throws(() => createLoanFinancialSnapshot({ ...input, members: [] }), /owner unavailable/);
});
test('cutoffs use Nairobi calendar dates regardless of device timezone', () => {
  assert.equal(getPortfolioCutoff('2026-09-30').toISOString(), '2026-09-30T20:59:59.999Z');
  assert.equal(getFinancialTimestamp('2026-09-30'), Date.parse('2026-09-29T21:00:00Z'));
  assert.equal(getFinancialTimestamp('2026-09-30 12:00:00.000'), Date.parse('2026-09-30T12:00:00Z'));
  assert.throws(() => getPortfolioCutoff('2026-02-30'), /Invalid/);
});
