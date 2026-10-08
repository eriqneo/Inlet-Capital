# Read-Only Arrears Audit

Source: inletcapital.pockethost.io. Final read: **2026-10-08 00:56:41-00:56:48
EAT**. Authentication plus nine paginated collection GETs: ten logical requests.
122 loans, 577 receipts, three balance-offs and 919 schedule rows were read.
No business records or schema were changed; no retry loop was used.

## Findings Before Changes

- At 00:45 EAT, legacy Dashboard allocation, raw schedule and Group Profile's
  maximum-stored/allocated formulas all returned **KES 49,440**. There was no
  observed current-total difference in that read; disagreement was demonstrated
  using controlled stale-payment and historical-cutoff fixtures instead.
- Group Profile trusted stored schedule payments/status. Individual Performance,
  Group Performance, Repayments and alerts used raw schedule counters, while
  Dashboard/Analytics rebuilt them. Edited, deleted, reversed or future receipts
  could therefore produce different positions in different views.
- Device-local due-day checks could move overdue classification near midnight.
- Reports combined latest/maximum duplicate schedule fields differently from
  Dashboard. Oldest overdue loan age and portfolio denominator must be shared.
- Individual Performance omitted group-account arrears while including those
  accounts in its OLB KPI, creating another scope difference.
- The initial OLB recheck failed strict validation on recurring-decimal schedule
  amounts. The generator stored `liability / period` without cent distribution.
- A mocked capture test exposed a separate midnight issue: payment dates were
  stored at UTC midnight (03:00 EAT), temporarily future-dating today's receipts.
  Capture/edit dates now use Nairobi day-start and shared display formatting.

## Recheck With Shared Calculations

| Metric | Result |
| --- | ---: |
| Operational OLB, including unpaid fines | KES 1,759,790.00 |
| Unpaid overdue scheduled amount | KES 49,440.00 |
| Unique overdue loans | 18 |
| Overdue installments | 22 |
| Arrears Ratio | 2.81% |
| GPAR | 13.17% |
| PAR 30 exposure / loans / rate | KES 173,310.00 / 14 / 9.85% |
| PAR 60 exposure / loans / rate | KES 58,500.00 / 4 / 3.32% |
| PAR 90 exposure / loans / rate | KES 0.00 / 0 / 0.00% |
| 90+ exposure / loans / rate | KES 0.00 / 0 / 0.00% |

The shared denominator is KES 1,759,790.00. Bucket loan counts sum to 18, not
22; the remaining four are additional overdue installments on existing loans.
Legacy current arrears still agree at KES 49,440.00. These results are read-only
calculations over live sources, **not verification of the deployed frontend**.

## Data Quality

- 160 installments across 14 loans contain sub-cent recurring decimals, e.g.
  2,244.1666666666665. Shared normalization conserves scheduled totals and restores
  OLB calculation; no live installment or liability was rewritten.
- Twelve stored-payment differences appear after normalization, attributable to
  the distribution of fractional cents. No difference in current total arrears
  was observed between group/member allocations in this snapshot.
- 101 schedules have no current loan link. They are excluded from operational
  totals. Their provenance should be investigated before any cleanup; this audit
  does not infer they are safe to delete.
- No duplicate loan/installment identities among linked schedules were found.
- No future-dated receipt or source update during the final read was detected.

This is a sequential read, not a transactionally consistent snapshot. Current
ownership/lifecycle and current schedule versions apply. Complete event-time
historical reconstruction and live access-rule certification remain out of scope.
