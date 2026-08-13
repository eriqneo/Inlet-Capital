import { pb } from './api.js';
import { dataCache } from './dataCache.js';
import {
  getCurrentOfficerId,
  getOfficerDataScopeId,
  getOfficerScopeCacheKey,
  shouldScopeOfficerData,
  shouldScopeToCurrentOfficer
} from '../core/officerScope.js';

const combineFilters = (...filters) => filters.filter(Boolean).map(filter => `(${filter})`).join(' && ');
const getExpenseOfficerScopeFilter = (officerId = getOfficerDataScopeId()) => officerId
  ? `recorded_by="${officerId}"`
  : '';

export const expenseService = {
  /**
   * Get paginated expense list
   */
  async getAll({ page = 1, perPage = 50, filter = '', sort = '-date' } = {}) {
    return await pb.collection('expenses').getList(page, perPage, {
      filter: combineFilters(filter, shouldScopeOfficerData() ? getExpenseOfficerScopeFilter() : ''),
      sort,
      expand: 'votehead,recorded_by'
    });
  },

  async getAllCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-date' } = options;
    const key = `expenses:list:${getOfficerScopeCacheKey()}:${page}:${perPage}:${sort}:${filter}`;
    return await dataCache.get(key, () => this.getAll({ page, perPage, filter, sort }), onUpdate);
  },

  /**
   * Get all expenses (for reports)
   */
  async getFullList({ filter = '', sort = '-date' } = {}) {
    return await pb.collection('expenses').getFullList({
      sort,
      filter: combineFilters(filter, shouldScopeOfficerData() ? getExpenseOfficerScopeFilter() : ''),
      expand: 'votehead,recorded_by'
    });
  },

  /**
   * Record new expense
   */
  async create(data) {
    const userId = getCurrentOfficerId();
    const payload = { ...data };
    if (userId && (shouldScopeToCurrentOfficer() || !payload.recorded_by)) {
      payload.recorded_by = userId;
    }
    const record = await pb.collection('expenses').create(payload);
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
