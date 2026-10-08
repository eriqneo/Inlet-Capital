import test from 'node:test';
import assert from 'node:assert/strict';
import { getArrearsRatioRating, ARREARS_RATIO_RATING_DEFINITION_VERSION } from '../src/core/arrearsRatioRating.js';
import { getParRating } from '../src/core/parRating.js';

const cases = [
  [0, 'Excellent', 'var(--success)', 'Very strong portfolio quality'],
  [2, 'Excellent', 'var(--success)', 'Very strong portfolio quality'],
  [2.01, 'Healthy', 'var(--success)', 'Good control; normal monitoring'],
  [5, 'Healthy', 'var(--success)', 'Good control; normal monitoring'],
  [5.01, 'Watch', '#ca8a04', 'Early warning; collection needs attention'],
  [8, 'Watch', '#ca8a04', 'Early warning; collection needs attention'],
  [8.01, 'Needs Attention', '#f97316', 'Elevated arrears; management action required'],
  [12, 'Needs Attention', '#f97316', 'Elevated arrears; management action required'],
  [12.01, 'High Risk', 'var(--danger)', 'Significant portfolio-quality problem'],
  [20, 'High Risk', 'var(--danger)', 'Significant portfolio-quality problem'],
  [20.01, 'Critical', '#991b1b', 'Severe arrears; urgent recovery action'],
  [100, 'Critical', '#991b1b', 'Severe arrears; urgent recovery action']
];

for (const [rate, label, color, detail] of cases) {
  test(`Arrears Ratio ${rate}% is ${label} with the agreed color and guidance`, () => {
    const result = getArrearsRatioRating(rate);
    assert.equal(result.label, label);
    assert.equal(result.color, color);
    assert.equal(result.accent, color);
    assert.equal(result.detail, detail);
  });
}

test('invalid percentages cannot present a healthy portfolio', () => {
  for (const rate of [null, undefined, '', '5', NaN, Infinity, -Infinity, -0.01]) {
    assert.throws(() => getArrearsRatioRating(rate), /finite, non-negative percentage/);
  }
});

test('Arrears Ratio policy stays separate from PAR policy', () => {
  for (const [rate, arrearsLabel, parLabel] of [
    [3, 'Healthy', 'Excellent'], [6, 'Watch', 'Healthy'],
    [13, 'High Risk', 'Action Required'], [20, 'High Risk', 'Critical']
  ]) {
    assert.equal(getArrearsRatioRating(rate).label, arrearsLabel);
    assert.equal(getParRating(rate).label, parLabel);
  }
});

test('policy is versioned, immutable and classifies the unrounded ratio', () => {
  assert.equal(ARREARS_RATIO_RATING_DEFINITION_VERSION, 'arrears-ratio-rating-v1');
  assert.ok(Object.isFrozen(getArrearsRatioRating(0)));
  assert.throws(() => { getArrearsRatioRating(0).label = 'Changed'; }, TypeError);
  assert.equal(getArrearsRatioRating(2 + 1e-8).label, 'Healthy');
  assert.equal(getArrearsRatioRating(20 + 1e-8).label, 'Critical');
});
