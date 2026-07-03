import { pb } from './api.js';
import { dataCache } from './dataCache.js';

const requireAdminRecordManager = () => {
  const role = pb.authStore.model?.role;
  if (role !== 'super_admin') {
    throw new Error('Only super admins can manage group lifecycle.');
  }
};

const visibleGroupFilter = 'status!="suspended" && status!="closed"';
const combineFilters = (...filters) => filters.filter(Boolean).map(filter => `(${filter})`).join(' && ');

export const groupService = {
  async list({ page = 1, perPage = 50, filter = '', sort = '-created', includeSuspended = false } = {}) {
    return await pb.collection('groups').getList(page, perPage, {
      filter: includeSuspended ? filter : combineFilters(visibleGroupFilter, filter),
      sort,
    });
  },

  async listCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-created', includeSuspended = false } = options;
    const key = `groups:list:${page}:${perPage}:${sort}:${filter}:${includeSuspended ? 'with-suspended' : 'visible'}`;
    return await dataCache.getLocalFirst(key, () => this.list({ page, perPage, filter, sort, includeSuspended }), onUpdate);
  },

  async getAll(onUpdate = null) {
    return await dataCache.getLocalFirst('groups:all:visible', () => pb.collection('groups').getFullList({
      filter: visibleGroupFilter,
      sort: 'name',
    }), onUpdate);
  },

  async getAllIncludingLifecycle(onUpdate = null) {
    return await dataCache.getLocalFirst('groups:all:including-lifecycle', () => pb.collection('groups').getFullList({
      sort: 'name',
    }), onUpdate);
  },

  async getAllIncludingSuspended(onUpdate = null) {
    return await this.getAllIncludingLifecycle(onUpdate);
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

  async close(id) {
    requireAdminRecordManager();
    const record = await pb.collection('groups').update(id, { status: 'closed' });
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
    requireAdminRecordManager();
    await pb.collection('groups').delete(id);
    await dataCache.invalidatePrefix('groups:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return true;
  },

  subscribeToChanges(callback) {
    return pb.collection('groups').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('groups').unsubscribe('*');
  }
};
