import test from 'node:test';
import assert from 'node:assert/strict';
import { getParRating, PAR_RATING_DEFINITION_VERSION } from '../src/core/parRating.js';

const cases = [
  [0, 'excellent', 'Excellent', 'var(--success)'],
  [2.81, 'excellent', 'Excellent', 'var(--success)'],
  [5, 'excellent', 'Excellent', 'var(--success)'],
  [5.01, 'healthy', 'Healthy', 'var(--success)'],
  [8, 'healthy', 'Healthy', 'var(--success)'],
  [8.01, 'attention', 'Needs Attention', '#ca8a04'],
  [12, 'attention', 'Needs Attention', '#ca8a04'],
  [12.01, 'action', 'Action Required', '#f97316'],
  [15, 'action', 'Action Required', '#f97316'],
  [15.01, 'high-risk', 'High Risk', 'var(--danger)'],
  [19.99, 'high-risk', 'High Risk', 'var(--danger)'],
  [20, 'critical', 'Critical', '#991b1b'],
  [20.01, 'critical', 'Critical', '#991b1b'],
  [100, 'critical', 'Critical', '#991b1b'],
  [150, 'critical', 'Critical', '#991b1b']
];

for (const [rate, id, label, color] of cases) {
  test(`${rate}% has the agreed ${label} rating and color`, () => {
    const result = getParRating(rate);
    assert.equal(result.id, id);
    assert.equal(result.label, label);
    assert.equal(result.color, color);
    assert.equal(result.accent, color);
    assert.ok(result.detail.length > 20);
  });
}

test('missing or malformed percentages cannot be rated Excellent', () => {
  for (const rate of [null, undefined, '', '5', NaN, Infinity, -Infinity, -0.01]) {
    assert.throws(() => getParRating(rate), /finite, non-negative percentage/);
  }
});

test('ratings are immutable, versioned and use the unrounded ratio', () => {
  assert.equal(PAR_RATING_DEFINITION_VERSION, 'par-rating-v1');
  assert.ok(Object.isFrozen(getParRating(0)));
  assert.throws(() => { getParRating(0).label = 'Changed'; }, TypeError);
  assert.equal(getParRating(5 + 1e-8).id, 'healthy');
  assert.equal(getParRating(20 - 1e-8).id, 'high-risk');
});
