routerAdd('POST', '/api/inlet/loans/{id}/recovery', (e) => {
  if (!e.auth || e.auth.collection().name !== 'users' || e.auth.getString('role') !== 'super_admin') {
    throw new ForbiddenError('Only superadmins can renew loans.');
  }
  if (['suspended', 'closed', 'inactive'].includes(e.auth.getString('status'))) {
    throw new ForbiddenError('This account cannot renew loans.');
  }
  const domain = require(`${__hooks}/lib/debtRecovery.js`);
  const body = e.requestInfo().body;
  let result;
  e.app.runInTransaction(app => {
    const loan = app.findRecordById('loans', e.request.pathValue('id'));
    const owner = loan.getString('member')
      ? app.findRecordById('members', loan.getString('member'))
      : app.findRecordById('groups', loan.getString('group'));
    if (['suspended', 'closed', 'exited'].includes(owner.getString('status'))) {
      throw new BadRequestError('Suspended or closed accounts cannot renew loans.');
    }
    const related = name => app.findAllRecords(name, $dbx.hashExp({ loan: loan.id }));
    const schedules = related('loan_schedule');
    schedules.sort((a, b) => a.getInt('installment_no') - b.getInt('installment_no'));
    const repayments = related('loan_repayments');
    const settlements = related('loan_balance_offs');
    const settings = app.findAllRecords('settings', $dbx.hashExp({ key: 'penalty_amount' }));
    const penaltyAmount = settings.length ? Number(settings[0].get('value')) : 500;
    if (!Number.isFinite(penaltyAmount) || penaltyAmount < 0) throw new BadRequestError('Invalid penalty setting.');
    const recordData = record => JSON.parse(JSON.stringify(record.publicExport()));
    let quote;
    try {
      quote = domain.buildDebtRecoveryRenewal({ loan: recordData(loan),
        repayments: repayments.map(recordData), settlements: settlements.map(recordData),
        schedules: schedules.map(recordData), penaltyAmount, period: Number(body.period),
        interestRate: body.interest_rate === undefined ? undefined : Number(body.interest_rate),
        renewalDate: body.renewal_date, finalDueDate: body.final_due_date });
    } catch (error) {
      throw new BadRequestError(error.message);
    }
    if (body.action === 'preview') { result = quote; return; }
    if (body.action !== 'renew') throw new BadRequestError('Invalid recovery action.');
    const reason = String(body.reason || '').trim();
    if (reason.length < 10 || reason.length > 2000) throw new BadRequestError('Enter an agreement reason of 10 to 2000 characters.');
    if (body.fingerprint !== quote.fingerprint) {
      throw new BadRequestError('Loan terms changed. Review a fresh renewal quote before confirming.');
    }

    if (loan.getString('renewed_to')) {
      throw new BadRequestError('This loan has already been renewed.');
    }
    if (app.findAllRecords('loans', $dbx.hashExp({ loan_no: quote.newLoanNo })).length) {
      throw new BadRequestError('The next renewal loan number already exists. Contact the administrator.');
    }

    const loanCollection = app.findCollectionByNameOrId('loans');
    const renewedLoan = new Record(loanCollection);
    const hasLoanField = name => {
      try { return Boolean(loanCollection.fields.getByName(name)); } catch (_) { return false; }
    };
    const setLoanField = (name, value) => {
      if (hasLoanField(name) && value !== undefined && value !== null && value !== '') renewedLoan.set(name, value);
    };
    ['type', 'purpose', 'guarantor', 'collaterals', 'processed_by']
      .forEach(name => setLoanField(name, loan.get(name)));
    const memberId = loan.getString('member');
    const groupId = loan.getString('group');
    if (memberId) renewedLoan.set('member', memberId);
    if (groupId) renewedLoan.set('group', groupId);
    renewedLoan.set('loan_no', quote.newLoanNo);
    renewedLoan.set('status', 'disbursed');
    renewedLoan.set('period', quote.period);
    renewedLoan.set('amount_applied', quote.amountDue);
    renewedLoan.set('approved_amount', quote.amountDue);
    renewedLoan.set('interest_rate', quote.interestRate);
    renewedLoan.set('interest_amount', quote.interest);
    renewedLoan.set('total_liability', quote.renewedAmount);
    renewedLoan.set('application_date', quote.renewalDate);
    renewedLoan.set('disbursement_date', quote.renewalDate);
    setLoanField('approved_date', quote.renewalDate);
    setLoanField('processing_fee', 0);
    setLoanField('processing_fee_rate', 0);
    setLoanField('processing_fee_paid', true);
    // The setup migration guarantees this field. Set it directly so the new
    // cycle can never lose its traceable source-loan relationship.
    renewedLoan.set('renewed_from', loan.id);
    renewedLoan.set('renewal_date', quote.renewalDate);
    app.save(renewedLoan);

    const audit = new Record(app.findCollectionByNameOrId('loan_renewals'));
    audit.set('loan', loan.id);
    audit.set('renewed_loan', renewedLoan.id);
    audit.set('recorded_by', e.auth.id);
    audit.set('renewal_date', quote.renewalDate);
    audit.set('reason', reason);
    audit.set('previous_terms', recordData(loan));
    audit.set('previous_schedule', schedules.map(recordData));
    const auditTerms = JSON.parse(JSON.stringify(quote));
    auditTerms.renewed_loan_id = renewedLoan.id;
    audit.set('new_terms', auditTerms);
    app.save(audit);

    renewedLoan.set('renewal_summary', { renewal_id: audit.id, verdict: 'Renewed', reason,
      source_loan_id: loan.id, source_loan_no: loan.getString('loan_no'),
      principal: quote.principal, amount_due: quote.amountDue, renewal_base: quote.renewalBase,
      renewed_amount: quote.renewedAmount, interest: quote.interest, fines_included: quote.fines,
      total_payable: quote.totalPayable, interest_rate: quote.interestRate, period: quote.period,
      renewal_date: quote.renewalDate, final_due_date: quote.finalDueDate, source_unit: quote.sourceUnit });
    app.save(renewedLoan);

    loan.set('renewed_to', renewedLoan.id);
    loan.set('status', 'closed');
    app.save(loan);

    const scheduleCollection = app.findCollectionByNameOrId('loan_schedule');
    quote.installments.forEach(data => {
      const record = new Record(scheduleCollection);
      Object.keys(data).forEach(key => record.set(key, key === 'loan' ? renewedLoan.id : data[key]));
      app.save(record);
    });
    result = { loan: recordData(renewedLoan), sourceLoan: recordData(loan), renewalId: audit.id };
  });
  return e.json(200, result);
}, $apis.requireAuth('users'));

// Recovery metadata may only be written by the transactional endpoint.
onRecordUpdateRequest(e => {
  const body = e.requestInfo().body;
  const fields = e.record.collection().name === 'loans' ? ['renewal_date', 'renewal_summary', 'renewed_from', 'renewed_to'] : ['carried_fine'];
  if (fields.some(field => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new ForbiddenError('Recovery terms must be changed through the renewal action.');
  }
  e.next();
}, 'loans', 'loan_schedule');

onRecordCreateRequest(e => {
  const body = e.requestInfo().body;
  const fields = e.record.collection().name === 'loans' ? ['renewal_date', 'renewal_summary', 'renewed_from', 'renewed_to'] : ['carried_fine'];
  if (fields.some(field => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new ForbiddenError('Recovery terms must be changed through the renewal action.');
  }
  e.next();
}, 'loans', 'loan_schedule');
