import fs from 'node:fs';

// Follow the existing maintenance scripts' configuration without duplicating credentials.
const source = fs.readFileSync(new URL('../setup_collections.mjs', import.meta.url), 'utf8');
const setting = name => process.env[name] || source.match(new RegExp(`const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`))?.[1];
const base = setting('PB_URL');
let token;
const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${base}/api/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Schema request failed (${response.status}): ${data.message || 'Unknown error'}`);
  return data;
};
try {
  token = (await request('collections/_superusers/auth-with-password', 'POST', {
    identity: setting('ADMIN_EMAIL'), password: setting('ADMIN_PASS')
  })).token;
  const collection = await request('collections/loans');
  const field = 'savings_disbursement_review';
  const fields = [...collection.fields];
  if (!fields.some(item => item.name === field)) fields.push({ name: field, type: 'json', required: false });
  const guard = '@request.body.savings_disbursement_review:isset = false || @request.auth.role = "super_admin"';
  const updateRule = collection.updateRule === null ? null : collection.updateRule.includes(guard)
    ? collection.updateRule : `(${collection.updateRule || '@request.auth.id != ""'}) && (${guard})`;
  if (!process.argv.includes('--check')) await request('collections/loans', 'PATCH', { fields, updateRule });
  const verified = await request('collections/loans');
  const ready = verified.fields.some(item => item.name === field && item.type === 'json')
    && (verified.updateRule === null || verified.updateRule.includes(guard));
  if (!ready) throw new Error('Savings review field or superadmin rule is not installed.');
  console.log('Loans schema verified: savings exception JSON field and superadmin-only review writes. No loan or savings records changed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
