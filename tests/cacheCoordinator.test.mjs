import test from 'node:test';
import assert from 'node:assert/strict';
import { createCacheCoordinator, observeCache } from '../src/core/cacheCoordinator.js';
import { trackPageSubscriptions } from '../src/core/pageSubscriptions.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const makeStorage = () => {
  const entries = new Map();
  return {
    entries,
    async read(key) { return structuredClone(entries.get(key)); },
    async claim(key, token) { entries.set(key, { ...entries.get(key), token }); },
    async commit(key, token, data, ts) {
      if (entries.get(key)?.token !== token) return false;
      entries.set(key, { token, data, ts });
      return true;
    },
    async set(key, data, ts, token) { entries.set(key, { data, ts, token }); },
    async remove(matches) { for (const key of entries.keys()) if (matches(key)) entries.delete(key); },
    async clear() { entries.clear(); }
  };
};
const setup = (options = {}) => {
  const storage = options.storage || makeStorage();
  const events = [];
  const cache = createCacheCoordinator({ storage, getOwner: () => 'admin',
    publish: event => events.push(event), warn: () => {}, ...options });
  return { cache, storage, events };
};

test('coalesces simultaneous cache misses into one request', async () => {
  const { cache } = setup();
  const gate = deferred();
  let calls = 0;
  const fetch = () => { calls += 1; return gate.promise; };
  const first = cache.get('savings:all', fetch);
  const second = cache.getLocalFirst('savings:all', fetch);
  await tick();
  assert.equal(calls, 1);
  gate.resolve([100]);
  assert.deepEqual(await first, [100]);
  assert.deepEqual(await second, [100]);
});

test('both read APIs deduplicate stale refreshes and notify their callbacks', async () => {
  let now = 1;
  const { cache } = setup({ now: () => now });
  await cache.set('savings:all', [1]);
  now = 400000;
  const gate = deferred();
  let calls = 0;
  const updates = [];
  const fetch = () => { calls += 1; return gate.promise; };
  assert.deepEqual(await cache.get('savings:all', fetch, value => updates.push(value)), [1]);
  assert.deepEqual(await cache.getLocalFirst('savings:all', fetch, value => updates.push(value)), [1]);
  await tick();
  assert.equal(calls, 1);
  gate.resolve([2]);
  await tick();
  assert.deepEqual(updates, [[2], [2]]);
});

test('an invalidated request cannot restore deleted data or detach its replacement', async () => {
  const { cache, storage } = setup();
  const old = deferred(), fresh = deferred();
  const request = cache.refresh('savings:all', () => old.promise);
  const rejected = assert.rejects(request, { isCacheObsolete: true });
  await tick();
  await cache.invalidatePrefixes(['savings:', 'group_summary:']);
  const replacement = cache.refresh('savings:all', () => fresh.promise);
  await tick();
  old.resolve(['deleted']);
  await rejected;
  assert.equal(storage.entries.get('admin::savings:all')?.data, undefined);
  assert.equal(cache.refresh('savings:all', () => { throw new Error('Duplicate request'); }), replacement);
  fresh.resolve(['current']);
  assert.deepEqual(await replacement, ['current']);
});

test('unrelated invalidations do not cancel a loan request', async () => {
  const { cache } = setup();
  const gate = deferred();
  const request = cache.refresh('loans:all', () => gate.promise);
  await tick();
  await cache.invalidatePrefix('savings:');
  gate.resolve([1]);
  assert.deepEqual(await request, [1]);
});

test('persistent claims reject stale writes across tabs even before a broadcast arrives', async () => {
  const storage = makeStorage();
  const first = setup({ storage }).cache;
  const second = setup({ storage }).cache;
  const gate = deferred();
  const request = first.refresh('savings:all', () => gate.promise);
  const rejected = assert.rejects(request, { isCacheObsolete: true });
  await tick();
  await second.invalidatePrefix('savings:');
  await second.refresh('savings:all', async () => ['new']);
  gate.resolve(['old']);
  await rejected;
  assert.deepEqual(storage.entries.get('admin::savings:all').data, ['new']);
});

test('manual cache writes supersede pending requests', async () => {
  const { cache, storage } = setup();
  const gate = deferred();
  const request = cache.refresh('savings:all', () => gate.promise);
  const rejected = assert.rejects(request, { isCacheObsolete: true });
  await tick();
  await cache.set('savings:all', ['corrected']);
  gate.resolve(['old']);
  await rejected;
  assert.deepEqual(storage.entries.get('admin::savings:all').data, ['corrected']);
});

