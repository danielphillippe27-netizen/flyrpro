# Contacts and Activity: Table Usage and Unification

This doc records how the app uses (or doesn’t use) contact and activity tables, and how to unify iOS and web.

**Source:** Codebase search across iOS and web. DB schema in `supabase/migrations/`.

---

## 1. Contacts

| Table / concept | Used by app? | Where |
|-----------------|--------------|--------|
| **`public.contacts`** | **Yes** | **iOS:** ContactsService (fetch/add/update/delete, by address, link to address), BuildingDataService (contacts for address). **Web:** ContactsService (fetch/create/update/delete, link to address), ContactsHubView, CreateContactDialog, useBuildingData + MapBuildingsLayer (contacts by address), sync-crm (reads for FUB), FollowUpBoss push-lead (insert). |
| **`public.campaign_contacts`** | **Yes (web only)** | **Web only:** CampaignsService (fetchCampaignContacts, createCampaignContact, updateCampaignContact, deleteCampaignContact); campaign detail page `app/(main)/campaigns/[campaignId]/page.tsx`. In DB this is a **view** over `contacts` with an INSTEAD OF trigger, so campaign-scoped leads live in `contacts`. **iOS:** no references. |
| **`public.field_leads`** | **Yes (iOS only)** | **iOS:** FieldLeadsService (all CRUD), CampaignMapView, LeadDetailView, LeadCaptureSheet, LeadsViewModel, NewCampaignDetailView, SyncSettingsView, LeadsExportManager. **Web:** uses `contacts` only; no references to `field_leads`. |

**Summary**

- **contacts** = used on both (canonical storage; campaign_contacts view sits on top for web campaign lead list).
- **campaign_contacts** = used on web only (via CampaignsService); not used on iOS.
- **field_leads** = used on iOS only; web is already on `contacts`. Unification = move iOS from `field_leads` to `contacts`.

---

## 2. Team activity (sessions + events)

| Table / concept | Used by app? | Where |
|-----------------|--------------|--------|
| **`public.sessions`** | **Yes** | **iOS:** SessionsAPI (fetch user sessions, campaign sessions, active session), SessionManager (insert/update sessions), NewCampaignDetailView (campaign sessions for analytics), LeaderboardView / LeaderboardDebugView. **Web:** team dashboard RPCs (e.g. get_team_leaderboard, get_agent_report) read from `sessions`. |
| **`public.session_events`** | **Yes** | **iOS:** SessionEventsAPI; RPC `rpc_complete_building_in_session` writes to `session_events` (see migration `20250208000000_session_recording.sql`). **Web:** `get_team_activity_feed` and related RPCs read from `session_events` (with fallback to `sessions`). |
| **`public.field_sessions`** | **No** | Not referenced in app code. Legacy; team dashboard reads from `sessions`. |
| **`public.activity_events`** | **No** | Not referenced in app code. Legacy; team feed reads from `session_events`. |

**Summary**

- **sessions** and **session_events** = used (iOS reads/writes; web reads via RPCs). Already the single source of truth for team activity.
- **field_sessions** and **activity_events** = not used; no app unification needed for them.

---

## 3. Contact-level activity

| Table / concept | Used by app? | Where |
|-----------------|--------------|--------|
| **`public.contact_activities`** | **Yes** | **iOS:** ContactsService.logActivity (insert), ContactsService.fetchActivities (select), ContactDetailSheet (show timeline, log activity), ContactsViewModel.logActivity. **Web:** ContactsService.logActivity / fetchActivities; ContactDetailSheet (load activities, log activity). Table created in `20250121000000_add_contacts_tables.sql`. |

**Summary**

- **contact_activities** = used on both iOS and web for per-contact timeline (log + fetch). Same table; unification is already in place at the DB and service layer; ensure UX (e.g. timeline visibility, activity types) is consistent across platforms.

---

## 4. Unification checklist

| Area | Current state | Unification action |
|------|----------------|--------------------|
| **Contacts** | Web uses `contacts` (and `campaign_contacts` view). iOS still uses `field_leads`. | **iOS:** Switch to `contacts` (and optional use of `campaign_contacts` view if you add campaign-scoped lead UI on iOS). Reuse or mirror web’s workspace/campaign/address/gers_id semantics. Migrate or sync existing `field_leads` data into `contacts` if needed; then stop writing to `field_leads`. |
| **Team activity** | Both use `sessions` + `session_events`. | None required; already unified. |
| **Contact activity** | Both use `contact_activities` (ContactsService + ContactDetailSheet on web; equivalent on iOS). | Ensure activity types and payloads are aligned (e.g. knock, call, note). Add or expose contact timeline on web wherever it’s missing so parity with iOS is clear. |

---

## 5. Quick reference: canonical tables

- **Contacts:** `public.contacts` (with optional `campaign_contacts` view for campaign-scoped lead list on web).
- **Team activity:** `public.sessions` + `public.session_events`.
- **Contact activity:** `public.contact_activities`.

Legacy tables not used by app: `field_leads` (iOS to migrate off), `field_sessions`, `activity_events`.
