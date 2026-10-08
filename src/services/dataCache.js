import { pb } from './api.js';
import { createCacheCoordinator, observeCache } from '../core/cacheCoordinator.js';

const DB_NAME = 'InletCacheDB';
const STORE_NAME = 'collections';
const CACHE_EPOCH_KEY = 'inlet_data_cache_epoch';
export const DATA_CACHE_EPOCH = 'shared-cache-2026-10-07-v1';
let databasePromise;

const openDB = () => {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
        resolve(request.result);
      };
      request.onerror = () => { databasePromise = null; reject(request.error); };
    });
  }
  return databasePromise;
};

// Resolve writes only after the transaction commits, not at request success.
const transact = async (mode, operation) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error('Cache transaction aborted.'));
    tx.onerror = () => reject(tx.error);
    operation(tx.objectStore(STORE_NAME), value => { result = value; });
  });
};
const storage = {
  read: key => transact('readonly', (store, done) => {
    store.get(key).onsuccess = event => done(event.target.result);
  }),
  claim: (key, token) => transact('readwrite', store => {
    store.get(key).onsuccess = event => store.put({ ...event.target.result, key, token });
  }),
  commit: (key, token, data, ts) => transact('readwrite', (store, done) => {
    store.get(key).onsuccess = event => {
      if (event.target.result?.token !== token) { done(false); return; }
      store.put({ key, token, data, ts });
      done(true);
    };
  }),
  set: (key, data, ts, token) => transact('readwrite', store => { store.put({ key, data, ts, token }); }),
  remove: matches => transact('readwrite', store => {
    store.openCursor().onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) return;
      if (matches(String(cursor.key))) cursor.delete();
      cursor.continue();
    };
  }),
  clear: () => transact('readwrite', store => { store.clear(); })
};

const CHANNEL_NAME = 'inlet-cache-changes-v1';
let channel;
try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME); }
catch (error) { console.warn('[dataCache] BroadcastChannel unavailable', error); }

export const dataCache = createCacheCoordinator({
  storage,
  getOwner: () => pb.authStore.model?.id || 'anonymous',
  status: status => updateSyncStatus(status),
  publish: event => {
    // Only change metadata crosses tabs; financial records stay in IndexedDB.
    if (channel) channel.postMessage(event);
    else localStorage.setItem(CHANNEL_NAME, JSON.stringify({ ...event, nonce: crypto.randomUUID() }));
  }
});
if (channel) channel.onmessage = event => dataCache.receive(event.data);
else window.addEventListener('storage', event => {
  if (event.key !== CHANNEL_NAME || !event.newValue) return;
  try { dataCache.receive(JSON.parse(event.newValue)); } catch { /* Ignore malformed notification metadata. */ }
});

const clearBrowserCaches = async () => {
  if (!('caches' in window)) return;
  await Promise.all((await caches.keys()).map(key => caches.delete(key)));
};
dataCache.ensureCurrentEpoch = async () => {
  try {
    if (localStorage.getItem(CACHE_EPOCH_KEY) === DATA_CACHE_EPOCH) return false;
    await dataCache.invalidateAll();
    await clearBrowserCaches();
    localStorage.setItem(CACHE_EPOCH_KEY, DATA_CACHE_EPOCH);
    return true;
  } catch (error) { console.warn('[dataCache] Cache epoch check failed', error); return false; }
};
dataCache.clearLocalAppCache = async () => {
  await dataCache.invalidateAll();
  await clearBrowserCaches();
  localStorage.setItem(CACHE_EPOCH_KEY, DATA_CACHE_EPOCH);
  return true;
};
export const observeCachedView = (prefixes, refresh, options) => observeCache(dataCache, prefixes, refresh, options);

export const debounce = (fn, ms = 500) => {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
};

const updateSyncStatus = status => {
  let indicator = document.getElementById('global-sync-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'global-sync-indicator';
    indicator.setAttribute('role', 'status');
    indicator.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:8px 12px;border-radius:20px;background:var(--surface-color);box-shadow:0 4px 12px rgba(0,0,0,0.1);font-size:0.75rem;font-weight:600;z-index:9999;display:flex;align-items:center;gap:8px;transition:all 0.3s ease;pointer-events:none;';
    document.body.appendChild(indicator);
  }
  clearTimeout(indicator.hideTimeout);
  indicator.style.opacity = '1';
  const states = {
    syncing: ['var(--warning)', 'Syncing...'],
    synced: ['var(--success)', 'Synced'],
    limited: ['var(--warning)', 'Updates delayed'],
    offline: ['var(--danger)', 'Sync unavailable']
  };
  const [color, label] = states[status] || states.offline;
  indicator.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span> ${label}`;
  if (status === 'synced') indicator.hideTimeout = setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
};
