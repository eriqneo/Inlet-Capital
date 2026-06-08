import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PB_URL = 'https://inletcapital.pockethost.io';
const ADMIN_EMAIL = 'aturaerick@gmail.com';
const ADMIN_PASS = 'dGY@SrzA86PQc5n';

async function fetchPb(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${PB_URL}/api/${path}`, options);
  } catch {
    return curlPb(path, method, body, token);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API Error ${res.status} ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function curlPb(path, method = 'GET', body = null, token = null) {
  const args = [
    '-sS',
    '-X', method,
    `${PB_URL}/api/${path}`,
    '-H', 'Content-Type: application/json'
  ];
  if (token) args.push('-H', `Authorization: ${token}`);
  if (body) args.push('-d', JSON.stringify(body));
  args.push('-w', '\n%{http_code}');

  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
  const lines = stdout.trim().split('\n');
  const status = Number(lines.pop());
  const rawBody = lines.join('\n');
  const data = rawBody ? JSON.parse(rawBody) : {};
  if (status < 200 || status >= 300) {
    throw new Error(`API Error ${status} ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function updateCollectionRules(name, rules) {
  const collection = await fetchPb(`collections/${name}`, 'GET', null, token);
  Object.assign(collection, rules);
  await fetchPb(`collections/${name}`, 'PATCH', collection, token);
  console.log(`${name} rules repaired.`);
}

console.log('Authenticating to PocketHost...');
const auth = await fetchPb('collections/_superusers/auth-with-password', 'POST', {
  identity: ADMIN_EMAIL,
  password: ADMIN_PASS
});
const token = auth.token;

const appUserCanRead = '@request.auth.id != ""';
const expenseWriter = '@request.auth.role = "super_admin" || @request.auth.role = "admin" || @request.auth.role = "cashier"';
const voteheadManager = '@request.auth.role = "super_admin" || @request.auth.role = "admin"';

await updateCollectionRules('expenses', {
  listRule: appUserCanRead,
  viewRule: appUserCanRead,
  createRule: expenseWriter,
  updateRule: expenseWriter,
  deleteRule: '@request.auth.role = "super_admin" || @request.auth.role = "admin"'
});

await updateCollectionRules('voteheads', {
  listRule: appUserCanRead,
  viewRule: appUserCanRead,
  createRule: voteheadManager,
  updateRule: voteheadManager,
  deleteRule: '@request.auth.role = "super_admin" || @request.auth.role = "admin"'
});

console.log('Expense module rules are ready for app users.');
