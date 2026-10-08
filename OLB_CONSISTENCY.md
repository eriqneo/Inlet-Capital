# OLB Consistency

Implemented locally after the [OLB audit](OLB_AUDIT_2026-10-07.md). No production
business records, schema, access rules or deployments are changed by this work.

## Definition

Version `olb-v1`: OLB is unpaid contractual principal + interest + outstanding
fines. Amounts are calculated in cents, not corrected by display rounding.

- A receipt's `amount` includes its collected `fine_amount`. Only the remainder
  reduces the contractual liability; the fine reduces outstanding fines.
- A posted savings balance-off reduces the contract once. Reversed receipts and
  settlements do not contribute. Duplicate persisted record IDs count once.
- Pending and awaiting-disbursement applications are not outstanding loans.
  Written-off and renewed source loans have zero current operational OLB.
- A renewal's new loan ID has its own liability and history. Earlier source
  repayments do not reduce it.
- OLB includes fines calculated from the schedule and source receipts, not an
  independently maintained schedule-paid balance. Historical schedule-paid
  fallback is disabled for these balances.
- The existing shared liability fallback remains: approved principal (then
  applied principal) plus stored/derived interest, with stored liability as a
  floor. This is not a migration that repairs inconsistent legacy contract terms.
- Invalid money, conflicting record versions, invalid persisted receipt dates
  or missing installment due dates stop calculation rather than becoming zero.

`calculateLoanBalanceBreakdown()` returns contract balance, outstanding fines
and total OLB. `createLoanPortfolioCalculator()` indexes the child records and
memoizes balances within one immutable dataset. Recreate it when records, terms,
settings or cutoff change; do not mutate its source records in place.

## Dates and Scope

The selected To date is inclusive through the end of that Nairobi calendar day.
Without To, the assessment time is now. From selects period movements or schedule
rows; it does not discard a loan's opening balance. Report OLB captions identify
the cutoff. The Repayments OLB KPI is the scoped portfolio balance, not a sum of
the same loan repeated on installment rows. Its due-date/status row filters do
not silently redefine the portfolio KPI.

Group OLB follows the account/member scope and the cutoff, independently of the
loan table's application-date filter. Group risk denominator uses that same
remaining OLB rather than original disbursed liability.

The calculator restores written-off loans before their effective write-off date
and renewed source loans before the successor's renewal date. Missing renewal
context stops historical calculation. Current account assignment and lifecycle
are still applied; this is not event-time reconstruction of transfers, waivers,
edited contract terms or legacy in-place renewals. Complete historical accounting
requires versioned event history. Arrears are now connected under their separate
contract in [Arrears Consistency](ARREARS_CONSISTENCY.md). Collections, growth and
P&L retain separate definitions; this work does not certify all those metrics.

## Shared Data and Updates

Dashboard, Analytics, Reports and the loan debt-unit lists read the same
officer-scoped `loans:financial:snapshot:v2:` bundle. All required reads must
succeed before it is stored. Source loans, owners, repayments, balance-offs,
schedules and penalty setting are included. Group Profile retains bounded
group-specific queries but publishes its complete bundle together. Loan Overview
uses the same calculator and refuses a headline balance when required reads fail.

Initial failures show unavailable, not fabricated balances. Failed explicit
refreshes preserve a prior complete Dashboard/Analytics/Group view with a stale
notice, or disable incomplete report sections and exports. The cache's global
sync indicator also exposes failed background revalidation. A successful bundle
is complete as fetched, but sequential PocketBase reads are **not a database
transaction**. Cross-record writes still need an authoritative server transaction
or snapshot endpoint for atomic consistency.

`startLoanFinancialSync()` owns session subscriptions for loans, repayments,
balance-offs, schedules, settings and account ownership/lifecycle. Source changes
invalidate the financial bundle and group-profile bundle; local cache invalidation
bridges cover mutations when realtime is unavailable. Bursts are coalesced and
same-origin tabs receive metadata notifications. Streams stop on logout/HMR.

Routine financial refresh is ten minutes when subscriptions connected, with a
two-minute fallback when subscription setup failed. Local mutations and realtime
events refresh promptly rather than waiting for that timer. Existing per-session
429 cooldown applies. These are not guaranteed cross-device update times during
a network outage, nor a shared-IP rate limiter. Large portfolios/many users still
need authorized, versioned backend aggregates to stay within PocketHost limits.

Officer ownership is used in server query filters and client/cache scope.
Member ownership takes precedence over group ownership. This does not replace
PocketBase collection access rules; those must independently enforce authorization.

## Verification and Deployment

```sh
node tests/loanPortfolio.test.mjs
node tests/loanFinancialSnapshot.test.mjs
node --test tests/*.test.mjs
npm run build
TEST_PAGE=/tests/olb.browser.html node scripts/test_cache_browser.mjs
TEST_TIMEZONE=Pacific/Auckland TEST_PAGE=/tests/olb.browser.html node scripts/test_cache_browser.mjs
TEST_TIMEZONE=America/Los_Angeles TEST_PAGE=/tests/olb.browser.html node scripts/test_cache_browser.mjs
TEST_PAGE=/tests/savings.browser.html node scripts/test_cache_browser.mjs
```

Browser tests mock PocketBase, block live sends and use an isolated browser
profile. They check the actual view renderers, external receipt/settlement events,
cutoffs, officer isolation, failure/export guards and savings regressions.

The original read-only production audit succeeded before implementation. An
initial post-implementation recheck stopped on a transport error (curl exit 56).
The 8 October recheck then exposed legacy recurring-decimal installment amounts;
after shared installment normalization, live-source OLB recalculated successfully
to **KES 1,759,790.00**. See `ARREARS_AUDIT_2026-10-08.md` for the read timestamp,
scope and limitations. This is not deployed-UI verification. No business record
was written during the audits.

Build regenerates `pb_hooks/lib/debtRecovery.js`, because renewal quotes import
the shared balance/fine calculation. Upload that generated library with the
existing recovery hook when deploying approved changes; it is not uploaded here.
No new schema fields are required for this implementation. No commit or push
has been made. Future financial changes must extend these shared modules and
cross-view tests, not add local OLB formulas.
