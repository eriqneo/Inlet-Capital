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
        schedules: schedules.map(recordData), penaltyAmount, period: Number(body.period) });
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

    const audit = new Record(app.findCollectionByNameOrId('loan_renewals'));
    audit.set('loan', loan.id);
    audit.set('recorded_by', e.auth.id);
    audit.set('renewal_date', quote.renewalDate);
    audit.set('reason', reason);
    audit.set('previous_terms', recordData(loan));
    audit.set('previous_schedule', schedules.map(recordData));
    audit.set('new_terms', quote);
    app.save(audit);

    loan.set('renewal_date', quote.renewalDate);
    loan.set('renewal_summary', { renewal_id: audit.id, reason, principal: quote.principal,
      interest: quote.interest, fines: quote.fines, total_payable: quote.totalPayable,
      period: quote.period, source_unit: quote.sourceUnit });
    loan.set('period', quote.period);
    loan.set('interest_rate', quote.interestRate);
    loan.set('interest_amount', quote.interest);
    loan.set('total_liability', quote.liability);
    loan.set('status', 'disbursed');
    app.save(loan);
    schedules.forEach(record => app.delete(record));
    const collection = app.findCollectionByNameOrId('loan_schedule');
    quote.installments.forEach(data => {
      const record = new Record(collection);
      Object.keys(data).forEach(key => record.set(key, data[key]));
      app.save(record);
    });
    result = { loan: recordData(loan), renewalId: audit.id };
  });
  return e.json(200, result);
}, $apis.requireAuth('users'));

// Recovery metadata may only be written by the transactional endpoint.
onRecordUpdateRequest(e => {
  const body = e.requestInfo().body;
  const fields = e.record.collection().name === 'loans' ? ['renewal_date', 'renewal_summary'] : ['carried_fine'];
  if (fields.some(field => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new ForbiddenError('Recovery terms must be changed through the renewal action.');
  }
  e.next();
}, 'loans', 'loan_schedule');

onRecordCreateRequest(e => {
  const body = e.requestInfo().body;
  const fields = e.record.collection().name === 'loans' ? ['renewal_date', 'renewal_summary'] : ['carried_fine'];
  if (fields.some(field => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new ForbiddenError('Recovery terms must be changed through the renewal action.');
  }
  e.next();
}, 'loans', 'loan_schedule');
