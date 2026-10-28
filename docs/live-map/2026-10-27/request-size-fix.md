# Team dashboard width and Live Map request fix

The dashboard wrapper capped all tabs at 80rem, producing wide empty margins on large displays. It now fills the available content width while retaining responsive side padding.

The real team `22` Live Map loader failed at the presence query: enumerating campaign IDs produced a 33,709-character URL and HTTP 400 Bad Request. The loader now joins campaign presence to campaigns and filters by campaign workspace directly. The resulting URL is 344 characters and returns HTTP 200. It also avoids the previous campaign-list row limit.

The production database was read only. Running the corrected loader returned eight team members and zero fresh presence reports. This verifies recovery of the data query, not phone GPS publishing or a two-device field session.

Validation: 25 loader tests and five presentation tests pass, including workspace isolation, shared sessions, and 1,500 historical campaigns. Focused ESLint passes. Project type checking reports unrelated existing errors and none in the three changed files.

This fix has not been deployed.
