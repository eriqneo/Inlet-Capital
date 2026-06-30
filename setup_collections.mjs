import fs from 'fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PB_URL = 'https://inletcapital.pockethost.io';
const ADMIN_EMAIL = 'aturaerick@gmail.com';
const ADMIN_PASS = 'dGY@SrzA86PQc5n';

async function fetchPb(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = token;
  
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  
  let res;
  try {
    res = await fetch(`${PB_URL}/api/${path}`, options);
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

async function run() {
  try {
    console.log('Authenticating...');
    const auth = await fetchPb('collections/_superusers/auth-with-password', 'POST', {
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
      usersColl.updateRule = '@request.auth.role = "super_admin" || (@request.auth.id = id && @request.body.role:isset = false && @request.body.status:isset = false && @request.body.email:isset = false && @request.body.emailVisibility:isset = false && @request.body.verified:isset = false && @request.body.name:isset = false && @request.body.module_permissions:isset = false)';
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
      if (!usersColl.fields.some(f => f.name === 'status')) {
        usersColl.fields.push({
          name: 'status',
          type: 'select',
          required: false,
          values: ['active', 'suspended'],
          maxSelect: 1
        });
        console.log('Users collection updated with status field.');
      } else {
        console.log('Users collection already has status field.');
      }
      if (!usersColl.fields.some(f => f.name === 'force_password_change')) {
        usersColl.fields.push({
          name: 'force_password_change',
          type: 'bool',
          required: false
        });
        console.log('Users collection updated with force_password_change field.');
      } else {
        console.log('Users collection already has force_password_change field.');
      }
      if (!usersColl.fields.some(f => f.name === 'password_changed_at')) {
        usersColl.fields.push({
          name: 'password_changed_at',
          type: 'date',
          required: false
        });
        console.log('Users collection updated with password_changed_at field.');
      } else {
        console.log('Users collection already has password_changed_at field.');
      }
      if (!usersColl.fields.some(f => f.name === 'module_permissions')) {
        usersColl.fields.push({
          name: 'module_permissions',
          type: 'json',
          required: false
        });
        console.log('Users collection updated with module_permissions field.');
      } else {
        console.log('Users collection already has module_permissions field.');
      }
      await fetchPb('collections/users', 'PATCH', usersColl, token);
      console.log('Users collection access rules updated.');
    } catch (e) {
      console.log('Error updating users:', e.message);
    }

    // Create Groups Collection
    console.log('Creating groups collection...');
    const usersForGroupsColl = await fetchPb('collections/users', 'GET', null, token);
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
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'dormant', 'suspended', 'dissolved'] },
        { name: 'created_by', type: 'relation', collectionId: usersForGroupsColl.id, cascadeDelete: false, maxSelect: 1 }
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
      if (e.message.includes('autoupdate') || e.message.includes('validation_collection_name_exists')) {
         console.log('Groups collection already exists.');
         try {
           const groupsColl = await fetchPb('collections/groups', 'GET', null, token);
           const statusField = groupsColl.fields.find(f => f.name === 'status');
           if (statusField && !statusField.values.includes('suspended')) {
             statusField.values = Array.from(new Set([...(statusField.values || []), 'suspended']));
             await fetchPb('collections/groups', 'PATCH', groupsColl, token);
             console.log('Groups collection updated with suspended status.');
           }
         } catch (updateErr) {
           console.log('Could not update groups status values:', updateErr.message);
         }
      } else {
         console.error(e.message);
      }
    }

    // Create Members Collection
    console.log('Creating members collection...');
    const groupsForMembersColl = await fetchPb('collections/groups', 'GET', null, token);
    const usersForMembersColl = await fetchPb('collections/users', 'GET', null, token);
    const membersDef = {
      name: 'members',
      type: 'base',
      fields: [
        { name: 'reg_no', type: 'text', required: true, unique: true },
        { name: 'full_name', type: 'text', required: true },
        { name: 'id_number', type: 'text', required: true, unique: true },
        { name: 'phone', type: 'text', required: true, unique: true },
        { name: 'phone_number', type: 'text', unique: true },
        { name: 'dob', type: 'date' },
        { name: 'date_of_birth', type: 'date' },
        { name: 'maritalStatus', type: 'text' },
        { name: 'marital_status', type: 'text' },
        { name: 'childrenCount', type: 'number' },
        { name: 'children_count', type: 'number' },
        { name: 'kraPin', type: 'text' },
        { name: 'passportPhoto', type: 'text' },
        { name: 'passport_photo', type: 'file', maxSelect: 1, maxSize: 524288, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
        { name: 'address', type: 'text' },
        { name: 'nok_name', type: 'text' },
        { name: 'nok_phone', type: 'text' },
        { name: 'nok_relationship', type: 'text' },
        { name: 'registration_fee', type: 'number' },
        { name: 'registration_fee_details', type: 'json' },
        { name: 'registration_date', type: 'date', required: true },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'dormant', 'suspended', 'exited'] },
        { name: 'group', type: 'relation', collectionId: groupsForMembersColl.id, cascadeDelete: false, maxSelect: 1 },
        { name: 'registered_by', type: 'relation', collectionId: usersForMembersColl.id, cascadeDelete: false, maxSelect: 1 }
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
      if (e.message.includes('autoupdate') || e.message.includes('validation_collection_name_exists')) {
         console.log('Members collection already exists.');
         try {
           const membersColl = await fetchPb('collections/members', 'GET', null, token);
           const statusField = membersColl.fields.find(f => f.name === 'status');
           if (statusField && !statusField.values.includes('suspended')) {
             statusField.values = Array.from(new Set([...(statusField.values || []), 'suspended']));
             await fetchPb('collections/members', 'PATCH', membersColl, token);
             console.log('Members collection updated with suspended status.');
           }
         } catch (updateErr) {
           console.log('Could not update members status values:', updateErr.message);
         }
      } else {
         console.error(e.message);
      }
    }

    console.log('Ensuring group summary collection...');
    try {
      const groupsColl = await fetchPb('collections/groups', 'GET', null, token);
      const groupSummaryDef = {
        name: 'group_summary',
        type: 'base',
        fields: [
          { name: 'group', type: 'relation', required: true, unique: true, collectionId: groupsColl.id, cascadeDelete: true, maxSelect: 1 },
          { name: 'member_count', type: 'number' },
          { name: 'total_savings', type: 'number' },
          { name: 'outstanding_loan', type: 'number' },
          { name: 'total_arrears', type: 'number' },
          { name: 'members_in_arrears', type: 'number' },
          { name: 'inactive_members', type: 'number' },
          { name: 'last_calculated_at', type: 'date' }
        ],
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.role != "auditor"',
        updateRule: '@request.auth.role != "auditor"',
        deleteRule: '@request.auth.role = "super_admin" || @request.auth.role = "admin"'
      };

      try {
        await fetchPb('collections', 'POST', groupSummaryDef, token);
        console.log('Group summary collection created.');
      } catch (createErr) {
        if (!createErr.message.includes('validation_collection_name_exists')) throw createErr;
        const summaryColl = await fetchPb('collections/group_summary', 'GET', null, token);
        let changed = false;
        const existingFieldNames = new Set(summaryColl.fields.map(field => field.name));
        groupSummaryDef.fields.forEach(field => {
          if (!existingFieldNames.has(field.name)) {
            summaryColl.fields.push(field);
            changed = true;
          }
        });
        ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].forEach(ruleName => {
          if (summaryColl[ruleName] !== groupSummaryDef[ruleName]) {
            summaryColl[ruleName] = groupSummaryDef[ruleName];
            changed = true;
          }
        });
        if (changed) {
          await fetchPb('collections/group_summary', 'PATCH', summaryColl, token);
          console.log('Group summary collection updated.');
        } else {
          console.log('Group summary collection already configured.');
        }
      }
    } catch (e) {
      console.log('Error ensuring group summary collection:', e.message);
    }

    console.log('Ensuring members profile fields...');
    try {
      const membersColl = await fetchPb('collections/members', 'GET', null, token);
      const profileFields = [
        { name: 'phone_number', type: 'text' },
        { name: 'dob', type: 'date' },
        { name: 'date_of_birth', type: 'date' },
        { name: 'maritalStatus', type: 'text' },
        { name: 'marital_status', type: 'text' },
        { name: 'childrenCount', type: 'number' },
        { name: 'children_count', type: 'number' },
        { name: 'kraPin', type: 'text' },
        { name: 'passportPhoto', type: 'text' },
        { name: 'passport_photo', type: 'file', maxSelect: 1, maxSize: 524288, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
        { name: 'registration_fee_details', type: 'json' }
      ];
      const existingFieldNames = new Set(membersColl.fields.map(field => field.name));
      const missingFields = profileFields.filter(field => !existingFieldNames.has(field.name));
      if (missingFields.length > 0) {
        membersColl.fields.push(...missingFields);
        await fetchPb('collections/members', 'PATCH', membersColl, token);
        console.log(`Members collection updated with: ${missingFields.map(field => field.name).join(', ')}`);
      } else {
        console.log('Members collection already has profile fields.');
      }
    } catch (e) {
      console.log('Error updating members profile fields:', e.message);
    }

    console.log('Ensuring member unique identity fields...');
    try {
      const membersColl = await fetchPb('collections/members', 'GET', null, token);
      let changed = false;
      for (const fieldName of ['id_number', 'phone', 'phone_number']) {
        const field = membersColl.fields.find(item => item.name === fieldName);
        if (field && !field.unique) {
          field.unique = true;
          changed = true;
        }
      }
      if (changed) {
        await fetchPb('collections/members', 'PATCH', membersColl, token);
        console.log('Members collection unique constraints updated for ID and phone fields.');
      } else {
        console.log('Members collection already has unique ID/phone fields.');
      }
    } catch (e) {
      console.log('Error updating members unique fields:', e.message);
    }

    console.log('Ensuring settings file field...');
    try {
      const settingsColl = await fetchPb('collections/settings', 'GET', null, token);
      if (!settingsColl.fields.some(field => field.name === 'file_value')) {
        settingsColl.fields.push({
          name: 'file_value',
          type: 'file',
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
        });
        await fetchPb('collections/settings', 'PATCH', settingsColl, token);
        console.log('Settings collection updated with file_value field.');
      } else {
        console.log('Settings collection already has file_value field.');
      }
    } catch (e) {
      console.log('Error updating settings file field:', e.message);
    }

    console.log('Ensuring loan approval comment field...');
    try {
      const loansColl = await fetchPb('collections/loans', 'GET', null, token);
      let changed = false;
      if (!loansColl.fields.some(field => field.name === 'approval_comment')) {
        loansColl.fields.push({
          name: 'approval_comment',
          type: 'text',
          required: false
        });
        changed = true;
        console.log('Loans collection updated with approval_comment field.');
      } else {
        console.log('Loans collection already has approval_comment field.');
      }
      if (!loansColl.fields.some(field => field.name === 'processing_fee_rate')) {
        loansColl.fields.push({
          name: 'processing_fee_rate',
          type: 'number',
          required: false
        });
        changed = true;
        console.log('Loans collection updated with processing_fee_rate field.');
      } else {
        console.log('Loans collection already has processing_fee_rate field.');
      }
      if (changed) await fetchPb('collections/loans', 'PATCH', loansColl, token);
    } catch (e) {
      console.log('Error updating loans extra fields:', e.message);
    }

    console.log('Ensuring user login activity collection...');
    try {
      const usersColl = await fetchPb('collections/users', 'GET', null, token);
      const loginActivityDef = {
        name: 'user_login_activity',
        type: 'base',
        fields: [
          { name: 'user', type: 'relation', required: true, collectionId: usersColl.id, cascadeDelete: true, maxSelect: 1 },
          { name: 'login_at', type: 'date', required: true },
          { name: 'user_email', type: 'text' },
          { name: 'user_name', type: 'text' }
        ],
        listRule: '@request.auth.role = "super_admin" || @request.auth.role = "admin"',
        viewRule: '@request.auth.role = "super_admin" || @request.auth.role = "admin"',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.role = "super_admin"',
        deleteRule: '@request.auth.role = "super_admin"'
      };

      try {
        await fetchPb('collections', 'POST', loginActivityDef, token);
        console.log('User login activity collection created.');
      } catch (createErr) {
        if (!createErr.message.includes('validation_collection_name_exists')) throw createErr;
        const activityColl = await fetchPb('collections/user_login_activity', 'GET', null, token);
        let changed = false;
        const existingFieldNames = new Set(activityColl.fields.map(field => field.name));
        loginActivityDef.fields.forEach(field => {
          if (!existingFieldNames.has(field.name)) {
            activityColl.fields.push(field);
            changed = true;
          }
        });
        ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].forEach(ruleName => {
          if (activityColl[ruleName] !== loginActivityDef[ruleName]) {
            activityColl[ruleName] = loginActivityDef[ruleName];
            changed = true;
          }
        });
        if (changed) {
          await fetchPb('collections/user_login_activity', 'PATCH', activityColl, token);
          console.log('User login activity collection updated.');
        } else {
          console.log('User login activity collection already configured.');
        }
      }
    } catch (e) {
      console.log('Error ensuring user login activity collection:', e.message);
    }
    
    console.log('Done!');
  } catch (err) {
    console.error('Fatal:', err.message);
  }
}

run();
