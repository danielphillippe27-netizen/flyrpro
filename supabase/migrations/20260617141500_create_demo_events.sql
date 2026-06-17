-- Migration: 20260617141500_create_demo_events
-- Description: Adds append-only analytics events for the cinematic demo engine.
-- iOS impact: none | altered tables: none | requires iOS coordination: no
-- Author: Harry Brown
-- Date: 2026-06-17

create table public.demo_events (
  id bigint generated always as identity primary key,
  slug text not null,
  session_id uuid not null,
  event text not null,
  beat smallint,
  t_ms integer,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_demo_events_slug_created on public.demo_events (slug, created_at desc);
create index idx_demo_events_session on public.demo_events (session_id);

alter table public.demo_events enable row level security;
-- No permissive policies. All writes go through app/api/demo-events/route.ts
-- using the service-role admin client. All reads go through the
-- Basic-Auth-protected /d/admin readout page using the same admin client.
--
-- Deviation from the brief: no FK on slug referencing demo_links(slug).
-- The generic /d/demo page and any unknown-slug fallback (per Phase 1's
-- "never 404" requirement) don't have a demo_links row, and a FK would
-- silently break tracking for exactly those cases. Plain text slug avoids
-- this fragility.
