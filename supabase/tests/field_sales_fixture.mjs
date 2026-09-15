import { readFile } from 'node:fs/promises';
export async function createSalesFixture() {
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}');
CREATE TABLE workspaces(id uuid PRIMARY KEY,timezone text);
CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
CREATE TABLE campaigns(id uuid PRIMARY KEY,workspace_id uuid,name text,territory_id uuid);
CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid,user_id uuid,full_name text,campaign_id uuid,lead_kind text DEFAULT 'field',created_at timestamptz DEFAULT now());
CREATE TABLE contact_activities(id uuid PRIMARY KEY,contact_id uuid,type text,timestamp timestamptz,created_at timestamptz DEFAULT now(),status text);
CREATE TABLE sessions(id uuid PRIMARY KEY,workspace_id uuid,user_id uuid,campaign_id uuid);
CREATE TABLE session_events(id uuid PRIMARY KEY,session_id uuid,building_id text,address_id uuid,created_at timestamptz,event_type text,metadata jsonb,outcome text);
INSERT INTO auth.users(id,raw_user_meta_data) VALUES('${id(1)}','{"full_name":"Owner"}'),('${id(2)}','{"full_name":"Rep"}'),('${id(3)}','{"full_name":"Admin"}'),('${id(4)}','{}');
INSERT INTO workspaces(id) VALUES('${id(10)}'),('${id(11)}');
INSERT INTO workspace_members VALUES('${id(10)}','${id(1)}','owner'),('${id(10)}','${id(2)}','member'),('${id(10)}','${id(3)}','admin'),('${id(11)}','${id(4)}','owner');
INSERT INTO campaigns VALUES('${id(20)}','${id(10)}','Test campaign','${id(21)}');
INSERT INTO contacts(id,workspace_id,user_id,full_name,campaign_id,created_at) VALUES
('${id(30)}','${id(10)}','${id(2)}','Private customer','${id(20)}',date_trunc('month',now())-interval '1 day'),
('${id(31)}','${id(10)}','${id(1)}','Owner customer',null,date_trunc('month',now())-interval '1 day'),
('${id(32)}','${id(10)}','${id(3)}','Admin customer',null,date_trunc('month',now())-interval '1 day'),
('${id(33)}','${id(11)}','${id(4)}','Foreign customer',null,now());
`);
await db.exec(await readFile(new URL('./fixtures/20260915190000_field_sales_v1.sql',import.meta.url),'utf8'));

await db.exec(await readFile(new URL('./fixtures/20260915230000_field_sales_pipeline_beta.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('./fixtures/20260915234000_field_sales_aggregate_precision.sql',import.meta.url),'utf8'));
return {db,id};
}
