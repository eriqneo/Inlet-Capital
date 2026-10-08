export const obsoleteCacheRead = () => Object.assign(new Error('Cache read superseded by a newer change.'), {
  isCacheObsolete: true
});

// Storage claims are persisted so requests in other tabs cannot restore old data.
export const createCacheCoordinator = ({ storage, getOwner, publish = () => {}, status = () => {},
  now = Date.now, token = () => crypto.randomUUID(), warn = console.warn }) => {
  const flights = new Map();
  const backoffs = new Map();
  const listeners = new Set();
  const scoped = (owner, key) => `${owner}::${key}`;
  let generation = 0;
  let clearGeneration = 0;
  let activeRequests = 0;
  let persistenceAvailable = true;

  const emit = event => {
    if (event.owner !== getOwner() && event.type !== 'cleared') return;
    for (const listener of listeners) {
      try { listener(event); } catch (error) { warn('[cache] Observer failed', error); }
    }
  };
  const announce = event => {
    emit(event);
    try { publish(event); } catch (error) { warn('[cache] Cross-tab notification failed', error); }
  };
  const forget = event => {
    for (const [key, flight] of flights) {
      if (event.type === 'cleared' || (flight.owner === event.owner &&
        (event.exact ? flight.key === event.exact : event.prefixes.some(prefix => flight.key.startsWith(prefix))))) {
        flights.delete(key);
      }
    }
  };
  const readStored = async key => {
    if (!persistenceAvailable) return null;
    try { return await storage.read(key); }
    catch (error) { persistenceAvailable = false; warn('[cache] Local storage unavailable', error); return null; }
  };
  const backoffError = owner => {
    if ((backoffs.get(owner) || 0) <= now()) return null;
    return Object.assign(new Error('Refresh paused temporarily after server rate limiting.'), {
      status: 429, isCacheBackoff: true
    });
  };

  const refresh = (key, fetchFn) => {
    const owner = getOwner();
    const scopedKey = scoped(owner, key);
    if (flights.has(scopedKey)) return flights.get(scopedKey).promise;
    const limited = backoffError(owner);
    if (limited) return Promise.reject(limited);
    const flight = { key, owner, token: token(), generation: clearGeneration };
    flights.set(scopedKey, flight);
    flight.promise = (async () => {
      let claimed = false;
      let persisted = false;
      let outcome = 'synced';
      activeRequests += 1;
      status('syncing');
      const current = () => getOwner() === owner && clearGeneration === flight.generation && flights.get(scopedKey) === flight;
      try {
        if (persistenceAvailable) {
          try { await storage.claim(scopedKey, flight.token); claimed = true; }
          catch (error) { persistenceAvailable = false; warn('[cache] Cache claim failed; fetching without persistence', error); }
        }
        if (!current()) throw obsoleteCacheRead();
        const data = await fetchFn();
        if (!current()) throw obsoleteCacheRead();
        if (claimed) {
          let committed;
          try { committed = await storage.commit(scopedKey, flight.token, data, now()); }
          catch (error) { persistenceAvailable = false; warn('[cache] Cache persistence failed', error); }
          if (committed === false) throw obsoleteCacheRead();
          persisted = committed === true;
        }
        if (!current()) throw obsoleteCacheRead();
        if (persisted) announce({ type: 'updated', owner, key });
        return data;
      } catch (error) {
        if (error.isCacheObsolete) throw error;
        if (Number(error.status) === 429) {
          const message = [error.message, error.data?.message, error.response?.message].filter(Boolean).join(' ');
          const seconds = Number(message.match(/retry\s+after\s+(\d+)\s*seconds?/i)?.[1]);
          backoffs.set(owner, now() + (seconds > 0 ? seconds * 1000 : 30 * 60 * 1000));
          outcome = 'limited';
        } else outcome = 'offline';
        throw error;
      } finally {
        if (flights.get(scopedKey) === flight) flights.delete(scopedKey);
        activeRequests -= 1;
        if (activeRequests === 0) status(backoffError(getOwner()) ? 'limited' : outcome);
      }
    })();
    return flight.promise;
  };

  const read = async (key, fetchFn, onUpdate, interval, attempts = 0) => {
    const owner = getOwner();
    const readGeneration = generation;
    const cached = await readStored(scoped(owner, key));
    if (owner !== getOwner()) throw obsoleteCacheRead();
    if (readGeneration !== generation) {
      if (attempts < 2) return read(key, fetchFn, onUpdate, interval, attempts + 1);
      throw obsoleteCacheRead();
    }
    if (cached && Object.hasOwn(cached, 'data')) {
      if (now() - cached.ts > interval && !backoffError(owner)) {
        refresh(key, fetchFn).then(data => {
          if (owner === getOwner() && readGeneration === generation) onUpdate?.(data);
        }).catch(error => {
          if (!error.isCacheObsolete) warn(`[cache] Background refresh failed for ${key}`, error);
        });
      }
      return cached.data;
    }
    try { return await refresh(key, fetchFn); }
    catch (error) {
      if (error.isCacheObsolete && owner === getOwner() && attempts < 2) {
        return read(key, fetchFn, onUpdate, interval, attempts + 1);
      }
      throw error;
    }
  };

  const invalidate = async ({ prefixes, exact }) => {
    const owner = getOwner();
    const event = { type: 'invalidated', owner, ...(exact !== undefined ? { exact } : { prefixes }) };
    generation += 1;
    forget(event);
    try {
      await storage.remove(key => exact !== undefined ? key === scoped(owner, exact)
        : prefixes.some(prefix => key.startsWith(scoped(owner, prefix))));
    } catch (error) {
      persistenceAvailable = false;
      event.storageUnavailable = true;
      warn('[cache] Invalidation failed; bypassing persisted data', error);
    }
    announce(event);
  };

  return {
    get: (key, fetchFn, onUpdate = null) => read(key, fetchFn, onUpdate, 5 * 60 * 1000),
    getLocalFirst: (key, fetchFn, onUpdate = null, options = {}) =>
      read(key, fetchFn, onUpdate, options.minRefreshInterval ?? 60 * 1000),
    refresh,
    refreshDedupe: refresh,
    isRefreshPaused: () => Boolean(backoffError(getOwner())),
    invalidate: exact => invalidate({ exact }),
    invalidatePrefix: prefix => invalidate({ prefixes: [prefix] }),
    invalidatePrefixes: prefixes => invalidate({ prefixes: [...new Set(prefixes)] }),
    async set(key, data) {
      const owner = getOwner();
      const scopedKey = scoped(owner, key);
      flights.delete(scopedKey);
      try { await storage.set(scopedKey, data, now(), token()); }
      catch (error) { persistenceAvailable = false; warn('[cache] Cache write failed', error); }
      announce({ type: 'updated', owner, key });
    },
    async invalidateAll() {
      generation += 1;
      clearGeneration += 1;
      flights.clear();
      await storage.clear();
      announce({ type: 'cleared', owner: getOwner() });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    receive(event) {
      if (!event || !['invalidated', 'updated', 'cleared'].includes(event.type)) return;
      if (event.type !== 'cleared' && event.owner !== getOwner()) return;
      if (event.type === 'invalidated' && typeof event.exact !== 'string' &&
        (!Array.isArray(event.prefixes) || !event.prefixes.every(prefix => typeof prefix === 'string'))) return;
      if (event.type === 'cleared') clearGeneration += 1;
      if (event.storageUnavailable) persistenceAvailable = false;
      if (event.type !== 'updated') { generation += 1; forget(event); }
      emit(event);
    }
  };
};

// Re-render after a burst of cache changes, preserving page filters and queuing
// a follow-up if a mutation arrives while the current render is still loading.
export const observeCache = (cache, prefixes, refresh, { delay = 200, updates = prefixes, onError = console.warn } = {}) => {
  let disposed = false, running = false, pending = false, timer;
  const run = async () => {
    if (disposed || running) return;
    pending = false;
    running = true;
    try { await refresh(); }
    catch (error) { if (!error.isCacheObsolete) onError(error); }
    finally {
      running = false;
      if (pending && !disposed) timer = setTimeout(run, delay);
    }
  };
  const unsubscribe = cache.subscribe(event => {
    const relevant = event.type === 'cleared' || (event.type === 'updated'
      ? updates.some(prefix => event.key?.startsWith(prefix))
      : prefixes.some(prefix => event.exact ? event.exact.startsWith(prefix)
        : event.prefixes.some(changed => changed.startsWith(prefix) || prefix.startsWith(changed))));
    if (!relevant || disposed) return;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  });
  return () => { disposed = true; clearTimeout(timer); unsubscribe(); };
};
