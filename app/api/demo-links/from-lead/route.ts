import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import {
  createDemoLinkFromFields,
  generateDemoLinkForLead,
  mapIndustryToDemoVertical,
} from '@/lib/demo/generateDemoLinkForLead';
import { hasFlyrDemoAdminAccess } from '@/lib/auth/flyrInternalWorkspace';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import { createAdminClient } from '@/lib/supabase/server';
import type { Contact, DiallerLead } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GenerateFromLeadBody = {
  workspaceId?: unknown;
  leadId?: unknown;
  contactId?: unknown;
  company?: unknown;
  city?: unknown;
  industry?: unknown;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function assertWorkspaceAccess(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  workspaceId: string;
}): Promise<boolean> {
  const membership = await resolveWorkspaceMembershipForUser(
    params.admin as unknown as MinimalSupabaseClient,
    params.userId,
    params.workspaceId
  );
  return membership.workspaceId === params.workspaceId;
}

async function findDiallerLeadForContact(params: {
  admin: ReturnType<typeof createAdminClient>;
  contact: Contact;
  workspaceId: string;
}): Promise<DiallerLead | null> {
  const normalizedPhone = normalizePhoneNumber(params.contact.phone);
  const phoneCandidates = [
    normalizedPhone.e164,
    text(params.contact.phone),
  ].filter(Boolean);

  for (const phone of phoneCandidates) {
    const { data, error } = await params.admin
      .from('dialler_leads')
      .select('*')
      .eq('workspace_id', params.workspaceId)
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data as DiallerLead;
    if (error && error.code !== 'PGRST116') {
      console.warn('[demo-links/from-lead] dialler lead phone lookup failed', error);
    }
  }

  const email = text(params.contact.email).toLowerCase();
  if (email) {
    const { data, error } = await params.admin
      .from('dialler_leads')
      .select('*')
      .eq('workspace_id', params.workspaceId)
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data as DiallerLead;
    if (error && error.code !== 'PGRST116') {
      console.warn('[demo-links/from-lead] dialler lead email lookup failed', error);
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const allowed = await hasFlyrDemoAdminAccess(admin, user.id, user.email);
  if (!allowed) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as GenerateFromLeadBody;
  const leadId = text(body.leadId);
  const contactId = text(body.contactId);
  const workspaceId = text(body.workspaceId);

  try {
    if (leadId) {
      const { data: lead, error } = await admin
        .from('dialler_leads')
        .select('id, workspace_id')
        .eq('id', leadId)
        .maybeSingle();

      if (error) throw error;
      if (!lead?.workspace_id) {
        return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
      }

      const allowed = await assertWorkspaceAccess({ admin, userId: user.id, workspaceId: lead.workspace_id as string });
      if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const generated = await generateDemoLinkForLead({ admin, leadId, user });
      return NextResponse.json(generated);
    }

    if (contactId) {
      const { data: contactRow, error } = await admin
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .maybeSingle();

      if (error) throw error;
      if (!contactRow) {
        return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
      }

      const contact = contactRow as Contact;
      const resolvedWorkspaceId = text(contact.workspace_id) || workspaceId;
      if (!resolvedWorkspaceId) {
        return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
      }

      const allowed = await assertWorkspaceAccess({ admin, userId: user.id, workspaceId: resolvedWorkspaceId });
      if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const lead = await findDiallerLeadForContact({ admin, contact, workspaceId: resolvedWorkspaceId });
      if (!lead) {
        return NextResponse.json(
          {
            error: 'No associated dialer lead found.',
            needsManual: true,
            company: text(contact.full_name) || 'Lead',
            city: text(contact.address),
          },
          { status: 404 }
        );
      }

      const generated = await generateDemoLinkForLead({ admin, leadId: lead.id, user });
      return NextResponse.json(generated);
    }

    const company = text(body.company);
    const city = text(body.city);
    const industry = text(body.industry);
    if (!company || !city) {
      return NextResponse.json({ error: 'Company and city are required.' }, { status: 400 });
    }

    const generated = await createDemoLinkFromFields({
      admin,
      fields: {
        company,
        city,
        industry,
        vertical: mapIndustryToDemoVertical(industry),
      },
    });
    return NextResponse.json(generated);
  } catch (error) {
    console.error('[demo-links/from-lead] failed to generate link', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate demo link.' },
      { status: 500 }
    );
  }
}
