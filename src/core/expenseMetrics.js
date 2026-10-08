import { financialCents, getFinancialTimestamp, getPortfolioCutoff, selectFinancialRecords } from './financialRecords.js';
import { getSavingsDateBounds } from './savingsMetrics.js';

const relationId = value => typeof value === 'string' ? value : (value?.id || '');
const monthIndex = timestamp => {
  const date = new Date(timestamp + 3 * 3600000);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
};

export const calculateExpenseTrend = (records = [], { from = '', to = '', officer = '', now = new Date() } = {}) => {
  const { start } = getSavingsDateBounds({ from, to });
  const cutoff = getPortfolioCutoff(to, now);
  const scoped = records.filter(record => !officer || officer === 'all'
    || (relationId(record.recorded_by) || record.expand?.recorded_by?.id) === officer);
  const selected = selectFinancialRecords(scoped, { cutoff, fields: ['date', 'expense_date', 'created'] })
    .filter(record => start === null || getFinancialTimestamp(record.date || record.expense_date || record.created) >= start);
  let totalCents = 0;
  const monthly = new Map();
  for (const record of selected) {
    if (record.amount == null || record.amount === '') throw new Error('Expense amount unavailable');
    const cents = financialCents(record.amount, 'Expense amount');
    totalCents += cents;
    if (!Number.isSafeInteger(totalCents)) throw new Error('Expense total exceeds supported precision');
    const month = monthIndex(getFinancialTimestamp(record.date || record.expense_date || record.created));
    monthly.set(month, (monthly.get(month) || 0) + cents);
  }
  if (!selected.length) return { labels: [], amounts: [], total: 0, count: 0, interval: 'month' };

  const months = [...monthly.keys()].sort((a, b) => a - b);
  const first = from ? monthIndex(start) : months[0];
  const last = to || from ? monthIndex(cutoff.getTime()) : months[months.length - 1];
  const interval = last - first >= 24 ? 'year' : 'month';
  const labels = [], amounts = [];
  if (interval === 'year') {
    const yearly = new Map();
    for (const [month, cents] of monthly) {
      const year = Math.floor(month / 12);
      yearly.set(year, (yearly.get(year) || 0) + cents);
    }
    for (let year = Math.floor(first / 12); year <= Math.floor(last / 12); year++) {
      labels.push(String(year)); amounts.push((yearly.get(year) || 0) / 100);
    }
  } else {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' });
    for (let month = first; month <= last; month++) {
      labels.push(formatter.format(new Date(Date.UTC(Math.floor(month / 12), month % 12, 1))));
      amounts.push((monthly.get(month) || 0) / 100);
    }
  }
  return { labels, amounts, total: totalCents / 100, count: selected.length, interval };
};
