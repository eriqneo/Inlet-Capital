import { pb } from './api.js';
import { dataCache } from './dataCache.js';
import {
  filterMembersForCurrentOfficer,
  getMemberOfficerScopeFilter,
  getOfficerScopeCacheKey,
  paginateScopedItems,
  shouldScopeOfficerData,
  shouldScopeToCurrentOfficer
} from '../core/officerScope.js';

const normalizePhone = (value = '') => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) digits = `0${digits.slice(3)}`;
  if (digits.startsWith('1') && digits.length === 10) digits = `0${digits}`;
  return digits;
};

const normalizeIdNumber = (value = '') => String(value || '').trim().toLowerCase();

const getPrimaryPhone = (record = {}) => record.phone_number || record.phone || '';
const visibleMemberFilter = 'status!="suspended" && status!="closed"';
const combineFilters = (...filters) => filters.filter(Boolean).map(filter => `(${filter})`).join(' && ');
const requireSuperAdminLifecycleManager = () => {
  if (pb.authStore.model?.role !== 'super_admin') {
    throw new Error('Only super admins can manage member lifecycle.');
  }
};

const toMemberPayload = (data = {}) => {
  if (!data.passportPhotoFile) return data;
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (key === 'passportPhotoFile') return;
    if (key === 'passportPhoto') return;
    if (value === undefined || value === null) return;
    formData.append(key, value);
  });
  formData.append('passport_photo', data.passportPhotoFile, data.passportPhotoFile.name || 'passport-photo.webp');
  return formData;
};

const stripOptionalRegistrationFeeDetails = (data) => {
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'registration_fee_details')) return data;
  const clone = { ...data };
  delete clone.registration_fee_details;
  return clone;
};

