# Shared Savings Calculations

Step 3 implementation, 2026-10-07. This changes application code, not live records
or the PocketHost schema. Business definitions remain in
[Financial Definitions](FINANCIAL_DEFINITIONS.md); cache behavior is documented in
[Cache Sync](CACHE_SYNC.md).

## Calculation Ownership

`src/core/savingsMetrics.js` owns transaction normalization, reversal exclusion,
ID deduplication, monetary sums in cents, Nairobi date boundaries, current account
ownership, and optional officer/lifecycle selection. A member relation takes
precedence over a transaction's historical group relation.

Use `calculateSavingsSummary` for already-scoped records. Use
`selectSavingsRecords` with authorized member/group context and a date range
before summing. `calculateSavingsPeriod` additionally returns opening and closing
balances; its `net` is movement, not the closing balance.

Unknown transaction types, invalid amounts, conflicting equal-version records,
and invalid dated records raise errors instead of being silently counted as
deposits or zero. Blank legacy types remain deposits. A newer `updated` revision
supersedes an older copy of the same ID; distinct IDs are never merged because
their amounts happen to match.

## Connected Views

- Dashboard, Analytics, Savings History and Reports share
  `savingsService.getFinancialRecordsCached()` and its scoped ledger cache.
- Member profiles, group profiles, group cards, and
  member-balance services use the same monetary calculator.
- The loan balance-off fallback savings check uses that calculator too. This
  does not make the existing multi-request balance-off operation atomic.
- Savings History totals, count, sorting and pagination use one selected dataset.
  It shows eligible operational transactions; reversed records remain visible
  and labelled in member history.
- Individual Performance retains separate member and group-account figures.
  Its combined savings KPI intentionally includes both when All Members or
  Group Members is selected; member rows do not invent group-account ownership.
- Group Performance savings use transaction dates. A group's most recent
  activity no longer removes it from a historical savings period. Other group
  measures such as OLB remain current-position measures in this step.
- Group profile member-table dates still select Last Saved, as previously
  requested. Its savings KPI/table use transaction dates independently; a later
  deposit does not erase a member's earlier-period savings.
- Cash Flow and Withdrawals identify internal balance-offs from linked
  `loan_balance_offs.savings_transaction` IDs. The debit reduces savings once;
  it is excluded from net cash movement. Cash Flow displays the reconciliation.
- Print/PDF and Excel reuse full filtered report rows. No export-only savings
  formula has been added.

The old automatic assignment of a group deposit to its sole member was removed.
An administrator can still explicitly assign a transaction after verifying its
owner; a group-account deposit is not inherently an error.

## Verification

Run from the project root:

```sh
node --test tests/*.test.mjs
npm run build
npm run dev -- --host 127.0.0.1 --port 5181
```

With that development server running, use a separate terminal:

```sh
node scripts/test_cache_browser.mjs
TEST_PAGE=/tests/savings.browser.html node scripts/test_cache_browser.mjs
TEST_PAGE=/tests/savings.browser.html TEST_TIMEZONE=America/Los_Angeles node scripts/test_cache_browser.mjs
```

The browser runner requires Chrome and uses a disposable profile. The savings
test substitutes all PocketBase reads and writes and rejects unexpected network
calls. It tests seven real page renderers, legacy deposits, reversals, suspended
members, transferred group membership, Nairobi day boundaries, internal
balance-offs, exports beyond page one, and the failed savings-load state.
The cache suite additionally tests refresh-after-amendment. These are synthetic
regressions, not a certification of the current production ledger.

## Remaining Work

- Live reconciliation under identical dates and officer scope is still needed
  after deployment approval. No production totals have been asserted here.
- Group cards and profiles no longer display stored `group_summary` or
  `groups.total_savings` values while loading. They show a checking state, then
  calculate from loaded source records. Failed initial reads stop calculation;
  failed refreshes retain the previous view with an explicit warning.
- Opening a profile no longer writes a browser-derived summary back to the
  server. The unused browser summary service has been retired. Existing server
  summary records remain unchanged and are not authoritative to these screens.
  Versioned, transactionally maintained backend rollups need a separate server
  implementation/deployment before they can safely replace source reads.
- Group profiles observe membership and savings invalidations. Refreshes use
  guarded cache requests and publish the complete refreshed dataset together,
  preserving the selected filters. Group cards reject superseded hydrations.
- All-ledger reads are reused, not made bounded. Larger datasets need indexed,
  authorized backend aggregate queries using these same definitions.
- Missing ownership hidden by existing service/lifecycle filters cannot be
  diagnosed by a frontend calculator. An authorized backend orphan-record audit
  is still required. Missing balance-off links likewise need reconciliation.
- Suspended-group cascade rules, future-dated entries and growth comparison
  policy remain the unresolved decisions in Financial Definitions. This step
  does not change them.
- OLB is now connected separately; see [OLB Consistency](OLB_CONSISTENCY.md).
  Arrears are connected under [Arrears Consistency](ARREARS_CONSISTENCY.md).
  P&L and atomic financial writes remain separate work. Passing savings tests
  does not certify those calculations or database access rules.
