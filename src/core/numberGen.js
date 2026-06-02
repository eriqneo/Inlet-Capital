export const generateRegNo = () => {
  const randomStr = Math.floor(10000 + Math.random() * 90000);
  const year = new Date().getFullYear();
  return `REG-${year}-${randomStr}`;
};

export const generateLoanNo = () => {
  const randomStr = Math.floor(10000 + Math.random() * 90000);
  const year = new Date().getFullYear();
  return `LN-${year}-${randomStr}`;
};

export const generateGroupId = () => {
  const randomStr = Math.floor(1000 + Math.random() * 9000);
  return `GRP-${randomStr}`;
};
