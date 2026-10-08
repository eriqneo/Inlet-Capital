export const ARREARS_RATIO_RATING_DEFINITION_VERSION = 'arrears-ratio-rating-v1';

const rating = (id, label, color, detail) => Object.freeze({ id, label, color, accent: color, detail });
const ratings = Object.freeze({
  excellent: rating('excellent', 'Excellent', 'var(--success)', 'Very strong portfolio quality'),
  healthy: rating('healthy', 'Healthy', 'var(--success)', 'Good control; normal monitoring'),
  watch: rating('watch', 'Watch', '#ca8a04', 'Early warning; collection needs attention'),
  attention: rating('attention', 'Needs Attention', '#f97316', 'Elevated arrears; management action required'),
  highRisk: rating('high-risk', 'High Risk', 'var(--danger)', 'Significant portfolio-quality problem'),
  critical: rating('critical', 'Critical', '#991b1b', 'Severe arrears; urgent recovery action')
});

export const getArrearsRatioRating = (rate) => {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
    throw new Error('Arrears Ratio rating requires a finite, non-negative percentage');
  }
  if (rate > 20) return ratings.critical;
  if (rate > 12) return ratings.highRisk;
  if (rate > 8) return ratings.attention;
  if (rate > 5) return ratings.watch;
  if (rate > 2) return ratings.healthy;
  return ratings.excellent;
};
