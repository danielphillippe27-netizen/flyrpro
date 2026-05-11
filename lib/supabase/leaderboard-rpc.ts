import type { PostgrestError } from '@supabase/supabase-js';

export type LeaderboardRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;
};

type GetLeaderboardRpcArgs = {
  p_metric: string;
  p_timeframe: string;
  p_workspace_id?: string | null;
  p_limit?: number;
  p_offset?: number;
};

function isLegacyLeaderboardSignatureError(error: PostgrestError | null): boolean {
  return Boolean(
    error?.code === 'PGRST202' &&
      error.message.includes('public.get_leaderboard') &&
      error.message.includes('p_limit')
  );
}

export async function callLeaderboardRpc(
  client: LeaderboardRpcClient,
  args: GetLeaderboardRpcArgs
): Promise<{ data: unknown; error: PostgrestError | null }> {
  const primaryArgs = {
    p_metric: args.p_metric,
    p_timeframe: args.p_timeframe,
    p_workspace_id: args.p_workspace_id ?? null,
    p_limit: args.p_limit ?? 100,
    p_offset: args.p_offset ?? 0,
  };

  const primaryResult = await client.rpc('get_leaderboard', primaryArgs);
  if (!isLegacyLeaderboardSignatureError(primaryResult.error)) {
    return primaryResult;
  }

  const fallbackResult = await client.rpc('get_leaderboard', {
    p_metric: args.p_metric,
    p_timeframe: args.p_timeframe,
    p_workspace_id: args.p_workspace_id ?? null,
  });

  if (fallbackResult.error || !Array.isArray(fallbackResult.data)) {
    return fallbackResult;
  }

  const offset = Math.max(args.p_offset ?? 0, 0);
  const limit = Math.max(args.p_limit ?? fallbackResult.data.length, 0);

  return {
    data: fallbackResult.data.slice(offset, offset + limit),
    error: null,
  };
}
