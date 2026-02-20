import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/profile — current user's profile (user_profiles + email from auth).
 */
export async function GET() {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select(
        'first_name, last_name, industry, brokerage_name, quote, avatar_url, is_founder'
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error('Profile GET error:', profileError);
      return NextResponse.json(
        { error: 'Failed to load profile' },
        { status: 500 }
      );
    }

    const fullName =
      (profile?.first_name || profile?.last_name)
        ? [profile.first_name, profile.last_name].filter(Boolean).join(' ')
        : (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
          (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
          null;
    const avatarUrl =
      profile?.avatar_url ??
      (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
      (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture) ||
      null;

    return NextResponse.json({
      email: user.email ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      full_name: fullName,
      industry: profile?.industry ?? null,
      brokerage_name: profile?.brokerage_name ?? null,
      quote: profile?.quote ?? null,
      avatar_url: avatarUrl,
      is_founder: !!profile?.is_founder,
    });
  } catch (err) {
    console.error('Profile GET error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/profile — update current user's profile (first_name, last_name, industry, brokerage_name, quote, avatar_url).
 */
export async function PATCH(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      first_name,
      last_name,
      industry,
      brokerage_name,
      quote,
      avatar_url,
      workspace_name,
      workspace_id,
    } = body as {
      first_name?: string | null;
      last_name?: string | null;
      industry?: string | null;
      brokerage_name?: string | null;
      quote?: string | null;
      avatar_url?: string | null;
      workspace_name?: string | null;
      workspace_id?: string | null;
    };

    const normalizedWorkspaceName =
      typeof workspace_name === 'string'
        ? workspace_name.trim().replace(/\s+/g, ' ').trim()
        : '';
    const requestedWorkspaceId =
      typeof workspace_id === 'string' && workspace_id.trim()
        ? workspace_id.trim()
        : null;

    const updates: Record<string, string | null> = {};
    if (first_name !== undefined) {
      updates.first_name =
        typeof first_name === 'string' ? first_name.trim() || null : null;
    }
    if (last_name !== undefined) {
      updates.last_name =
        typeof last_name === 'string' ? last_name.trim() || null : null;
    }
    if (industry !== undefined) {
      updates.industry =
        typeof industry === 'string' ? industry.trim().slice(0, 100) || null : null;
    }
    if (brokerage_name !== undefined) {
      updates.brokerage_name =
        typeof brokerage_name === 'string'
          ? brokerage_name.trim().replace(/\s+/g, ' ').trim() || null
          : null;
    }
    if (quote !== undefined) {
      updates.quote =
        typeof quote === 'string' ? quote.trim().slice(0, 500) || null : null;
    }
    if (avatar_url !== undefined) {
      updates.avatar_url =
        typeof avatar_url === 'string' && avatar_url.trim()
          ? avatar_url.trim()
          : null;
    }

    const wantsWorkspaceRename = normalizedWorkspaceName.length > 0;

    if (Object.keys(updates).length > 0) {
      const supabase = await getSupabaseServerClient();
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('user_id', user.id);

      if (updateError) {
        console.error('Profile PATCH error:', updateError);
        return NextResponse.json(
          { error: 'Failed to update profile' },
          { status: 500 }
        );
      }
    }

    if (wantsWorkspaceRename) {
      const admin = createAdminClient();

      const { data: founderProfile } = await admin
        .from('user_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('is_founder', true)
        .maybeSingle();
      const isFounder = !!founderProfile?.user_id;

      let targetWorkspaceId: string | null = null;
      if (requestedWorkspaceId) {
        if (isFounder) {
          targetWorkspaceId = requestedWorkspaceId;
        } else {
          const { data: membership } = await admin
            .from('workspace_members')
            .select('workspace_id, role')
            .eq('workspace_id', requestedWorkspaceId)
            .eq('user_id', user.id)
            .maybeSingle();
          if (!membership?.workspace_id || membership.role !== 'owner') {
            return NextResponse.json(
              { error: 'Only workspace owners can rename this workspace.' },
              { status: 403 }
            );
          }
          targetWorkspaceId = membership.workspace_id;
        }
      } else {
        const { data: memberships } = await admin
          .from('workspace_members')
          .select('workspace_id, role, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true })
          .limit(1);
        targetWorkspaceId = memberships?.[0]?.workspace_id ?? null;
      }

      if (!targetWorkspaceId) {
        return NextResponse.json(
          { error: 'No workspace found to rename.' },
          { status: 400 }
        );
      }

      if (!isFounder) {
        const { data: ownerMembership } = await admin
          .from('workspace_members')
          .select('workspace_id, role')
          .eq('workspace_id', targetWorkspaceId)
          .eq('user_id', user.id)
          .eq('role', 'owner')
          .maybeSingle();
        if (!ownerMembership?.workspace_id) {
          return NextResponse.json(
            { error: 'Only workspace owners can rename this workspace.' },
            { status: 403 }
          );
        }
      }

      const { data: updatedWorkspace, error: workspaceError } = await admin
        .from('workspaces')
        .update({ name: normalizedWorkspaceName, updated_at: new Date().toISOString() })
        .eq('id', targetWorkspaceId)
        .select('id')
        .maybeSingle();

      if (workspaceError || !updatedWorkspace?.id) {
        console.error('Workspace rename error:', workspaceError);
        return NextResponse.json(
          { error: 'Failed to update workspace name' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Profile PATCH error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
