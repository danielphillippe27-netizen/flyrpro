# iOS Brokerage Onboarding Plan (Real Estate Only)

This document defines the iOS implementation plan for brokerage selection during onboarding, aligned with current `FLYR-PRO` backend/web behavior.

Use this as the source of truth for product, engineering, and QA.

---

## 1) Goal and Scope

### Goal

Implement brokerage UX in iOS onboarding so that:

1. The brokerage field appears **only when** the selected industry is `Real Estate`.
2. Users can either:
   - pick an **existing brokerage** from autocomplete, or
   - **add a new brokerage name** as free text.
3. Submission writes data in the format expected by `POST /api/onboarding/complete`.

### In Scope

- Onboarding step UI behavior and state transitions.
- Brokerage autocomplete data fetching.
- Payload mapping for selected existing vs custom typed brokerage.
- Error handling, loading states, and validation rules.
- QA scenarios and rollout checks.

### Out of Scope

- Backend schema changes.
- Search ranking logic changes.
- Non-onboarding brokerage edits after onboarding.

---

## 2) Backend Contracts (Current Behavior)

### Search endpoint

- **Route:** `GET /api/brokerages/search?q=<query>&limit=<n>`
- **Used by web onboarding today** for typeahead.
- **Response:** JSON array of brokerage rows (at minimum `id`, `name`).
- Recommended iOS query params:
  - `q`: trimmed user input
  - `limit`: `15` (matches web)

### Onboarding completion endpoint

- **Route:** `POST /api/onboarding/complete`
- Relevant request fields:
  - `industry: string`
  - `brokerage?: string`
  - `brokerageId?: string` (UUID)

### Persistence behavior on backend

When request is submitted:

1. If `brokerageId` is a valid UUID:
   - `workspaces.brokerage_id = brokerageId`
   - `workspaces.brokerage_name = null`
2. Else if `brokerage` has text:
   - Backend attempts exact-ish name match against canonical `brokerages` table
   - If matched: stores canonical `brokerage_id` and clears `brokerage_name`
   - If not matched: stores custom text in `brokerage_name`, `brokerage_id = null`

Implication for iOS: always safe to send typed `brokerage` text when user did not choose an autocomplete item.

---

## 3) Product Rules (Must-Haves)

1. Brokerage input is hidden for all industries except `Real Estate`.
2. Switching away from `Real Estate` must clear:
   - brokerage text
   - selected brokerage id
   - suggestions list/open state
3. For `Real Estate`, brokerage is optional unless product decides otherwise.
4. User can complete onboarding by either:
   - selecting existing brokerage from list, or
   - keeping custom typed value (new brokerage path).
5. If user selects an existing brokerage and then edits text manually, clear selected id to avoid stale mismatch.

---

## 4) UX / Interaction Design

### Field visibility

- Show brokerage section only when `industry == "Real Estate"`.
- Hide immediately when industry changes to any other value.

### Typeahead behavior

- Debounce input (`200–300ms`).
- Trigger search only when trimmed query is non-empty.
- Show dropdown suggestions under field.
- Selecting a suggestion:
  - sets input text to suggestion name
  - sets `brokerageId` to suggestion id
  - closes dropdown

### “Add new brokerage” behavior

When user input does not exactly match a returned suggestion name (case-insensitive), show action row:

- `Add "<typed value>" as new brokerage`

Selecting this action:

- keeps sanitized typed text in `brokerage`
- sets `brokerageId = nil`
- closes dropdown

### Empty / no-results behavior

- If no matches but query exists, still show the add-new row.
- Do not block continue.

### Accessibility / UX polish

- Keep keyboard focus in brokerage input while typing.
- Dismiss suggestions on outside tap, `Esc`, or industry change.
- Support Dynamic Type and VoiceOver labels for result rows and add-new action.

---

## 5) iOS State Model

Use explicit state to avoid edge bugs.

```swift
struct BrokerageSuggestion: Decodable, Identifiable {
    let id: String
    let name: String
}

struct BrokerageState {
    var industry: String = ""
    var brokerageText: String = ""
    var selectedBrokerageId: String? = nil
    var suggestions: [BrokerageSuggestion] = []
    var isSuggestionsOpen: Bool = false
    var isSearching: Bool = false
    var searchError: String? = nil
}
```

### Derived flags

- `showBrokerageField = (industry == "Real Estate")`
- `hasTypedBrokerage = !brokerageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty`
- `isExistingSelection = (selectedBrokerageId != nil)`

---

## 6) Networking Plan for iOS

### Request

- Method: `GET`
- URL: `https://flyrpro.app/api/brokerages/search`
- Query:
  - `q=<trimmed input>`
  - `limit=15`

