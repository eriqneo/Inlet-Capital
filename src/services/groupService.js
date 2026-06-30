import { pb } from './api.js';
import { dataCache } from './dataCache.js';

const requireAdminRecordManager = () => {
  const role = pb.authStore.model?.role;
  if (!['super_admin', 'admin'].includes(role)) {
    throw new Error('Only admins can manage group lifecycle.');
  }
};

export const groupService = {
  async list({ page = 1, perPage = 50, filter = '', sort = '-created' } = {}) {
    return await pb.collection('groups').getList(page, perPage, {
      filter,
      sort,
    });
  },

  async listCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-created' } = options;
    const key = `groups:list:${page}:${perPage}:${sort}:${filter}`;
    return await dataCache.getLocalFirst(key, () => this.list({ page, perPage, filter, sort }), onUpdate);
  },

  async getAll(onUpdate = null) {
    return await dataCache.getLocalFirst('groups:all', () => pb.collection('groups').getFullList({
      sort: 'name',
    }), onUpdate);
  },

  async getById(id) {
    return await pb.collection('groups').getOne(id);
  },

  async create(data) {
    console.log('[groupService] Creating group with data:', JSON.stringify(data, null, 2));
    try {
      const result = await pb.collection('groups').create(data);
      console.log('[groupService] Created successfully:', result);
      await dataCache.invalidatePrefix('groups:');
      return result;
    } catch (err) {
      console.error('[groupService] Create failed. Status:', err.status);
      console.error('[groupService] Response data:', JSON.stringify(err.data, null, 2));
      throw err;
    }
  },

  async update(id, data) {
    const record = await pb.collection('groups').update(id, data);
    await dataCache.invalidatePrefix('groups:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async suspend(id) {
    requireAdminRecordManager();
    const record = await pb.collection('groups').update(id, { status: 'suspended' });
    await dataCache.invalidatePrefix('groups:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async revive(id) {
    requireAdminRecordManager();
    const record = await pb.collection('groups').update(id, { status: 'active' });
    await dataCache.invalidatePrefix('groups:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async delete(id) {
    return await this.suspend(id);
  },

  subscribeToChanges(callback) {
    return pb.collection('groups').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('groups').unsubscribe('*');
  }
};
