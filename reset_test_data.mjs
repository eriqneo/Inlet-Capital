import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PB_URL = 'https://inletcapital.pockethost.io';
const ADMIN_EMAIL = 'aturaerick@gmail.com';
const ADMIN_PASS = 'dGY@SrzA86PQc5n';
const CONFIRMATION = 'RESET_TEST_DATA';

const collectionsToClear = [
  'loan_repayments',
  'loan_schedule',
  'savings',
  'expenses',
  'loans',
  'members',
  'groups',
  'audit_log'
];

const protectedCollections = new Set([
  'users',
  'settings',
  'voteheads',
  'user_login_activity'
]);

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

async function collectionExists(collection, token) {
  try {
    await fetchPb(`collections/${collection}`, 'GET', null, token);
    return true;
  } catch (err) {
    if (String(err.message || '').includes('404')) return false;
    throw err;
  }
}

async function getAllRecordIds(collection, token) {
  const ids = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const result = await fetchPb(
      `collections/${collection}/records?page=${page}&perPage=${perPage}&fields=id`,
      'GET',
      null,
      token
    );
    ids.push(...(result.items || []).map(item => item.id));
    if (page >= result.totalPages || (result.items || []).length === 0) break;
    page += 1;
  }

  return ids;
}

async function deleteRecords(collection, ids, token) {
  let deleted = 0;
  for (const id of ids) {
    await fetchPb(`collections/${collection}/records/${id}`, 'DELETE', null, token);
    deleted += 1;
  }
  return deleted;
}

async function run() {
  const confirmation = process.argv[2] || '';
  if (confirmation !== CONFIRMATION) {
    throw new Error(`Refusing to reset data. Run: node reset_test_data.mjs ${CONFIRMATION}`);
  }

  for (const collection of collectionsToClear) {
    if (protectedCollections.has(collection)) {
      throw new Error(`Safety check failed: ${collection} is protected and cannot be cleared.`);
    }
  }

  console.log('Authenticating to PocketHost...');
  const auth = await fetchPb('collections/_superusers/auth-with-password', 'POST', {
    identity: ADMIN_EMAIL,
    password: ADMIN_PASS
  });
  const token = auth.token;

  console.log('Counting records before reset...');
  const beforeCounts = {};
  for (const collection of collectionsToClear) {
    if (!(await collectionExists(collection, token))) {
      beforeCounts[collection] = 'missing';
      continue;
    }
    beforeCounts[collection] = (await getAllRecordIds(collection, token)).length;
  }

  console.table(beforeCounts);
  console.log('Deleting test data in dependency-safe order...');

  const deletedCounts = {};
  for (const collection of collectionsToClear) {
    if (beforeCounts[collection] === 'missing') {
      deletedCounts[collection] = 'skipped';
      continue;
    }
    const ids = await getAllRecordIds(collection, token);
    deletedCounts[collection] = await deleteRecords(collection, ids, token);
  }

  console.log('Deleted records:');
  console.table(deletedCounts);

  console.log('Counting records after reset...');
  const afterCounts = {};
  for (const collection of collectionsToClear) {
    if (beforeCounts[collection] === 'missing') {
      afterCounts[collection] = 'missing';
      continue;
    }
    afterCounts[collection] = (await getAllRecordIds(collection, token)).length;
  }
  console.table(afterCounts);

  console.log('Protected collections were not touched: users, settings, voteheads, user_login_activity.');
  console.log('Reset complete. Clear browser IndexedDB/cache on deployed clients before entering real data.');
}

run().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
