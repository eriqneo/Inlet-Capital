import { pb } from './api.js';
import { dataCache } from './dataCache.js';

export const savingsService = {
  /**
   * Record a new deposit or withdrawal
   * @param {Object} data 
   */
  async recordTransaction(data) {
    console.log('[savingsService] Recording transaction:', data);
    try {
      const result = await pb.collection('savings').create(data);
      await dataCache.invalidatePrefix('savings:');
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
    return await pb.collection('savings').getList(page, perPage, {
      filter,
      sort,
      expand: 'member,member.group,group,recorded_by'
    });
  },

  async getAllCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-date' } = options;
    const key = `savings:list:${page}:${perPage}:${sort}:${filter}:expanded:v2`;
    return await dataCache.get(key, () => this.getAll({ page, perPage, filter, sort }), onUpdate);
  },

  async getAllBasic({ page = 1, perPage = 50, filter = '', sort = '-date' } = {}) {
    return await pb.collection('savings').getList(page, perPage, {
      filter,
      sort
    });
  },

  async getAllBasicCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-date' } = options;
    const key = `savings:list:${page}:${perPage}:${sort}:${filter}:basic`;
    return await dataCache.get(key, () => this.getAllBasic({ page, perPage, filter, sort }), onUpdate);
  },

  /**
   * Get total balance for a specific member
   */
  async getMemberBalance(memberId) {
    // memberId here is the PocketBase relation ID for the member
    const records = await pb.collection('savings').getFullList({
      filter: `member="${memberId}" && is_reversed=false`,
    });
    
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
    return await pb.collection('savings').getFullList({
      filter: `member="${memberId}"`,
      sort: '-date',
      expand: 'recorded_by'
    });
  },

  /**
   * Get all savings for a specific group
   */
  async getByGroup(groupId) {
    return await pb.collection('savings').getFullList({
      filter: `group="${groupId}"`,
      sort: '-date',
      expand: 'recorded_by'
    });
  },

  async update(id, data) {
    const record = await pb.collection('savings').update(id, data);
    await dataCache.invalidatePrefix('savings:');
    return record;
  },

  async delete(id) {
    await pb.collection('savings').delete(id);
    await dataCache.invalidatePrefix('savings:');
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
    return record;
  },

  subscribeToChanges(callback) {
    return pb.collection('savings').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('savings').unsubscribe('*');
  }
};