### Response handling

- Parse array as `[BrokerageSuggestion]`.
- On failure:
  - clear suggestions
  - keep typed value intact
  - optionally show non-blocking inline helper: `Couldn’t load suggestions`

### Debounce + cancellation

- Debounce input `200–300ms`.
- Cancel in-flight search when:
  - query changes
  - field hidden (industry changed away from Real Estate)
  - view disappears

---

## 7) Submission Mapping (`POST /api/onboarding/complete`)

At submit time:

1. Build base onboarding payload.
2. Include brokerage fields only when industry is `Real Estate`.

### Mapping logic

If `industry != "Real Estate"`:

- `brokerage = nil`
- `brokerageId = nil`

If `industry == "Real Estate"` and user selected existing:

- `brokerage = brokerageText` (optional but recommended to send)
- `brokerageId = selectedBrokerageId`

If `industry == "Real Estate"` and user typed custom:

- `brokerage = sanitizedText`
- `brokerageId = nil`

Sanitize text before submit:

- trim leading/trailing whitespace
- collapse internal multi-spaces to single spaces

---

## 8) Suggested ViewModel Flow

1. `onIndustryChanged(newValue)`
   - set industry
   - if newValue != `Real Estate`, reset brokerage state
2. `onBrokerageTextChanged(newText)`
   - set text
   - clear `selectedBrokerageId`
   - debounce search if Real Estate and non-empty text
3. `onSelectSuggestion(item)`
   - set text = item.name
   - set selected id = item.id
   - close list
4. `onSelectAddNew()`
   - sanitize text
   - selected id = nil
   - close list
5. `onSubmit()`
   - construct payload with mapping rules in Section 7

---

## 9) Edge Cases to Handle

1. User picks existing brokerage then edits one character:
   - Must clear `brokerageId`.
2. User clears brokerage input entirely:
   - suggestions close
   - `brokerageId = nil`
3. Industry toggles Real Estate -> Other -> Real Estate:
   - state should re-open cleanly without stale id/list.
4. Search API temporarily fails:
   - user can still continue with custom typed brokerage.
5. Exact name typed but not selected:
   - backend still attempts canonical match on submit.

---

## 10) QA Test Matrix

### Core paths

1. **Non-Real-Estate industry**
   - Brokerage field never appears.
   - Submit payload contains no brokerage fields.
2. **Real Estate + existing brokerage**
   - Search returns list.
   - Select row sets `brokerageId`.
   - Submit stores canonical brokerage.
3. **Real Estate + custom brokerage**
   - Type value, choose add-new action (or leave typed value).
   - Submit with `brokerage` text and `brokerageId = null`.

### Behavior tests

4. Change industry away from Real Estate after selecting brokerage:
   - Brokerage state clears.
5. Return to Real Estate:
   - input empty, no stale selection.
6. Network failure during search:
   - continue works with typed value.
7. Double-submit protection:
   - only one onboarding request in flight.

### Data verification

8. Existing selection writes `workspaces.brokerage_id`.
9. New text writes `workspaces.brokerage_name`.
10. Leaderboard/grouping still resolves display name correctly.

---

## 11) Rollout Plan (Minimal Surface Area)

### Phase 1: Client-only alignment

- Implement iOS behavior to match existing backend/web contracts.
- No server changes.

### Phase 2: Hardening (optional)

- Add lightweight telemetry:
  - search success/failure rate
  - existing vs custom selection ratio
- Add guardrails for very short query length if needed.

### Phase 3: Optimization (optional)

- Add local in-memory cache for recent brokerage queries.
- Add highlighted matching text in suggestions.

---

## 12) Engineering Checklist

- [ ] Brokerage UI rendered only for `Real Estate`.
- [ ] Debounced search wired to `GET /api/brokerages/search`.
- [ ] Suggestion selection sets `brokerageId`.
- [ ] Typing after selection clears `brokerageId`.
- [ ] Add-new path keeps custom text with nil id.
- [ ] Industry change away from Real Estate clears brokerage state.
- [ ] Submit payload mapping implemented exactly as defined.
- [ ] Error and loading states handled without blocking onboarding.
- [ ] QA matrix scenarios pass on simulator + device.

---

## 13) Canonical Endpoint Summary

- Search brokerages:
  - `GET https://flyrpro.app/api/brokerages/search?q=<query>&limit=15`
- Complete onboarding:
  - `POST https://flyrpro.app/api/onboarding/complete`

For team-handoff users who continue on web, the same backend behavior applies through web onboarding (`/onboarding/team/setup`), so iOS and web remain consistent on persistence rules.
