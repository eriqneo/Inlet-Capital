# Analytics Expenses Chart

Analytics now displays recorded expenses as red monthly bars and a period total,
with exact two-decimal KES amounts in tooltips. Ranges longer than 24 months use
annual bars without truncating older spending. Empty months remain zero. Empty
results and unavailable records are distinct states; a failed expense read does
not prevent the other Analytics sections from loading.

`src/core/expenseMetrics.js` deduplicates saved records, excludes reversals, sums
integer cents and uses Nairobi effective dates (`date`, then legacy `expense_date`,
then `created`). From and To are inclusive calendar dates. No To means through
the assessment time; future entries are excluded. Invalid amounts/dates stop a
verified chart instead of being replaced with zero.

Expenses follow `recorded_by`, not member/loan assignment. The existing expense
service applies server officer filters, with an additional client-side check.
Superadmins/admins use the universal officer selection; other users only see
their own expenses. PocketBase rules remain responsible for authorization.

Analytics reuses the officer-scoped expense cache used by Reports. Date changes
recalculate locally. Expense mutations invalidate that cache; a page-owned expense
subscription handles remote changes and is stopped on navigation. Existing cache
refresh/rate-limit behavior and conservative Analytics polling are reused. Chart
instances and delayed chart initialization are cleaned up on rerender/navigation.
This adds no schema fields, database writes or deployment.

These expense normalization rules are applied to the new chart only. Existing
Expense List/P&L reducers have not been refactored or certified to handle legacy
reversals/duplicate rows identically in this task.

The chart uses the application's existing [Chart.js bar chart](https://www.chartjs.org/docs/latest/charts/bar.html)
library. The accessible canvas fallback lists each period amount.

## Verification

```sh
node tests/expenseMetrics.test.mjs
node --test tests/*.test.mjs
npm run build
TEST_PAGE=/tests/expensesChart.browser.html node scripts/test_cache_browser.mjs
```

The isolated browser fixture blocks real PocketBase traffic. For real canvas
rendering, pass a locally downloaded Chart.js UMD script via `TEST_CHART_SCRIPT`.
`TEST_VIEWPORT=mobile` checks a 390px viewport; `TEST_SCREENSHOT_PATH` captures the
expense card. Tests cover filtering, ownership, realtime/cache updates, failure,
retry, lifecycle cleanup and (with the real library) colored canvas pixels.
