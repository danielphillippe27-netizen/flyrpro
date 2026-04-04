export interface MondayColumn {
  id: string;
  title: string;
  type: string;
}

export interface MondayBoard {
  id: string;
  name: string;
  state?: string | null;
  workspace?: {
    id?: string | null;
    name?: string | null;
  } | null;
  columns: MondayColumn[];
}

export class MondaySubitemsBoardError extends Error {
  boardId: string;

  constructor(boardId: string, message?: string) {
    super(
      message ??
        'Selected Monday board is a subitems board. Choose the parent board instead in Settings -> Integrations -> Monday.com.'
    );
    this.name = 'MondaySubitemsBoardError';
    this.boardId = boardId;
  }
}

export interface MondayColumnMappingEntry {
  columnId: string;
  columnTitle?: string;
  columnType?: string;
  strategy?: string;
}

export interface MondayProviderConfig {
  workspaceId?: string | null;
  workspaceName?: string | null;
  columnMapping?: Record<string, MondayColumnMappingEntry>;
}

type MondayFieldKey =
  | 'name'
  | 'phone'
  | 'email'
  | 'address'
  | 'notes'
  | 'followUpDate'
  | 'appointmentStart'
  | 'appointmentEnd'
  | 'appointmentTitle'
  | 'status';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const PSEUDO_ITEM_NAME = '__item_name__';
const PSEUDO_ITEM_UPDATE = '__item_update__';

const FIELD_ORDER: MondayFieldKey[] = [
  'phone',
  'email',
  'address',
  'notes',
  'followUpDate',
  'appointmentStart',
  'appointmentEnd',
  'appointmentTitle',
  'status',
];

const FIELD_KEYWORDS: Record<MondayFieldKey, string[]> = {
  name: ['name', 'lead', 'contact'],
  phone: ['phone', 'mobile', 'cell', 'telephone'],
  email: ['email', 'e-mail'],
  address: ['address', 'street', 'location'],
  notes: ['note', 'notes', 'details', 'comments', 'comment', 'summary'],
  followUpDate: ['follow up', 'follow-up', 'reminder', 'task due', 'due', 'call back', 'callback'],
  appointmentStart: ['appointment start', 'meeting start', 'start', 'appointment date', 'meeting date'],
  appointmentEnd: ['appointment end', 'meeting end', 'end'],
  appointmentTitle: ['appointment title', 'meeting title', 'appointment', 'meeting', 'subject', 'event'],
  status: ['status', 'stage', 'pipeline'],
};

const FIELD_TYPES: Record<MondayFieldKey, string[]> = {
  name: ['name'],
  phone: ['phone', 'text'],
  email: ['email', 'text'],
  address: ['location', 'text', 'long_text', 'long-text'],
  notes: ['long_text', 'long-text', 'text'],
  followUpDate: ['date', 'datetime'],
  appointmentStart: ['date', 'datetime'],
  appointmentEnd: ['date', 'datetime'],
  appointmentTitle: ['text', 'long_text', 'long-text'],
  status: ['status', 'dropdown', 'text'],
};

export function mondayPseudoValues() {
  return {
    itemName: PSEUDO_ITEM_NAME,
    itemUpdate: PSEUDO_ITEM_UPDATE,
  };
}

