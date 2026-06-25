import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/app/api/_utils/request-user";
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from "@/app/api/_utils/workspace";
import { createAdminClient } from "@/lib/supabase/server";
import {
  BUILT_IN_SCRIPT_DEFINITIONS,
  getBuiltInScriptByName,
  parseScriptFlowBody,
  upgradeBuiltInScriptFlow,
} from "@/lib/scripts/default-script";
import {
  WORKSPACE_SCRIPT_MAX_BODY_LENGTH,
  WORKSPACE_SCRIPT_MAX_NAME_LENGTH,
} from "@/lib/scripts/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_WORKSPACE_SCRIPT_MAX_BODY_LENGTH = 12000;

type WorkspaceScriptRow = {
  id: string;
  name: string;
  body: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type ScriptPayload = {
  workspaceId?: unknown;
  name?: unknown;
  body?: unknown;
};

function builtInScript(
  script: (typeof BUILT_IN_SCRIPT_DEFINITIONS)[number],
): ReturnType<typeof serializeScript> {
  return {
    id: script.id,
    name: script.name,
    body: script.body,
    flow: script.flow,
    createdAt: null,
    updatedAt: null,
  };
}

function serializeScript(row: WorkspaceScriptRow) {
  const builtIn = getBuiltInScriptByName(row.name);
  if (builtIn) {
    const flow =
      upgradeBuiltInScriptFlow(builtIn.name, parseScriptFlowBody(row.body)) ??
      builtIn.flow;
    return {
      id: builtIn.id,
      name: builtIn.name,
      body: row.body || builtIn.body,
      flow,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  const flow = parseScriptFlowBody(row.body);
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    flow,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function isMissingScriptsStorage(
  error: { message?: string } | null | undefined,
): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("workspace_scripts") &&
    (message.includes("does not exist") ||
      message.includes("could not find the table"))
  );
}

function isScriptBodyConstraintError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "23514" ||
    message.includes("workspace_scripts_body_check")
  );
}

function scriptBodyConstraintMessage() {
  return "Supabase script storage needs the latest workspace scripts migration before it can save long scripts.";
}

async function resolveWorkspaceForRequest(
  request: NextRequest,
  requestedWorkspaceId?: unknown,
) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return { error: "Unauthorized", status: 401 as const };
  }

  const admin = createAdminClient();
  const workspaceIdParam =
    typeof requestedWorkspaceId === "string"
      ? requestedWorkspaceId
      : request.nextUrl.searchParams.get("workspaceId");
  const workspaceResolution = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    workspaceIdParam,
  );

  if (!workspaceResolution.workspaceId) {
    return {
      error:
        workspaceResolution.error ??
        "No workspace membership found for this user",
      status: workspaceResolution.status ?? 400,
    };
  }

  return { requestUser, admin, workspaceId: workspaceResolution.workspaceId };
}

async function ensureBuiltInScripts(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
) {
  const { data: existingRows, error: existingError } = await admin
    .from("workspace_scripts")
    .select("id, name, body, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (existingError) return { rows: null, error: existingError };
  const rows = (existingRows ?? []) as WorkspaceScriptRow[];
  const existingNames = new Set(rows.map((row) => row.name));
  const missingScripts = BUILT_IN_SCRIPT_DEFINITIONS.filter(
    (script) => !existingNames.has(script.name),
  );

  if (missingScripts.length === 0) {
    return { rows, error: null };
  }

  const persistableScripts = missingScripts.filter(
    (script) => script.body.length <= LEGACY_WORKSPACE_SCRIPT_MAX_BODY_LENGTH,
  );
  const virtualBuiltIns = missingScripts.filter(
    (script) => script.body.length > LEGACY_WORKSPACE_SCRIPT_MAX_BODY_LENGTH,
  );

  if (persistableScripts.length === 0) {
    return { rows, virtualBuiltIns, error: null };
  }

  const { data: createdRows, error: createError } = await admin
    .from("workspace_scripts")
    .insert(
      persistableScripts.map((script) => ({
        workspace_id: workspaceId,
        created_by: userId,
        name: script.name,
        body: script.body,
      })),
    )
    .select("id, name, body, created_at, updated_at");

  if (createError) {
    if (isScriptBodyConstraintError(createError)) {
      return { rows, virtualBuiltIns: missingScripts, error: null };
    }
    return { rows: null, error: createError };
  }
  return {
    rows: [...((createdRows ?? []) as WorkspaceScriptRow[]), ...rows],
    virtualBuiltIns,
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const context = await resolveWorkspaceForRequest(request);
  if ("error" in context) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  }

  const result = await ensureBuiltInScripts(
    context.admin,
    context.workspaceId,
    context.requestUser.id,
  );
  if (result.error) {
    if (isMissingScriptsStorage(result.error)) {
      return NextResponse.json({
        scripts: BUILT_IN_SCRIPT_DEFINITIONS.map(builtInScript),
        storageReady: false,
      });
    }
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({
    scripts: [
      ...((result.virtualBuiltIns ?? []).map(builtInScript)),
      ...((result.rows ?? []).map(serializeScript)),
    ],
    storageReady: (result.virtualBuiltIns ?? []).length === 0,
  });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as ScriptPayload;
  const context = await resolveWorkspaceForRequest(
    request,
    payload.workspaceId,
  );
  if ("error" in context) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!name || name.length > WORKSPACE_SCRIPT_MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Name must be 1-${WORKSPACE_SCRIPT_MAX_NAME_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (!body || body.length > WORKSPACE_SCRIPT_MAX_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Body must be 1-${WORKSPACE_SCRIPT_MAX_BODY_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const { data, error } = await context.admin
    .from("workspace_scripts")
    .insert({
      workspace_id: context.workspaceId,
      created_by: context.requestUser.id,
      name,
      body,
    })
    .select("id, name, body, created_at, updated_at")
    .single();

  if (error) {
    if (isMissingScriptsStorage(error)) {
      return NextResponse.json(
        {
          error:
            "Supabase script storage is not ready. Run the workspace scripts migration first.",
        },
        { status: 503 },
      );
    }
    if (isScriptBodyConstraintError(error)) {
      return NextResponse.json(
        { error: scriptBodyConstraintMessage() },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      script: serializeScript(data as WorkspaceScriptRow),
      storageReady: true,
    },
    { status: 201 },
  );
}
