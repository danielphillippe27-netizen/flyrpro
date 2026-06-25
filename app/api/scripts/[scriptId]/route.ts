import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/app/api/_utils/request-user";
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from "@/app/api/_utils/workspace";
import { createAdminClient } from "@/lib/supabase/server";
import {
  BUILT_IN_SCRIPT_DEFINITIONS,
  encodeScriptFlowBody,
  getBuiltInScriptById,
  getBuiltInScriptByName,
  parseScriptFlowBody,
  upgradeBuiltInScriptFlow,
  type StarterScriptFlowLine,
  type StarterScriptFlowNode,
} from "@/lib/scripts/default-script";
import {
  WORKSPACE_SCRIPT_MAX_BODY_LENGTH,
  WORKSPACE_SCRIPT_MAX_NAME_LENGTH,
} from "@/lib/scripts/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspaceScriptRow = {
  id: string;
  name: string;
  body: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type ScriptUpdatePayload = {
  name?: unknown;
  body?: unknown;
  flow?: unknown;
};

const MAX_STEP_TEXT_LENGTH = 2000;
const MAX_OPTION_LABEL_LENGTH = 120;
const MAX_SCRIPT_LINE_LENGTH = 2000;

function serializeScript(row: WorkspaceScriptRow) {
  const builtIn = getBuiltInScriptByName(row.name);
  const parsedFlow = parseScriptFlowBody(row.body);
  const flow = builtIn
    ? upgradeBuiltInScriptFlow(builtIn.name, parsedFlow) ?? builtIn.flow
    : parsedFlow;

  return {
    id: builtIn?.id ?? row.id,
    name: row.name,
    body: row.body || builtIn?.body || "",
    flow,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function builtInScript(script: (typeof BUILT_IN_SCRIPT_DEFINITIONS)[number]) {
  return {
    id: script.id,
    name: script.name,
    body: script.body,
    flow: script.flow,
    createdAt: null,
    updatedAt: null,
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { scriptId } = await params;
  const workspaceIdParam = request.nextUrl.searchParams.get("workspaceId");
  const admin = createAdminClient();
  const workspaceResolution = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    workspaceIdParam,
  );

  if (!workspaceResolution.workspaceId) {
    return NextResponse.json(
      {
        error:
          workspaceResolution.error ??
          "No workspace membership found for this user",
      },
      { status: workspaceResolution.status ?? 400 },
    );
  }

  const query = admin
    .from("workspace_scripts")
    .select("id, name, body, created_at, updated_at")
    .eq("workspace_id", workspaceResolution.workspaceId);

  const builtIn = getBuiltInScriptById(scriptId);
  const { data, error } = builtIn
    ? await query.eq("name", builtIn.name).maybeSingle()
    : await query.eq("id", scriptId).maybeSingle();

  if (error) {
    if (isMissingScriptsStorage(error)) {
      if (builtIn) return NextResponse.json({ script: builtInScript(builtIn) });
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    if (builtIn) return NextResponse.json({ script: builtInScript(builtIn) });
    return NextResponse.json({ error: "Script not found" }, { status: 404 });
  }

  return NextResponse.json({
    script: serializeScript(data as WorkspaceScriptRow),
  });
}

function normalizeFlow(input: unknown): StarterScriptFlowNode[] | null {
  if (!Array.isArray(input)) return null;
  const ids = new Set<string>();

  const flow = input
    .map((node): StarterScriptFlowNode | null => {
      if (!node || typeof node !== "object") return null;
      const candidate = node as Partial<StarterScriptFlowNode>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.label !== "string" ||
        typeof candidate.kind !== "string" ||
        typeof candidate.title !== "string" ||
        typeof candidate.say !== "string" ||
        !Array.isArray(candidate.options)
      ) {
        return null;
      }

      const kind = candidate.kind;
      if (!["start", "question", "objection", "close", "done"].includes(kind))
        return null;
      if (!candidate.id.trim() || ids.has(candidate.id)) return null;
      if (
        !candidate.label.trim() ||
        !candidate.title.trim() ||
        !candidate.say.trim()
      )
        return null;
      if (
        candidate.title.length > MAX_STEP_TEXT_LENGTH ||
        candidate.say.length > MAX_STEP_TEXT_LENGTH
      )
        return null;
      if (candidate.coach && candidate.coach.length > MAX_STEP_TEXT_LENGTH)
        return null;
      ids.add(candidate.id);

      const options = candidate.options
        .map((option) => {
          if (!option || typeof option !== "object") return null;
          const candidateOption = option as {
            label?: unknown;
            nextId?: unknown;
          };
          if (
            typeof candidateOption.label !== "string" ||
            typeof candidateOption.nextId !== "string"
          )
            return null;
          if (
            !candidateOption.label.trim() ||
            !candidateOption.nextId.trim() ||
            candidateOption.label.length > MAX_OPTION_LABEL_LENGTH
          ) {
            return null;
          }
          return {
            label: candidateOption.label.trim(),
            nextId: candidateOption.nextId.trim(),
          };
        })
        .filter(Boolean) as StarterScriptFlowNode["options"];

      if (options.length === 0) return null;

      const lines = Array.isArray(candidate.lines)
        ? (candidate.lines
            .map((line): StarterScriptFlowLine | null => {
              if (!line || typeof line !== "object") return null;
              const candidateLine = line as {
                speaker?: unknown;
                text?: unknown;
              };
              if (
                (candidateLine.speaker !== "rep" &&
                  candidateLine.speaker !== "person") ||
                typeof candidateLine.text !== "string"
              ) {
                return null;
              }
              const text = candidateLine.text.trim();
              if (!text || text.length > MAX_SCRIPT_LINE_LENGTH) return null;
              return {
                speaker: candidateLine.speaker,
                text,
              };
            })
            .filter(Boolean) as StarterScriptFlowLine[])
        : undefined;

      if (
        Array.isArray(candidate.lines) &&
        (!lines || lines.length !== candidate.lines.length)
      )
        return null;

      return {
        id: candidate.id.trim(),
        label: candidate.label.trim(),
        kind,
        title: candidate.title.trim(),
        say: candidate.say.trim(),
        lines: lines?.length ? lines : undefined,
        coach:
          typeof candidate.coach === "string" && candidate.coach.trim()
            ? candidate.coach.trim()
            : undefined,
        options,
      };
    })
    .filter(Boolean) as StarterScriptFlowNode[];

  if (flow.length !== input.length || flow.length === 0) return null;
  if (
    flow.some((node) => node.options.some((option) => !ids.has(option.nextId)))
  )
    return null;
  return flow;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { scriptId } = await params;
  const builtIn = getBuiltInScriptById(scriptId);
  const payload = (await request
    .json()
    .catch(() => ({}))) as ScriptUpdatePayload;
  const workspaceIdParam = request.nextUrl.searchParams.get("workspaceId");
  const admin = createAdminClient();
  const workspaceResolution = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    workspaceIdParam,
  );

  if (!workspaceResolution.workspaceId) {
    return NextResponse.json(
      {
        error:
          workspaceResolution.error ??
          "No workspace membership found for this user",
      },
      { status: workspaceResolution.status ?? 400 },
    );
  }

  const updates: { name?: string; body?: string } = {};
  if (payload.flow !== undefined) {
    const flow = normalizeFlow(payload.flow);
    if (!flow) {
      return NextResponse.json({ error: "Flow is invalid." }, { status: 400 });
    }
    const body = encodeScriptFlowBody(flow);
    if (body.length > WORKSPACE_SCRIPT_MAX_BODY_LENGTH) {
      return NextResponse.json(
        {
          error: `Script is too long. Keep the saved body under ${WORKSPACE_SCRIPT_MAX_BODY_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }
    updates.body = body;
  } else if (payload.body !== undefined) {
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    if (!body || body.length > WORKSPACE_SCRIPT_MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: `Body must be 1-${WORKSPACE_SCRIPT_MAX_BODY_LENGTH} characters.` },
        { status: 400 },
      );
    }
    updates.body = body;
  }

  if (!builtIn && payload.name !== undefined) {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name || name.length > WORKSPACE_SCRIPT_MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Name must be 1-${WORKSPACE_SCRIPT_MAX_NAME_LENGTH} characters.` },
        { status: 400 },
      );
    }
    updates.name = name;
  }

  if (!updates.body && !updates.name) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  if (builtIn) {
    const { data: existing, error: existingError } = await admin
      .from("workspace_scripts")
      .select("id")
      .eq("workspace_id", workspaceResolution.workspaceId)
      .eq("name", builtIn.name)
      .maybeSingle();

    if (existingError) {
      if (isMissingScriptsStorage(existingError)) {
        return NextResponse.json(
          {
            error:
              "Supabase script storage is not ready. Run the workspace scripts migration first.",
          },
          { status: 503 },
        );
      }
      if (isScriptBodyConstraintError(existingError)) {
        return NextResponse.json(
          { error: scriptBodyConstraintMessage() },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 },
      );
    }

    if (!existing) {
      const { data, error } = await admin
        .from("workspace_scripts")
        .insert({
          workspace_id: workspaceResolution.workspaceId,
          created_by: requestUser.id,
          name: builtIn.name,
          body: updates.body ?? builtIn.body,
        })
        .select("id, name, body, created_at, updated_at")
        .single();

      if (error) {
        if (isScriptBodyConstraintError(error)) {
          return NextResponse.json(
            { error: scriptBodyConstraintMessage() },
            { status: 503 },
          );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({
        script: serializeScript(data as WorkspaceScriptRow),
      });
    }

    const { data, error } = await admin
      .from("workspace_scripts")
      .update({ body: updates.body ?? builtIn.body })
      .eq("id", existing.id)
      .eq("workspace_id", workspaceResolution.workspaceId)
      .select("id, name, body, created_at, updated_at")
      .single();

    if (error) {
      if (isScriptBodyConstraintError(error)) {
        return NextResponse.json(
          { error: scriptBodyConstraintMessage() },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      script: serializeScript(data as WorkspaceScriptRow),
    });
  }

  const { data, error } = await admin
    .from("workspace_scripts")
    .update(updates)
    .eq("id", scriptId)
    .eq("workspace_id", workspaceResolution.workspaceId)
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

  return NextResponse.json({
    script: serializeScript(data as WorkspaceScriptRow),
  });
}