export async function mondayGraphQLRequest<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: accessToken,
      'API-Version': '2023-10',
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json().catch(async () => ({
    errors: [{ message: await response.text() }],
  }));

  if (!response.ok) {
    throw new Error(`Monday API request failed: ${response.status} - ${JSON.stringify(payload)}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`Monday GraphQL error: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data as T;
}

export async function fetchMondayAccount(accessToken: string): Promise<{ accountId?: string; accountName?: string }> {
  const data = await mondayGraphQLRequest<{
    account?: { id?: string | number; name?: string };
    me?: { id?: string | number; name?: string };
  }>(
    accessToken,
    `
      query {
        account {
          id
          name
        }
        me {
          id
          name
        }
      }
    `
  );

  return {
    accountId: data.account?.id != null ? String(data.account.id) : data.me?.id != null ? String(data.me.id) : undefined,
    accountName: data.account?.name ?? data.me?.name,
  };
}

export async function fetchMondayBoards(accessToken: string): Promise<MondayBoard[]> {
  const data = await mondayGraphQLRequest<{
    boards: Array<{
      id: string | number;
      name: string;
      state?: string | null;
      workspace?: { id?: string | number | null; name?: string | null } | null;
      columns: Array<{ id: string; title: string; type: string }>;
    }>;
  }>(
    accessToken,
    `
      query {
        boards(limit: 100) {
          id
          name
          state
          workspace {
            id
            name
          }
          columns {
            id
            title
            type
          }
        }
      }
    `
  );

  return (data.boards ?? [])
    .filter((board) => board.state !== 'archived' && board.state !== 'deleted')
    .map((board) => ({
      id: String(board.id),
      name: board.name,
      state: board.state ?? null,
      workspace: board.workspace
        ? {
            id: board.workspace.id != null ? String(board.workspace.id) : null,
            name: board.workspace.name ?? null,
          }
        : null,
      columns: (board.columns ?? []).map((column) => ({
        id: column.id,
        title: column.title,
        type: column.type,
      })),
    }));
}

export async function validateMondayBoardSelection(accessToken: string, boardId: string) {
  try {
    const data = await mondayGraphQLRequest<{
      boards: Array<{
        items_page?: {
          items?: Array<{
            id: string | number;
            parent_item?: { id?: string | number | null } | null;
          }>;
        } | null;
      }>;
    }>(
      accessToken,
      `
        query ($boardId: [ID!]) {
          boards(ids: $boardId) {
            items_page(limit: 1) {
              items {
                id
                parent_item {
                  id
                }
              }
            }
          }
        }
      `,
      { boardId: [boardId] }
    );

    const firstItem = data.boards?.[0]?.items_page?.items?.[0];
    if (firstItem?.parent_item?.id != null) {
      throw new MondaySubitemsBoardError(boardId);
    }
  } catch (error) {
    if (error instanceof MondaySubitemsBoardError || isMondaySubitemsBoardError(error)) {
      throw new MondaySubitemsBoardError(boardId);
    }
    throw error;
  }
}

export function resolveMondayColumnMapping(
  columns: MondayColumn[],
  existingMapping?: Record<string, MondayColumnMappingEntry> | null
): Record<string, MondayColumnMappingEntry> {
  const resolved: Record<string, MondayColumnMappingEntry> = {
    name: {
      columnId: PSEUDO_ITEM_NAME,
      columnTitle: 'Item name',
      columnType: 'name',
      strategy: 'item_name',
    },
  };
  const availableById = new Map(columns.map((column) => [column.id, column]));
  const usedColumns = new Set<string>();

  for (const field of FIELD_ORDER) {
    const existing = existingMapping?.[field];
    if (existing?.columnId && availableById.has(existing.columnId)) {
      const currentColumn = availableById.get(existing.columnId)!;
      resolved[field] = {
        columnId: currentColumn.id,
        columnTitle: currentColumn.title,
        columnType: currentColumn.type,
        strategy: existing.strategy,
      };
      usedColumns.add(currentColumn.id);
      continue;
    }

    const bestColumn = findBestColumn(field, columns, usedColumns);
    if (bestColumn) {
      resolved[field] = {
        columnId: bestColumn.id,
        columnTitle: bestColumn.title,
        columnType: bestColumn.type,
      };
      usedColumns.add(bestColumn.id);
      continue;
    }

    if (field === 'notes') {
      resolved[field] = {
        columnId: PSEUDO_ITEM_UPDATE,
        columnTitle: 'Item update',
        columnType: 'update',
        strategy: 'update_comment',
      };
    }
  }

  return resolved;
}

export function buildMondayColumnValues(
  lead: {
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
    task?: { due_date?: string | null } | null;
    appointment?: { date?: string | null; title?: string | null } | null;
    status?: string | null;
  },
  columns: MondayColumn[],
  mapping: Record<string, MondayColumnMappingEntry>
) {
  const columnTypeById = new Map(columns.map((column) => [column.id, column.type]));
  const values: Record<string, unknown> = {};

  setMappedValue(values, columnTypeById, mapping.phone, trimmed(lead.phone));
  setMappedValue(values, columnTypeById, mapping.email, trimmed(lead.email));
  setMappedValue(values, columnTypeById, mapping.address, trimmed(lead.address));

  if (mapping.notes?.strategy !== 'update_comment') {
    setMappedValue(values, columnTypeById, mapping.notes, trimmed(lead.notes));
  }

  setMappedValue(values, columnTypeById, mapping.followUpDate, trimmed(lead.task?.due_date));

  const appointmentStart = trimmed(lead.appointment?.date);
  const appointmentEnd = appointmentStart
    ? new Date(new Date(appointmentStart).getTime() + 60 * 60 * 1000).toISOString()
    : '';
  setMappedValue(values, columnTypeById, mapping.appointmentStart, appointmentStart);
  setMappedValue(values, columnTypeById, mapping.appointmentEnd, appointmentEnd);
  setMappedValue(values, columnTypeById, mapping.appointmentTitle, trimmed(lead.appointment?.title));
  setMappedValue(values, columnTypeById, mapping.status, trimmed(lead.status));

  return values;
}

export async function createMondayItem(
  accessToken: string,
  boardId: string,
  itemName: string,
  columnValues: Record<string, unknown>
): Promise<string> {
  let data: {
    create_item: { id: string | number };
  };
  try {
    data = await mondayGraphQLRequest<{
      create_item: { id: string | number };
    }>(
      accessToken,
      `
        mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
          create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
            id
          }
        }
      `,
      {
        boardId,
        itemName,
        columnValues: JSON.stringify(columnValues),
      }
    );
  } catch (error) {
    if (isMondaySubitemsBoardError(error)) {
      throw new MondaySubitemsBoardError(boardId);
    }
    throw error;
  }

  return String(data.create_item.id);
}

export async function updateMondayItem(
  accessToken: string,
  boardId: string,
  itemId: string,
  columnValues: Record<string, unknown>
) {
  await mondayGraphQLRequest(
    accessToken,
    `
      mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) {
          id
        }
      }
    `,
    {
      boardId,
      itemId,
      columnValues: JSON.stringify(columnValues),
    }
  );
}

export async function createMondayUpdate(accessToken: string, itemId: string, body: string) {
  await mondayGraphQLRequest(
    accessToken,
    `
      mutation ($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) {
          id
        }
      }
    `,
    { itemId, body }
  );
}

function setMappedValue(
  values: Record<string, unknown>,
  columnTypeById: Map<string, string>,
  mappingEntry: MondayColumnMappingEntry | undefined,
  rawValue: string
) {
  const pseudo = mondayPseudoValues();
  if (!mappingEntry?.columnId || !rawValue) return;
  if (mappingEntry.columnId === pseudo.itemName || mappingEntry.columnId === pseudo.itemUpdate) return;

  const columnType = normalize(columnTypeById.get(mappingEntry.columnId));
  values[mappingEntry.columnId] = formatMondayValue(columnType, rawValue);
}

function formatMondayValue(columnType: string, rawValue: string) {
  switch (columnType) {
    case 'email':
      return { email: rawValue, text: rawValue };
    case 'phone':
      return { phone: rawValue, countryShortName: 'US' };
    case 'location':
      return { address: rawValue };
    case 'status':
      return { label: rawValue };
    case 'date':
    case 'datetime':
      return formatMondayDateValue(rawValue);
    default:
      return rawValue;
  }
}

function formatMondayDateValue(rawValue: string) {
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return rawValue;

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
  };
}

