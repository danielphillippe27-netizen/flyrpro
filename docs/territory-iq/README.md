# Territory IQ field guide

This folder is the operational workspace for reviewing Territory IQ one neighbourhood at a time.

## Files

- `NEIGHBOURHOOD_AUDIT_CHECKLIST.md` — the repeatable audit procedure and acceptance rules.
- `toronto-neighbourhood-audit.xlsx` — the working tracker, pre-populated with Toronto's official 158-neighbourhood model.

The production ingestion code and immutable source files remain in the separate Canada Territory IQ pipeline. This folder tracks research, coverage, decisions, quality review, and score readiness; it is not a raw-data store.

## Operating rhythm

1. Pick the next neighbourhood marked `Not started` in the workbook.
2. Follow every section in `NEIGHBOURHOOD_AUDIT_CHECKLIST.md`.
3. Record each signal as `Ready`, `Partial`, `Missing`, `Restricted`, or `Not applicable`.
4. Add evidence URLs and concise notes. Never mark a signal `Ready` from memory.
5. Record the current GRID SCORE and confidence before changing any model inputs.
6. Complete the QA review, then mark the neighbourhood `Complete`.
7. Revisit `Partial` and stale sources on their refresh deadline.

## Non-negotiable rules

- Prefer official municipal, provincial, and federal sources.
- Record licence evidence and commercial-use status before acquisition.
- Keep area estimates clearly separated from property-level facts.
- Do not infer ownership, income, damage, or property condition for an individual home.
- Do not ingest restricted data without an approved commercial agreement.
- Do not add street-tree data to this programme.
- Addresses, buildings, and parcels remain outside this audit unless the project scope is explicitly changed.
- A public download is not proof that commercial use is allowed.
- Every score-changing source must be versioned, validated, shadow-scored, and promoted.

## Definition of complete

A neighbourhood is complete only when:

- its boundary/name/ID are verified against an official source;
- all checklist signals have an explicit status;
- available sources have current URLs, licence evidence, freshness, resolution, and coverage notes;
- join/coverage and obvious data-quality issues have been recorded;
- the baseline and proposed GRID SCORE impact have been reviewed;
- missing and restricted signals are disclosed rather than silently treated as zero;
- an independent QA reviewer has signed off.

