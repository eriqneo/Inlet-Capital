import { pb } from './api.js';

export const loanService = {
  /**
   * Apply for a new loan
   */
  async apply(data) {
    console.log('[loanService] Applying for loan:', data);
    return await pb.collection('loans').create(data);
  },

  /**
   * Get paginated list of loans
   */
  async getAll({ page = 1, perPage = 50, filter = '', sort = '-application_date' } = {}) {
    return await pb.collection('loans').getList(page, perPage, {
      filter,
      sort,
      expand: 'member,group,processed_by'
    });
  },

  /**
   * Get a specific loan by its ID (the PocketBase record ID)
   */
  async getById(id) {
    return await pb.collection('loans').getOne(id, {
      expand: 'member,group,processed_by'
    });
  },

  /**
   * Get a specific loan by its custom loan_no
   */
  async getByLoanNo(loanNo) {
    const result = await pb.collection('loans').getFirstListItem(`loan_no="${loanNo}"`, {
      expand: 'member,group,processed_by'
    });
    return result;
  },

  /**
   * Get loans pending approval
   */
  async getPendingApprovals() {
    return await pb.collection('loans').getFullList({
      filter: 'status="pending" || status="partial_approved"',
      sort: '-application_date',
      expand: 'member,group'
    });
  },

  /**
   * Update a loan (approve, disburse, reject, etc.)
   */
  async update(id, data) {
    return await pb.collection('loans').update(id, data);
  },

  /**
   * Get all loans for a specific member (PB relation ID)
   */
  async getByMember(memberId) {
    return await pb.collection('loans').getFullList({
      filter: `member="${memberId}"`,
      sort: '-application_date',
      expand: 'member,group,processed_by'
    });
  },

  /**
   * Get all loans for a specific group (PB relation ID)
   */
  async getByGroup(groupId) {
    return await pb.collection('loans').getFullList({
      filter: `group="${groupId}"`,
      sort: '-application_date',
      expand: 'member,group,processed_by'
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
    return await pb.collection('loan_schedule').create(data);
  },

  async updateScheduleInstallment(id, data) {
    return await pb.collection('loan_schedule').update(id, data);
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
    return await pb.collection('loan_repayments').create(data);
  },

  subscribeToChanges(callback) {
    return pb.collection('loans').subscribe('*', callback);
  },

  unsubscribe() {
    pb.collection('loans').unsubscribe('*');
  }
};
