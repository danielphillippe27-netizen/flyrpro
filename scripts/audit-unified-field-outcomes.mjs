// Read-only production audit. Never prints credentials, addresses, notes or contact data.
import { config } from 'dotenv';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
config({ path: '.env.local', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await db.connect();
  await db.query('BEGIN READ ONLY');
  await db.query("SET LOCAL statement_timeout='30s'");
  const report = {};
  const queries = {
    farms: `SELECT count(*)::int total,count(*) FILTER(WHERE linked_campaign_id IS NULL)::int without_linked_campaign FROM farms`,
    home_links: `SELECT count(*)::int total,count(*) FILTER(WHERE fa.campaign_address_id IS NULL)::int missing_link,
      count(*) FILTER(WHERE fa.campaign_address_id IS NOT NULL AND (ca.id IS NULL OR ca.campaign_id IS DISTINCT FROM f.linked_campaign_id))::int mismatched_link
      FROM farm_addresses fa JOIN farms f ON f.id=fa.farm_id LEFT JOIN campaign_addresses ca ON ca.id=fa.campaign_address_id`,
    ambiguous_links: `SELECT count(*)::int groups FROM (SELECT farm_id,campaign_address_id FROM farm_addresses
      WHERE campaign_address_id IS NOT NULL GROUP BY farm_id,campaign_address_id HAVING count(*)>1) x`,
    session_attribution: `SELECT count(*) FILTER(WHERE farm_id IS NOT NULL)::int farm_sessions,
      count(*) FILTER(WHERE farm_id IS NOT NULL AND farm_touch_id IS NULL)::int missing_touch,
      count(*) FILTER(WHERE s.farm_id IS NULL AND EXISTS(SELECT 1 FROM farms f WHERE f.linked_campaign_id=s.campaign_id))::int linked_campaign_sessions_without_farm_context FROM sessions s`,
    exclusions: `SELECT count(*) FILTER(WHERE status='do_not_knock')::int do_not_knock_outcomes,
      count(*) FILTER(WHERE status='none')::int reset_outcomes,count(*)::int outcomes FROM farm_touch_addresses`,
    touch_totals: `SELECT count(*)::int mismatched_touches FROM farm_touches t WHERE coalesce(t.homes_reached,0) <>
      (SELECT count(*) FROM farm_touch_addresses a WHERE a.farm_touch_id=t.id AND a.status IN ('no_answer','delivered','talked','appointment','future_seller','hot_lead'))`,
    schema: `SELECT to_regprocedure('public.v3_record_field_outcome(uuid,uuid[],text,text,timestamptz,uuid,text,text,double precision,double precision,text,jsonb,text,text,integer,text,uuid,uuid)') IS NOT NULL AS unified_rpc_installed`,
  };
  for (const [name, sql] of Object.entries(queries)) report[name] = (await db.query(sql)).rows;
  await db.query('ROLLBACK');
  const output = JSON.stringify({ auditedAt: new Date().toISOString(), readOnly: true, ...report }, null, 2);
  await writeFile('docs/unified-outcomes/live-audit.json', output+'\n');
  console.log(output);
} catch (error) { console.error('Read-only audit failed:', error.code ?? error.name); process.exitCode=1; }
finally { await db.end(); }
