import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest, type RequestUser } from '@/app/api/_utils/request-user';
import { decryptMetaAccessToken } from './oauth';

type AdminClient = ReturnType<typeof createAdminClient>;

export type AuthorizedFarm = {
  admin: AdminClient;
  user: RequestUser;
  farm: {
    id: string;
    owner_id: string;
    workspace_id?: string | null;
  };
};

export type MetaConnectionRow = {
  id: string;
  user_id: string;
  team_id?: string | null;
  meta_user_id?: string | null;
  access_token_encrypted: string;
  token_expires_at?: string | null;
  scopes?: string[] | null;
  connected_at?: string | null;
};

export async function requireMetaUser(request: NextRequest): Promise<
  | {
      admin: AdminClient;
      user: RequestUser;
    }
  | NextResponse
> {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return { admin: createAdminClient(), user };
}

async function userCanAccessWorkspace(
  admin: AdminClient,
  userId: string,
  workspaceId: string | null | undefined
): Promise<boolean> {
  if (!workspaceId) return false;

  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  return Boolean(membership?.workspace_id);
}

export async function requireAuthorizedFarm(
  request: NextRequest,
  farmId: string
): Promise<AuthorizedFarm | NextResponse> {
  const auth = await requireMetaUser(request);
  if (auth instanceof NextResponse) return auth;

  const { data: farm, error } = await auth.admin
    .from('farms')
    .select('id, owner_id, workspace_id')
    .eq('id', farmId)
    .maybeSingle();

  if (error || !farm) {
    return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
  }

  const canAccess =
    farm.owner_id === auth.user.id ||
    (await userCanAccessWorkspace(auth.admin, auth.user.id, farm.workspace_id));

  if (!canAccess) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  return {
    ...auth,
    farm: farm as AuthorizedFarm['farm'],
  };
}

export async function getMetaConnectionForUser(
  admin: AdminClient,
  userId: string
): Promise<MetaConnectionRow | null> {
  const { data, error } = await admin
    .from('meta_connections')
    .select('id, user_id, team_id, meta_user_id, access_token_encrypted, token_expires_at, scopes, connected_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as MetaConnectionRow | null) ?? null;
}

export async function getDecryptedMetaToken(
  admin: AdminClient,
  userId: string
): Promise<{ connection: MetaConnectionRow; accessToken: string }> {
  const connection = await getMetaConnectionForUser(admin, userId);
  if (!connection?.access_token_encrypted) {
    throw new Error('Connect Meta Ads first.');
  }

  if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now()) {
    throw new Error('Meta permissions expired or were revoked. Reconnect Meta Ads.');
  }

  return {
    connection,
    accessToken: decryptMetaAccessToken(connection.access_token_encrypted),
  };
}

export function publicMetaConnection(connection: MetaConnectionRow | null) {
  if (!connection) return { connected: false };
  return {
    connected: true,
    id: connection.id,
    meta_user_id: connection.meta_user_id ?? null,
    token_expires_at: connection.token_expires_at ?? null,
    scopes: connection.scopes ?? [],
    connected_at: connection.connected_at ?? null,
  };
}
