import { pb } from './api.js';
import { dataCache } from './dataCache.js';

export const expenseService = {
  /**
   * Get paginated expense list
   */
  async getAll({ page = 1, perPage = 50, filter = '', sort = '-date' } = {}) {
    return await pb.collection('expenses').getList(page, perPage, {
      filter,
      sort,
      expand: 'votehead,recorded_by'
    });
  },

  async getAllCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-date' } = options;
    const key = `expenses:list:${page}:${perPage}:${sort}:${filter}`;
    return await dataCache.get(key, () => this.getAll({ page, perPage, filter, sort }), onUpdate);
  },

  /**
   * Get all expenses (for reports)
   */
  async getFullList({ filter = '', sort = '-date' } = {}) {
    return await pb.collection('expenses').getFullList({
      sort,
      filter,
      expand: 'votehead,recorded_by'
    });
  },

  /**
   * Record new expense
   */
  async create(data) {
    const record = await pb.collection('expenses').create(data);
    await dataCache.invalidatePrefix('expenses:');
    return record;
  },

  /**
   * Get all voteheads (expense categories)
   */
  async getVoteheads({ includeArchived = false } = {}) {
    const key = `voteheads:${includeArchived ? 'all' : 'active'}`;
    return await dataCache.get(key, async () => {
      try {
        const filter = includeArchived ? '' : 'status != "archived"';
        return await pb.collection('voteheads').getFullList({
          sort: 'name',
          filter
        });
      } catch (err) {
        // Fallback if the 'status' field doesn't exist in the PocketBase schema yet
        if (err.status === 400) {
          return await pb.collection('voteheads').getFullList({
            sort: 'name'
          });
        }
        throw err;
      }
    });
  },

  /**
   * Add new votehead
   */
  async createVotehead(data) {
    if (!data.status) data.status = 'active';
    const record = await pb.collection('voteheads').create(data);
    await dataCache.invalidatePrefix('voteheads:');
    return record;
  },

  /**
   * Update votehead
   */
  async updateVotehead(id, data) {
    const record = await pb.collection('voteheads').update(id, data);
    await dataCache.invalidatePrefix('voteheads:');
    return record;
  },

  /**
   * Soft-delete votehead (archive)
   */
  async deleteVotehead(id) {
    const record = await pb.collection('voteheads').update(id, { status: 'archived' });
    await dataCache.invalidatePrefix('voteheads:');
    return record;
  },

  subscribeToChanges(callback) {
    return pb.collection('expenses').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('expenses').unsubscribe('*');
  }
};
