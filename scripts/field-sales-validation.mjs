// Local-only browser harness: real components and migrated PostgreSQL, synthetic identities.
// PGLITE_MODULE=... ESBUILD_MODULE=... node scripts/field-sales-validation.mjs
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(root, "package.json"));
const { build } = await import(process.env.ESBUILD_MODULE ?? "esbuild");
const { createSalesFixture } =
  await import("../../WolfGrid-IOS/supabase/tests/field_sales_fixture.mjs");
const { db, id } = await createSalesFixture();
if (process.env.PRO_SALES === "1") {
  for (const migration of ["20260916120000_pro_sales_foundation.sql","20260916121000_pro_sales_records.sql","20260916121500_pro_sales_activity.sql","20260916122000_pro_sales_reporting.sql","20260916123000_pro_sales_leaderboards.sql","20260916124000_pro_sales_goals.sql","20260916125000_pro_sales_goal_compatibility.sql","20260916126000_pro_sales_home.sql","20260916127000_pro_sales_entry.sql","20260916128000_pro_sales_pipeline.sql","20260916129000_pro_sales_report_pipeline.sql","20260916130000_pro_sales_commission_home.sql","20260917120000_appointment_sales_v1.sql","20260917121000_appointment_sale_uniqueness.sql"]) {
    await db.exec(await readFile(resolve(root,"../WolfGrid-IOS/supabase/migrations",migration),"utf8"));
  }
}
await db.exec(
  `INSERT INTO field_sales_settings(workspace_id,enabled,currency,timezone) VALUES('${id(10)}',true,'CAD','America/Toronto');`,
);
if (process.env.PRO_SALES === "1") {
  await db.exec(`INSERT INTO contact_activities(id,contact_id,type,timestamp,status) VALUES
    ('${id(40)}','${id(30)}','meeting',now()-interval '2 hours','completed'),
    ('${id(41)}','${id(31)}','meeting',now()-interval '1 hour','completed');`);
}
const dir = await mkdtemp(join(tmpdir(), "wolfgrid-sales-browser-"));
await writeFile(
  join(dir, "workspace.ts"),
  `export function useWorkspace(){return {currentWorkspaceId:'${id(10)}'}}`,
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
import {SalesCard} from '${join(root, "components/field-sales/SalesCard.tsx")}';
createRoot(document.getElementById('root')).render(<><header style={{padding:16,background:'#eef2ff'}}><strong>Local Sales acceptance environment</strong> <label>Test identity <select onChange={e=>window.testActor(e.target.value)} defaultValue={localStorage.getItem('actor')||'1'}><option value="1">Owner</option><option value="2">Representative</option><option value="3">Admin</option></select></label></header><div style={{maxWidth:1100,margin:'auto',padding:24}}>{location.pathname.includes("goals") ? <SalesGoals/> : location.pathname.includes("leaderboards") ? <ProSalesLeaderboard/> : location.pathname.includes("reports") ? <ProSalesReport/> : location.pathname.split("/").pop()?.length === 36 ? <SaleRecordPanel saleId={location.pathname.split("/").pop()}/> : location.pathname.includes("opportunities") ? <SalesWorkbench/> : <><SalesCard/><SalesDashboard/></>}</div></>);
`,
);
await build({
  entryPoints: [join(dir, "entry.tsx")],
  bundle: true,
  outfile: join(dir, "bundle.js"),
  jsx: "automatic",
  platform: "browser",
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
          if (args.path.startsWith("@/"))
            return {
              path:
                join(root, args.path.slice(2)) +
                (args.path.endsWith("client") ? ".ts" : ".tsx"),
            };
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
