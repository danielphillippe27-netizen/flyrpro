export type EmailTemplate = { id: string; name: string; subject: string; body: string };

export const starterEmailTemplates: readonly EmailTemplate[] = [
  {
    id: "estimate",
    name: "Estimate follow-up",
    subject: "Estimate follow-up",
    body: "Hi {first_name},\n\nDid you have any questions about the estimate?",
  },
  {
    id: "follow-up",
    name: "Quick follow-up",
    subject: "Following up",
    body: "Hi {first_name},\n\nWhen would be a good time to follow up?",
  },
];

export async function emailTemplatesRequest(
  userId: string,
  payload?: { action: "save"; template: EmailTemplate } | { action: "delete"; id: string },
  signal?: AbortSignal,
): Promise<{ templates?: EmailTemplate[] }> {
  const response = await fetch("/api/coco/email-templates", {
    cache: "no-store",
    signal,
    headers: {
      "x-wolfgrid-user-id": userId,
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    ...(payload ? { method: "POST", body: JSON.stringify(payload) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load email templates.");
  return result;
}