test('cache clearing blocks pending writes, but cannot bypass rate limiting', async () => {
  let now = 0;
  const { cache, storage } = setup({ now: () => now });
  const gate = deferred();
  const request = cache.refresh('savings:all', () => gate.promise);
  const rejected = assert.rejects(request, { isCacheObsolete: true });
  await tick();
  await cache.invalidateAll();
  gate.resolve(['old']);
  await rejected;
  assert.equal(storage.entries.size, 0);
  await assert.rejects(cache.refresh('savings:all', async () => {
    throw Object.assign(new Error('retry after 100 seconds'), { status: 429 });
  }), { status: 429 });
  await cache.invalidateAll();
  await assert.rejects(cache.refresh('savings:other', async () => []), { isCacheBackoff: true });
  now = 100001;
  assert.deepEqual(await cache.refresh('savings:other', async () => [2]), [2]);
});

test('owner changes never deliver or persist previous-user results', async () => {
  let owner = 'A';
  const { cache, storage } = setup({ getOwner: () => owner });
  const gate = deferred();
  const request = cache.getLocalFirst('savings:all', () => gate.promise);
  const rejected = assert.rejects(request, { isCacheObsolete: true });
  await tick();
  owner = 'B';
  gate.resolve(['private']);
  await rejected;
  assert.equal(storage.entries.get('A::savings:all')?.data, undefined);
  assert.equal(storage.entries.has('B::savings:all'), false);
});

test('network failures are not retried as storage failures', async () => {
  const { cache } = setup();
  let calls = 0;
  await assert.rejects(cache.getLocalFirst('savings:all', async () => {
    calls += 1;
    throw Object.assign(new Error('Access denied'), { status: 403 });
  }), { status: 403 });
  assert.equal(calls, 1);
});

test('storage unavailable still returns one network response without a notification loop', async () => {
  const storage = makeStorage();
  storage.read = storage.claim = async () => { throw new Error('Storage disabled'); };
  const { cache, events } = setup({ storage });
  let calls = 0;
  assert.deepEqual(await cache.get('savings:all', async () => { calls += 1; return [5]; }), [5]);
  assert.equal(calls, 1);
  assert.equal(events.length, 0);
});

test('cross-tab notifications isolate users and never echo', async () => {
  const { cache, events } = setup();
  const received = [];
  cache.subscribe(event => received.push(event));
  cache.receive({ type: 'invalidated', owner: 'another-user', prefixes: ['savings:'] });
  cache.receive({ type: 'invalidated', owner: 'admin', prefixes: ['savings:'] });
  assert.equal(received.length, 1);
  assert.equal(events.length, 0);
  assert.equal(JSON.stringify(received).includes('amount'), false);
});

test('failed invalidation bypasses persisted old data instead of showing it again', async () => {
  const { cache, storage } = setup();
  await cache.set('savings:all', [100]);
  storage.remove = async () => { throw new Error('Storage transaction failed'); };
  await cache.invalidatePrefix('savings:');
  assert.deepEqual(await cache.getLocalFirst('savings:all', async () => [200]), [200]);
});

test('view observers coalesce bursts, queue changes during loading, and dispose', async () => {
  const { cache } = setup();
  const gate = deferred();
  let calls = 0;
  const stop = observeCache(cache, ['savings:'], async () => {
    calls += 1;
    if (calls === 1) await gate.promise;
  }, { delay: 1 });
  await cache.invalidatePrefix('savings:');
  await cache.invalidatePrefix('savings:');
  await pause();
  assert.equal(calls, 1);
  await cache.invalidatePrefix('savings:');
  await pause();
  assert.equal(calls, 1);
  gate.resolve();
  await pause();
  assert.equal(calls, 2);
  await cache.invalidatePrefix('savings:');
  stop();
  await pause();
  assert.equal(calls, 2);
});

test('a refreshed savings dataset reaches all subscribed module consumers', async () => {
  const { cache } = setup();
  const values = new Map();
  const stops = ['Dashboard', 'Analytics', 'Reports', 'Savings'].map(name =>
    observeCache(cache, ['savings:'], async () => {
      values.set(name, await cache.getLocalFirst('savings:financial', async () => [600]));
    }, { delay: 1 }));
  await cache.set('savings:financial', [400]);
  await pause();
  assert.deepEqual([...values.values()], [[400], [400], [400], [400]]);
  await cache.invalidatePrefix('savings:');
  await pause();
  assert.deepEqual([...values.values()], [[600], [600], [600], [600]]);
  stops.forEach(stop => stop());
});

test('router cleanup releases subscriptions registered after navigation exactly once', async () => {
  const element = {};
  const dispose = trackPageSubscriptions(element);
  let calls = 0;
  const stop = () => calls++;
  const pending = deferred();
  element.__subscriptionPromise = pending.promise;
  dispose();
  element.__subscriptions = [stop];
  pending.resolve([stop]);
  await tick();
  dispose();
  assert.equal(calls, 1);
});
