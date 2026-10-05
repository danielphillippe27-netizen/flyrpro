import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveUserFromRequest } from "@/app/api/_utils/request-user";
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from "@/app/api/_utils/workspace";
import { dispatchKimiCoco } from "@/lib/integrations/kimicoco";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = body?.id ?? body?.contactId;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json(
      { error: "Save the contact in WolfGrid before sending it" },
      { status: 400 },
    );
  try {
    const admin = createAdminClient();
    const { data: contact, error } = await admin
      .from("contacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!contact?.workspace_id)
      return NextResponse.json(
        { error: "Saved contact not found" },
        { status: 404 },
      );
    const workspace = await resolveWorkspaceIdForUser(
      admin as unknown as MinimalSupabaseClient,
      user.id,
      contact.workspace_id,
    );
    if (
      !workspace.workspaceId ||
      (body.workspaceId && body.workspaceId !== workspace.workspaceId)
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data: connection } = await admin
      .from("kimicoco_connections")
      .select("auto_sync")
      .eq("workspace_id", workspace.workspaceId)
      .maybeSingle();
    if (!connection || (body.automatic === true && !connection.auto_sync))
      return NextResponse.json(
        { error: "KimiCoco is not connected for automatic transfers" },
        { status: 404 },
      );
    const changes: Record<string, string | null> = {};
    for (const [object, dateField, titleField, notesField] of [
      [
        "appointment",
        "appointment_at",
        "appointment_title",
        "appointment_notes",
      ],
      ["task", "follow_up_at", "follow_up_title", "follow_up_notes"],
    ]) {
      const value = body[object];
      if (value == null) continue;
      const date = value.date ?? value.due_date;
      if (
        typeof date !== "string" ||
        !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) ||
        !Number.isFinite(Date.parse(date))
      )
        return NextResponse.json(
          { error: "Appointments and follow-ups require a time and timezone" },
          { status: 400 },
        );
      changes[dateField] = new Date(date).toISOString();
      for (const [input, field] of [
        ["title", titleField],
        ["notes", notesField],
      ]) {
        if (
          value[input] != null &&
          (typeof value[input] !== "string" || value[input].length > 20000)
        )
          return NextResponse.json(
            { error: `Invalid ${object} ${input}` },
            { status: 400 },
          );
        changes[field] =
          typeof value[input] === "string" ? value[input].trim() || null : null;
      }
    }
    if (body.appointment?.location != null) {
      if (
        typeof body.appointment.location !== "string" ||
        body.appointment.location.length > 1000
      )
        return NextResponse.json(
          { error: "Invalid appointment location" },
          { status: 400 },
        );
      changes.appointment_location = body.appointment.location.trim() || null;
    }
    if (Object.keys(changes).length) {
      const { error: saveError } = await admin
        .from("contacts")
        .update(changes)
        .eq("id", id)
        .eq("workspace_id", workspace.workspaceId);
      if (saveError) throw saveError;
    }
    const { error: queueError } = await admin.rpc("enqueue_kimicoco_contact", {
      p_workspace: workspace.workspaceId,
      p_contact: id,
    });
    if (queueError) throw queueError;
    await dispatchKimiCoco(workspace.workspaceId);
    const { data: job } = await admin
      .from("kimicoco_sync_jobs")
      .select("status,last_error,remote_client_id")
      .eq("workspace_id", workspace.workspaceId)
      .eq("contact_id", id)
      .single();
    return NextResponse.json(
      {
        success: job?.status !== "needs_attention",
        status: job?.status ?? "pending",
        clientId: job?.remote_client_id,
        message:
          job?.status === "synced"
            ? "Contact and follow-up details sent to KimiCoco"
            : "Contact queued for KimiCoco",
        error: job?.last_error,
      },
      { status: job?.status === "needs_attention" ? 409 : 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "KimiCoco transfer is unavailable" },
      { status: 503 },
    );
  }
}
