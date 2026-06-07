export const MODULES = [
  { id: 'dashboard', label: 'Dashboard', path: '#/' },
  { id: 'analytics', label: 'Analytics', path: '#/analytics' },
  { id: 'members', label: 'Members', path: '#/members' },
  { id: 'groups', label: 'Groups', path: '#/groups' },
  { id: 'loans', label: 'Loans', path: '#/loans' },
  { id: 'savings', label: 'Savings', path: '#/savings' },
  { id: 'expenses', label: 'Expenses', path: '#/expenses' },
  { id: 'reports', label: 'Reports', path: '#/reports' },
  { id: 'settings', label: 'Settings', path: '#/settings' }
];

export const ROLE_MODULE_DEFAULTS = {
  super_admin: MODULES.map(module => module.id),
  admin: MODULES.map(module => module.id),
  manager: ['dashboard', 'analytics', 'members', 'groups', 'loans', 'reports'],
  loan_officer: ['dashboard', 'members', 'groups', 'loans', 'reports'],
  cashier: ['dashboard', 'members', 'savings', 'expenses'],
  group_officer: ['dashboard', 'members', 'groups'],
  auditor: ['dashboard', 'analytics', 'members', 'groups', 'reports']
};

export const getDefaultModulesForRole = (role = '') => ROLE_MODULE_DEFAULTS[role] || ['dashboard'];

export const getAssignedModules = (user = {}) => {
  if (user.role === 'super_admin') return MODULES.map(module => module.id);
  const assigned = Array.isArray(user.module_permissions) ? user.module_permissions.filter(Boolean) : [];
  return assigned.length > 0 ? assigned : getDefaultModulesForRole(user.role);
};

export const canAccessModule = (user = {}, moduleId = '') => {
  if (!moduleId || moduleId === 'dashboard') return true;
  if (user.role === 'super_admin') return true;
  return getAssignedModules(user).includes(moduleId);
};
