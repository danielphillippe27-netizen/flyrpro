CREATE EXTENSION IF NOT EXISTS postgis;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA extensions;
CREATE TABLE public.campaign_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL,
 formatted text,address text,house_number text,street_name text,locality text,region text,postal_code text,
 match_source text,visited boolean DEFAULT false,deleted_at timestamptz
);
CREATE TABLE public.building_address_links (
 campaign_id uuid,address_id uuid REFERENCES campaign_addresses(id),user_confirmed boolean,locked boolean,match_type text
);
CREATE TABLE field_activity (address_id uuid REFERENCES campaign_addresses(id),note text,outcome text,assignee text);
