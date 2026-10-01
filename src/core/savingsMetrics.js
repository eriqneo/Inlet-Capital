export const getSavingsTransactionType = (record = {}) => (
  String(record.type || '').trim().toLowerCase() === 'withdrawal' ? 'withdrawal' : 'deposit'
);

export const isActiveSavingsTransaction = (record = {}) => !record.is_reversed;

export const getSavingsSignedAmount = (record = {}) => {
  if (!isActiveSavingsTransaction(record)) return 0;
  const amount = Number(record.amount) || 0;
  return getSavingsTransactionType(record) === 'withdrawal' ? -amount : amount;
};

export const calculateSavingsSummary = (records = []) => records.reduce((summary, record) => {
  if (!isActiveSavingsTransaction(record)) return summary;
  const amount = Number(record.amount) || 0;
  const type = getSavingsTransactionType(record);
  if (type === 'withdrawal') summary.withdrawals += amount;
  else summary.deposits += amount;
  summary.net += type === 'withdrawal' ? -amount : amount;
  summary.count += 1;
  return summary;
}, { deposits: 0, withdrawals: 0, net: 0, count: 0 });
