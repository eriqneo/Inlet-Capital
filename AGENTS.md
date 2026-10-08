# Repository Instructions

## Financial Changes

- Read `FINANCIAL_DEFINITIONS.md`, `SAVINGS_CONSISTENCY.md`,
  `OLB_CONSISTENCY.md` and `ARREARS_CONSISTENCY.md` before changing money KPIs.
- Define financial behavior in pure `src/core` modules. Do not add independent
  savings, OLB or arrears formulas to a page. Reuse shared selectors/calculators.
- Audit all consumers of a metric, including Dashboard, Analytics, reports,
  group/member/loan profiles, alerts, exports and PocketBase hooks. Report gaps
  before implementing changes; test the related views together.
- Use integer cents for money and Africa/Nairobi calendar boundaries. Separate
  receipt totals, contractual repayments, fines and internal savings balance-offs.
- Portfolio positions include opening balances up to the To date; From dates
  filter activity/table rows, not opening OLB or arrears. Label these differences.
- Classify PAR once per loan using its oldest unpaid overdue installment. Count
  loans separately from installments. Use the same scoped OLB denominator.
- Dashboard Arrears Ratio ratings use `src/core/arrearsRatioRating.js`; Dashboard
  Global PAR (GPAR) and Group PAR ratings use `src/core/parRating.js`.
  These are separate policies: exactly 20%
  is High Risk for Arrears Ratio but Critical for PAR. Test all band endpoints.
  GPAR's formula remains overdue-loan OLB / portfolio OLB; sharing rating bands
  does not change that formula. Aging-bucket colors identify age, not risk ratings.
- Analytics expense bars use `src/core/expenseMetrics.js`, Nairobi effective
  dates and `recorded_by` officer scope. Keep unavailable reads distinct from
  zero expenses; date-filter changes must not refetch the expense ledger.
- Exclude reversed entries, deduplicate records and apply the existing ownership
  and lifecycle policies. Never use incomplete reads or stale stored rollups as
  verified zero balances. Preserve the last complete view with a stale notice,
  or show unavailable and disable financial exports.
- Reuse the scoped financial snapshot/cache invalidation flow. Do not introduce
  per-view refresh loops or fetch the full ledger on every filter change.
- Financial changes require focused core tests, related-view browser regressions,
  `node --test tests/*.test.mjs`, `npm run build` and `git diff --check`.
- Rebuild generated hook libraries through the existing build script, not manual
  edits. State clearly when a changed hook has not been uploaded to PocketHost.

## Production And Version Control

- Do not commit, push, deploy, change live schema or edit live financial records
  without explicit user approval. The current work is local until approved.
- Production audits must be read-only except authentication, bounded/paginated,
  and stop on rate limits. Never print credentials, tokens or customer contacts,
  or include secrets in process arguments. Do not run `setup_collections.mjs`
  as an audit; it changes schema.
- Preserve unrelated user changes. Never reset/revert the worktree to simplify
  a task. Use `apply_patch` for manual edits.
- Document definitions, audit evidence, limitations and deployment requirements
  alongside the implementation. Do not claim mocked tests certify live totals.
