import fs from 'fs';

const PB_URL = 'https://inletcapital.pockethost.io';
const ADMIN_EMAIL = 'aturaerick@gmail.com';
const ADMIN_PASS = 'dGY@SrzA86PQc5n';

async function fetchPb(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = token;
  
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(`${PB_URL}/api/${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`API Error ${res.status} ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function run() {
  try {
    console.log('Authenticating...');
    const auth = await fetchPb('admins/auth-with-password', 'POST', {
      identity: ADMIN_EMAIL,
      password: ADMIN_PASS
    });
    const token = auth.token;
    console.log('Token acquired.');

    // Update Users Collection to add 'role' field
    console.log('Updating users collection...');
    try {
      const usersColl = await fetchPb('collections/users', 'GET', null, token);
      usersColl.listRule = '@request.auth.role = "super_admin" || @request.auth.role = "admin"';
      usersColl.viewRule = '@request.auth.role = "super_admin" || @request.auth.role = "admin"';
      usersColl.createRule = '@request.auth.role = "super_admin"';
      usersColl.updateRule = '@request.auth.role = "super_admin"';
      usersColl.deleteRule = '@request.auth.role = "super_admin"';
      if (!usersColl.fields.some(f => f.name === 'role')) {
        usersColl.fields.push({
          name: 'role',
          type: 'select',
          required: true,
          values: ['super_admin', 'admin', 'manager', 'loan_officer', 'cashier', 'group_officer', 'auditor'],
          maxSelect: 1
        });
        console.log('Users collection updated with role field.');
      } else {
        console.log('Users collection already has role field.');
      }
      await fetchPb('collections/users', 'PATCH', usersColl, token);
      console.log('Users collection access rules updated.');
    } catch (e) {
      console.log('Error updating users:', e.message);
    }

    // Create Groups Collection
    console.log('Creating groups collection...');
    const groupsDef = {
      name: 'groups',
      type: 'base',
      fields: [
        { name: 'group_id', type: 'text', required: true, unique: true },
        { name: 'name', type: 'text', required: true },
        { name: 'meeting_day', type: 'select', maxSelect: 1, values: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
        { name: 'meeting_time', type: 'text' },
        { name: 'location', type: 'text' },
        { name: 'chairperson', type: 'text' },
        { name: 'secretary', type: 'text' },
        { name: 'treasurer', type: 'text' },
        { name: 'registration_fee', type: 'number' },
        { name: 'registration_date', type: 'date', required: true },
        { name: 'performance_rating', type: 'number' },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'dormant', 'dissolved'] },
        { name: 'created_by', type: 'relation', relationOptions: { collectionId: 'users', cascadeDelete: false } }
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.role != "auditor"',
      updateRule: '@request.auth.role != "auditor"',
      deleteRule: '@request.auth.role = "super_admin" || @request.auth.role = "admin"'
    };
    try {
      await fetchPb('collections', 'POST', groupsDef, token);
      console.log('Groups collection created.');
    } catch (e) {
      if (e.message.includes('autoupdate')) {
         console.log('Groups collection already exists.');
      } else {
         console.error(e.message);
      }
    }

    // Create Members Collection
    console.log('Creating members collection...');
    const membersDef = {
      name: 'members',
      type: 'base',
      fields: [
        { name: 'reg_no', type: 'text', required: true, unique: true },
        { name: 'full_name', type: 'text', required: true },
        { name: 'id_number', type: 'text', required: true, unique: true },
        { name: 'phone', type: 'text', required: true },
        { name: 'address', type: 'text' },
        { name: 'nok_name', type: 'text' },
        { name: 'nok_phone', type: 'text' },
        { name: 'nok_relationship', type: 'text' },
        { name: 'registration_fee', type: 'number' },
        { name: 'registration_date', type: 'date', required: true },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'dormant', 'exited'] },
        { name: 'group', type: 'relation', relationOptions: { collectionId: 'groups', cascadeDelete: false } },
        { name: 'registered_by', type: 'relation', relationOptions: { collectionId: 'users', cascadeDelete: false } }
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.role != "auditor"',
      updateRule: '@request.auth.role != "auditor"',
      deleteRule: '@request.auth.role = "super_admin" || @request.auth.role = "admin"'
    };
    try {
      await fetchPb('collections', 'POST', membersDef, token);
      console.log('Members collection created.');
    } catch (e) {
      if (e.message.includes('autoupdate')) {
         console.log('Members collection already exists.');
      } else {
         console.error(e.message);
      }
    }
    
    console.log('Done!');
  } catch (err) {
    console.error('Fatal:', err.message);
  }
}

run();
