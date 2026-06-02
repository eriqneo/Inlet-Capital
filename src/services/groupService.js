import { pb } from './api.js';

export const groupService = {
  async list({ page = 1, perPage = 50, filter = '', sort = '-created' } = {}) {
    return await pb.collection('groups').getList(page, perPage, {
      filter,
      sort,
    });
  },

  async getAll() {
    return await pb.collection('groups').getFullList({
      sort: 'name',
    });
  },

  async getById(id) {
    return await pb.collection('groups').getOne(id);
  },

  async create(data) {
    console.log('[groupService] Creating group with data:', JSON.stringify(data, null, 2));
    try {
      const result = await pb.collection('groups').create(data);
      console.log('[groupService] Created successfully:', result);
      return result;
    } catch (err) {
      console.error('[groupService] Create failed. Status:', err.status);
      console.error('[groupService] Response data:', JSON.stringify(err.data, null, 2));
      throw err;
    }
  },

  async update(id, data) {
    return await pb.collection('groups').update(id, data);
  },

  subscribeToChanges(callback) {
    return pb.collection('groups').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('groups').unsubscribe('*');
  }
};
