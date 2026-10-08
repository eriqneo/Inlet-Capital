# Arrears Consistency

Definition version: `arrears-v1`, 2026-10-08, Africa/Nairobi.

## Financial Contract

Arrears are the unpaid **principal plus contractual interest** in installments
whose due calendar day has passed. An installment due today is not overdue.
Fines are excluded from scheduled arrears; outstanding fines remain part of OLB.
A receipt of 2,000 containing a collected fine of 500 contributes 1,500 toward
the installment. Completed savings balance-offs contribute their contractual
amount once. Reversed events do not contribute.

`loanScheduleMetrics.js` allocates valid, deduplicated contractual events FIFO
over normalized installments, in integer cents, up to the selected cutoff.
Stored schedule `paid` and `status` are not authoritative for operational arrears.
Future receipts cannot reduce an earlier position. Ambiguous conflicting records,
invalid dates and invalid receipt amounts stop a verified calculation.

`loanArrears.js` joins this schedule position to the shared OLB calculator. Loans
that have not been disbursed, written-off loans, rolled-over renewal sources and
future disbursements do not contribute current arrears. Historical renewal and
write-off handling follows `OLB_CONSISTENCY.md`. Caller ownership/lifecycle scope
is retained; this module is not an authorization layer.

## Ratios And Counts

- Arrears Ratio = unpaid overdue scheduled amount / scoped outstanding OLB * 100.
- GPAR = entire OLB of overdue loans / scoped outstanding OLB * 100.
- PAR 30, PAR 60, PAR 90 and 90+ exposure assign each loan once, using its oldest
  unpaid installment: 1-30, 31-60, 61-90 and 91+ days respectively.
- Each PAR percentage uses the same **whole scoped portfolio OLB** denominator,
  including non-overdue loans. It is not the bucket's share of total arrears.
- Loan counts and installment counts are separate. Multiple overdue installments
  on a loan yield one Aging table entry and one PAR loan, not several loans.

Dashboard and Arrears Aging use the same summary. Aging age-band and From-date
filters narrow the displayed loan rows, without reclassifying loans or changing
the PAR denominator. The To date sets the Nairobi end-of-day position for
arrears and OLB. A From date must not erase overdue opening debt. The displayed
arrears total can intentionally differ from the unfiltered portfolio position;
the amount label and portfolio OLB/date in the filter summary distinguish these.

## PAR Rating Policy

Version `par-rating-v1`, 2026-10-08. `src/core/parRating.js` owns the rating,
color and follow-up guidance for Dashboard **Global Portfolio at Risk (GPAR)**
and Group Profile **Portfolio at Risk (PAR)**. Dashboard GPAR retains its existing
`overdue-loan OLB / scoped portfolio OLB * 100` formula; Group PAR retains its
`arrears / scoped OLB * 100` calculation. Group filters
recalculate the rating and guidance with the selected scope and cutoff; no new
backend reads are needed. Dashboard Arrears Ratio has its own policy below.

| Percentage | Rating | Color |
| --- | --- | --- |
| 0% through 5% | Excellent | Green |
| More than 5% through 8% | Healthy | Green |
| More than 8% through 12% | Needs Attention | Yellow |
| More than 12% through 15% | Action Required | Orange |
| More than 15% but less than 20% | High Risk | Red |
| 20% and above | Critical | Dark red |

Shared endpoints use the lower band, except 20% explicitly starts Critical.
The underlying, unrounded percentage determines the rating; display formatting
remains two decimals. Invalid/missing/negative percentages raise an error rather
than presenting a healthy portfolio. A complete zero-OLB portfolio retains the
existing calculated ratio of zero. Empty and unavailable sources remain distinct.

The audit found independent older Dashboard and Group rating expressions.
The initial fix incorrectly applied the PAR bands to Dashboard Arrears Ratio
as well. The user's clarifications separate these policies: Group Profile's
initial render and subsequent filters use the PAR helper, as does Dashboard GPAR;
Dashboard Arrears Ratio uses its own helper. GPAR's previous 0-10/11-20/21-30/
31-40/41+ rating bands are replaced by the six PAR bands above, including follow-up
guidance. Its overdue-loan OLB formula is unchanged. PAR aging bucket colors
continue to identify age ranges rather than these risk-rating bands.

Boundary tests cover all six bands, exact endpoints, invalid inputs and immutable
policy values. Browser regressions exercise the actual Dashboard GPAR, Arrears
Ratio and Group cards,
receipt updates, high-risk exposure, account scope and historical date filters.
This correction requires no schema changes or hook upload; the earlier financial
hook deployment requirement below still applies to the previously pending work.

## Arrears Ratio Rating Policy

Version `arrears-ratio-rating-v1`, 2026-10-08.
`src/core/arrearsRatioRating.js` owns Dashboard Arrears Ratio's bands, colors
and guidance. Its formula remains `arrears / scoped OLB * 100`.

| Percentage | Rating | Color | Guidance |
| --- | --- | --- | --- |
| 0% through 2% | Excellent | Green | Very strong portfolio quality |
| More than 2% through 5% | Healthy | Green | Good control; normal monitoring |
| More than 5% through 8% | Watch | Yellow | Early warning; collection needs attention |
| More than 8% through 12% | Needs Attention | Orange | Elevated arrears; management action required |
| More than 12% through 20% | High Risk | Red | Significant portfolio-quality problem |
| More than 20% | Critical | Dark red | Severe arrears; urgent recovery action |

