// Converts renewals created by the former in-place flow into separate loan cycles.
migrate((app) => {
  const money = value => Math.round((Number(value) || 0) * 100) / 100;
  const parseJSONField = (record, field, fallback) => {
    const raw = record.get(field);
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw === 'string') return JSON.parse(raw);
    if (raw && typeof raw.string === 'function') return JSON.parse(raw.string());
    return JSON.parse(JSON.stringify(raw));
  };
  const firstValue = values => {
    for (let index = 0; index < values.length; index += 1) {
      if (values[index] !== undefined && values[index] !== null && values[index] !== '') return values[index];
    }
    return undefined;
  };
  const nextLoanNumber = loanNo => {
    const normalized = String(loanNo || '').trim() || 'LN';
    const match = normalized.match(/^(.*)-R(\d+)$/i);
    return match ? `${match[1]}-R${Number(match[2]) + 1}` : `${normalized}-R1`;
  };
  const setIfPresent = (record, field, value) => {
    if (value !== undefined && value !== null && value !== '') record.set(field, value);
  };
  const createSchedule = (collection, loanId, row, resetPayment) => {
    const schedule = new Record(collection);
    const amount = money(row.amount);
    const paid = resetPayment ? 0 : money(row.paid);
    schedule.set('loan', loanId);
    schedule.set('installment_no', Number(row.installment_no) || 0);
    schedule.set('due_date', row.due_date);
    schedule.set('amount', amount);
    schedule.set('paid', paid);
    schedule.set('status', resetPayment
      ? 'pending'
      : (row.status || (paid >= amount && amount > 0 ? 'paid' : (paid > 0 ? 'partial' : 'pending'))));
    schedule.set('penalty_waived', Boolean(row.penalty_waived));
    setIfPresent(schedule, 'penalty_waiver_reason', row.penalty_waiver_reason);
    schedule.set('carried_fine', resetPayment ? 0 : money(row.carried_fine));
    app.save(schedule);
  };

  const loanCollection = app.findCollectionByNameOrId('loans');
  const scheduleCollection = app.findCollectionByNameOrId('loan_schedule');
  const archives = app.findAllRecords('loan_renewals');

  archives.forEach(archive => {
    if (archive.getString('renewed_loan')) return;

    const source = app.findRecordById('loans', archive.getString('loan'));
    if (source.getString('renewed_from') || source.getString('renewed_to')) return;

    const previous = parseJSONField(archive, 'previous_terms', {});
    const previousSchedule = parseJSONField(archive, 'previous_schedule', []);
    const terms = parseJSONField(archive, 'new_terms', {});
    const installments = Array.isArray(terms.installments) ? terms.installments : [];
    const sourceLoanNo = String(previous.loan_no || source.getString('loan_no') || '').trim();
    const newLoanNo = nextLoanNumber(sourceLoanNo);
    const amountDue = money(firstValue([terms.amountDue, terms.renewalBase, terms.principal]));
    const renewedAmount = money(firstValue([terms.renewedAmount, terms.totalPayable, terms.liability]));
    const interestRate = Number(firstValue([terms.interestRate, terms.interest_rate]));
    const interest = money(terms.interest);
    const period = Number(terms.period);
    const renewalDate = terms.renewalDate || terms.renewal_date || archive.getString('renewal_date');
    const lastInstallment = installments.length ? installments[installments.length - 1] : null;
    const finalDueDate = terms.finalDueDate || terms.final_due_date || (lastInstallment ? lastInstallment.due_date : '');

    if (!sourceLoanNo || !(amountDue > 0) || !(renewedAmount >= amountDue)
      || !Number.isFinite(interestRate) || !Number.isInteger(period) || period < 1
      || installments.length !== period || !Array.isArray(previousSchedule)
      || !previousSchedule.length || !renewalDate) {
      throw new Error(`Legacy renewal ${archive.id} is incomplete and was not converted.`);
    }
    if (app.findAllRecords('loans', $dbx.hashExp({ loan_no: newLoanNo })).length) {
      throw new Error(`Cannot convert legacy renewal ${archive.id}: ${newLoanNo} already exists.`);
    }

    const renewed = new Record(loanCollection);
    ['member', 'group', 'type', 'purpose', 'collaterals', 'guarantor', 'processed_by']
      .forEach(field => setIfPresent(renewed, field, source.get(field)));
    renewed.set('loan_no', newLoanNo);
    renewed.set('status', 'disbursed');
    renewed.set('period', period);
    renewed.set('amount_applied', amountDue);
    renewed.set('approved_amount', amountDue);
    renewed.set('interest_rate', interestRate);
    renewed.set('interest_amount', interest);
    renewed.set('total_liability', renewedAmount);
    renewed.set('application_date', renewalDate);
    renewed.set('approved_date', renewalDate);
    renewed.set('disbursement_date', renewalDate);
    renewed.set('processing_fee', 0);
    renewed.set('processing_fee_rate', 0);
    renewed.set('processing_fee_paid', true);
    renewed.set('grace_period_months', 0);
    renewed.set('approval_comment', 'Decision verdict: Renewed');
    renewed.set('renewed_from', source.id);
    renewed.set('renewal_date', renewalDate);
    renewed.set('renewal_summary', {
      renewal_id: archive.id,
      verdict: 'Renewed',
      reason: archive.getString('reason'),
      source_loan_id: source.id,
      source_loan_no: sourceLoanNo,
      principal: amountDue,
      amount_due: amountDue,
      renewal_base: amountDue,
      renewed_amount: renewedAmount,
      interest: interest,
      fines_included: money(terms.fines),
      total_payable: renewedAmount,
      interest_rate: interestRate,
      period: period,
      renewal_date: renewalDate,
      final_due_date: finalDueDate,
      source_unit: terms.sourceUnit || terms.source_unit || 'du'
    });
    app.save(renewed);

    const currentSchedules = app.findAllRecords('loan_schedule', $dbx.hashExp({ loan: source.id }));
    currentSchedules.forEach(record => app.delete(record));
    previousSchedule.forEach(row => createSchedule(scheduleCollection, source.id, row, false));
    installments.forEach(row => createSchedule(scheduleCollection, renewed.id, row, true));

    source.set('period', Number(previous.period));
    source.set('approved_amount', money(previous.approved_amount));
    source.set('interest_rate', Number(previous.interest_rate) || 0);
    source.set('interest_amount', money(previous.interest_amount));
    source.set('total_liability', money(previous.total_liability));
    source.set('status', 'closed');
    source.set('renewal_date', null);
    source.set('renewal_summary', null);
    source.set('renewed_to', renewed.id);
    app.save(source);

    terms.decisionVerdict = 'Renewed';
    terms.newLoanNo = newLoanNo;
    terms.sourceLoanId = source.id;
    terms.sourceLoanNo = sourceLoanNo;
    terms.amountDue = amountDue;
    terms.renewedAmount = renewedAmount;
    terms.renewed_loan_id = renewed.id;
    archive.set('renewed_loan', renewed.id);
    archive.set('new_terms', terms);
    app.save(archive);
  });
}, () => {
  // Financial rollovers are intentionally not auto-reversed.
});
