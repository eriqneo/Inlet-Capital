import { pb } from './api.js';
import { dataCache } from './dataCache.js';
import {
  filterSavingsForCurrentOfficer,
  getCurrentOfficerId,
  getGroupOfficerId,
  getMemberOfficerId,
  getOfficerScopeCacheKey,
  getPortfolioRecordOfficerScopeFilter,
  paginateScopedItems,
  shouldScopeOfficerData,
  shouldScopeToCurrentOfficer
} from '../core/officerScope.js';

const requireAdminRecordManager = () => {
  const role = pb.authStore.model?.role;
  if (!['super_admin', 'admin'].includes(role)) {
    throw new Error('Only admins can edit or delete records.');
  }
};
const combineFilters = (...filters) => filters.filter(Boolean).map(filter => `(${filter})`).join(' && ');

export const savingsService = {
  /**
   * Record a new deposit or withdrawal
   * @param {Object} data 
   */
  async recordTransaction(data) {
    const payload = { ...data };
    if (shouldScopeToCurrentOfficer()) {
      const officerId = getCurrentOfficerId();
      if (payload.member) {
        const member = await pb.collection('members').getOne(payload.member);
        if (getMemberOfficerId(member) !== officerId) {
          throw new Error('You can only record savings for members assigned to your portfolio.');
        }
      } else if (payload.group) {
        const group = await pb.collection('groups').getOne(payload.group);
        if (getGroupOfficerId(group) !== officerId) {
          throw new Error('You can only record savings for groups assigned to your portfolio.');
        }
      } else {
        throw new Error('Select a member or group assigned to your portfolio.');
      }
      payload.recorded_by = officerId;
    }
    console.log('[savingsService] Recording transaction:', payload);
    try {
      const result = await pb.collection('savings').create(payload);
      await dataCache.invalidatePrefix('savings:');
      await dataCache.invalidatePrefix('group_summary:');
      await dataCache.invalidatePrefix('groups:profile:');
      return result;
    } catch (err) {
      console.error('[savingsService] Transaction failed:', err);
      throw err;
    }
  },

  /**
   * Get all transactions with expanded member and group details
   */
  async getAll({ page = 1, perPage = 50, filter = '', sort = '-date' } = {}) {
    if (shouldScopeOfficerData()) {
      const items = filterSavingsForCurrentOfficer(await pb.collection('savings').getFullList({
        filter: combineFilters(filter, getPortfolioRecordOfficerScopeFilter()),
        sort,
        expand: 'member,member.group,group,recorded_by'
      }));
      return paginateScopedItems(items, { page, perPage });
    }

    return await pb.collection('savings').getList(page, perPage, {
      filter,
      sort,
      expand: 'member,member.group,group,recorded_by'
    });
  },

  async getAllCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-date' } = options;
    const key = `savings:list:${getOfficerScopeCacheKey()}:${page}:${perPage}:${sort}:${filter}:expanded:v2`;
    return await dataCache.getLocalFirst(key, () => this.getAll({ page, perPage, filter, sort }), onUpdate);
  },

  async getAllBasic({ page = 1, perPage = 50, filter = '', sort = '-date' } = {}) {
    if (shouldScopeOfficerData()) {
      const items = filterSavingsForCurrentOfficer(await pb.collection('savings').getFullList({
        filter: combineFilters(filter, getPortfolioRecordOfficerScopeFilter()),
        sort,
        expand: 'member,member.group,group,recorded_by'
      }));
      return paginateScopedItems(items, { page, perPage });
    }

    return await pb.collection('savings').getList(page, perPage, {
      filter,
      sort
    });
  },

  async getAllBasicCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-date' } = options;
    const key = `savings:list:${getOfficerScopeCacheKey()}:${page}:${perPage}:${sort}:${filter}:basic`;
    return await dataCache.getLocalFirst(key, () => this.getAllBasic({ page, perPage, filter, sort }), onUpdate);
  },

  async getFullListCached({ filter = '', sort = '-date', expand = 'member,member.group,group,recorded_by', cacheKey = 'savings:all:expanded:v2' } = {}, onUpdate = null) {
    const effectiveExpand = shouldScopeOfficerData() && !expand ? 'member,member.group,group,recorded_by' : expand;
    const key = `${cacheKey}:${getOfficerScopeCacheKey()}:${sort}:${filter}:${effectiveExpand}`;
    return await dataCache.getLocalFirst(key, async () => {
      const options = { filter, sort };
      if (shouldScopeOfficerData()) options.filter = combineFilters(filter, getPortfolioRecordOfficerScopeFilter());
      if (effectiveExpand) options.expand = effectiveExpand;
      return filterSavingsForCurrentOfficer(await pb.collection('savings').getFullList(options));
    }, onUpdate);
  },

  /**
   * Get total balance for a specific member
   */
  async getMemberBalance(memberId) {
    // memberId here is the PocketBase relation ID for the member
    const records = filterSavingsForCurrentOfficer(await pb.collection('savings').getFullList({
      filter: `member="${memberId}" && is_reversed=false`,
      expand: 'member,member.group,group'
    }));
    
    return records.reduce((sum, record) => {
      return record.type === 'deposit' 
        ? sum + record.amount 
        : sum - record.amount;
    }, 0);
  },

  /**
   * Get all savings for a specific member
   */
  async getByMember(memberId) {
    return filterSavingsForCurrentOfficer(await pb.collection('savings').getFullList({
      filter: `member="${memberId}"`,
      sort: '-date',
      expand: 'member,member.group,group,recorded_by'
    }));
  },

  /**
   * Get all savings for a specific group
   */
  async getByGroup(groupId) {
    return filterSavingsForCurrentOfficer(await pb.collection('savings').getFullList({
      filter: `group="${groupId}"`,
      sort: '-date',
      expand: 'member,member.group,group,recorded_by'
    }));
  },

  async update(id, data) {
    requireAdminRecordManager();
    const record = await pb.collection('savings').update(id, data);
    await dataCache.invalidatePrefix('savings:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async delete(id) {
    requireAdminRecordManager();
    await pb.collection('savings').delete(id);
    await dataCache.invalidatePrefix('savings:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return true;
  },
  
  /**
   * Reverse a transaction
   */
  async reverseTransaction(id) {
    const record = await pb.collection('savings').update(id, {
      is_reversed: true
    });
    await dataCache.invalidatePrefix('savings:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  subscribeToChanges(callback) {
    return pb.collection('savings').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('savings').unsubscribe('*');
  }
};
