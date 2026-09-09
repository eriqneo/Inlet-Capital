import fs from 'node:fs';

const source = fs.readFileSync(new URL('../setup_collections.mjs', import.meta.url), 'utf8');
const setting = name => process.env[name] || source.match(new RegExp(`const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`))?.[1];
const checkOnly = process.argv.includes('--check');
let token;
const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${setting('PB_URL')}/api/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(`Recovery schema request failed (${response.status}): ${data.message || 'Unknown error'}`);
    error.status = response.status;
    throw error;
  }
  return data;
};

try {
  token = (await request('collections/_superusers/auth-with-password', 'POST', {
    identity: setting('ADMIN_EMAIL'), password: setting('ADMIN_PASS')
  })).token;
  const loans = await request('collections/loans');
  const users = await request('collections/users');
  for (const [name, additions] of [
    ['loans', [{ name: 'renewal_date', type: 'date' }, { name: 'renewal_summary', type: 'json' }]],
    ['loan_schedule', [{ name: 'carried_fine', type: 'number', min: 0 }]]
  ]) {
    const collection = await request(`collections/${name}`);
    const missing = additions.filter(field => !collection.fields.some(existing => existing.name === field.name && existing.type === field.type));
    if (checkOnly && missing.length) throw new Error(`Missing recovery fields on ${name}. Run this script without --check.`);
    if (missing.length) await request(`collections/${name}`, 'PATCH', { fields: [...collection.fields, ...missing] });
  }
  let audit;
  try { audit = await request('collections/loan_renewals'); }
  catch (error) { if (error.status !== 404) throw error; }
  const readRule = '@request.auth.role = "super_admin" || @request.auth.role = "admin" || loan.member.assigned_officer = @request.auth.id || (loan.member.assigned_officer = "" && loan.member.registered_by = @request.auth.id) || loan.group.assigned_officer = @request.auth.id || (loan.group.assigned_officer = "" && loan.group.created_by = @request.auth.id)';
  const definition = { name: 'loan_renewals', type: 'base', listRule: readRule, viewRule: readRule,
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: 'loan', type: 'relation', collectionId: loans.id, maxSelect: 1, required: true, cascadeDelete: false },
      { name: 'recorded_by', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: false },
      { name: 'renewal_date', type: 'date', required: true },
      { name: 'reason', type: 'text', required: true, max: 2000 },
      { name: 'previous_terms', type: 'json', required: true },
      { name: 'previous_schedule', type: 'json', required: true },
      { name: 'new_terms', type: 'json', required: true }
    ] };
  if (!audit) {
    if (checkOnly) throw new Error('Missing loan_renewals collection.');
    await request('collections', 'POST', definition);
  } else {
    if ([audit.createRule, audit.updateRule, audit.deleteRule].some(rule => rule !== null)) {
      throw new Error('loan_renewals must have locked create, update, and delete API rules.');
    }
    if (definition.fields.some(field => !audit.fields.some(existing => existing.name === field.name && existing.type === field.type))) {
      throw new Error('Existing loan_renewals schema differs from the expected recovery audit schema.');
    }
  }
  console.log('Debt recovery schema verified. Upload pb_hooks/debt_recovery.pb.js and pb_hooks/lib/debtRecovery.js to PocketHost to enable renewal. No financial records changed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