Exactly 20% remains High Risk here, unlike PAR where 20% starts Critical.
Both policies validate finite non-negative inputs, use unrounded ratios and
display two decimals. Boundary and cross-policy tests prevent their thresholds
from being accidentally merged again. This changes labels/colors, not balances,
eligibility, date boundaries, database records or the GPAR formula. GPAR now shares
PAR's rating bands, not Arrears Ratio's bands.

## Connected Views

- Dashboard: arrears, Arrears Ratio, GPAR, PAR aging and alert counts.
- Analytics: arrears KPI and aging watchlist, with officer and To-date scope.
- Individual Performance: member arrears and an explicit group-account bridge,
  matching its existing combined OLB scope. Individual-only filters omit groups.
- Group Performance and Group Profile: member and group-account arrears, partial
  payments, balance-offs and cutoff-aware group PAR. Existing group member filters
  still define the selected member cohort, including its last-saved date filter.
- Repayments and Arrears Aging reports: effective paid amounts and arrears status.
- Alerts: one card per loan, remaining scheduled balances, same Nairobi due days.
- Loan Overview: schedule rows and capture/edit schedule updates use the shared
  allocation rather than incrementing potentially stale stored schedule payments.
  Payment calendar dates persist at Nairobi day-start (server `created` retains
  capture time); today's payment cannot accidentally be future-dated until 3 a.m.
  The shared date formatter displays Nairobi calendar dates rather than device
  dates, including persisted PocketBase UTC timestamps.
- Debt Management: current-position arrears use the same calculator. Its report
  date filters remain entry/activity filters, explicitly labeled current balances.

All these reuse the complete scoped financial sources and invalidation mechanism
described in `OLB_CONSISTENCY.md`. No extra refresh loop was added. Snapshot cache
keys advance to `loans:financial:snapshot:v2:` and group bundles to
`records:arrears-v1` so old unnormalized bundles are not reused after deployment.

## Installment Precision

The audit found legacy schedules generated as `liability / period`, preserving
recurring decimals in PocketBase. Strict money validation exposed this gap.

`loanInstallments.js` rounds cumulative scheduled amounts to cents, conserving
each existing loan's rounded scheduled total. This is a compatibility rule for
generated installments and their stored payment counters, **not permission to
round malformed receipts or change contractual liability**. Repeated normalization
is idempotent. All views and penalty/renewal calculations use the same normalization.
New schedules are generated as cent-valued installments whose sum is exactly
the contractual scheduled liability. No existing database amount was rewritten.

Duplicate row IDs are handled by the shared financial selector. Duplicate
loan/installment identities select the newer record, not maximum amount/paid.
Equal-version financial/date/waiver conflicts are rejected. Orphans are excluded
when joining the complete financial snapshot to its current loans; they are not
silently reassigned or deleted.

## Verification

```sh
node tests/loanArrears.test.mjs
node --test tests/parRating.test.mjs
node --test tests/arrearsRatioRating.test.mjs
node --test tests/*.test.mjs
npm run build
git diff --check
TEST_PAGE=/tests/olb.browser.html node scripts/test_cache_browser.mjs
TEST_PAGE=/tests/loanPayment.browser.html node scripts/test_cache_browser.mjs
TEST_TIMEZONE=America/Los_Angeles TEST_PAGE=/tests/olb.browser.html node scripts/test_cache_browser.mjs
TEST_TIMEZONE=Pacific/Auckland TEST_PAGE=/tests/olb.browser.html node scripts/test_cache_browser.mjs
TEST_PAGE=/tests/savings.browser.html node scripts/test_cache_browser.mjs
node scripts/audit_olb_reconciliation.mjs --arrears
```

The browser tests mock PocketBase, prohibit live sends and check actual views:
stale schedule payments, partial receipts, balance-offs, group-account exposure,
matching PAR percentages, age filters, external updates, historical cutoffs,
officer scope and incomplete-read export guards. They do not certify production UI.
The OLB and payment fixtures pin their clock at 8 October 2026, 00:30 EAT, so
midnight calendar behavior and age bands remain deterministic on future runs.
Read-only live evidence is in `ARREARS_AUDIT_2026-10-08.md`.

## Limits And Deployment

Sequential source reads are not an atomic database snapshot. Multi-record payment
writes remain non-transactional; a server transaction is needed to eliminate
concurrent-write races and partial capture. Schedule counters are derived, so
their staleness no longer determines headline arrears, but this does not make the
capture workflow atomic or idempotent.

Historical results use current ownership, lifecycle, contract terms and schedule
versions. Current reversals/waivers and later schedule edits cannot be reconstructed
at their original event time without versioned history. Do not certify these as
fully reconstructed historical accounting. Account suspension policy is unchanged.
P&L/interest allocation and collections-efficiency formulas remain separate work.

Deploy only after approval. `npm run build` regenerates
`pb_hooks/lib/debtRecovery.js`; upload it with the recovery hook when deploying
approved changes so server renewal quotes also handle legacy fractional schedules.
No new schema fields, production mutations, commits or pushes were made here.
