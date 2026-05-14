import { put, getById } from './db.js';

export const initializeData = async () => {
  // Seed an admin user if not exists
  const admin = await getById('users', 'admin');
  if (!admin) {
    await put('users', {
      id: 'admin',
      name: 'Super Admin',
      role: 'admin',
      pin: '0000'
    });
  }

  // Seed default settings
  const settingsKeys = [
    { key: 'individual_reg_fee', value: 1000 },
    { key: 'group_reg_fee', value: 1000 },
    { key: 'processing_fee_percent', value: 8 },
    { key: 'interest_rate_percent', value: 20 },
    { key: 'activation_fee', value: 200 },
    { key: 'penalty_amount', value: 500 },
    { key: 'penalty_grace_weeks', value: 4 },
    { key: 'org_name', value: 'Inlet Capital Limited' },
    { key: 'org_logo', value: '' },
    { key: 'org_address', value: 'Nairobi, Kenya' },
    { key: 'org_phone', value: '+254 700 000 000' },
    { key: 'org_email', value: 'info@inletcapital.co.ke' },
    { key: 'org_reg_no', value: 'PVT-XXXXXX' },
    { key: 'currency_symbol', value: 'KES' },
  ];

  for (const s of settingsKeys) {
    const existing = await getById('settings', s.key);
    if (!existing) {
      await put('settings', s);
    }
  }

  // Seed default voteheads
  const defaultVoteheads = [
    { id: 'salaries', name: 'Salaries', description: 'Staff wages and commissions' },
    { id: 'utilities', name: 'Utilities', description: 'Water, Electricity, Internet' },
    { id: 'stationery', name: 'Stationery', description: 'Office supplies and printing' },
    { id: 'rent', name: 'Rent', description: 'Office space rent' },
    { id: 'miscellaneous', name: 'Miscellaneous', description: 'Other expenses' },
  ];

  for (const v of defaultVoteheads) {
    const existing = await getById('voteheads', v.id);
    if (!existing) {
      await put('voteheads', v);
    }
  }
};
