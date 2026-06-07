export const getCurrentRoute = () => window.location.hash || '#/';

export const withReturnTo = (targetRoute, returnRoute = getCurrentRoute()) => {
  const separator = targetRoute.includes('?') ? '&' : '?';
  return `${targetRoute}${separator}returnTo=${encodeURIComponent(returnRoute)}`;
};

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const getReturnTo = (params = {}, fallbackRoute = '#/') => {
  const route = params.returnTo ? safeDecode(params.returnTo) : fallbackRoute;
  return route && route.startsWith('#/') ? route : fallbackRoute;
};

export const navigateToReturn = (params = {}, fallbackRoute = '#/') => {
  window.location.hash = getReturnTo(params, fallbackRoute);
};
