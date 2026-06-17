-- Migration: 20260617133000_create_demo_links
-- Description: Adds DB-backed demo link records for the cinematic demo engine.
-- iOS impact: none | altered tables: none | requires iOS coordination: no
-- Author: Harry Brown
-- Date: 2026-06-17

create table public.demo_links (
  slug text primary key,
  company text,
  contact_name text,
  vertical text not null default 'generic',
  city text,
  center_lng double precision,
  center_lat double precision,
  cta_variant text not null default 'book',
  cta_url text,
  navigation_mode text not null default 'scroll',
  created_at timestamptz not null default now()
);

alter table public.demo_links enable row level security;
-- No permissive policies — all access goes through the service-role
-- admin client server-side only, never exposed to anon/authenticated clients.
