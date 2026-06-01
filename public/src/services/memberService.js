import { pb } from './api.js';

export const memberService = {
  async list({ page = 1, perPage = 20, filter = '', sort = '-created' } = {}) {
    return await pb.collection('members').getList(page, perPage, {
      filter,
      sort,
      expand: 'group',
    });
  },

  async getAll() {
    return await pb.collection('members').getFullList({
      expand: 'group',
      sort: '-created'
    });
  },

  async getById(id) {
    return await pb.collection('members').getOne(id, {
      expand: 'group',
    });
  },

  async getByRegNo(regNo) {
    return await pb.collection('members').getFirstListItem(`reg_no = "${regNo}"`, {
      expand: 'group'
    });
  },

  async create(data) {
    return await pb.collection('members').create(data);
  },

  async update(id, data) {
    return await pb.collection('members').update(id, data);
  },

  async getSavingsBalance(memberId) {
    // We will calculate this dynamically from savings_transactions
    // For now, if collection is not ready, return 0 or mock
    try {
      const deposits = await pb.collection('savings_transactions').getFullList({
        filter: `member = "${memberId}" && type = "deposit" && is_reversed = false`,
      });
      const withdrawals = await pb.collection('savings_transactions').getFullList({
        filter: `member = "${memberId}" && type = "withdrawal" && is_reversed = false`,
      });
      const totalIn = deposits.reduce((sum, t) => sum + t.amount, 0);
      const totalOut = withdrawals.reduce((sum, t) => sum + t.amount, 0);
      return totalIn - totalOut;
    } catch (e) {
      console.warn("Savings transactions not available yet, returning 0 for balance.", e);
      return 0;
    }
  },

  subscribeToChanges(callback) {
    return pb.collection('members').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('members').unsubscribe('*');
  }
};
