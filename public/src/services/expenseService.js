import { pb } from './api.js';

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

  /**
   * Get all expenses (for reports)
   */
  async getFullList() {
    return await pb.collection('expenses').getFullList({
      sort: '-date',
      expand: 'votehead,recorded_by'
    });
  },

  /**
   * Record new expense
   */
  async create(data) {
    return await pb.collection('expenses').create(data);
  },

  /**
   * Get all voteheads (expense categories)
   */
  async getVoteheads({ includeArchived = false } = {}) {
    const filter = includeArchived ? '' : 'status != "archived"';
    return await pb.collection('voteheads').getFullList({
      sort: 'name',
      filter
    });
  },

  /**
   * Add new votehead
   */
  async createVotehead(data) {
    if (!data.status) data.status = 'active';
    return await pb.collection('voteheads').create(data);
  },

  /**
   * Update votehead
   */
  async updateVotehead(id, data) {
    return await pb.collection('voteheads').update(id, data);
  },

  /**
   * Soft-delete votehead (archive)
   */
  async deleteVotehead(id) {
    return await pb.collection('voteheads').update(id, { status: 'archived' });
  },

  subscribeToChanges(callback) {
    return pb.collection('expenses').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('expenses').unsubscribe('*');
  }
};
