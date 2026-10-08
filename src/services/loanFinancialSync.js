import { pb } from './api.js';
import { dataCache, observeCachedView } from './dataCache.js';
import { loanSnapshotPrefix } from './loanFinancialSnapshotService.js';

export const startLoanFinancialSync = () => {
  let owner = '', session = 0, stops = [], lastCheck = 0, pendingTimer, streamsHealthy = false;
  const pendingPrefixes = new Set();
  const queue = (...prefixes) => {
    if (!owner) return;
    prefixes.forEach(prefix => pendingPrefixes.add(prefix));
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      const changes = [...pendingPrefixes];
      pendingPrefixes.clear();
      void dataCache.invalidatePrefixes(changes).catch(error => console.warn('[LoanFinancialSync] Invalidation unavailable', error));
    }, 100);
  };
  const dependencies = ['loan_repayments', 'loan_schedule', 'loan_balance_offs:', 'members:', 'groups:all:', 'settings:'];
  const stopCache = observeCachedView(dependencies, () => queue(loanSnapshotPrefix, 'groups:profile:'), { updates: [], delay: 100 });
  const streams = { loans: 'loans:', loan_repayments: 'loan_repayments', loan_schedule: 'loan_schedule',
    loan_balance_offs: 'loan_balance_offs:', members: 'members:', groups: 'groups:all:', settings: 'settings:' };
  const connect = async () => {
    const nextOwner = pb.authStore.model?.id || '';
    if (nextOwner === owner) return;
    owner = nextOwner;
    const current = ++session;
    stops.forEach(stop => stop());
    stops = [];
    clearTimeout(pendingTimer);
    pendingPrefixes.clear();
    if (!owner) return;
    lastCheck = Date.now();
    streamsHealthy = true;
    await Promise.all(Object.entries(streams).map(async ([collection, prefix]) => {
      try {
        const stop = await pb.collection(collection).subscribe('*', () => {
          if (current === session) queue(prefix, loanSnapshotPrefix, 'groups:profile:');
        });
        if (current === session) stops.push(stop);
        else stop();
      } catch (error) { if (current === session) streamsHealthy = false; console.warn(`[LoanFinancialSync] ${collection} stream unavailable; periodic checks remain active.`, error.message); }
    }));
  };
  const stopAuth = pb.authStore.onChange(() => { void connect(); });
  void connect();
  const check = () => {
    if (!owner || document.hidden || dataCache.isRefreshPaused() || Date.now() - lastCheck < (streamsHealthy ? 600000 : 120000)) return;
    lastCheck = Date.now();
    queue(loanSnapshotPrefix, 'groups:profile:');
  };
  const timer = setInterval(check, 120000);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
  return () => {
    session++;
    owner = '';
    stopCache(); stopAuth(); stops.forEach(stop => stop());
    clearInterval(timer); clearTimeout(pendingTimer);
    window.removeEventListener('online', check);
    document.removeEventListener('visibilitychange', check);
  };
};
