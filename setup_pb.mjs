import PocketBase from 'pocketbase';

const pb = new PocketBase('https://inletcapital.pockethost.io');

async function run() {
  try {
    await pb.admins.authWithPassword('aturaerick@gmail.com', 'dGY@SrzA86PQc5n');
    console.log('Authenticated as admin');

    // Create groups collection
    const collection = await pb.collections.create({
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
        { name: 'registration_fee', type: 'number', required: true },
        { name: 'registration_date', type: 'date', required: true },
        { name: 'performance_rating', type: 'number' },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'dormant', 'dissolved'] },
        { name: 'created_by', type: 'relation', relationOptions: { collectionId: '_pb_users_auth_', cascadeDelete: false }, required: true }
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.role != "auditor"',
      updateRule: '@request.auth.role != "auditor"',
      deleteRule: '@request.auth.role = "super_admin" || @request.auth.role = "admin"'
    });
    console.log('Created groups collection:', collection.id);
  } catch (err) {
    console.error('Error:', err.response || err);
  }
}

run();
