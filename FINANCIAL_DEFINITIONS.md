# Financial Definitions

## Status and Scope

Version: savings-v1, prepared 2026-10-07 (Africa/Nairobi).

OLB is now implemented under a separate `olb-v1` contract; see
[OLB Consistency](OLB_CONSISTENCY.md) for its formula, cutoff, source completeness
and remaining historical/transactional limitations.

Arrears and PAR are connected under `arrears-v1`; see
[Arrears Consistency](ARREARS_CONSISTENCY.md) for allocation, date boundaries,
ratios, scopes and legacy installment precision.

This is the target contract for the savings consistency work. Shared calculations
and the principal savings views are connected in Step 3; see
[Savings Consistency](SAVINGS_CONSISTENCY.md) for coverage, tests and remaining
limitations. This does not claim that every policy recommendation is implemented.
No database migration or live financial change is part of this work.

Previously established business rules are retained: withdrawals reduce balances,
but do not reduce deposit growth or undo weekly contribution credit; savings
follow the client's assigned officer; suspended, closed, and exited members are
excluded from the operational portfolio while their records are retained.

New edge-case recommendations are identified explicitly under Policy Decisions.
Do not treat those recommendations as approved business rules.

## Common Comparison Context

Two figures must match when all of these match:

- Metric and definition version.
- Authorized officer scope, member/group scope, and lifecycle scope.
- Effective transaction date range or balance cutoff, in Africa/Nairobi time.
- Included transaction IDs and data revision.
- Data completeness: a partially loaded result is not a verified total.

PocketBase savings records are the source records. IndexedDB, group summaries,
and displayed totals are derived copies. No screen, PDF, or spreadsheet defines
its own alternative financial formula.

## Savings Metrics

All amounts are KES. Display monetary figures to two decimal places. Future
calculations should use integer minor units or equivalent exact decimal handling,
rather than relying on display rounding to correct arithmetic differences.

| Metric | Definition | Display label |
| --- | --- | --- |
| Deposits | Sum of eligible deposits in the selected period | Deposits / DEP |
| Withdrawals | Sum of eligible savings debits in the selected period, including a posted savings balance-off debit | Withdrawals / WIT |
| Net savings movement | Deposits minus withdrawals within the selected period | Net Savings Movement |
| Opening savings balance | Eligible deposits minus withdrawals strictly before the start date | Opening Savings Balance |
| Closing savings balance | Opening balance plus net movement through the end date | Savings Balance as at [date] |
| Current savings balance | Eligible deposits minus withdrawals through the assessment time | Total Savings Balance |
| Transaction count | Number of distinct eligible savings transaction IDs for the same scope and period | Transactions |
| Deposit growth | `(current-period deposits - comparison-period deposits) / comparison-period deposits * 100` when comparison deposits are positive | Savings Deposit Growth |

An all-time balance requires complete opening history. If an imported opening
balance is missing, do not manufacture it from another screen's total. Identify
the missing history for reconciliation before presenting a verified balance.

Savings consistency and group savings performance are separate measures against
expected contributions. Withdrawals reduce savings balances, but do not cancel
the credit for a deposit made toward a weekly obligation. Neither rating is a
substitute for the monetary savings balance.

## Transaction Eligibility

1. Count each saved transaction ID once, even if it appears in both a member and
   a group dataset. Do not deduplicate by equal amount, date, or member: separate
   legitimate deposits can have identical values.
2. Exclude records with `is_reversed=true` from deposits, withdrawals, balances,
   growth, and the eligible transaction count. A history table may show them with
   a reversed indicator and a separately labelled history-row count.
3. Normalize transaction type by trimming and lowercasing. `deposit` is positive;
   `withdrawal` is negative. A blank legacy type means deposit, consistent with
   the existing shared calculator and its test. New entries require a type.
4. Unknown nonblank types are data-quality exceptions, not silently assumed
   deposits. The shared calculator now rejects them.
5. Amounts must be finite, positive, and representable to cents. Invalid legacy
   amounts must be flagged; a total that omits them is provisional, not verified.
   The shared calculator now rejects invalid amounts rather than substituting zero.
6. An unresolved member/group relation must be flagged. It must not silently
   become an individual account, a group account, or an officer's record.
7. An edit replaces the contribution of that transaction ID. A reversal removes
   its contribution under the current corrected-ledger model. A permitted
   deletion removes it. Preserving the audit trail is separate from the total.

## Date Rules

- Use `savings.date` as the effective transaction date. Use `created` only when
  `date` is absent on a legacy record. Preserve `created` as the capture timestamp;
  it is not a substitute for an existing effective date.
