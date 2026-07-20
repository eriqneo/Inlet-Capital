import { pb } from './api.js';
import { dataCache } from './dataCache.js';
import { addMonthsPreservingDay, getRepaymentScheduleAnchorDate } from '../core/repaymentSchedule.js';
import {
  filterLoansForCurrentOfficer,
  getOfficerScopeCacheKey,
  paginateScopedItems,
  shouldScopeToCurrentOfficer
} from '../core/officerScope.js';

const requireAdminRecordManager = () => {
  const role = pb.authStore.model?.role;
  if (role !== 'super_admin') {
    throw new Error('Only super admins can delete loan records.');
  }
};

const normalizeGuarantorId = (value) => String(value || '').replace(/\D/g, '').trim();

const activeGuarantorStatuses = ['pending', 'approved', 'partial_approved', 'disbursed'];
const normalLoanRestrictedStatuses = ['pending', 'approved', 'partial_approved', 'disbursed'];
const repeatLoanAllowedTypes = ['emergency', 'school_fees'];
const awaitingDisbursementStatuses = ['approved', 'partial_approved'];
const preDisbursementStatuses = ['pending', 'approved', 'partial_approved', 'rejected', 'expired'];

const normalizeLoanStatusPayload = async (id, data) => {
  const payload = { ...data };
  if (!payload.status) return payload;

  const existing = await pb.collection('loans').getOne(id).catch(() => null);
  const hasDisbursementDate = Boolean(payload.disbursement_date || existing?.disbursement_date);

  if (payload.status === 'disbursed') {
    if (!hasDisbursementDate) payload.disbursement_date = new Date().toISOString();
    return payload;
  }

  if (['completed', 'closed'].includes(payload.status)) {
    if (!hasDisbursementDate) {
      throw new Error('A loan must be disbursed before it can be completed or closed.');
    }
    return payload;
  }

  if (preDisbursementStatuses.includes(payload.status)) {
    payload.disbursement_date = null;
  }

  if (payload.status === 'pending') {
    payload.approved_date = null;
    payload.approved_amount = 0;
    payload.expired_date = null;
  }

  if (awaitingDisbursementStatuses.includes(payload.status) && !payload.approved_date && existing?.approved_date) {
    payload.approved_date = existing.approved_date;
  }

  return payload;
};

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
    if (shouldScopeToCurrentOfficer()) {
      const items = filterLoansForCurrentOfficer(await pb.collection('loans').getFullList({
        filter,
        sort,
        expand: 'member,member.group,group,processed_by'
      }));
      return paginateScopedItems(items, { page, perPage });
    }

    return await pb.collection('loans').getList(page, perPage, {
      filter,
      sort,
      expand: 'member,member.group,group,processed_by'
    });
  },

  async getAllCached(options = {}, onUpdate = null) {
    const { page = 1, perPage = 50, filter = '', sort = '-application_date' } = options;
    const key = `loans:list:v2:${getOfficerScopeCacheKey()}:${page}:${perPage}:${sort}:${filter}`;
    return await dataCache.getLocalFirst(key, () => this.getAll({ page, perPage, filter, sort }), onUpdate);
  },

  async getFullListCached({ filter = '', sort = '-application_date', expand = 'member,member.group,group,processed_by', cacheKey = 'loans:all:expanded:v1' } = {}, onUpdate = null) {
    const effectiveExpand = shouldScopeToCurrentOfficer() && !expand ? 'member,member.group,group,processed_by' : expand;
    const key = `${cacheKey}:${getOfficerScopeCacheKey()}:${sort}:${filter}:${effectiveExpand}`;
    return await dataCache.getLocalFirst(key, async () => {
      const options = { filter, sort };
      if (effectiveExpand) options.expand = effectiveExpand;
      const loans = await pb.collection('loans').getFullList(options);
      return filterLoansForCurrentOfficer(loans);
    }, onUpdate);
  },

  async getFullListFresh({ filter = '', sort = '-application_date', expand = 'member,member.group,group,processed_by', cacheKey = 'loans:all:expanded:v1' } = {}) {
    const effectiveExpand = shouldScopeToCurrentOfficer() && !expand ? 'member,member.group,group,processed_by' : expand;
    const key = `${cacheKey}:${getOfficerScopeCacheKey()}:${sort}:${filter}:${effectiveExpand}`;
    const options = { filter, sort };
    if (effectiveExpand) options.expand = effectiveExpand;
    return await dataCache.refresh(key, async () => filterLoansForCurrentOfficer(await pb.collection('loans').getFullList(options)));
  },

  /**
   * Get a specific loan by its ID (the PocketBase record ID)
   */
  async getById(id) {
    const loan = await pb.collection('loans').getOne(id, {
      expand: 'member,member.group,group,processed_by'
    });
    if (shouldScopeToCurrentOfficer() && filterLoansForCurrentOfficer([loan]).length === 0) {
      throw new Error('You can only access loans assigned to your portfolio.');
    }
    return loan;
  },

  /**
   * Get a specific loan by its custom loan_no
   */
  async getByLoanNo(loanNo) {
    const result = await pb.collection('loans').getFirstListItem(`loan_no="${loanNo}"`, {
      expand: 'member,member.group,group,processed_by'
    });
    if (shouldScopeToCurrentOfficer() && filterLoansForCurrentOfficer([result]).length === 0) {
      throw new Error('You can only access loans assigned to your portfolio.');
    }
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
    const payload = await normalizeLoanStatusPayload(id, data);
    const record = await pb.collection('loans').update(id, payload);
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
    return filterLoansForCurrentOfficer(await pb.collection('loans').getFullList({
      filter: `member="${memberId}"`,
      sort: '-application_date',
      expand: 'member,member.group,group,processed_by'
    }));
  },

  /**
   * Get all loans for a specific group (PB relation ID)
   */
  async getByGroup(groupId) {
    return filterLoansForCurrentOfficer(await pb.collection('loans').getFullList({
      filter: `group="${groupId}"`,
      sort: '-application_date',
      expand: 'member,member.group,group,processed_by'
    }));
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

  async ensureRepaymentSchedule(loan) {
    const period = Math.max(0, Number.parseInt(loan?.period, 10) || 0);
    if (!loan?.id || period === 0) {
      throw new Error('A valid loan period is required to generate the repayment schedule.');
    }

    const existing = await this.getScheduleForLoan(loan.id);
    const existingInstallments = new Set(
      existing.map(item => Number(item.installment_no)).filter(Number.isFinite)
    );
    const principal = Number(loan.approved_amount || loan.amount_applied) || 0;
    const liability = Number(loan.total_liability) || (principal + (Number(loan.interest_amount) || 0));
    const installmentAmount = liability / period;
    const startDate = getRepaymentScheduleAnchorDate(loan);
    const created = [];

    for (let installmentNo = 1; installmentNo <= period; installmentNo += 1) {
      if (existingInstallments.has(installmentNo)) continue;
      const dueDate = addMonthsPreservingDay(startDate, installmentNo);
      created.push(await this.createScheduleInstallment({
        loan: loan.id,
        installment_no: installmentNo,
        due_date: dueDate.toISOString(),
        amount: installmentAmount,
        paid: 0,
        status: 'pending',
        penalty_waived: false
      }));
    }

    return [...existing, ...created].sort((a, b) => Number(a.installment_no) - Number(b.installment_no));
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
    let record;
    try {
      record = await pb.collection('loan_repayments').create(data);
    } catch (error) {
      const hasAllocationFields = 'principal_amount' in data || 'interest_amount' in data;
      if (error?.status !== 400 || !hasAllocationFields) throw error;
      const compatibleData = { ...data };
      delete compatibleData.principal_amount;
      delete compatibleData.interest_amount;
      record = await pb.collection('loan_repayments').create(compatibleData);
      console.warn('[loanService] Repayment allocation fields are not installed yet; saved using the legacy schema.');
    }
    await dataCache.invalidate('loan_repayments');
    await dataCache.invalidatePrefix('loan_repayments:');
    await dataCache.invalidatePrefix('loan_repayments');
    await dataCache.invalidatePrefix('loans:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async updateRepayment(id, data) {
    const role = pb.authStore.model?.role;
    if (!['super_admin', 'admin'].includes(role)) {
      throw new Error('Only admins can edit repayment records.');
    }

    let record;
    try {
      record = await pb.collection('loan_repayments').update(id, data);
    } catch (error) {
      const hasAllocationFields = 'principal_amount' in data || 'interest_amount' in data;
      if (error?.status !== 400 || !hasAllocationFields) throw error;
      const compatibleData = { ...data };
      delete compatibleData.principal_amount;
      delete compatibleData.interest_amount;
      record = await pb.collection('loan_repayments').update(id, compatibleData);
      console.warn('[loanService] Repayment allocation fields are not installed yet; updated using the legacy schema.');
    }
    await dataCache.invalidate('loan_repayments');
    await dataCache.invalidatePrefix('loan_repayments:');
    await dataCache.invalidatePrefix('loan_repayments');
    await dataCache.invalidatePrefix('loans:');
    await dataCache.invalidatePrefix('loans:all:');
    await dataCache.invalidatePrefix('loans:analytics:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return record;
  },

  async deleteRepayment(id) {
    const role = pb.authStore.model?.role;
    if (role !== 'super_admin') {
      throw new Error('Only super admins can delete repayment records.');
    }

    await pb.collection('loan_repayments').delete(id);
    await dataCache.invalidate('loan_repayments');
    await dataCache.invalidatePrefix('loan_repayments:');
    await dataCache.invalidatePrefix('loan_repayments');
    await dataCache.invalidatePrefix('loans:');
    await dataCache.invalidatePrefix('loans:all:');
    await dataCache.invalidatePrefix('loans:analytics:');
    await dataCache.invalidatePrefix('group_summary:');
    await dataCache.invalidatePrefix('groups:profile:');
    return true;
  },

  subscribeToChanges(callback) {
    return pb.collection('loans').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('loans').unsubscribe('*');
  }
};
