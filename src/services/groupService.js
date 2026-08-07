import { pb } from './api.js';
import { dataCache } from './dataCache.js';
import {
  filterGroupsForCurrentOfficer,
  getGroupOfficerScopeFilter,
  getOfficerScopeCacheKey,
  paginateScopedItems,
  shouldScopeOfficerData,
  shouldScopeToCurrentOfficer
} from '../core/officerScope.js';

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
    if (shouldScopeOfficerData()) {
      const items = await pb.collection('groups').getFullList({
        filter: combineFilters(includeSuspended ? '' : visibleGroupFilter, filter, getGroupOfficerScopeFilter()),
        sort,
      });
      return paginateScopedItems(items, { page, perPage });
    }

    return await pb.collection('groups').getList(page, perPage, {
      filter: includeSuspended ? filter : combineFilters(visibleGroupFilter, filter),
      sort,
    });
  },

  async listCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-created', includeSuspended = false } = options;
    const key = `groups:list:${getOfficerScopeCacheKey()}:${page}:${perPage}:${sort}:${filter}:${includeSuspended ? 'with-suspended' : 'visible'}`;
    return await dataCache.getLocalFirst(key, () => this.list({ page, perPage, filter, sort, includeSuspended }), onUpdate);
  },

  async getAll(onUpdate = null) {
    const key = `groups:all:visible:${getOfficerScopeCacheKey()}`;
    return await dataCache.getLocalFirst(key, async () => filterGroupsForCurrentOfficer(await pb.collection('groups').getFullList({
      filter: combineFilters(visibleGroupFilter, shouldScopeOfficerData() ? getGroupOfficerScopeFilter() : ''),
      sort: 'name',
    })), onUpdate);
  },

  async getAllIncludingLifecycle(onUpdate = null) {
    const key = `groups:all:including-lifecycle:${getOfficerScopeCacheKey()}`;
    return await dataCache.getLocalFirst(key, async () => filterGroupsForCurrentOfficer(await pb.collection('groups').getFullList({
      filter: shouldScopeOfficerData() ? getGroupOfficerScopeFilter() : '',
      sort: 'name',
    })), onUpdate);
  },

  async getAllIncludingSuspended(onUpdate = null) {
    return await this.getAllIncludingLifecycle(onUpdate);
  },

  async getById(id) {
    const group = await pb.collection('groups').getOne(id);
    if (shouldScopeOfficerData() && filterGroupsForCurrentOfficer([group]).length === 0) {
      throw new Error('You can only access groups assigned to your portfolio.');
    }
    return group;
  },

  async create(data) {
    const payload = shouldScopeToCurrentOfficer()
      ? { ...data, created_by: pb.authStore.model.id, assigned_officer: pb.authStore.model.id }
      : data;
    console.log('[groupService] Creating group with data:', JSON.stringify(payload, null, 2));
    try {
      const result = await pb.collection('groups').create(payload);
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
    const payload = { ...data };
    if (shouldScopeToCurrentOfficer()) {
      delete payload.created_by;
      delete payload.assigned_officer;
    }
    const record = await pb.collection('groups').update(id, payload);
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
