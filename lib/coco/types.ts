export const contactLabels = [
  "Family",
  "Friend",
  "Client",
  "Lead",
  "Active Client",
  "Past Client",
  "Tradie",
] as const;
export type ContactLabel = string;
export const stages = ["Lead", "Warm", "Active Client", "Past Client"] as const;
export type Client = {
  id: string;
  workspace_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  contact_labels: ContactLabel[];
  stage: string;
  created_at: string;
  updated_at: string;
  appointment_at?: string | null;
  identifiers?: string[];
};
export type Task = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  title: string;
  notes: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  source?: "field" | "crm";
  version?: number;
};
export type MessageAttachment = {
  guid: string;
  fileName: string;
  mimeType?: string | null;
  byteCount: number;
  status: string;
  storagePath?: string | null;
};
export type Message = {
  id: string;
  client_id: string;
  conversation_id: string;
  direction: "incoming" | "outgoing";
  body: string | null;
  body_status: string;
  sender_identifier?: string | null;
  sent_at: string | null;
  created_at: string;
  attachments: MessageAttachment[];
};
export type Conversation = {
  id: string;
  client_id: string;
  channel: string;
  participants?: string[];
  last_message_at: string | null;
  last_read_at: string | null;
  preview: string | null;
  message_id: string | null;
};
export type ClientDeal = {
  id: string;
  client_id: string;
  property_address: string | null;
  side: "buyer" | "seller" | null;
  price: number | null;
  closing_date: string | null;
  evidence_subject: string;
  evidence_date: string | null;
};
export type WorkspaceData = {
  clients: Client[];
  tasks: Task[];
  conversations: Conversation[];
  messages: Message[];
  deals: ClientDeal[];
};
export const emptyData: WorkspaceData = {
  clients: [],
  tasks: [],
  conversations: [],
  messages: [],
  deals: [],
};