export const memberService = {
  async list({ page = 1, perPage = 20, filter = '', sort = '-created' } = {}) {
    if (shouldScopeOfficerData()) {
      const items = await pb.collection('members').getFullList({
        filter: combineFilters(visibleMemberFilter, filter, getMemberOfficerScopeFilter()),
        sort,
        expand: 'group',
      });
      return paginateScopedItems(items, { page, perPage });
    }

    return await pb.collection('members').getList(page, perPage, {
      filter: combineFilters(visibleMemberFilter, filter),
      sort,
      expand: 'group',
    });
  },

  async listCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 20, filter = '', sort = '-created' } = options;
    const key = `members:list:${getOfficerScopeCacheKey()}:${page}:${perPage}:${sort}:${filter}`;
    return await dataCache.getLocalFirst(key, () => this.list({ page, perPage, filter, sort }), onUpdate);
  },

  async getAll(onUpdate = null) {
    const key = `members:all:visible:${getOfficerScopeCacheKey()}`;
    return await dataCache.getLocalFirst(key, async () => filterMembersForCurrentOfficer(await pb.collection('members').getFullList({
      filter: combineFilters(visibleMemberFilter, shouldScopeOfficerData() ? getMemberOfficerScopeFilter() : ''),
      expand: 'group',
      sort: '-created'
    })), onUpdate);
  },

  async getAllIncludingLifecycle(onUpdate = null) {
    const key = `members:all:including-lifecycle:${getOfficerScopeCacheKey()}`;
    return await dataCache.getLocalFirst(key, async () => filterMembersForCurrentOfficer(await pb.collection('members').getFullList({
      filter: shouldScopeOfficerData() ? getMemberOfficerScopeFilter() : '',
      expand: 'group',
      sort: '-created'
    })), onUpdate);
  },

  async getById(id) {
    const member = await pb.collection('members').getOne(id, {
      expand: 'group',
    });
    if (shouldScopeOfficerData() && filterMembersForCurrentOfficer([member]).length === 0) {
      throw new Error('You can only access members assigned to your portfolio.');
    }
    return member;
  },

  async getByRegNo(regNo) {
    const member = await pb.collection('members').getFirstListItem(`reg_no = "${regNo}"`, {
      expand: 'group'
    });
    if (shouldScopeOfficerData() && filterMembersForCurrentOfficer([member]).length === 0) {
      throw new Error('You can only access members assigned to your portfolio.');
    }
    return member;
  },

  async create(data) {
    const payload = shouldScopeToCurrentOfficer()
      ? { ...data, registered_by: pb.authStore.model.id, assigned_officer: pb.authStore.model.id }
      : data;
    const duplicate = await this.findDuplicatePrincipalIdentifiers(payload);
    if (duplicate) {
      throw new Error(`${duplicate.field} already belongs to ${duplicate.memberName}. A principal member cannot be registered twice.`);
    }
    let record;
    try {
      record = await pb.collection('members').create(toMemberPayload(payload));
    } catch (err) {
      if (!String(err.message || '').toLowerCase().includes('registration_fee_details')) throw err;
      record = await pb.collection('members').create(toMemberPayload(stripOptionalRegistrationFeeDetails(payload)));
    }
    await dataCache.invalidatePrefix('members:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async update(id, data) {
    const payload = { ...data };
    if (shouldScopeToCurrentOfficer()) {
      delete payload.registered_by;
      delete payload.assigned_officer;
    }
    const duplicate = await this.findDuplicatePrincipalIdentifiers(payload, id);
    if (duplicate) {
      throw new Error(`${duplicate.field} already belongs to ${duplicate.memberName}. A principal member cannot be registered twice.`);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'group') && payload.group) {
      await this.validateSingleGroupPrincipalMembership(id);
    }
    const record = await pb.collection('members').update(id, toMemberPayload(payload));
    await dataCache.invalidatePrefix('members:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async suspend(id) {
    requireSuperAdminLifecycleManager();
    const record = await pb.collection('members').update(id, { status: 'suspended' });
    await dataCache.invalidatePrefix('members:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async close(id) {
    requireSuperAdminLifecycleManager();
    const record = await pb.collection('members').update(id, { status: 'closed' });
    await dataCache.invalidatePrefix('members:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async revive(id) {
    requireSuperAdminLifecycleManager();
    const record = await pb.collection('members').update(id, { status: 'active' });
    await dataCache.invalidatePrefix('members:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async delete(id) {
    requireSuperAdminLifecycleManager();
    await pb.collection('members').delete(id);
    await dataCache.invalidatePrefix('members:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return true;
  },

  getPhotoUrl(member = {}) {
    if (member.passport_photo) return pb.files.getURL(member, member.passport_photo);
    return member.passportPhoto || '';
  },

  async validateSingleGroupPrincipalMembership(memberId) {
    const member = await pb.collection('members').getOne(memberId, {
      fields: 'id,full_name,reg_no,id_number,phone,phone_number,group'
    });
    const targetIdNumber = normalizeIdNumber(member.id_number);
    const targetPhone = normalizePhone(getPrimaryPhone(member));
    if (!targetIdNumber && !targetPhone) return true;

    const members = await pb.collection('members').getFullList({
      fields: 'id,full_name,reg_no,id_number,phone,phone_number,group'
    });

    const duplicateInGroup = members.find(candidate => {
      if (candidate.id === memberId || !candidate.group) return false;
      const sameId = targetIdNumber && normalizeIdNumber(candidate.id_number) === targetIdNumber;
      const samePhone = targetPhone && normalizePhone(getPrimaryPhone(candidate)) === targetPhone;
      return sameId || samePhone;
    });

    if (duplicateInGroup) {
      throw new Error(`This principal member appears to already be in a group as ${duplicateInGroup.full_name || 'another member'}${duplicateInGroup.reg_no ? ` (${duplicateInGroup.reg_no})` : ''}. One principal member can only belong to one group.`);
    }

    return true;
  },

  async findDuplicatePrincipalIdentifiers(data = {}, excludeId = '') {
    const targetIdNumber = normalizeIdNumber(data.id_number);
    const targetPhone = normalizePhone(data.phone_number || data.phone);
    if (!targetIdNumber && !targetPhone) return null;

    const members = await pb.collection('members').getFullList({
      fields: 'id,full_name,reg_no,id_number,phone,phone_number'
    });

    const duplicate = members.find(member => {
      if (excludeId && member.id === excludeId) return false;
      const sameId = targetIdNumber && normalizeIdNumber(member.id_number) === targetIdNumber;
      const samePhone = targetPhone && normalizePhone(getPrimaryPhone(member)) === targetPhone;
      return sameId || samePhone;
    });

    if (!duplicate) return null;

    const duplicateId = targetIdNumber && normalizeIdNumber(duplicate.id_number) === targetIdNumber;
    return {
      field: duplicateId ? 'ID number' : 'Phone number',
      memberName: `${duplicate.full_name || 'another member'}${duplicate.reg_no ? ` (${duplicate.reg_no})` : ''}`,
      member: duplicate
    };
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
