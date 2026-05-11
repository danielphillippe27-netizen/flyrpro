import { NextRequest, NextResponse } from 'next/server';
import { getDecryptedMetaToken, requireMetaUser } from '../_lib/access';
import { listMetaAdAccounts, metaErrorResponse, normalizeMetaAdAccountId } from '../_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireMetaUser(request);
    if (auth instanceof NextResponse) return auth;

    const { connection, accessToken } = await getDecryptedMetaToken(auth.admin, auth.user.id);
    const accounts = await listMetaAdAccounts(accessToken);

    const rows = accounts
      .map((account) => {
        const metaAdAccountId = normalizeMetaAdAccountId(account.id || account.account_id || '');
        if (!metaAdAccountId) return null;
        return {
          user_id: auth.user.id,
          team_id: connection.team_id ?? null,
          meta_connection_id: connection.id,
          meta_ad_account_id: metaAdAccountId,
          name: account.name ?? null,
          currency: account.currency ?? null,
          account_status: account.account_status != null ? String(account.account_status) : null,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (rows.length > 0) {
      const { error } = await auth.admin
        .from('meta_ad_accounts')
        .upsert(rows, { onConflict: 'user_id,meta_ad_account_id' });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ad_accounts: rows });
  } catch (error) {
    const metaError = metaErrorResponse(error);
    return NextResponse.json(
      { error: metaError.message, code: metaError.code },
      { status: metaError.status }
    );
  }
}
