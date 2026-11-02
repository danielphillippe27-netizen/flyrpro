import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { applyMapEditChanges, type MapEditState } from "../CampaignMapEdits";

test("authenticated HTTP edit flow authorizes campaign access, retries safely, detects conflicts and undoes a batch", async t => {
  const campaign = "00000000-0000-0000-0000-000000000001";
  const owner = "00000000-0000-0000-0000-000000000010";
  const member = "00000000-0000-0000-0000-000000000011";
  let state: MapEditState = { revision: 0, features: {} };
  const mutations = new Set<string>(); let writes = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const send = (value: unknown, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    const single = (row: unknown) => send(request.headers.accept?.includes("vnd.pgrst.object") ? row : row ? [row] : []);
    if (url.pathname === "/auth/v1/user") {
      const token = request.headers.authorization?.replace("Bearer ", "");
      return send({ id: token === "owner-token" ? owner : token === "member-token" ? member : "00000000-0000-0000-0000-000000000099", aud: "authenticated", role: "authenticated" });
    }
    if (url.pathname === "/rest/v1/campaigns") return single({ owner_id: owner, workspace_id: "workspace" });
    if (url.pathname === "/rest/v1/workspace_members") return single(url.searchParams.get("user_id") === `eq.${member}` ? { user_id: member } : null);
    if (url.pathname === "/rest/v1/workspaces") return single({ owner_id: owner });
    if (url.pathname === "/rest/v1/campaign_map_edit_states") return single(state);
    if (url.pathname === "/rest/v1/rpc/apply_campaign_map_edits") {
      writes++;
      let body = ""; for await (const chunk of request) body += chunk;
      const rpc = JSON.parse(body);
      assert.equal(request.headers.authorization, "Bearer service-test-key");
      assert.equal(rpc.p_campaign_id, campaign);
      assert.ok([owner, member].includes(rpc.p_actor_id));
      if (mutations.has(rpc.p_mutation_id)) return send(state);
      if (rpc.p_base_revision !== state.revision) return send({ ...state, conflict: true });
      state = applyMapEditChanges(state, rpc.p_changes); mutations.add(rpc.p_mutation_id);
      return send(state);
    }
    send({ error: "Unexpected fixture request" }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const oldEnv = { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_ANON_KEY = "anon-test-key"; process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  try {
    const { GET, POST } = await import("../../../app/api/campaigns/[campaignId]/map-edits/route");
    const context = { params: Promise.resolve({ campaignId: campaign }) };
    const request = (method: string, token?: string, body?: unknown) => new Request("http://localhost/api/map-edits", {
      method, headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await t.test("unauthenticated and unrelated users cannot read or edit", async () => {
      assert.equal((await GET(request("GET"), context)).status, 401);
      assert.equal((await GET(request("GET", "outsider-token"), context)).status, 403);
      assert.equal((await POST(request("POST", "outsider-token", {}), context)).status, 403);
      assert.equal(writes, 0);
    });
    await t.test("owner and workspace member can read the same revision", async () => {
      for (const token of ["owner-token", "member-token"]) {
        const response = await GET(request("GET", token), context);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal((await response.json()).revision, 0);
      }
    });
    const batch = { clientMutationId: "00000000-0000-0000-0000-000000000100", baseRevision: 0, changes: [
      { kind: "building", id: "roof", value: { hidden: true } },
      { kind: "address", id: "home", value: { buildingLinkSet: true, parcelLinkSet: true, parcelId: "lot" } },
    ] };
    await t.test("batch and duplicate retry produce one revision", async () => {
      for (let i = 0; i < 2; i++) {
        const response = await POST(request("POST", "owner-token", batch), context);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).revision, 1);
      }
      assert.equal(state.features["address:home"].parcelId, "lot");
    });
    await t.test("a stale teammate mutation receives the current state with 409", async () => {
      const response = await POST(request("POST", "member-token", { ...batch, clientMutationId: "00000000-0000-0000-0000-000000000101" }), context);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).revision, 1);
    });
    await t.test("malformed geometry never reaches the transaction", async () => {
      const before = writes;
      const response = await POST(request("POST", "owner-token", { ...batch, changes: [{ kind: "address", id: "home", value: { geometry: false } }] }), context);
      assert.equal(response.status, 400);
      assert.equal(writes, before);
    });
    await t.test("undo restores both building visibility and address relationships", async () => {
      const response = await POST(request("POST", "owner-token", { clientMutationId: "00000000-0000-0000-0000-000000000102", baseRevision: 1, changes: [
        { kind: "building", id: "roof", value: null }, { kind: "address", id: "home", value: null },
      ] }), context);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).features, {});
    });
  } finally {
    if (oldEnv.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldEnv.url;
    if (oldEnv.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldEnv.anon;
    if (oldEnv.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldEnv.service;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
