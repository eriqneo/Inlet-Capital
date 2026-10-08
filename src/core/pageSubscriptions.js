// Profiles finish initializing after the router mounts them. Track subscriptions
// assigned later as well, including promises that resolve after navigation.
export const trackPageSubscriptions = element => {
  let disposed = false;
  const cleanups = new Set();
  const released = new Set();
  const release = callback => {
    if (released.has(callback)) return;
    released.add(callback);
    try { Promise.resolve(callback()).catch(error => console.warn('Subscription cleanup failed', error)); }
    catch (error) { console.warn('Subscription cleanup failed', error); }
  };
  const collect = (callbacks = []) => {
    for (const callback of callbacks) {
      if (typeof callback !== 'function') continue;
      if (disposed) release(callback);
      else cleanups.add(callback);
    }
  };
  for (const property of ['__subscriptions', '__subscriptionPromise']) {
    let value = element[property];
    const register = next => {
      if (property === '__subscriptions') collect(next);
      else if (next) Promise.resolve(next).then(collect).catch(error => console.warn('Subscription setup failed', error));
    };
    Object.defineProperty(element, property, {
      configurable: true,
      get: () => value,
      set: next => { value = next; register(next); }
    });
    register(value);
  }
  return () => {
    disposed = true;
    element.__disposed = true;
    cleanups.forEach(release);
    cleanups.clear();
  };
};