- A malformed nonempty date is an exception; do not silently substitute another
  date. A record with neither usable date cannot enter a verified dated total.
- Interpret date-only filters as Nairobi calendar days, regardless of device
  timezone. From is inclusive at local midnight. To includes the entire local
  day, implemented as an exclusive boundary at the following midnight.
- For movement: both dates select the period; From only runs through the
  assessment time; To only runs from the beginning of available history through
  To; no dates means through the assessment time.
- For a closing balance, From does not discard opening savings. Transactions
  before From form the opening balance; transactions within the range form the
  movement. Do not label period movement as the closing balance.
- From later than To is invalid and must stop calculation/export of the range.
- Future-dated savings and historical reconstruction require the policy choices
  listed below. Record the assessment time so a comparison is reproducible.
- Member registration dates, group last-activity dates, and member Last Saved
  filters must not silently replace the savings transaction-date filter. A
  last-activity filter selects a client cohort; label that additional scope.

## Account and Group Scope

| Account scope | Records included |
| --- | --- |
| All accounts | Member-owned savings plus group-account savings, once each |
| All members | Savings with a valid member owner, whether grouped or individual |
| Individual members | Member-owned savings whose member currently has no group |
| Members in groups | Member-owned savings whose member currently belongs to a group |
| Group accounts | Valid group owner and no member owner |
| One member | Only records owned by that member |
| One group: All members + group accounts | Current members' savings plus that group's own account |
| One group: All members | Current members' savings only |
| One group: Group Acc | The group's own account only |

A transaction with both member and group fields is member-owned. Its group field
does not create a second contribution. Current portfolio grouping follows the
member's current group; the recorded transaction group remains historical context.
An event-time group report would be a distinct report, not an interchangeable
total. Officer/group transfers do not create deposits or withdrawals.

An unassigned group deposit remains group-account savings until correctly
allocated. It must not be attributed to a member merely to make totals agree.

Individual Performance rows remain member-owned savings. Where its existing
summary includes group-account savings, show Member Savings and Group Account
Savings separately so their combined figure is explainable. A member-only table
must not imply that its rows sum to a combined member-and-group-account KPI.

## Officer and Lifecycle Scope

For member-owned savings, resolve the officer from `member.assigned_officer`,
falling back to `member.registered_by`. For a group-owned account, use
`group.assigned_officer`, falling back to `group.created_by`. Member ownership
takes precedence when both relations exist. `recorded_by` identifies the capture
user, not the current portfolio owner.

An officer sees only their authorized assigned portfolio. An admin's global
officer filter applies consistently to every savings view and export. Missing
assignment is reported as unassigned in an authorized all-portfolio view; it is
not assigned to whichever officer is viewing the screen. Frontend filtering does
not replace database access rules.

Current operational member totals include active and inactive members. Savings
inactivity alone does not erase a member's balance. Suspended, closed, and exited
members are excluded from operational totals, as previously requested; their
savings records remain available through authorized lifecycle/history reporting.
Suspension is a scope change, not a withdrawal or a zeroing of the account.

Historical cash movement across all retained accounts and current operational
portfolio movement are different scopes. Reports must identify which is being
shown. Current membership/status data cannot establish who owned an account, or
whether it was suspended, at an earlier date without additional history.

## Savings Balance-Off and Cash Flow

When savings settle a loan, debit savings once by settlement plus any surcharge
actually taken from savings. The linked settlement must not debit savings again.
A surcharge paid separately must not be included in the savings debit.

This reduces savings but is an internal transfer, not automatically cash paid
out to a client. Actual cash-flow totals must distinguish cash withdrawals from
internal balance-offs. Savings movement can reconcile to actual cash movement
only with an explicit bridge for noncash items.

Current code stores balance-off debits as `withdrawal` with `payment_method=cash`.
Future classification should use the linked `loan_balance_offs.savings_transaction`
and a verified transaction classification, not infer cash movement solely from
that payment method or from free-text remarks. Incomplete links require review.

## Screen and Export Contract

| View | Required savings meaning |
| --- | --- |
| Dashboard | Current operational savings balance, plus DEP/WIT where shown |
| Analytics | Balance without a range; explicitly labelled net movement with a range |
| Savings module | Same balance/movement definitions and account scope as Analytics |
| Member profile | Member balance; filtered history movement labelled separately |
| Group profile and Group Performance | Group-scoped balance/movement; same ownership and transaction-date rules |
| Individual Performance | Member row amounts, with explicit group-account reconciliation if included in the summary |
| Cash Flow | Clearly distinguish savings movement from actual cash flow and internal transfers |
| Withdrawal report | Eligible withdrawal/debit rows and matching sum; identify internal balance-offs |
| PDF, print, and Excel | Same metric, scope, revision, and all filtered rows as the corresponding view |

