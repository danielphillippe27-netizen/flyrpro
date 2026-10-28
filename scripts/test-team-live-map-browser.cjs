/* Exercises the production Live Map UI with a real Mapbox renderer and controlled team API responses.
   Only workspace identity and API data are fixtures; no production records are changed. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { compile } = require("@tailwindcss/node");
const { chromium } = require("playwright");
const dotenv = require("dotenv");

async function main() {
  const root = path.resolve(__dirname, "..");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wolfgrid-live-map-"));
  let browser, server, reviewPage;
  try {
    const env = dotenv.parse(await fs.readFile(path.join(root, ".env.local")));
    assert(
      env.NEXT_PUBLIC_MAPBOX_TOKEN,
      "A public Mapbox token is required for the real renderer check",
    );
    const entry = path.join(temp, "entry.tsx");
    await fs.writeFile(
      entry,
      `
   import React, {useState} from 'react';
   import {createRoot} from 'react-dom/client';
   import mapboxgl from 'mapbox-gl';
   import {ThemeProvider, useTheme} from '${root}/lib/theme-provider';
   import {TeamMapTab} from '${root}/components/home/team/TeamMapTab';
   const OriginalMap = mapboxgl.Map;
   mapboxgl.Map = class extends OriginalMap { constructor(options) { super(options); window.testMap=this; } };
   const range={start:'2026-10-26T00:00:00Z',end:'2026-10-27T00:00:00Z'};
   const memberIds=[];
   function Review(){const {setTheme}=useTheme(); const [visible,show]=useState(true); const [demoMode,setDemo]=useState(false); return <main style={{padding:24,maxWidth:1500,margin:'auto'}}><div style={{display:'flex',gap:16,marginBottom:16}}><h1>WolfGrid · Live Map</h1><button onClick={()=>setTheme('dark')}>Dark theme</button><button onClick={()=>setTheme('light')}>Light theme</button><button onClick={()=>show(false)}>Unmount map</button><button onClick={()=>setDemo(true)}>Demo map</button></div>{visible&&<TeamMapTab range={range} memberIds={memberIds} mapMode="live" demoLive={demoMode}/>}</main>}
   createRoot(document.getElementById('root')).render(<ThemeProvider><Review/></ThemeProvider>);
  `,
    );
    await build({
      entryPoints: [entry],
      bundle: true,
      outfile: path.join(temp, "app.js"),
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      nodePaths: [path.join(root, "node_modules")],
      tsconfig: path.join(root, "tsconfig.json"),
      define: {
        "process.env": "{}",
        "process.browser": "true",
        "process.env.NEXT_PUBLIC_MAPBOX_TOKEN": JSON.stringify(
          env.NEXT_PUBLIC_MAPBOX_TOKEN,
        ),
        "process.env.NODE_ENV": '"development"',
      },
      plugins: [
        {
          name: "workspace-fixture",
          setup(b) {
            b.onResolve({ filter: /^@\/lib\/workspace-context$/ }, () => ({
              path: "workspace",
              namespace: "fixture",
            }));
            b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: `export const useWorkspace=()=>({currentWorkspaceId:'review-team'});`,
              loader: "js",
            }));
          },
        },
      ],
    });
    const css = await compile(
      await fs.readFile(path.join(root, "app/globals.css"), "utf8"),
      { base: path.join(root, "app"), onDependency() {} },
    );
    const source = (
      await Promise.all(
        [
          "components/home/team/TeamLiveActivity.tsx",
          "components/home/team/TeamMapTab.tsx",
          "components/ui/card.tsx",
        ].map((p) => fs.readFile(path.join(root, p), "utf8")),
      )
    ).join("\n");
    await fs.writeFile(
      path.join(temp, "style.css"),
      css.build([...new Set(source.match(/[^\s"'`<>{}]+/g))]),
    );
    server = http.createServer(async (req, res) => {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === "/avatar.svg") {
        res.setHeader("Content-Type", "image/svg+xml");
        res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#334155"/><circle cx="40" cy="28" r="16" fill="#f1c9a5"/><ellipse cx="40" cy="76" rx="30" ry="27" fill="#0284c7"/></svg>',
        );
        return;
      }
      const file = {
        "/app.js": "app.js",
        "/app.css": "app.css",
        "/style.css": "style.css",
      }[pathname];
      if (file) {
        try {
          res.setHeader(
            "Content-Type",
            file.endsWith(".js") ? "text/javascript" : "text/css",
          );
          res.end(await fs.readFile(path.join(temp, file)));
        } catch {
          res.statusCode = 404;
          res.end();
        }
        return;
      }
      if (pathname === "/broken.png") {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    reviewPage = page;
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Browser runtime:", error.message);
    });
    let denied = false;
    let fail = false,
      phase = "fresh",
      requests = 0;
    const members = [
      ["alex", "Alex Rivera", "#3B82F6"],
      ["maria", "Maria Santos", "#A855F7"],
      ["tyler", "Tyler King", "#22C55E"],
      ["jessica", "Jessica Miller", "#EF4444"],
    ].map(([user_id, display_name, color], i) => ({
      user_id,
      display_name,
      color,
      avatar_url:
        i === 0
          ? origin + "/avatar.svg"
          : i === 1
            ? origin + "/broken.png"
            : null,
    }));
    function response() {
      return {
        members,
        sessions: [],
        knockPoints: [],
        livePresence: members.slice(0, 3).map((member, i) => ({
          ...member,
          campaign_id: "campaign",
          campaign_name: "Mississauga",
          session_id: i < 2 ? "shared" : "tyler-session",
          lat: 43.599 + i * 0.001 + (phase === "moved" && i === 0 ? 0.002 : 0),
          lng: -79.687 + i * 0.002,
          status: i === 2 ? "paused" : "active",
          updated_at: new Date(
            Date.now() -
              (phase === "delayed" ? 120000 : phase === "expired" ? 360000 : 0),
          ).toISOString(),
          started_at: new Date(Date.now() - 1200000).toISOString(),
          active_seconds: 1200,
          distance_meters: 800,
          doors_hit: i === 2 ? 9 : phase === "moved" ? 13 : 12,
          conversations: i === 2 ? 2 : 4,
          flyers_delivered: i === 2 ? 8 : 10,
        })),
      };
    }
    await page.route("**/api/team/map?**", async (route) => {
      requests++;
      assert.equal(
        new URL(route.request().url()).searchParams.get("workspaceId"),
        "review-team",
      );
      assert.equal(
        new URL(route.request().url()).searchParams.get("mode"),
        "live",
      );
      await route.fulfill({
        status: denied ? 403 : fail ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(fail ? { error: "fixture outage" } : response()),
      });
    });
    await page.goto(origin);
    await page
      .getByRole("button", {
        name: "Locate Alex Rivera, 12 doors, Active",
        exact: true,
      })
      .waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () => window.testMap?.isStyleLoaded(),
      {},
      { timeout: 60000 },
    );
    const panel = page.getByRole("complementary", {
      name: "Live team activity",
    });
    assert.equal(await page.locator(".mapboxgl-marker").count(), 3);
    assert.equal(
      await panel.getByRole("button", { name: "View Jessica Miller" }).count(),
      1,
    );
    assert(
      /21\s+Doors/.test(await panel.innerText()),
      "Shared session totals are deduplicated",
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".mapboxgl-marker img")].some(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    assert.equal(
      await page.locator('.mapboxgl-marker img[src$="broken.png"]').count(),
      0,
      "Broken avatars fall back to initials",
    );
    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Locate Alex Rivera, 12 doors, Active",
        exact: true,
      })
      .waitFor();
    await page.waitForFunction(() => window.testMap?.isStyleLoaded());
    await page
      .locator("main > .space-y-4")
      .screenshot({ path: "/tmp/wolfgrid-live-map-desktop.png" });
    await panel.getByRole("button", { name: "View Alex Rivera" }).click();
    await panel.getByRole("button", { name: "Stop following" }).waitFor();
    await panel
      .getByText("Shared session · these stats belong to the session.")
      .waitFor();
    phase = "moved";
    await panel.getByRole("button", { name: "Refresh team locations" }).click();
    await page
      .getByRole("button", {
        name: "Locate Alex Rivera, 13 doors, Active",
        exact: true,
      })
      .waitFor();
    await page.waitForFunction(
      () => Math.abs(window.testMap.getCenter().lat - 43.601) < 0.0001,
    );
    const canvas = await page.locator(".mapboxgl-canvas").boundingBox();
    await page.mouse.move(canvas.x + 40, canvas.y + 80);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 100, canvas.y + 110, { steps: 8 });
    await page.mouse.up();
    await panel
      .getByRole("button", { name: "Follow location", exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "Follow location", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Stop following", exact: true })
      .waitFor();
    const polls = requests;
    await new Promise((resolve) => setTimeout(resolve, 15500));
    assert(
      requests > polls,
      "Locations refresh automatically after 15 seconds",
    );
    fail = true;
    await panel.getByRole("button", { name: "Refresh team locations" }).click();
    await panel.getByText("Connection interrupted · retrying").waitFor();
    assert.equal(
      await page.locator(".mapboxgl-marker").count(),
      3,
      "Refresh failure retains last known locations",
    );
    fail = false;
    phase = "delayed";
    await panel.getByRole("button", { name: "Refresh team locations" }).click();
    await panel
      .getByRole("button", { name: "Waiting for fresh location" })
      .waitFor();
    assert(
      await panel
        .getByRole("button", { name: "Waiting for fresh location" })
        .isDisabled(),
    );
    await page
      .getByRole("button", {
        name: "Locate Alex Rivera, 12 doors, Location delayed",
        exact: true,
      })
      .waitFor();
    phase = "expired";
    await panel.getByRole("button", { name: "Refresh team locations" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".mapboxgl-marker").length === 0,
    );
    await panel
      .getByText(
        "No recent location for this teammate. Following is unavailable.",
      )
      .waitFor();
    phase = "fresh";
    await panel.getByRole("button", { name: "Refresh team locations" }).click();
    await page
      .getByRole("button", {
        name: "Locate Alex Rivera, 12 doors, Active",
        exact: true,
      })
      .waitFor();
    await panel.getByRole("button", { name: /^Paused 1$/ }).click();
    assert.equal(
      await panel.getByRole("button", { name: /^View / }).count(),
      1,
    );
    await panel.getByRole("button", { name: /^All 4$/ }).click();
    await panel.getByRole("button", { name: "Show everyone" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    const mapBox = await page.locator(".mapboxgl-map").boundingBox();
    for (const marker of await page.locator(".mapboxgl-marker button").all()) {
      const box = await marker.boundingBox();
      assert(
        box &&
          box.x >= mapBox.x - 1 &&
          box.x + box.width <= mapBox.x + mapBox.width + 1 &&
          box.y >= mapBox.y - 1 &&
          box.y + box.height <= mapBox.y + mapBox.height + 1,
        "Resizing keeps every person fully visible on the mobile map",
      );
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Mobile has no horizontal overflow",
    );
    assert.equal(await page.locator(".mapboxgl-marker").count(), 3);
    await page.locator("main > .space-y-4").screenshot({
      path: "/tmp/wolfgrid-live-map-mobile.png",
    });
    await page
      .getByRole("button", { name: "Light theme", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Locate Alex Rivera, 12 doors, Active",
        exact: true,
      })
      .waitFor();
    await page.waitForFunction(() => window.testMap?.isStyleLoaded());
    await page.locator("main > .space-y-4").screenshot({
      path: "/tmp/wolfgrid-live-map-mobile-light.png",
    });
    denied = true;
    await panel.getByRole("button", { name: "Refresh team locations" }).click();
    await page
      .getByText(
        "Live Map access is unavailable. Sign in with an authorized team account.",
      )
      .waitFor();
    assert.equal(
      await page.locator(".mapboxgl-marker").count(),
      0,
      "Revoked access clears last known locations",
    );
    denied = false;
    await page.getByRole("button", { name: "Demo map", exact: true }).click();
    await page.getByRole("button", { name: /^Locate Maya,/ }).waitFor();
    assert.equal(
      await page.locator(".mapboxgl-marker").count(),
      4,
      "The existing four-person demo remains functional",
    );
    await panel
      .getByText("Simulated locations and activity", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Unmount map", exact: true })
      .click();
    assert.equal(await page.locator(".mapboxgl-marker").count(), 0);
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log(
      JSON.stringify({
        passed: true,
        requests,
        checks: [
          "real Mapbox renderer and basemap",
          "profile photos and broken-photo fallback",
          "shared-session totals",
          "roster selection and GPS follow",
          "moving GPS and stats",
          "15-second polling",
          "refresh-outage recovery",
          "delayed and expired location handling",
          "roster filters and show everyone",
          "dark and light themes",
          "390px mobile layout",
          "manual pan stops follow",
          "authorization loss clears locations",
          "four-person demo regression",
          "mobile resize keeps all people visible",
          "marker cleanup",
        ],
        screenshots: [
          "/tmp/wolfgrid-live-map-desktop.png",
          "/tmp/wolfgrid-live-map-mobile.png",
          "/tmp/wolfgrid-live-map-mobile-light.png",
        ],
      }),
    );
  } catch (error) {
    if (reviewPage) {
      console.error(
        "Review state:",
        await reviewPage.evaluate(() => ({
          text: document.body.innerText,
          map: !!window.testMap,
          style: window.testMap?.isStyleLoaded(),
        })),
      );
      await reviewPage.screenshot({
        path: "/tmp/wolfgrid-live-map-failure.png",
      });
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server)
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
