import { pb } from './api.js';
import { dataCache } from './dataCache.js';

export const memberCommentService = {
  async getByMember(memberId) {
    return await pb.collection('member_comments').getFullList({
      filter: `member="${memberId}"`,
      sort: '-comment_date',
      expand: 'created_by'
    });
  },

  async getByMembers(memberIds = []) {
    const uniqueIds = [...new Set(memberIds.filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const filter = uniqueIds.map(id => `member="${id}"`).join(' || ');
    return await pb.collection('member_comments').getFullList({
      filter: `(${filter})`,
      sort: '-comment_date',
      expand: 'created_by'
    });
  },

  async create(data) {
    const record = await pb.collection('member_comments').create(data);
    await dataCache.invalidatePrefix(`member_comments:${data.member}:`);
    return record;
  },

  async update(id, data) {
    const record = await pb.collection('member_comments').update(id, data);
    await dataCache.invalidatePrefix(`member_comments:${record.member || data.member}:`);
    return record;
  },

  async delete(id, memberId) {
    await pb.collection('member_comments').delete(id);
    if (memberId) await dataCache.invalidatePrefix(`member_comments:${memberId}:`);
    return true;
  }
};
