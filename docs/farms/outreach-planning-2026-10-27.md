# Guided farm outreach planning

Farm creation and the Dashboard annual planner now share questions for door-knocking rounds, calling rounds, daily quotas, chosen weekdays, start date, 1–52 weeks, and explicit holiday/vacation dates. Defaults: one door round, 50 doors/day, Monday–Saturday, zero calling rounds, 52 weeks. No statutory holiday dates are assumed.

A round is one attempt per eligible home. Required door days = ceil(homes × door rounds / daily doors); required call days = ceil(homes × call rounds / daily calls). Both quotas use the same workdays; the schedule needs the greater of those two totals. Call counts are planning targets, not a claim that every address has a usable phone number. Rounds follow each other with no built-in rest interval. The finish date skips unselected weekdays, explicit days off and legacy holiday weeks. Holidays on an already excluded weekday are not subtracted twice.

Creation uses the full-boundary address estimate and labels it as an estimate. It stores validated settings in the existing farms.annual_coverage_plan JSON before importing homes. The existing import-homes flow imports canonical addresses, after which the annual endpoint recalculates from all eligible farm addresses. It rejects insufficient capacity and ignores client-supplied home counts. Valid daily plans also update the existing farms.door_plan JSON atomically, using the same workdays, holidays and number of door rounds. Weekly lists show first-pass unique coverage; daily lists include repeated door rounds. Existing weekly plans retain their original behavior. New farms receive one planned touchpoint per chosen round rather than a fixed twelve-session template.

The Dashboard can edit the same answers, keep legacy weekly planning, export assignments, and use existing contact actions. Existing farms and visit history are not modified merely by opening the planner. No schema migration or deployment is needed for these changes because both JSON columns already exist.

Validation:
- npx tsx lib/farms/__tests__/outreach-schedule.test.ts
- npx tsx lib/farms/__tests__/annual-coverage.test.ts
- npx tsx lib/farms/__tests__/door-plan.test.ts
- node scripts/test-farm-annual-coverage-api.cjs
- node scripts/test-farm-annual-coverage-browser.cjs
- node scripts/test-farm-create-outreach-browser.cjs

Browser checks cover daily and weekly modes, daily targets, selected weekdays, holiday dates and weeks, insufficient capacity, persistence/reload, CSV, contacts and 320/390/768/1440-pixel layouts. Fixtures remain local test data. A full repository type check has unrelated existing errors; changed production files have no diagnostics.
