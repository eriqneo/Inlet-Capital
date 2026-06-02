import { pb } from './api.js';

export const savingsService = {
  /**
   * Record a new deposit or withdrawal
   * @param {Object} data 
   */
  async recordTransaction(data) {
    console.log('[savingsService] Recording transaction:', data);
    try {
      const result = await pb.collection('savings').create(data);
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
      expand: 'member,group,recorded_by'
    });
  },

  async getAllBasic({ page = 1, perPage = 50, filter = '', sort = '-date' } = {}) {
    return await pb.collection('savings').getList(page, perPage, {
      filter,
      sort
    });
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
  
  /**
   * Reverse a transaction
   */
  async reverseTransaction(id) {
    return await pb.collection('savings').update(id, {
      is_reversed: true
    });
  },

  subscribeToChanges(callback) {
    return pb.collection('savings').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('savings').unsubscribe('*');
  }
};
