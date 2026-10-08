# Shared Cache and Savings Updates

Implemented locally as Step 2 of the savings consistency work, 2026-10-07.
This changes synchronization, not the financial definitions or database schema.
See [Financial Definitions](FINANCIAL_DEFINITIONS.md) for the separate calculation
contract and unresolved policy decisions.

## Update Flow

1. A savings create, update, delete, or reversal succeeds in PocketBase.
2. `invalidateSavings()` invalidates `savings:`, `group_summary:`, and
   `groups:profile:` together for the current cache owner.
3. Cache observers notify dependent visible-page code; existing page filters
   and selected report tabs remain in their view's state.
4. Reads share requests by cache key. Background refreshes notify observers
   after the IndexedDB write commits.
5. BroadcastChannel sends change metadata to other same-origin tabs. The
   storage-event fallback is used when BroadcastChannel is unavailable. No
   financial records are included in those messages.

Dashboard, Analytics, Reports, and Savings listen to cache changes. Member and
group savings profiles use the same savings notifications. Group Profile uses
matching officer-scoped read/write keys and applies background cache results.
The router releases page observers, including subscriptions registered after an
asynchronous profile initialization or after the user has navigated away.

`startSavingsSync()` maintains one PocketBase savings subscription per app
session, replacing the separate savings subscriptions used by those views.
Visible sessions check every two minutes as a fallback; returning to a visible
tab or coming online also checks after that interval. Realtime events invalidate
the cache immediately even in hidden tabs. This is not a guarantee of instant
cross-device updates while realtime/network service is unavailable.

The later OLB work adds `startLoanFinancialSync()` for loan-related records,
settings and ownership changes. See [OLB Consistency](OLB_CONSISTENCY.md) for its
shared snapshots and refresh rules. Remaining unrelated collections retain their
existing subscriptions.

## Request and Storage Rules

- Cache keys remain scoped by the signed-in user, with officer/query scope added
  by the calling service. One user's broadcast does not refresh another user's
  view. Broadcasts are never echoed back.
- Each refresh claims a token in IndexedDB. Its write can commit only while that
  token is current. Invalidation, a newer tab's refresh, or an explicit cache
  write makes an older token obsolete.
- Obsolete fetches cannot overwrite persisted data or invoke stale callbacks.
  Normal reads can retry a superseded request up to twice; owner changes stop
  delivery rather than retrying under another account.
- Cache writes resolve at transaction completion. A failed cache invalidation
  causes that session to bypass persisted data, so it cannot reuse the stale
  value that failed to clear.
- Network errors are not retried as IndexedDB failures. Rate-limit cooldowns
  apply across keys in that user's session and survive cache invalidation.
  The fallback is 30 minutes when no retry duration is available. Another tab
  has its own network cooldown; this is not a server-wide rate limiter.
- A successful server mutation remains successful if local cache cleanup or
  notification fails. Cache cleanup does not roll back the financial write.
- A cache epoch change clears incompatible existing caches once on startup.

## Avoid Refresh Loops

`observeCachedView(prefixes, refresh, options)` coalesces bursts and queues another
refresh when a change arrives during loading. Its returned cleanup must be
registered with the page's subscription lifecycle.

The `updates` option limits which completed cache writes trigger a rerender.
Reports now reads the shared financial snapshot instead of force-writing its own
fresh loan cache on every load. It observes completed shared snapshot updates
without a self-refresh loop. Do not invalidate savings from a savings-change observer;
the producer has already invalidated it.

## Verification

Run coordinator and lifecycle tests:

```sh
node tests/cacheCoordinator.test.mjs
node --test tests/*.test.mjs
npm run build
```

Run the actual IndexedDB and page-renderer tests in an isolated Chrome profile:

```sh
npm run dev -- --host 127.0.0.1 --port 5181
node scripts/test_cache_browser.mjs
```

The browser runner needs Node with built-in WebSocket support and Chrome. Set
`CHROME_BIN` or `TEST_BASE_URL` if those differ locally. It creates and removes a
temporary browser profile. The harness uses synthetic savings and mocked
PocketBase methods; it does not read or mutate live financial records. The harness
requires the runner's initialization flag before changing synthetic auth or cache
state, and refuses to run when opened directly in an ordinary browser tab.

## Remaining Work

Synchronization cannot reconcile different formulas. Step 3 connects the main
savings calculations and date/account scopes; see
[Savings Consistency](SAVINGS_CONSISTENCY.md) for coverage and limitations. The
unsafe browser group-summary writer and unverified summary display have been
retired. Authoritative server summaries and atomic multi-record financial writes
remain future work. Cross-device
ownership/lifecycle events now invalidate the shared financial bundle and group
profiles; other module-specific data flows still need their own regression checks.