function findBestColumn(
  field: MondayFieldKey,
  columns: MondayColumn[],
  usedColumns: Set<string>
): MondayColumn | null {
  let bestColumn: MondayColumn | null = null;
  let bestScore = 0;

  for (const column of columns) {
    if (usedColumns.has(column.id)) continue;
    const score = scoreColumn(field, column);
    if (score > bestScore) {
      bestScore = score;
      bestColumn = column;
    }
  }

  return bestScore > 0 ? bestColumn : null;
}

function scoreColumn(field: MondayFieldKey, column: MondayColumn): number {
  const normalizedTitle = normalize(column.title);
  const normalizedType = normalize(column.type);
  let score = 0;

  for (const expectedType of FIELD_TYPES[field]) {
    const normalizedExpectedType = normalize(expectedType);
    if (normalizedType === normalizedExpectedType) score += 6;
    else if (normalizedType.includes(normalizedExpectedType)) score += 3;
  }

  for (const keyword of FIELD_KEYWORDS[field]) {
    const normalizedKeyword = normalize(keyword);
    if (normalizedTitle === normalizedKeyword) score += 10;
    else if (normalizedTitle.includes(normalizedKeyword)) score += 7;
  }

  if (field === 'notes' && (normalizedType === 'long_text' || normalizedType === 'long-text')) {
    score += 4;
  }
  if ((field === 'followUpDate' || field === 'appointmentStart' || field === 'appointmentEnd') && normalizedType === 'date') {
    score += 2;
  }

  return score;
}

function normalize(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimmed(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function isMondaySubitemsBoardError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes("Can't create an item on subitems board") ||
    message.includes('Please use create_subitem mutation') ||
    message.includes('subitems board')
  );
}
