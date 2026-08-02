# Toronto priority Territory IQ sources

Production status as of 2026-08-01. All score inputs below are privacy-safe FSA or ward aggregates. The ingestion deliberately excludes addresses, buildings, parcels, street trees, business names, personal names, phone numbers, and unit-level records.

| Source | Signal | Resolution | Status | Production rows |
|---|---|---:|---|---:|
| Development Pipeline | Development momentum | Ward | Promoted | 25 |
| Business Licences | Business opening activity | FSA | Promoted | 96 |
| Apartment Building Evaluations | Rental building condition need | Ward | Promoted; low current sample | 3 |
| Apartment Building Registration | Rental systems opportunity | FSA / ward | Promoted | 115 |
| Multi-Tenant House Licences | Multi-tenant housing concentration | Ward | Promoted | 13 |
| Short-Term Rental Registrations | Short-term rental concentration | FSA | Promoted | 96 |
| Private Building Energy and Water Reporting | Energy / retrofit opportunity | — | Blocked: no official public disclosure dataset | 0 |

Business Licence aggregates without a matching official Statistics Canada Toronto FSA boundary are rejected. The 2026-08-01 load rejected 19 such area keys and promoted the remaining 96.

## GRID SCORE treatment

- Development momentum contributes to the versioned Timing / permit-activity factor.
- Business openings and rental signals contribute to Local Service Need.
- Each signal is tempered toward neutral using the active workspace industry profile. It is never represented as a fact about an individual household.
- Missing sources do not score as zero; unavailable weight is redistributed by the existing GRID SCORE rules.
- The model version is `grid-score-v3-toronto-priorities`.

## Refresh checklist

- [ ] Verify the official download and licence URLs still resolve.
- [ ] Retain the new raw source, metadata and licence snapshots under an immutable S3 version.
- [ ] Verify checksum, schema, record counts, nulls and source freshness.
- [ ] Normalize to FSA or ward aggregates and confirm prohibited fields are absent.
- [ ] Reject FSAs without an official promoted boundary and wards outside 01–25.
- [ ] Confirm all scores and confidences remain within 0–100 and 0–1.
- [ ] Upload raw, normalized and derived artifacts without overwriting an older version.
- [ ] Stage the source version, load its signals, then promote only after validation.
- [ ] Shadow-score Toronto campaigns and review score drift before changing weights.
- [ ] Verify the Territory IQ API returns the source, insight, heatmap cells and refreshed model version.

Private Building Energy and Water Reporting stays blocked until Toronto publishes an official commercial-safe disclosure file or API. Mandatory reporting alone is not treated as permission to reconstruct or infer property-level energy performance.
