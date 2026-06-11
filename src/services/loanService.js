import { pb } from './api.js';
import { dataCache } from './dataCache.js';

const requireAdminRecordManager = () => {
  const role = pb.authStore.model?.role;
  if (!['super_admin', 'admin'].includes(role)) {
    throw new Error('Only admins can delete records.');
  }
};

const normalizeGuarantorId = (value) => String(value || '').replace(/\D/g, '').trim();

const activeGuarantorStatuses = ['pending', 'approved', 'partial_approved', 'disbursed'];
const normalLoanRestrictedStatuses = ['pending', 'approved', 'partial_approved', 'disbursed'];
const repeatLoanAllowedTypes = ['emergency', 'school_fees'];

const getLoanOwnerLabel = (loan) => {
  const member = loan.expand?.member;
  const group = loan.expand?.group;
  if (member) return `${member.full_name || 'Member'} (${member.reg_no || member.id})`;
  if (group) return `${group.name || 'Group'} (${group.group_id || group.id})`;
  return loan.member || loan.group || 'Unknown applicant';
};

const buildRelationFilter = (field, ids) => ids.map(id => `${field}="${id}"`).join(' || ');

export const loanService = {
  /**
   * Apply for a new loan
   */
  async apply(data) {
    console.log('[loanService] Applying for loan:', data);
    await this.validateMemberBorrowingEligibility(data.member, data.type, {
      currentLoanNo: data.loan_no
    });
    await this.validateGuarantorAvailability(data.guarantor?.id_number, {
      applicantId: data.member || data.group || '',
      currentLoanNo: data.loan_no
    });
    const record = await pb.collection('loans').create(data);
    await dataCache.invalidatePrefix('loans:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async validateMemberBorrowingEligibility(memberId, loanType, { excludeLoanId = '', currentLoanNo = '' } = {}) {
    if (!memberId || repeatLoanAllowedTypes.includes(loanType)) return true;

    const statusFilter = normalLoanRestrictedStatuses.map(status => `status="${status}"`).join(' || ');
    const openLoans = await pb.collection('loans').getFullList({
      filter: `member="${memberId}" && (${statusFilter})`,
      sort: '-application_date',
      expand: 'member'
    });

    const candidateLoans = openLoans.filter(loan => {
      if (excludeLoanId && loan.id === excludeLoanId) return false;
      if (currentLoanNo && loan.loan_no === currentLoanNo) return false;
      return true;
    });

    if (candidateLoans.length === 0) return true;

    const loanIds = candidateLoans.map(loan => loan.id);
    const repayments = loanIds.length > 0
      ? await pb.collection('loan_repayments').getFullList({
          filter: buildRelationFilter('loan', loanIds)
        }).catch(() => [])
      : [];

    const blockingLoan = candidateLoans.find(loan => {
      if (loan.status !== 'disbursed') return true;
      const liability = Number(loan.total_liability) || 0;
      const paid = repayments
        .filter(repayment => repayment.loan === loan.id)
        .reduce((sum, repayment) => sum + (Number(repayment.amount) || 0), 0);
      return liability <= 0 || paid < liability;
    });

    if (!blockingLoan) return true;

    throw new Error(
      `This member already has an active unpaid loan (${blockingLoan.loan_no || blockingLoan.id}). They can only apply for an Emergency or School Fees loan until the current loan is fully paid.`
    );
  },

  async validateGuarantorAvailability(guarantorId, { excludeLoanId = '', currentLoanNo = '' } = {}) {
    const normalizedId = normalizeGuarantorId(guarantorId);
    if (!normalizedId) {
      throw new Error('Guarantor ID number is required.');
    }

    const statusFilter = activeGuarantorStatuses.map(status => `status="${status}"`).join(' || ');
    const activeLoans = await pb.collection('loans').getFullList({
      filter: `(${statusFilter})`,
      sort: '-application_date',
      expand: 'member,group'
    });

    const matchingLoans = activeLoans.filter(loan => {
      if (excludeLoanId && loan.id === excludeLoanId) return false;
      if (currentLoanNo && loan.loan_no === currentLoanNo) return false;
      return normalizeGuarantorId(
        loan.guarantor?.id_number
        || loan.guarantor?.idNo
        || loan.guarantor?.id_no
        || loan.guarantor?.national_id
      ) === normalizedId;
    });

    if (matchingLoans.length === 0) return true;

    const loanIds = matchingLoans.map(loan => loan.id);
    const repayments = loanIds.length > 0
      ? await pb.collection('loan_repayments').getFullList({
          filter: buildRelationFilter('loan', loanIds)
        }).catch(() => [])
      : [];

    const blockingLoan = matchingLoans.find(loan => {
      if (loan.status !== 'disbursed') return true;
      const liability = Number(loan.total_liability) || 0;
      const paid = repayments
        .filter(repayment => repayment.loan === loan.id)
        .reduce((sum, repayment) => sum + (Number(repayment.amount) || 0), 0);
      return liability <= 0 || paid < liability;
    });

    if (!blockingLoan) return true;

    throw new Error(
      `Guarantor ID ${normalizedId} is already tied to active loan ${blockingLoan.loan_no || blockingLoan.id} for ${getLoanOwnerLabel(blockingLoan)}. The guarantor can only guarantee another loan after that loan is fully paid.`
    );
  },

  /**
   * Get paginated list of loans
   */
  async getAll({ page = 1, perPage = 50, filter = '', sort = '-application_date' } = {}) {
    return await pb.collection('loans').getList(page, perPage, {
      filter,
      sort,
      expand: 'member,member.group,group,processed_by'
    });
  },

  async getAllCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-application_date' } = options;
    const key = `loans:list:v2:${page}:${perPage}:${sort}:${filter}`;
    return await dataCache.getLocalFirst(key, () => this.getAll({ page, perPage, filter, sort }), onUpdate);
  },

  async getFullListCached({ filter = '', sort = '-application_date', expand = 'member,member.group,group,processed_by', cacheKey = 'loans:all:expanded:v1' } = {}, onUpdate = null) {
    const key = `${cacheKey}:${sort}:${filter}:${expand}`;
    return await dataCache.getLocalFirst(key, () => {
      const options = { filter, sort };
      if (expand) options.expand = expand;
      return pb.collection('loans').getFullList(options);
    }, onUpdate);
  },

  /**
   * Get a specific loan by its ID (the PocketBase record ID)
   */
  async getById(id) {
    return await pb.collection('loans').getOne(id, {
      expand: 'member,member.group,group,processed_by'
    });
  },

  /**
   * Get a specific loan by its custom loan_no
   */
  async getByLoanNo(loanNo) {
    const result = await pb.collection('loans').getFirstListItem(`loan_no="${loanNo}"`, {
      expand: 'member,member.group,group,processed_by'
    });
    return result;
  },

  /**
   * Get loans pending approval
   */
  async getPendingApprovals() {
    return await pb.collection('loans').getFullList({
      filter: 'status="pending"',
      sort: '-application_date',
      expand: 'member,member.group,group'
    });
  },

  /**
   * Update a loan (approve, disburse, reject, etc.)
   */
  async update(id, data) {
    const record = await pb.collection('loans').update(id, data);
    await dataCache.invalidatePrefix('loans:');
    await dataCache.invalidatePrefix('loans:all:');
    await dataCache.invalidatePrefix('loans:analytics:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async delete(id) {
    requireAdminRecordManager();
    await pb.collection('loans').delete(id);
    await dataCache.invalidatePrefix('loans:');
    await dataCache.invalidatePrefix('loans:all:');
    await dataCache.invalidatePrefix('loans:analytics:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return true;
  },

  /**
   * Get all loans for a specific member (PB relation ID)
   */
  async getByMember(memberId) {
    return await pb.collection('loans').getFullList({
      filter: `member="${memberId}"`,
      sort: '-application_date',
      expand: 'member,member.group,group,processed_by'
    });
  },

  /**
   * Get all loans for a specific group (PB relation ID)
   */
  async getByGroup(groupId) {
    return await pb.collection('loans').getFullList({
      filter: `group="${groupId}"`,
      sort: '-application_date',
      expand: 'member,member.group,group,processed_by'
    });
  },

  // --- Schedules ---

  async getScheduleForLoan(loanId) {
    return await pb.collection('loan_schedule').getFullList({
      filter: `loan="${loanId}"`,
      sort: 'installment_no'
    });
  },

  async createScheduleInstallment(data) {
    const record = await pb.collection('loan_schedule').create(data);
    await dataCache.invalidate('loan_schedule');
    await dataCache.invalidatePrefix('loan_schedule:');
    await dataCache.invalidatePrefix('loan_schedule');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async updateScheduleInstallment(id, data) {
    const record = await pb.collection('loan_schedule').update(id, data);
    await dataCache.invalidate('loan_schedule');
    await dataCache.invalidatePrefix('loan_schedule:');
    await dataCache.invalidatePrefix('loan_schedule');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  // --- Repayments ---

  async getRepaymentsForLoan(loanId) {
    return await pb.collection('loan_repayments').getFullList({
      filter: `loan="${loanId}"`,
      sort: '-date',
      expand: 'recorded_by'
    });
  },

  async recordRepayment(data) {
    const record = await pb.collection('loan_repayments').create(data);
    await dataCache.invalidate('loan_repayments');
    await dataCache.invalidatePrefix('loan_repayments:');
    await dataCache.invalidatePrefix('loan_repayments');
    await dataCache.invalidatePrefix('loans:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  subscribeToChanges(callback) {
    return pb.collection('loans').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('loans').unsubscribe('*');
  }
};
