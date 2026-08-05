# Territory IQ neighbourhood audit checklist

Use this checklist for every neighbourhood. The workbook is the source of truth for progress; this document defines what each review must cover.

## 1. Identify the neighbourhood

- [ ] Confirm official neighbourhood ID and name.
- [ ] Verify the boundary version and effective date.
- [ ] Record neighbourhood-improvement-area designation, if applicable.
- [ ] Confirm the boundary intersects the campaign or intended customer market.
- [ ] Note boundary changes, split neighbourhoods, or ambiguous aliases.

## 2. Establish the baseline

- [ ] Record current GRID SCORE, model version, confidence, and calculation date.
- [ ] Record target-home count and number of scored cells.
- [ ] Record current available and missing factors.
- [ ] Save the pre-change score distribution for score-drift comparison.

## 3. Audit the demand signals

For every signal, record status, source URL, publisher, version/date, geographic resolution, refresh frequency, licence, commercial-use decision, coverage, quality notes, and proposed derived metric.

### Spending and development

- [ ] Active and cleared building permits.
- [ ] Development pipeline and planning applications.
- [ ] Preliminary zoning reviews and rezoning activity.
- [ ] Business licences, openings, closures, and relevant inspections.
- [ ] Capital projects, road restrictions, and utility-cut permits.
- [ ] Rental activity: RentSafeTO, multi-tenant licences, and short-term rentals.
- [ ] Building energy/water reporting and retrofit signals.

### Property and neighbourhood context

- [ ] Census income, owner occupancy, dwelling type, construction period, and population growth.
- [ ] Heritage-property concentration.
- [ ] Flood, fire, storm, heat, air-quality, and environmental exposure.
- [ ] Crime context at the published resolution.
- [ ] Transit, pedestrian/cycling network, traffic, and access barriers.
- [ ] Broadband/fibre availability and EV charging.
- [ ] School construction, boundary changes, and new-community indicators.

### WolfGrid proprietary behaviour

- [ ] Target-home and prospect density.
- [ ] Door answer rate with minimum sample size.
- [ ] Appointment rate with minimum sample size.
- [ ] Sales conversion rate with minimum sample size.
- [ ] Best time/day and seasonal performance.
- [ ] Industry-specific lift versus comparable neighbourhoods.
- [ ] Privacy threshold and suppression rules applied.

## 4. Validate every candidate source

- [ ] Official URL resolves and automated acquisition is possible.
- [ ] Licence snapshot is retained; commercial use is explicitly classified.
- [ ] Source date, retrieval date, checksum, schema, and record count are recorded.
- [ ] Coordinate reference system and geometry validity are checked.
- [ ] Coverage actually intersects the neighbourhood.
- [ ] Nulls, duplicates, stale records, and outliers are measured.
- [ ] Spatial/identifier join rate is measured at the claimed resolution.
- [ ] Municipal data overrides lower-authority baselines without losing provenance.
- [ ] The signal is not duplicated by a more authoritative source.
- [ ] Unclear, restricted, malformed, or out-of-coverage records are quarantined.

## 5. Define the intelligence produced

- [ ] Assign the signal to Need, Buyer, Timing, and/or Efficiency.
- [ ] Define its normalized 0–100 transformation.
- [ ] Define freshness decay and maximum usable age.
- [ ] Define spatial-resolution and area-estimate disclosure.
- [ ] Define coverage/quality/freshness confidence components.
- [ ] Define industry applicability and same-service suppression where required.
- [ ] Name the derived feature, such as Renovation Activity Index, Growth Momentum, Service Disruption Need, or Homes per Hour.
- [ ] Document why the metric should predict business now.

## 6. Test score impact

- [ ] Run the source in shadow mode first.
- [ ] Confirm unavailable data does not change the existing score.
- [ ] Confirm missing weights redistribute according to the versioned model.
- [ ] Compare score before/after and inspect the factor explanation.
- [ ] Review median absolute movement and 95th-percentile movement.
- [ ] Require manual approval above 5-point median or 15-point 95th-percentile movement.
- [ ] Confirm deterministic output from identical inputs.
- [ ] Confirm no household-level claim is inferred from area-level data.

## 7. Review the customer experience

- [ ] Heatmap cells align with campaign targets and contain no empty cells.
- [ ] Best-areas ranking agrees with the displayed cell scores.
- [ ] Factor bars show raw value, normalized score, confidence, source, and estimate level.
- [ ] Missing and restricted signals are disclosed plainly.
- [ ] Source versions and calculation date are visible.
- [ ] Light and dark map styles keep roads and cells legible.
- [ ] Member assignment scoping and workspace access are correct.

## 8. Close the audit

- [ ] Record the strongest opportunity finding in one sentence.
- [ ] Record the largest data gap and recommended next action.
- [ ] Assign an owner and refresh/review date.
- [ ] Attach evidence and quality-report locations.
- [ ] Obtain independent QA sign-off.
- [ ] Mark `Complete` only when every signal has an explicit disposition.

## Signal statuses

| Status | Meaning |
|---|---|
| Not reviewed | The neighbourhood-specific coverage and quality have not been checked yet. |
| Ready | Licensed, validated, covered, explainable, and eligible for scoring. |
| Partial | Useful but incomplete, stale, lower resolution, or not yet fully validated. |
| Missing | No suitable source found or no coverage. |
| Restricted | Valuable source exists but requires procurement or separate authorization. |
| Not applicable | Signal does not reasonably apply to this neighbourhood or model. |
