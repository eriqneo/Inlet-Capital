import { pb } from './api.js';

const DB_NAME = 'InletCacheDB';
const DB_VERSION = 1;
const STORE_NAME = 'collections';
const TTL = 5 * 60 * 1000; // 5 minutes (data older than this triggers background refresh on access)
const DEFAULT_LOCAL_FIRST_REFRESH_INTERVAL = 10 * 1000;
const CACHE_EPOCH_KEY = 'inlet_data_cache_epoch';
export const DATA_CACHE_EPOCH = 'officer-isolation-2026-08-06-v1';
const inFlightRefreshes = new Map();

const getCacheOwner = () => pb.authStore.model?.id || 'anonymous';
const getScopedKey = (key) => `${getCacheOwner()}::${String(key)}`;

// Wrap IndexedDB in a Promise API
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getFromDB = async (key) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const putToDB = async (key, data) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put({ key, data, ts: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const deleteFromDB = async (key) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const clearDB = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const clearBrowserCaches = async () => {
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map(key => caches.delete(key)));
};

const getAllKeys = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const dataCache = {
  async ensureCurrentEpoch() {
    try {
      const storedEpoch = localStorage.getItem(CACHE_EPOCH_KEY);
      if (storedEpoch === DATA_CACHE_EPOCH) return false;
      await clearDB();
      await clearBrowserCaches();
      inFlightRefreshes.clear();
      localStorage.setItem(CACHE_EPOCH_KEY, DATA_CACHE_EPOCH);
      console.info(`[dataCache] Cleared stale local data cache for ${DATA_CACHE_EPOCH}.`);
      return true;
    } catch (e) {
      console.warn('[dataCache] Cache epoch check failed:', e);
      return false;
    }
  },

  async clearLocalAppCache() {
    try {
      await clearDB();
      await clearBrowserCaches();
      inFlightRefreshes.clear();
      localStorage.setItem(CACHE_EPOCH_KEY, DATA_CACHE_EPOCH);
      return true;
    } catch (e) {
      console.error('[dataCache] Manual local cache clear failed:', e);
      throw e;
    }
  },

  /**
   * Get data from cache, or fetch it if missing/stale.
   * If cached data exists but is stale, returns cached data immediately
   * and triggers a background refresh.
   */
  async get(key, fetchFn, onUpdate = null) {
    const scopedKey = getScopedKey(key);
    try {
      const cached = await getFromDB(scopedKey);
      const now = Date.now();
      
      if (cached) {
        const isStale = (now - cached.ts) > TTL;
        
        if (isStale) {
          // Background refresh
          this.refresh(key, fetchFn).then(newData => {
             if (onUpdate) onUpdate(newData);
          }).catch(err => console.warn(`[dataCache] Background refresh failed for ${key}`, err));
        }
        
        return cached.data;
      }
      
      // Not in cache, must fetch
      return await this.refresh(key, fetchFn);
    } catch (err) {
      console.error(`[dataCache] Error accessing DB for ${key}`, err);
      // Fallback to fetch
      return await fetchFn();
    }
  },

  /**
   * Local-first read path.
   * If IndexedDB has data, return it immediately and refresh from PocketBase in
   * the background after a short cooldown. This is the fast path for shared
   * master data such as members and groups.
   */
  async getLocalFirst(key, fetchFn, onUpdate = null, options = {}) {
    const minRefreshInterval = options.minRefreshInterval ?? DEFAULT_LOCAL_FIRST_REFRESH_INTERVAL;
    const scopedKey = getScopedKey(key);

    try {
      const cached = await getFromDB(scopedKey);
      const now = Date.now();

      if (cached) {
        const shouldRefresh = (now - cached.ts) > minRefreshInterval;
        if (shouldRefresh) {
          this.refreshDedupe(key, fetchFn)
            .then(newData => {
              if (onUpdate) onUpdate(newData);
            })
            .catch(err => console.warn(`[dataCache] Local-first refresh failed for ${key}`, err));
        }
        return cached.data;
      }

      return await this.refreshDedupe(key, fetchFn);
    } catch (err) {
      console.error(`[dataCache] Local-first access failed for ${key}`, err);
      return await fetchFn();
    }
  },

  async refreshDedupe(key, fetchFn) {
    const scopedKey = getScopedKey(key);
    if (inFlightRefreshes.has(scopedKey)) return await inFlightRefreshes.get(scopedKey);

    const refreshPromise = this.refresh(key, fetchFn)
      .finally(() => inFlightRefreshes.delete(scopedKey));
    inFlightRefreshes.set(scopedKey, refreshPromise);
    return await refreshPromise;
  },
  
  /**
   * Forcibly fetch new data and update the cache
   */
  async refresh(key, fetchFn) {
    const cacheOwner = getCacheOwner();
    const scopedKey = getScopedKey(key);
    try {
      // Ensure UI knows we are syncing
      updateSyncStatus('syncing');
      const freshData = await fetchFn();
      if (getCacheOwner() !== cacheOwner) return freshData;
      await putToDB(scopedKey, freshData);
      updateSyncStatus('synced');
      return freshData;
    } catch (err) {
      console.error(`[dataCache] Refresh failed for ${key}`, err);
      updateSyncStatus('offline');
      throw err;
    }
  },

  async invalidate(key) {
    try {
      await deleteFromDB(getScopedKey(key));
    } catch (e) {
      console.error(`[dataCache] Invalidate failed for ${key}`, e);
    }
  },

  async invalidatePrefix(prefix) {
    try {
      const keys = await getAllKeys();
      const scopedPrefix = getScopedKey(prefix);
      await Promise.all(keys
        .filter(key => String(key).startsWith(scopedPrefix))
        .map(key => deleteFromDB(key)));
    } catch (e) {
      console.error(`[dataCache] Prefix invalidate failed for ${prefix}`, e);
    }
  },

  async set(key, data) {
    try {
      await putToDB(getScopedKey(key), data);
    } catch (e) {
      console.error(`[dataCache] Set failed for ${key}`, e);
    }
  },
  
  async invalidateAll() {
    try {
      await clearDB();
      inFlightRefreshes.clear();
    } catch (e) {
      console.error(`[dataCache] Clear failed`, e);
    }
  }
};

export const debounce = (fn, ms = 500) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

/**
 * Global UI indicator for sync status
 */
const updateSyncStatus = (status) => {
  let indicator = document.getElementById('global-sync-indicator');
  
  // Create if it doesn't exist (append to body so it floats)
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'global-sync-indicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 8px 12px;
      border-radius: 20px;
      background: var(--surface-color);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      font-size: 0.75rem;
      font-weight: 600;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.3s ease;
      opacity: 0;
      transform: translateY(10px);
      pointer-events: none;
    `;
    document.body.appendChild(indicator);
  }

  // Clear any existing hide timeout
  if (indicator.hideTimeout) clearTimeout(indicator.hideTimeout);
  
  indicator.style.opacity = '1';
  indicator.style.transform = 'translateY(0)';

  if (status === 'syncing') {
    indicator.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--warning); animation: pulse 1s infinite;"></span> Syncing...`;
  } else if (status === 'synced') {
    indicator.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--success);"></span> Synced`;
    // Hide after 2 seconds
    indicator.hideTimeout = setTimeout(() => {
      indicator.style.opacity = '0';
      indicator.style.transform = 'translateY(10px)';
    }, 2000);
  } else if (status === 'offline') {
    indicator.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--danger);"></span> Offline`;
  }
};

// Add global keyframe for pulse animation if missing
if (!document.getElementById('sync-style')) {
  const style = document.createElement('style');
  style.id = 'sync-style';
  style.innerHTML = `@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }`;
  document.head.appendChild(style);
}