Sorting and pagination never change a total. Any search, lifecycle filter, or
account filter that changes the financial population must affect its matching
total and be included in the comparison context. A complete zero is valid; a
loading, failed, partial, or stale dataset must carry its actual state.

## Reference Examples for Later Tests

| Scenario | Expected result |
| --- | --- |
| Deposits 1,000 and 400 with blank legacy type; withdrawal 200 | DEP 1,400.00; WIT 200.00; net 1,200.00; 3 transactions |
| Above plus reversed deposit 300 | Same eligible totals and count |
| Opening 1,000; period deposits 2,000; withdrawals 500 | Movement 1,500.00; closing balance 2,500.00 |
| Independent members 1,000; grouped members 1,200; group accounts 500 | All accounts 2,700.00; all members 2,200.00; all groups combined 1,700.00 |
| Member deposit 400 has both member and group relations | Member total +400.00; combined group total +400.00; institution total +400.00 |
| Deposit changes from 400 to 600 | Each applicable total increases by 200.00, not 600.00 |
| Officer A transfers a client with balance 700 to B | A -700.00; B +700.00; institution total unchanged |
| Member with 700 is suspended | Operational total -700.00; retained member history still 700.00; no withdrawal created |
| Starting balance 5,000; balance-off 1,000 plus savings-funded surcharge 100 | Savings debit 1,100.00 once; closing 3,900.00; no cash payout implied |
| Prior deposits 1,000; current deposits 1,500; current withdrawals 1,200 | Deposit growth 50.00%; current net movement 300.00 |
| Transaction at 2026-10-06T21:00:00Z | Included on Nairobi date 2026-10-07, not 2026-10-06 |
| Same filtered records displayed on different pages or sorted differently | Identical totals and eligible transaction count |

## Policy Decisions Before Behavior Changes

These cases are not settled by the existing code or prior instructions. The
recommendations are recorded for review, not authorized migrations:

| Decision | Recommendation |
| --- | --- |
| Suspended/closed group whose members remain active | Exclude the group's own account from operational group totals. Do not silently suspend members; explicitly decide whether group suspension also excludes their savings institution-wide. |
| Historical ownership and lifecycle | Keep current-assignment operational reporting as the default. Add event-time reporting only with reliable assignment/lifecycle history and a distinct label. |
| Corrected history versus an original past report | Default to the corrected current ledger filtered by effective date. Reproducing what was known on an earlier day requires audit/version history, especially for reversals and deletions. |
| Future-dated posted savings | Flag for review and exclude from current balances until their effective time. This needs explicit implementation and legacy-data review. |
| Growth comparison and zero denominator | Use month-to-date versus the same elapsed portion of the prior month (clamped to month end); completed months compare full months. Explicit ranges compare the preceding equal number of Nairobi calendar days. With a zero base show New or No deposits, not an invented percentage. |

## Implementation Map and Known Gaps

- [Shared savings calculator](src/core/savingsMetrics.js): monetary calculations,
  transaction normalization, Nairobi dates, and current ownership selection.
- [Savings service](src/services/savingsService.js): common financial ledger cache,
  mutation notifications and shared member-balance calculations.
- [Dashboard](src/features/dashboard/Dashboard.js): uses the shared savings sum.
- [Reports](src/features/reports/ReportsDashboard.js): shared savings calculations
  and transaction-date filtering, including Group Performance and full exports.
- [Group Profile](src/features/groups/GroupProfile.js) and group cards use shared
  savings sums. Unversioned server summaries are no longer used for display, and
  the browser summary writer has been retired. Backend rollups need versioning
  and transactional maintenance before they can replace these source reads.
- [Officer scope](src/core/officerScope.js) and
  [member lifecycle](src/core/memberLifecycle.js): existing policy helpers to
  reuse and extend, including explicit group lifecycle handling.
- [Loan service](src/services/loanService.js): linked balance-off savings debits
  are classified as internal transfers in Cash Flow; missing links still need
  a data audit.
- [Cache](src/services/dataCache.js): stale-request protection and shared savings
  notifications are implemented in Step 2; see [Cache Sync](CACHE_SYNC.md).
  Savings consumers are connected in Step 3. Other financial metrics remain
  separate work.

Reference cases now have shared-calculator and mocked cross-module browser
tests. Passing those tests does not replace a production data reconciliation.
