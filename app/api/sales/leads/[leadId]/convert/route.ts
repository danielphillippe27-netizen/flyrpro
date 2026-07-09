import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import type { Contact, SalesLead } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function canAccessSalesLead(params: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  lead: SalesLead;
}): Promise<boolean> {
  if (params.lead.assigned_user_id === params.userId) return true;

  const { data: founder } = await params.admin
    .from('user_profiles')
    .select('is_founder')
    .eq('user_id', params.userId)
    .limit(1)
    .maybeSingle();

  if ((founder as { is_founder?: boolean | null } | null)?.is_founder) return true;

  const { data: membership, error } = await params.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', params.lead.workspace_id)
    .eq('user_id', params.userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[api/sales/leads/convert] workspace access lookup failed', error);
    return false;
  }

  return Boolean(membership);
}

function contactStatusForLead(lead: SalesLead): string {
  if (lead.lead_state === 'interested' || lead.disposition === 'interested') return 'hot';
  if (lead.next_follow_up_at || lead.follow_up_at || lead.lead_state === 'callback') return 'follow_up';
  return 'new';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createAdminClient();

  try {
    const { data: leadRow, error: leadError } = await admin
      .from('sales_leads')
      .select('*')
      .eq('id', leadId)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!leadRow) return NextResponse.json({ error: 'Sales lead not found.' }, { status: 404 });

    const lead = leadRow as SalesLead;
    const allowed = await canAccessSalesLead({ admin, userId: user.id, lead });
    if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (lead.converted_contact_id) {
      const { data: existingContact, error: contactError } = await admin
        .from('contacts')
        .select('*')
        .eq('id', lead.converted_contact_id)
        .maybeSingle();

      if (contactError) throw contactError;
      return NextResponse.json({
        contact: (existingContact as Contact | null) ?? null,
        salesLead: lead,
        converted: Boolean(existingContact),
        alreadyConverted: true,
      });
    }

    const now = new Date().toISOString();
    const contactPayload = {
      user_id: user.id,
      workspace_id: lead.workspace_id,
      full_name: text(body.fullName) ?? text(body.name) ?? text(lead.name) ?? 'Sales lead',
      phone: text(body.phone) ?? text(lead.phone),
      phone_e164: text(lead.phone_e164),
      email: text(body.email) ?? text(lead.email),
      address: text(body.address) ?? text(lead.address) ?? text(lead.company) ?? 'Sales lead',
      status: text(body.status) ?? contactStatusForLead(lead),
      notes: text(body.notes) ?? lead.notes ?? null,
      follow_up_at: text(body.followUpAt) ?? lead.next_follow_up_at ?? lead.follow_up_at ?? null,
      reminder_date: text(body.followUpAt) ?? lead.next_follow_up_at ?? lead.follow_up_at ?? null,
      lead_kind: 'field',
      created_at: now,
      updated_at: now,
    };

    const { data: contactRow, error: insertError } = await admin
      .from('contacts')
      .insert(contactPayload)
      .select('*')
      .single();

    if (insertError) throw insertError;
    const contact = contactRow as Contact;

    const { data: updatedLeadRow, error: updateError } = await admin
      .from('sales_leads')
      .update({
        converted_contact_id: contact.id,
        contact_id: contact.id,
        lead_state: 'converted',
        last_touch_at: now,
        last_touch_summary: 'Converted to FLYR customer contact',
        updated_at: now,
      })
      .eq('id', lead.id)
      .eq('workspace_id', lead.workspace_id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    await admin.from('sales_activities').insert({
      workspace_id: lead.workspace_id,
      sales_lead_id: lead.id,
      sales_contact_id: lead.sales_contact_id ?? null,
      actor_user_id: user.id,
      activity_type: 'converted',
      note: 'Converted to FLYR customer contact.',
      occurred_at: now,
      metadata: {
        convertedContactId: contact.id,
        manual: true,
      },
    });

    return NextResponse.json({
      contact,
      salesLead: updatedLeadRow as SalesLead,
      converted: true,
      alreadyConverted: false,
    });
  } catch (error) {
    console.error('[api/sales/leads/convert] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to convert sales lead.' },
      { status: 500 }
    );
  }
}
