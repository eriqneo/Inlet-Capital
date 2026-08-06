const asAmount = (value) => Math.max(0, Number(value) || 0);

export const getLoanPrincipalAmount = (loan) => {
  const approved = asAmount(loan?.approved_amount);
  if (approved > 0) return approved;

  const applied = asAmount(loan?.amount_applied);
  if (applied > 0) return applied;

  const liability = asAmount(loan?.total_liability);
  const interest = asAmount(loan?.interest_amount);
  return Math.max(0, liability - interest);
};

export const getLoanInterestAmount = (loan) => {
  const storedInterest = asAmount(loan?.interest_amount);
  if (storedInterest > 0) return storedInterest;

  const principal = getLoanPrincipalAmount(loan);
  const liability = asAmount(loan?.total_liability);
  if (liability > principal) return liability - principal;

  const interestRate = asAmount(loan?.interest_rate);
  return principal > 0 && interestRate > 0 ? principal * (interestRate / 100) : 0;
};

export const getLoanLiabilityAmount = (loan) => {
  const principal = getLoanPrincipalAmount(loan);
  const interest = getLoanInterestAmount(loan);
  const storedLiability = asAmount(loan?.total_liability);
  return Math.max(storedLiability, principal + interest);
};

export const getRepaymentContractAmount = (repayment) => {
  const amount = asAmount(repayment?.amount);
  const fine = Math.min(amount, asAmount(repayment?.fine_amount));
  return amount - fine;
};

export const getSettlementContractAmount = (settlement) => {
  if (!settlement || settlement.status === 'reversed') return 0;
  return asAmount(settlement.amount);
};

export const getContractFulfillmentAmount = (record) => (
  record?.settlement_kind === 'balance_off'
    ? getSettlementContractAmount(record)
    : getRepaymentContractAmount(record)
);

export const allocateRepayment = ({ loan, repaymentAmount, fineAmount = 0, priorContractPaid = 0 }) => {
  const principal = getLoanPrincipalAmount(loan);
  const interest = getLoanInterestAmount(loan);
  const liability = getLoanLiabilityAmount(loan);
  const amount = asAmount(repaymentAmount);
  const fine = Math.min(amount, asAmount(fineAmount));
  const netPayment = amount - fine;
  const paidBefore = Math.min(liability, asAmount(priorContractPaid));
  const allocatedToContract = Math.min(netPayment, Math.max(0, liability - paidBefore));
  const interestRatio = liability > 0 ? interest / liability : 0;
  const interestPaidBefore = Math.min(interest, paidBefore * interestRatio);
  const interestAmount = Math.min(
    Math.max(0, interest - interestPaidBefore),
    allocatedToContract * interestRatio
  );

  return {
    amount,
    fineAmount: fine,
    contractAmount: allocatedToContract,
    principalAmount: Math.max(0, allocatedToContract - interestAmount),
    interestAmount: Math.max(0, interestAmount),
    excessAmount: Math.max(0, netPayment - allocatedToContract),
    principal,
    interest,
    liability
  };
};

export const calculateCollectedInterest = ({ loan, repayments = [], fromDate = null, toDate = null }) => {
  const orderedRepayments = repayments
    .map(repayment => ({
      repayment,
      paidAt: new Date(repayment?.date || repayment?.created || 0)
    }))
    .filter(item => !Number.isNaN(item.paidAt.getTime()))
    .sort((a, b) => a.paidAt - b.paidAt);

  let priorContractPaid = 0;
  let collectedInterest = 0;

  orderedRepayments.forEach(({ repayment, paidAt }) => {
    if (toDate && paidAt > toDate) return;
    const allocation = allocateRepayment({
      loan,
      repaymentAmount: repayment.amount,
      fineAmount: repayment.fine_amount,
      priorContractPaid
    });
    priorContractPaid += allocation.contractAmount;
    if ((!fromDate || paidAt >= fromDate) && (!toDate || paidAt <= toDate)) {
      collectedInterest += allocation.interestAmount;
    }
  });

  return Math.min(getLoanInterestAmount(loan), Math.max(0, collectedInterest));
};
