import { pb } from './api.js';
import { dataCache, observeCachedView } from './dataCache.js';

export const savingsDependencies = ['savings:', 'group_summary:', 'groups:profile:'];
export const invalidateSavings = () => dataCache.invalidatePrefixes(savingsDependencies);

// One savings stream per app session, shared by all views. Browser notifications
// cover local writes even when the PocketHost realtime connection is unavailable.
export const startSavingsSync = () => {
  let owner = '', session = 0, unsubscribe = null, lastCheck = 0;
  const check = async (force = false) => {
    if (!owner || (!force && (document.hidden || dataCache.isRefreshPaused() || Date.now() - lastCheck < 120000))) return;
    lastCheck = Date.now();
    await invalidateSavings();
  };
  const connect = async () => {
    const nextOwner = pb.authStore.model?.id || '';
    if (nextOwner === owner) return;
    owner = nextOwner;
    const current = ++session;
    unsubscribe?.();
    unsubscribe = null;
    if (!owner) return;
    lastCheck = Date.now();
    try {
      const stop = await pb.collection('savings').subscribe('*', () => {
        if (current === session) void check(true);
      });
      if (current !== session) stop();
      else unsubscribe = stop;
    } catch (error) { console.warn('[SavingsSync] Realtime unavailable; periodic checks will continue.', error); }
  };
  const stopAuth = pb.authStore.onChange(() => { void connect(); });
  void connect();
  const timer = setInterval(() => { void check(); }, 120000);
  const resume = () => { void check(); };
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  return () => {
    session += 1;
    stopAuth();
    unsubscribe?.();
    clearInterval(timer);
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
  };
};

export const observeSavings = callback => observeCachedView(['savings:'], callback, { updates: [] });
