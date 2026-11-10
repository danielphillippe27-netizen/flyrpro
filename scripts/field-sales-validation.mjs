// Local-only browser harness: real components and migrated PostgreSQL, synthetic identities.
// PGLITE_MODULE=... ESBUILD_MODULE=... node scripts/field-sales-validation.mjs
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(root, "package.json"));
const { build } = await import(process.env.ESBUILD_MODULE ?? "esbuild");
const fixturePath = process.env.SALES_FIXTURE ?? "../../WolfGrid-IOS/supabase/tests/field_sales_fixture.mjs";
const { createSalesFixture } = await import(fixturePath);
const roofing = process.env.ROOFING_SALES === "1";
const pro = roofing || process.env.PRO_SALES === "1";
const { db, id } = await createSalesFixture();
if (pro) {
  for (const migration of ["20260916120000_pro_sales_foundation.sql","20260916121000_pro_sales_records.sql","20260916121500_pro_sales_activity.sql","20260916122000_pro_sales_reporting.sql","20260916123000_pro_sales_leaderboards.sql","20260916124000_pro_sales_goals.sql","20260916125000_pro_sales_goal_compatibility.sql","20260916126000_pro_sales_home.sql","20260916127000_pro_sales_entry.sql","20260916128000_pro_sales_pipeline.sql","20260916129000_pro_sales_report_pipeline.sql","20260916130000_pro_sales_commission_home.sql","20260917120000_appointment_sales_v1.sql","20260917121000_appointment_sale_uniqueness.sql"]) {
    await db.exec(await readFile(resolve(root,"supabase/migrations",migration),"utf8"));
  }
}
await db.exec(
  `INSERT INTO field_sales_settings(workspace_id,enabled,currency,timezone) VALUES('${id(10)}',true,'CAD','America/Toronto');`,
);
if (pro) {
  await db.exec(`INSERT INTO contact_activities(id,contact_id,type,timestamp,status) VALUES
    ('${id(40)}','${id(30)}','meeting',now()-interval '2 hours','completed'),
    ('${id(41)}','${id(31)}','meeting',now()-interval '1 hour','completed');`);
}
if (roofing) {
  await db.exec(`
    CREATE ROLE service_role;
    CREATE FUNCTION can_view_campaign(campaign uuid, actor uuid) RETURNS boolean LANGUAGE sql AS $$
      SELECT EXISTS (SELECT 1 FROM campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
        WHERE c.id=campaign AND m.user_id=actor)
    $$;
    ALTER TABLE contacts ADD COLUMN appointment_at timestamptz, ADD COLUMN address_id uuid, ADD COLUMN address text, ADD COLUMN phone text;
    CREATE TABLE calendar_events (id uuid PRIMARY KEY, workspace_id uuid, user_id uuid, contact_id uuid, event_type text);
    CREATE TABLE campaign_addresses (id uuid PRIMARY KEY, campaign_id uuid, formatted text);
    INSERT INTO campaign_addresses VALUES ('${id(47)}','${id(20)}','7 Test Street');
    INSERT INTO sessions(id,workspace_id,user_id,campaign_id,start_time)
      VALUES ('${id(48)}','${id(10)}','${id(2)}','${id(20)}',now()-interval '10 minutes');
    UPDATE contacts SET session_id='${id(48)}',created_at=now()-interval '5 minutes' WHERE id='${id(30)}';
    UPDATE workspaces SET industry='Roofing' WHERE id='${id(10)}';
    UPDATE contacts SET address_id='${id(47)}',address='7 Test Street' WHERE id='${id(30)}';
  `);
  for (const migration of [
    "20261110120000_roofing_appointments.sql","20261110121000_roofing_appointment_reminders.sql",
    "20261110122000_roofing_sales.sql","20261110123000_roofing_earnings.sql","20261110124000_roofing_entry_and_reporting.sql", "20261110125000_workspace_sales_visibility.sql",
  ]) await db.exec(await readFile(resolve(root, "supabase/migrations", migration), "utf8"));
  await db.exec(`
    UPDATE field_sales_settings SET roofing_appointments_enabled=true,roofing_appointment_writes_enabled=true,
      roofing_sales_enabled=true,roofing_sale_writes_enabled=true,
      roofing_earnings_enabled=true,roofing_earnings_writes_enabled=true;
    SET ROLE authenticated;
    SET request.jwt.claim.sub='${id(1)}';
    SELECT field_earnings_command('${id(10)}','publish_plan',
     jsonb_build_object('request_id','${id(101)}','title','Inspection fee','role','setter',
      'effective_on',(now() AT TIME ZONE 'America/Toronto')::date,'rules','[{"kind":"held_fee","amount_minor":"10000"}]'::jsonb));
    SELECT field_earnings_command('${id(10)}','publish_plan',
     jsonb_build_object('request_id','${id(102)}','title','Cash commission','role','closer',
      'effective_on',(now() AT TIME ZONE 'America/Toronto')::date,'rules','[{"kind":"cash_percent","rate_bps":500}]'::jsonb));
    RESET ROLE;
  `);
}
const dir = await mkdtemp(join(tmpdir(), "wolfgrid-sales-browser-"));
await writeFile(
  join(dir, "workspace.ts"),
  `export function useWorkspace(){return {currentWorkspaceId:'${id(10)}',membershipsByWorkspaceId:{'${id(10)}':({'1':'owner','2':'member','3':'admin'})[localStorage.getItem('actor')||'1']}}}`,
);
await writeFile(
  join(dir, "navigation.ts"),
  `export function useSearchParams(){return new URLSearchParams(location.search)}`,
);
await writeFile(
  join(dir, "link.tsx"),
  `import React from 'react';export default function Link(p){return <a {...p}/>}`,
);
await writeFile(
  join(dir, "client.ts"),
  `
const listeners=new Set();
window.testActor=(n)=>{localStorage.setItem('actor',String(n));listeners.forEach(f=>f('SIGNED_IN'));};
export function createClient(){return {
 auth:{getSession:async()=>({data:{session:{user:{id:localStorage.getItem('actor')||'1'}}}}),onAuthStateChange:f=>{listeners.add(f);return {data:{subscription:{unsubscribe:()=>listeners.delete(f)}}};}},
 rpc:async(name,args)=>{const response=await fetch('/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Test-Actor':localStorage.getItem('actor')||'1'},body:JSON.stringify(args)});return response.json();}
};}
`,
);
await writeFile(
  join(dir, "entry.tsx"),
  `
import React from 'react';import {createRoot} from 'react-dom/client';
import {SalesDashboard} from '${join(root, "components/field-sales/SalesDashboard.tsx")}';
import {SalesWorkbench} from '${join(root, "components/field-sales/SalesWorkbench.tsx")}';
import {ProSalesLeaderboard} from '${join(root, "components/field-sales/ProSalesLeaderboard.tsx")}';
import {SalesGoals} from '${join(root, "components/field-sales/SalesGoals.tsx")}';
import {ProSalesReport} from '${join(root, "components/field-sales/ProSalesReport.tsx")}';
import {SaleRecordPanel} from '${join(root, "components/field-sales/SaleRecordPanel.tsx")}';
import {RoofingAppointments} from '${join(root, "components/appointments/RoofingAppointments.tsx")}';
import {EarningsPage} from '${join(root, "components/field-sales/EarningsPage.tsx")}';
import {SalesCard} from '${join(root, "components/field-sales/SalesCard.tsx")}';
import {WorkspaceSalesSettings} from '${join(root, "components/field-sales/WorkspaceSalesSettings.tsx")}';
import {SessionSales} from '${join(root, "components/field-sales/SessionSales.tsx")}';
createRoot(document.getElementById('root')).render(<><header style={{padding:16,background:'#eef2ff'}}><strong>Local Sales acceptance environment</strong> <label>Test identity <select onChange={e=>window.testActor(e.target.value)} defaultValue={localStorage.getItem('actor')||'1'}><option value="1">Owner</option><option value="2">Representative</option><option value="3">Admin</option></select></label></header><div style={{maxWidth:1100,margin:'auto',padding:24}}>{location.pathname === "/visibility-test" ? <><WorkspaceSalesSettings/><SalesCard/><SessionSales sessionId="${id(48)}"/></> : location.pathname === "/appointments" ? <RoofingAppointments workspace="${id(10)}" legacy={<p>Legacy appointments</p>} /> : location.pathname === "/sales/earnings" ? <EarningsPage/> : location.pathname.includes("goals") ? <SalesGoals/> : location.pathname.includes("leaderboards") ? <ProSalesLeaderboard/> : location.pathname.includes("reports") ? <ProSalesReport/> : location.pathname.split("/").pop()?.length === 36 ? <SaleRecordPanel saleId={location.pathname.split("/").pop()}/> : location.pathname.includes("opportunities") ? <SalesWorkbench/> : <><SalesCard/><SalesDashboard/></>}</div></>);
`,
);
await build({
  entryPoints: [join(dir, "entry.tsx")],
  bundle: true,
  outfile: join(dir, "bundle.js"),
  jsx: "automatic",
  platform: "browser",
  nodePaths: [join(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "isolated-services",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          const stub = {
            "@/lib/workspace-context": "workspace.ts",
            "@/lib/supabase/client": "client.ts",
            "next/navigation": "navigation.ts",
            "next/link": "link.tsx",
          }[args.path];
          if (stub) return { path: join(dir, stub) };
          if (args.path.startsWith("@/")) {
            const target = join(root, args.path.slice(2));
            for (const extension of [".ts", ".tsx"]) {
              if (existsSync(target + extension)) return { path: target + extension };
            }
          }
          if (
            args.path === "react" ||
            args.path.startsWith("react/") ||
            args.path === "react-dom/client"
          )
            return { path: require.resolve(args.path) };
        });
      },
    },
  ],
});
let queue = Promise.resolve();
const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  if (req.url.startsWith("/rpc/") || req.url.startsWith("/rest/v1/rpc/")) {
    let text = "";
    for await (const chunk of req) text += chunk;
    queue = queue.then(async () => {
      const actor = Number(req.headers["x-test-actor"] ?? 1);
      const name = req.url.split("/").pop();
      const args = JSON.parse(text);
      let result;
      try {
        await db.exec(
          `SET ROLE authenticated; SET request.jwt.claim.sub='${id([1, 2, 3].includes(actor) ? actor : 4)}';`,
        );
        if (name === "field_sales_bootstrap")
          result = await db.query("SELECT field_sales_bootstrap($1) data", [
            args.p_workspace,
          ]);
        else if (name === "field_sales_dashboard")
          result = await db.query(
            "SELECT field_sales_dashboard($1,$2,$3,$4,$5,$6) data",
            [
              args.p_workspace,
              args.p_period ?? "month",
              args.p_team ?? false,
              args.p_rep ?? null,
              args.p_campaign ?? null,
              args.p_status ?? null,
            ],
          );
        else if (name === "field_sales_command")
          result = await db.query("SELECT field_sales_command($1,$2,$3) data", [
            args.p_workspace,
            args.p_action,
            args.p_data,
          ]);
        else if (name === "field_sales_entry") result = await db.query("SELECT field_sales_entry($1,$2) data",[args.p_workspace,args.p_context??{}]);
        else if (name === "field_sales_commission_home") result = await db.query("SELECT field_sales_commission_home($1) data",[args.p_workspace]);
        else if (name === "field_sales_home") result = await db.query("SELECT field_sales_home($1) data",[args.p_workspace]);
        else if (name === "field_sales_target_list") result = await db.query("SELECT field_sales_target_list($1,$2) data",[args.p_workspace,args.p_filter??{}]);
        else if (name === "field_sales_target_command") result = await db.query("SELECT field_sales_target_command($1,$2,$3) data",[args.p_workspace,args.p_action,args.p_data]);
        else if (name === "field_sales_report") result = await db.query("SELECT field_sales_report($1,$2) data",[args.p_workspace,args.p_filter??{}]);
        else if (name === "field_sales_leaderboard") result = await db.query("SELECT field_sales_leaderboard($1,$2,$3) data",[args.p_workspace,args.p_filter??{},args.p_metric??null]);
        else if (name === "field_sales_drilldown") result = await db.query("SELECT field_sales_drilldown($1,$2,$3) data",[args.p_workspace,args.p_filter??{},args.p_kind]);
        else if (name === "field_sales_ranking_settings") result = await db.query("SELECT field_sales_ranking_settings($1,$2,$3,$4) data",[args.p_workspace,args.p_categories,args.p_minimum,args.p_featured]);
        else if (name === "field_sales_record") result = await db.query("SELECT field_sales_record($1,$2) data",[args.p_workspace,args.p_sale]);
        else if (name === "field_sales_workbench") result = await db.query("SELECT field_sales_workbench($1) data",[args.p_workspace]);
        else if (name === "field_sales_pipeline_command") result = await db.query("SELECT field_sales_pipeline_command($1,$2,$3) data",[args.p_workspace,args.p_action,args.p_data]);
        else if (roofing && name === "field_appointment_list")
          result = await db.query("SELECT field_appointment_list($1,$2,$3,$4,$5,$6,$7) data",
            [args.p_workspace,args.p_start??null,args.p_end??null,args.p_contact??null,args.p_team??false,args.p_after_start??null,args.p_after_id??null]);
        else if (roofing && name === "field_appointment_options")
          result = await db.query("SELECT field_appointment_options($1,$2,$3) data",[args.p_workspace,args.p_search??"",args.p_address??null]);
        else if (roofing && name === "field_appointment_command")
          result = await db.query("SELECT field_appointment_command($1,$2,$3) data",[args.p_workspace,args.p_action,args.p_data]);
        else if (roofing && name === "field_appointment_detail")
          result = await db.query("SELECT field_appointment_detail($1,$2) data",[args.p_workspace,args.p_id]);
        else if (roofing && name === "field_appointment_alerts")
          result = await db.query("SELECT field_appointment_alerts($1) data",[args.p_workspace]);
        else if (roofing && name === "field_sales_workspace_command")
          result = await db.query("SELECT field_sales_workspace_command($1,$2) data",[args.p_workspace,args.p_enabled??null]);
        else if (roofing && name === "field_sales_session_summary")
          result = await db.query("SELECT field_sales_session_summary($1,$2) data",[args.p_workspace,args.p_session]);
        else if (roofing && name === "field_sales_roofing_entry")
          result = await db.query("SELECT field_sales_roofing_entry($1,$2) data",[args.p_workspace,args.p_context??{}]);
        else if (roofing && name === "field_earnings_list")
          result = await db.query("SELECT field_earnings_list($1,$2) data",[args.p_workspace,args.p_filter??{}]);
        else if (roofing && name === "field_earnings_command")
          result = await db.query("SELECT field_earnings_command($1,$2,$3) data",[args.p_workspace,args.p_action,args.p_data]);
        else if (name === "field_sales_history") result = await db.query("SELECT field_sales_history($1,$2) data",[args.p_workspace,args.p_sale]);
        else throw new Error("Unknown RPC");
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            req.url.startsWith("/rest/")
              ? result.rows[0].data
              : { data: result.rows[0].data, error: null },
          ),
        );
      } catch (error) {
        res.setHeader("Content-Type", "application/json");
        if (req.url.startsWith("/rest/")) {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: error.message, code: "P0001" }));
        } else
          res.end(
            JSON.stringify({ data: null, error: { message: error.message } }),
          );
      }
    });
    return;
  }
  if (req.url === "/bundle.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(await readFile(join(dir, "bundle.js")));
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><html><head><title>WolfGrid Sales acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;margin:0;color:#172033;background:#f6f7f9}section,article{background:white;padding:16px;border:1px solid #ddd;border-radius:14px;margin:12px 0}button,select,input,textarea{font:inherit;padding:8px;border:1px solid #bbb;border-radius:8px}button{cursor:pointer}label{display:inline-block;margin:8px}strong{font-weight:650}form{border:1px solid #ddd;padding:20px;border-radius:12px;display:grid;gap:8px}p{line-height:1.5}.flex{display:flex;gap:12px}.justify-between{justify-content:space-between}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.text-2xl{font-size:24px}.space-y-6> *{margin-bottom:24px}.space-y-3> *{margin-bottom:12px}.text-destructive{color:#b22}small{font-size:12px}progress{width:100%}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
  );
});
const port = Number(process.env.SALES_TEST_PORT ?? 4318);
server.listen(port, "127.0.0.1", () =>
  console.log(`Local Sales acceptance server: http://127.0.0.1:${port}`),
);
