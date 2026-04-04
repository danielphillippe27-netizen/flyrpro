# Auth Routing Spec

This document is the canonical post-auth routing contract for FLYR across iOS and web.

## Goals

- Keep post-auth routing deterministic across iOS and web.
- Make Supabase auth session state the source of truth for authentication.
- Ensure invite flows resolve before onboarding, subscription gating, or workspace-home routing.
- Ensure onboarding completion is server-authoritative.
- Keep workspace fallback selection deterministic and consistent across clients.

## Canonical Decision Order

Every client should resolve routes in this order:

1. Authenticated session
   - If there is no valid Supabase session, route to `login`.
   - If there is a valid Supabase session, continue.

2. Invite intent
   - If invite intent exists, route to the join flow before any onboarding, subscribe, or app-home decision.
   - Auth listeners and bootstrap logic may preserve invite intent, but they must not consume the invite automatically.
   - Invite acceptance must happen only from the explicit join flow.

3. Server onboarding status
   - If the server says onboarding is incomplete, route to `onboarding`.
   - Clients must not treat local cache or local flags as authoritative onboarding completion.

4. Workspace resolution
   - If no accessible workspace exists, route to onboarding or the product-approved empty state.
   - If one workspace exists, select it.
   - If multiple workspaces exist, use the deterministic primary workspace rule below.

5. Subscription gating
   - If subscription gating applies after workspace resolution and onboarding is complete, route to `subscribe`.
   - Otherwise route to app home.

## Source Of Truth Rules

### Session truth

- Supabase auth session is authoritative for whether a user is authenticated.
- Cached `AppUser`, profile blobs, and workspace cache are secondary optimizations only.
- If session restore succeeds but cached profile data is missing or stale, the client must stay authenticated and rehydrate profile/workspace state.

### Onboarding truth

- Onboarding completion is server-confirmed.
- Clients may track `submitting`, `failed`, or `retry-needed`.
- Clients must not mark onboarding complete locally until the backend completion request succeeds.

### Invite truth

- Invite intent has priority over onboarding and subscribe routing.
- Duplicate invite acceptance attempts must be harmless.
- Backend invite acceptance must be idempotent for the same user and token.

## Deterministic Primary Workspace Rule

When fallback workspace selection is needed, all clients must use the same ordering:

1. `owner`
2. `admin`
3. `member`
4. Earliest membership `created_at`
5. Stable tie-breaker by workspace identifier if needed

Clients must not use an unvalidated cached workspace ahead of server-backed membership/access checks.

## Client Rules

### iOS

- Do not let auth-change callbacks auto-accept invites.
- Do not let local onboarding-complete flags override server onboarding truth.
- Namespace workspace cache by authenticated user id.
- Validate cached workspace membership before using it.

### Web

- Preserve invite intent explicitly through login, callback, and `/gate`.
- Do not bury invite intent in a way the post-auth gate cannot recover deterministically.

## Backend Rules

- Invite acceptance must be idempotent.
- Repeated accept attempts by the same user/token must return a success-like response.
- Membership creation must be safe to retry and must not create duplicate rows or inconsistent role state.
- Only invalid, expired, or unauthorized accept attempts should fail the flow.

## Reference Scenarios

### New invited user

1. User opens `/join?token=...` while logged out.
2. Client preserves invite intent through login.
3. After auth, route goes to join flow first.
4. User accepts invite once.
5. Workspace membership is established.
6. Route proceeds to onboarding or app home based on server truth.

### Returning invited user

1. User already has a valid session.
2. Invite intent routes directly to join flow.
3. Duplicate accept retry is harmless.
4. Final route uses server onboarding and workspace state.

### Onboarding failure

1. User submits onboarding.
2. Backend write fails.
3. Client stays on onboarding, shows retry state, and does not mark onboarding complete locally.

### Multi-workspace user

1. No explicit workspace selection exists.
2. Client resolves the primary workspace using the deterministic role-priority rule.
3. Web and iOS land on the same workspace.

### Restored session with missing profile cache

1. Supabase session restore succeeds.
2. Cached profile blob is missing or stale.
3. Client remains authenticated.
4. Client rehydrates profile/workspace state from server sources.

## Non-Negotiable Constraints

- Local cache must not change the canonical decision order.
- Local onboarding flags must not override server truth.
- Invite intent must be resolved before onboarding, subscribe, or workspace-home routing.
- Invite acceptance must have a single explicit owner in the UI flow.
