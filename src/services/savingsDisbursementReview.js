import { calculateSavingsConsistency, savingsDay } from '../core/savingsConsistency.js';

export const reviewSavingsBeforeDisbursement = async ({ api, loan, disbursementDate, getUser, confirmException, now = new Date() }) => {
  if (!['admin', 'super_admin'].includes(getUser()?.role)) throw new Error('Only admins can disburse loans.');
  if (!['approved', 'partial_approved'].includes(loan.status)) throw new Error('Only approved loans can be disbursed.');
  if (loan.disbursement_date) throw new Error('This loan has already been disbursed.');
  const selectedDay = savingsDay(disbursementDate);
  if (selectedDay === null || selectedDay > savingsDay(now)) throw new Error('Select a valid disbursement date that is not in the future.');
  if (!loan.member) return null;

  const loadAssessment = async () => {
    const member = await api.collection('members').getOne(loan.member, { expand: 'group' });
    if (['suspended', 'closed', 'exited'].includes(member.status)) throw new Error('Cannot disburse to a suspended or closed member.');
    if (!member.group) return { member, assessment: { applicable: false } };
    const group = member.expand?.group || await api.collection('groups').getOne(member.group);
    const savings = await api.collection('savings').getFullList({
      filter: api.filter('member = {:member} && type = "deposit" && is_reversed = false', { member: member.id }),
      fields: 'id,member,type,amount,date,created,is_reversed', sort: 'date,created'
    });
    const assessment = calculateSavingsConsistency({ member, group, savings, referenceDate: disbursementDate });
    if (assessment.status === 'unavailable') throw new Error('Savings consistency could not be verified. Check the group meeting day and membership start date before disbursing.');
    return { member, assessment };
  };
  const { member, assessment } = await loadAssessment();
  if (!assessment.requiresReview) return null;
  const reviewer = getUser();
  if (reviewer?.role !== 'super_admin') throw new Error('This member has not saved consistently. A superadmin must review the savings warning before disbursement.');
  if (!confirmException) throw new Error('Savings consistency review is required before disbursement.');
  const reason = await confirmException({ member, assessment });
  if (reason === null || reason === undefined) {
    const error = new Error('Disbursement cancelled. No funds have been released.');
    error.code = 'SAVINGS_REVIEW_CANCELLED';
    throw error;
  }
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) throw new Error('Enter a reason for proceeding (up to 1,000 characters).');
  if (getUser()?.id !== reviewer.id || getUser()?.role !== 'super_admin') throw new Error('Your authorization changed. Please reopen the loan.');
  // A deposit, reversal or membership change while the modal was open needs a fresh decision.
  const fresh = await loadAssessment();
  if (fresh.member.group !== member.group || JSON.stringify(fresh.assessment) !== JSON.stringify(assessment)) {
    throw new Error('Savings records changed during review. Please disburse again to review the latest position.');
  }
  const { weeks, ...summary } = assessment;
  return {
    version: 1, overridden: true, member: member.id, group: member.group,
    reviewed_by: reviewer.id, reviewer_name: reviewer.name || reviewer.email || reviewer.id,
    reviewed_at: new Date().toISOString(), disbursement_date: disbursementDate,
    reason: reason.trim(), assessment: summary
  };
};
