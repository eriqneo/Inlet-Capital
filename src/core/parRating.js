export const PAR_RATING_DEFINITION_VERSION = 'par-rating-v1';

const rating = (id, label, color, detail) => Object.freeze({ id, label, color, accent: color, detail });
const ratings = Object.freeze({
  excellent: rating('excellent', 'Excellent', 'var(--success)',
    'Strong portfolio quality. Portfolio is well controlled; maintain follow-up discipline.'),
  healthy: rating('healthy', 'Healthy', 'var(--success)',
    'Normal monitoring required. Follow up emerging arrears early.'),
  attention: rating('attention', 'Needs Attention', '#ca8a04',
    'Early warning: intensify borrower follow-up and prevent further aging. Monitor closely; identify causes and vulnerable loans.'),
  action: rating('action', 'Action Required', '#f97316',
    'Immediate collection attention required. Prioritize affected accounts.'),
  highRisk: rating('high-risk', 'High Risk', 'var(--danger)',
    'Urgent recovery required. Escalate problematic accounts and stop further deterioration. Management intervention and portfolio review required.'),
  critical: rating('critical', 'Critical', '#991b1b',
    'Immediate recovery intervention. Senior escalation required. Urgent management review, recovery plan and risk controls.')
});

export const getParRating = (rate) => {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
    throw new Error('PAR rating requires a finite, non-negative percentage');
  }
  // Shared endpoints belong to the lower band, except 20% starts Critical.
  if (rate >= 20) return ratings.critical;
  if (rate > 15) return ratings.highRisk;
  if (rate > 12) return ratings.action;
  if (rate > 8) return ratings.attention;
  if (rate > 5) return ratings.healthy;
  return ratings.excellent;
};
