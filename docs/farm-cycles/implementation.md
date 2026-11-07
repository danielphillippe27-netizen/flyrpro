# Simple Farm rounds

Updated November 7, 2026.

## Behaviour

- One saved active round per Farm, shared by web, iOS, and Android. Dates, plans, map opening, and session start/end never advance it.
- Everyday maps show current progress. Farm Settings provides a confirmed **Start a new round** action, starting today without a date form, and read-only history.
- New rounds reset coverage only. Contacts, notes, leads, appointments, follow-ups, do-not-knock instructions, and past visits remain.
- Undo is available only before the new round has any activity. The server rejects stale requests, concurrent changes, open sessions, and unauthorized access.
- New ordinary planned visits use the active round. Missing legacy membership resolves to round 1, not a date-derived number. Explicit older offline sessions retain their original membership; future unstarted membership is rejected.
- Native status caches are scoped to the saved round. Pending local edits survive refresh. Missing progress produces a retry message rather than an apparently empty Farm.
- Round changes require connectivity and native pending edits to be synced. Users are reminded to finish sessions and sync other devices first; disconnected devices cannot be inspected remotely.

## Server and rollout

Apply `20261107010000_simplify_farm_rounds.sql` after `20261106012000_explicit_farm_cycles.sql` before releasing the clients. This migration updates transition guards and adds undo; it does not reset any farm or delete visit history. Session/touch creation and round transitions lock the same farm.

The Bowmanville repair was separate: 137 existing outcomes were retained in round 1, as requested. The private backup is kept outside this web repository.

## Validation

- 35 isolated PostgreSQL assertions: membership, permission checks, stale transitions, open/completed sessions, future-round rejection, undo, and history preservation.
- 20 Farm cycle assertions plus touch-plan tests.
- Browser component checks at 320, 390, and 1100 px: confirmation/cancellation, start, undo, and history without a round selector or date inputs.
- Focused iOS tests include persisted active round, no calendar advancement, isolated round caches, pending outcomes, and reopening cached farms.
- Android Farm and round-status tests cover offline cache loading, missing-snapshot errors, current-round colours, and retained do-not-knock status. The network failure fixture resumes the suspended call, matching Retrofit behaviour.
- Full web TypeScript checking has existing errors outside these changed files. Focused lint has no errors; existing image/hook warnings remain.

Production and device rollout evidence is recorded separately after execution. Simulator/unit/component checks do not establish an outdoor or two-device walkthrough.
