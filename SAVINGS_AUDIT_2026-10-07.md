# Production Savings Reconciliation

Read-only audit of `inletcapital.pockethost.io`, completed 7 October 2026 at
16:16 EAT. The final pass read 807 savings records, 136 members and 13 groups.
Authentication plus paginated collection reads required seven logical requests.
No financial records, summaries, schema or permissions were updated.

## Ledger Totals

| Measure | KES |
| --- | ---: |
| Deposits | 796,060.00 |
| Savings debits / withdrawals | 39,260.00 |
| Net savings balance | **756,800.00** |
| Member-owned savings | 724,300.00 |
| Group-account savings | 32,500.00 |
| Internal balance-off debits included in withdrawals | 17,000.00 |
| Cash withdrawals, excluding linked internal balance-offs | 22,260.00 |
| Savings-related net cash movement | 773,800.00 |

Member-owned plus group-account savings reconciles exactly to the ledger balance.
The KES 32,500.00 group-account balance equals the size of the previously reported
Individual Performance discrepancy. This supports an account-scope explanation;
this audit does not reconstruct the historical screen snapshots or prove their
exact past record population.

Savings movement and savings-related cash movement are deliberately different:
KES 756,800.00 plus KES 17,000.00 internal transfers equals KES 773,800.00.
This is not the complete Cash Flow report total, which also contains loan receipts,
fees and fines.

## Date Reconciliation

| Nairobi transaction-date period | Deposits | Debits | Net movement | Transactions |
| --- | ---: | ---: | ---: | ---: |
| 1-7 October 2026 | 12,900.00 | 0.00 | 12,900.00 | 52 |
| 1-30 September 2026 | 82,250.00 | 200.00 | 82,050.00 | 222 |

The September debit is linked to an internal balance-off. An independently summed
integer-cents calculation agrees with the shared calculator for all three periods,
including all dates. Three assigned-officer balances also sum to KES 756,800.00:
KES 71,060.00, KES 620,140.00 and KES 65,600.00. This checks financial partitioning,
not login permissions or the deployed officer-facing UI.

## Stale Group Summaries

| Group | Ledger balance | Stored summary | Difference |
| --- | ---: | ---: | ---: |
| SHINERS SHG | 53,900.00 | 53,700.00 | 200.00 |
| GOD'S MERCY SHG. | 7,900.00 | 7,600.00 | 300.00 |

SHINERS group ID: `k6wplf4mykrqv0h`. Its summary was calculated on 1 October
at 13:23 EAT. Savings record `s3j2utfk36mkujm`, currently a KES 400.00 deposit
effective 1 October, was updated on 2 October at 17:47 EAT. The audit does not
establish that record's previous amount; its current amount must not be mistaken
for the KES 200.00 summary difference.

GOD'S MERCY group ID: `xr4h3elnu3vykmy`. Its summary was calculated on 1 October
at 19:35:02 EAT. Savings record `vihdn96510eru7y`, a KES 300.00 deposit effective
1 October, was updated at 19:35:43 EAT, after that calculation.

These are derived-summary discrepancies, not justification to change ledger
transactions. The permanent next step is to invalidate/version and rebuild
summaries when relevant savings or ownership changes occur. Until rebuilt, old
server summaries must not be presented as verified current balances.

## Validation and Limits

- No reversed records, blank legacy types, invalid amounts/dates, or unresolved
  account owners were found in this snapshot.
- No savings were excluded by member lifecycle, attributed to an old member
  group, or effective after 7 October. No excluded-group account exposure was found.
- All active settlement references pointed to existing savings transactions.
- No fetched member, group or savings record had an update timestamp later than
  audit start. Reads are sequential, not an atomic database snapshot.
- The deployed UI and users' IndexedDB caches were not inspected. Local browser
  tests establish code behavior; these reads establish current ledger totals.
- No commit or push was performed. This report contains private business totals
  and should not be published without review.

Repeat the audit locally with the existing authorized audit credentials:

```sh
node scripts/audit_savings_reconciliation.mjs --as-of=2026-10-07
```

Credentials and tokens are neither printed nor written by this script. It reads
existing local audit configuration without executing the schema setup script.
