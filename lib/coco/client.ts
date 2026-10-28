import type { WorkspaceData } from "./types";
export async function cocoApi<T>(
  userId: string,
  workspaceId: string,
  action?: string,
  data: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/crm-workspace?workspaceId=${encodeURIComponent(workspaceId)}${action ? "" : `&offset=${data.offset ?? 0}`}`,
    {
      credentials: "include",
      cache: "no-store",
      signal,
      headers: {
        "x-wolfgrid-user-id": userId,
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      ...(action
        ? {
            method: "POST",
            body: JSON.stringify({ action, workspaceId, ...data }),
          }
        : {}),
    },
  );
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Could not load your CRM.");
  return result;
}
export async function loadCoco(
  userId: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceData> {
  const result: WorkspaceData = {
    clients: [],
    tasks: [],
    conversations: [],
    messages: [],
    deals: [],
  };
  for (let offset = 0; ; offset += 500) {
    const page = await cocoApi<WorkspaceData>(
      userId,
      workspaceId,
      undefined,
      { offset },
      signal,
    );
    result.clients.push(...page.clients);
    result.conversations.push(...page.conversations);
    if (!offset) {
      result.tasks = page.tasks;
      result.deals = page.deals;
    }
    if (page.clients.length < 500) break;
  }
  return result;
}
