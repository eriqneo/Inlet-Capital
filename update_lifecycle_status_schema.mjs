import fs from 'fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const setupSource = fs.readFileSync(new URL('./setup_collections.mjs', import.meta.url), 'utf8');

const readConst = (name) => {
  const match = setupSource.match(new RegExp(`const ${name} = '([^']+)'`));
  if (!match) throw new Error(`Could not read ${name} from setup_collections.mjs`);
  return match[1];
};

const PB_URL = readConst('PB_URL');
const ADMIN_EMAIL = readConst('ADMIN_EMAIL');
const ADMIN_PASS = readConst('ADMIN_PASS');

async function fetchPb(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;

  let res;
  try {
    res = await fetch(`${PB_URL}/api/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    console.warn(`Fetch failed for ${path}; retrying with curl...`);
    return curlPb(path, method, body, token);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`API Error ${res.status} ${path}: ${JSON.stringify(data)}`);
  }
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

const ensureSuspendedStatus = async (collectionName, token) => {
  const collection = await fetchPb(`collections/${collectionName}`, 'GET', null, token);
  const statusField = collection.fields?.find(field => field.name === 'status');
  if (!statusField) throw new Error(`${collectionName}.status field was not found`);

  const currentValues = statusField.values || [];
  if (currentValues.includes('suspended')) {
    console.log(`${collectionName}.status already allows suspended.`);
    return false;
  }

  statusField.values = [...currentValues, 'suspended'];
  await fetchPb(`collections/${collectionName}`, 'PATCH', collection, token);
  console.log(`${collectionName}.status updated: ${statusField.values.join(', ')}`);
  return true;
};

async function run() {
  console.log(`Authenticating to ${PB_URL}...`);
  const auth = await fetchPb('collections/_superusers/auth-with-password', 'POST', {
    identity: ADMIN_EMAIL,
    password: ADMIN_PASS
  });

  await ensureSuspendedStatus('groups', auth.token);
  await ensureSuspendedStatus('members', auth.token);
  console.log('Lifecycle status schema update complete.');
}

run().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
