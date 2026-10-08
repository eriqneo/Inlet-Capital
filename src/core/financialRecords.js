export const getFinancialTimestamp = value => {
  if (value instanceof Date) return value.getTime();
  if (!value) return NaN;
  let text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const day = text.slice(0, 10);
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return NaN;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00+03:00';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text = text.replace(' ', 'T') + 'Z';
  return new Date(text).getTime();
};

export const getPortfolioCutoff = (to = '', now = new Date()) => {
  if (!to) return new Date(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Invalid portfolio cutoff date');
  const timestamp = getFinancialTimestamp(to);
  if (!Number.isFinite(timestamp) || new Date(timestamp + 3 * 3600000).toISOString().slice(0, 10) !== to) throw new Error('Invalid portfolio cutoff date');
  return new Date(timestamp + 86400000 - 1);
};

export const formatPortfolioDate = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(getFinancialTimestamp(value)));

export const financialCents = (value, label = 'Amount') => {
  const amount = value === null || value === undefined || value === '' ? 0 : Number(value);
  const cents = Math.round(amount * 100);
  if ((value != null && !['number', 'string'].includes(typeof value)) || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 0.00001) throw new Error(`${label} requires a valid non-negative amount to two decimals`);
  return cents;
};

export const selectFinancialRecords = (records = [], { cutoff, fields = ['date', 'effective_date', 'created'] } = {}) => {
  const latest = new Map();
  const anonymous = [];
  for (const record of records) {
    if (!record?.id) { anonymous.push(record); continue; }
    const prior = latest.get(record.id);
    if (!prior || getFinancialTimestamp(record.updated || record.created) > getFinancialTimestamp(prior.updated || prior.created)) latest.set(record.id, record);
    else if (prior !== record && JSON.stringify(prior) !== JSON.stringify(record) && !(getFinancialTimestamp(prior.updated || prior.created) > getFinancialTimestamp(record.updated || record.created))) throw new Error(`Conflicting financial record ${record.id}`);
  }
  const limit = cutoff ? getFinancialTimestamp(cutoff) : Infinity;
  if (cutoff && !Number.isFinite(limit)) throw new Error('Invalid financial cutoff');
  return [...latest.values(), ...anonymous].filter(record => {
    if (record?.is_reversed || record?.status === 'reversed') return false;
    const value = fields.map(field => record?.[field]).find(Boolean);
    if (!value) {
      if (record.id && cutoff && fields.length) throw new Error(`Effective financial date unavailable on ${record.id}`);
      return true;
    }
    const timestamp = getFinancialTimestamp(value);
    if (!Number.isFinite(timestamp)) throw new Error(`Invalid financial date on ${record.id || 'record'}`);
    return timestamp <= limit;
  });
};
