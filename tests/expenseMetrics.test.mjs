import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateExpenseTrend } from '../src/core/expenseMetrics.js';

const now = new Date('2026-10-08T12:00:00+03:00');
const records = [
  { id: 'e1', date: '2026-08-01', amount: 100.10, recorded_by: 'o1' },
  { id: 'e2', date: '2026-09-30T21:30:00Z', amount: '200.20', recorded_by: 'o1' },
  { id: 'e3', date: '2026-10-08', amount: 50, recorded_by: 'o2' }
];
test('monthly bars sum in cents and include zero months', () => {
  const result = calculateExpenseTrend(records, { now });
  assert.deepEqual(result.labels, ['Aug 2026', 'Sept 2026', 'Oct 2026']);
  assert.deepEqual(result.amounts, [100.10, 0, 250.20]);
  assert.equal(result.total, 350.30);
  assert.equal(result.count, 3);
});
test('Nairobi inclusive dates and recorded_by officer scope', () => {
  const result = calculateExpenseTrend(records, { from: '2026-10-01', to: '2026-10-01', officer: 'o1', now });
  assert.deepEqual(result.amounts, [200.20]);
  assert.equal(result.count, 1);
  assert.equal(calculateExpenseTrend(records, { officer: 'o2', now }).total, 50);
});
test('deduplicates, excludes reversals/future entries and supports legacy dates', () => {
  const result = calculateExpenseTrend([...records, { ...records[0] },
    { id: 'rev', amount: 500, date: '2026-10-01', is_reversed: true },
    { id: 'future', amount: 500, date: '2027-01-01' },
    { id: 'legacy', amount: 10, created: '2026-10-01 00:00:00.000Z' }], { now });
  assert.equal(result.total, 360.30);
  assert.equal(result.count, 4);
});
test('long ranges use annual bars without dropping old expenses', () => {
  const result = calculateExpenseTrend([{ id: 'old', amount: 100, date: '2023-01-01' }, ...records], { now });
  assert.equal(result.interval, 'year');
  assert.deepEqual(result.labels, ['2023', '2024', '2025', '2026']);
  assert.deepEqual(result.amounts, [100, 0, 0, 350.30]);
  assert.equal(result.total, 450.30);
});
test('explicit periods preserve leading/trailing zero months', () => {
  const result = calculateExpenseTrend(records, { from: '2026-07-01', to: '2026-11-30', now });
  assert.deepEqual(result.amounts, [0, 100.10, 0, 250.20, 0]);
});
test('empty data is distinct from invalid records or ranges', () => {
  assert.equal(calculateExpenseTrend([], { now }).count, 0);
  assert.throws(() => calculateExpenseTrend(records, { from: '2026-10-09', to: '2026-10-01', now }));
  for (const amount of [null, '', -1, 1.001, NaN]) {
    assert.throws(() => calculateExpenseTrend([{ id: 'bad', amount, date: '2026-10-01' }], { now }));
  }
  assert.throws(() => calculateExpenseTrend([{ id: 'bad', amount: 1, date: '2026-02-30' }], { now }));
});
