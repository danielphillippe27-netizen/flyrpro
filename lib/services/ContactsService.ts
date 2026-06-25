import { createClient } from '@/lib/supabase/client';
import type { Contact, ContactActivity } from '@/types/database';
import type { CreateContactPayload } from '@/types/contacts';

type LegacyFieldLead = {
  id: string;
  user_id: string | null;
  workspace_id?: string | null;
  full_name?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  campaign_id?: string | null;
  farm_id?: string | null;
  status?: string | null;
  source?: string | null;
  notes?: string | null;
  tags?: string | null;
  last_contacted?: string | null;
  reminder_date?: string | null;
  follow_up_at?: string | null;
  appointment_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type LinkedCalendarEventType = 'appointment' | 'follow_up';
type LinkedCalendarSourceKind = 'contact_appointment' | 'contact_follow_up';

export class ContactsService {
  private static client = createClient();
  private static readonly contactsPageSize = 1000;
  private static readonly contactsMaxRows = 10000;

  private static getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (!error || typeof error !== 'object') return '';
    if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
    return '';
  }

  private static parseJsonResponse(text: string): unknown {
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private static getResponseFallbackMessage(response: Response, text: string): string {
    const plainText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const details = plainText ? `: ${plainText.slice(0, 220)}` : '';
    return `Contact create request failed (${response.status} ${response.statusText || 'Error'})${details}`;
  }

  private static normalizeLegacyStatus(status?: string | null): Contact['status'] {
    const normalized = (status ?? '').trim().toLowerCase();
    if (!normalized) return 'new';
    if (normalized === 'new' || normalized === 'hot' || normalized === 'warm' || normalized === 'cold') {
      return normalized;
    }
    if (['interested', 'appointment', 'talked', 'converted'].includes(normalized)) return 'hot';
    if (['delivered', 'contacted', 'follow_up', 'follow-up'].includes(normalized)) return 'warm';
    if (['not_interested', 'uninterested', 'dnc', 'do_not_knock', 'do-not-knock'].includes(normalized)) {
      return 'cold';
    }
    return 'new';
  }

  private static mapLegacyFieldLead(row: LegacyFieldLead): Contact {
    const nowIso = new Date().toISOString();
    const fullName = (row.full_name ?? row.name ?? '').trim() || 'Lead';
    return {
      id: row.id,
      user_id: row.user_id ?? '',
      full_name: fullName,
      phone: row.phone ?? undefined,
      email: row.email ?? undefined,
      address: (row.address ?? '').trim(),
      campaign_id: row.campaign_id ?? undefined,
      farm_id: row.farm_id ?? undefined,
      status: this.normalizeLegacyStatus(row.status),
      source: row.source ?? undefined,
      last_contacted: row.last_contacted ?? undefined,
      notes: row.notes ?? undefined,
      reminder_date: row.reminder_date ?? row.follow_up_at ?? undefined,
      follow_up_at: row.follow_up_at ?? row.reminder_date ?? undefined,
      appointment_at: row.appointment_at ?? undefined,
      tags: row.tags ?? undefined,
      created_at: row.created_at ?? nowIso,
      updated_at: row.updated_at ?? row.created_at ?? nowIso,
    };
  }

  private static contactSignature(contact: Contact): string {
    return [
      contact.full_name.trim().toLowerCase(),
      (contact.phone ?? '').trim(),
      (contact.email ?? '').trim().toLowerCase(),
      (contact.address ?? '').trim().toLowerCase(),
      (contact.campaign_id ?? '').trim(),
    ].join('|');
  }

  private static async fetchContactRows(userId: string, workspaceId?: string | null, filters?: {
    status?: string;
    campaignId?: string;
    farmId?: string;
  }): Promise<Contact[]> {
    const rows: Contact[] = [];

    for (let from = 0; from < this.contactsMaxRows; from += this.contactsPageSize) {
      let query = this.client
        .from('contacts')
        .select('*');

      if (workspaceId) {
        query = query.eq('workspace_id', workspaceId);
      }
      if (userId) {
        query = query.eq('user_id', userId);
      }

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.campaignId) {
        query = query.eq('campaign_id', filters.campaignId);
      }
      if (filters?.farmId) {
        query = query.eq('farm_id', filters.farmId);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(from, from + this.contactsPageSize - 1);

      if (error) throw error;

      const page = (data ?? []) as unknown as Contact[];
      rows.push(...page);

      if (page.length < this.contactsPageSize) break;
    }

    return rows;
  }

  private static async linkedCalendarEventId(
    sourceKind: LinkedCalendarSourceKind,
    sourceId: string,
    eventType: LinkedCalendarEventType
  ): Promise<string> {
    const seed = `flyr-calendar-event|${sourceKind}|${sourceId.toLowerCase()}|${eventType}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
    const bytes = new Uint8Array(digest).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private static async softDeleteLinkedCalendarEvent(
    sourceKind: LinkedCalendarSourceKind,
    sourceId: string,
    eventType: LinkedCalendarEventType
  ): Promise<void> {
    const id = await this.linkedCalendarEventId(sourceKind, sourceId, eventType);
    await this.client
      .from('calendar_events')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  private static async upsertLinkedCalendarEvent(
    contact: Contact,
    eventType: LinkedCalendarEventType
  ): Promise<void> {
    const sourceKind: LinkedCalendarSourceKind =
      eventType === 'appointment' ? 'contact_appointment' : 'contact_follow_up';
    const scheduledAt =
      eventType === 'appointment'
        ? contact.appointment_at
        : contact.follow_up_at ?? contact.reminder_date;

    if (!scheduledAt) {
      await this.softDeleteLinkedCalendarEvent(sourceKind, contact.id, eventType);
      return;
    }

    const startAt = new Date(scheduledAt);
    if (Number.isNaN(startAt.getTime())) return;
    const durationMs = eventType === 'appointment' ? 60 * 60 * 1000 : 30 * 60 * 1000;
    const endAt = new Date(startAt.getTime() + durationMs);
    const id = await this.linkedCalendarEventId(sourceKind, contact.id, eventType);
    const label = eventType === 'appointment' ? 'Appointment' : 'Follow up';

    const { error } = await this.client
      .from('calendar_events')
      .upsert(
        {
          id,
          user_id: contact.user_id,
          workspace_id: contact.workspace_id ?? null,
          title: `${label}: ${contact.full_name || 'Lead'}`,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          is_all_day: false,
          event_type: eventType,
          contact_id: contact.id,
          contact_name: contact.full_name,
          contact_address: contact.address,
          source_kind: sourceKind,
          source_id: contact.id,
          notes: contact.notes ?? null,
          location: contact.address ?? null,
          color_key: eventType === 'appointment' ? 'red' : 'blue',
          deleted_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

    if (error) {
      console.warn('[ContactsService] Failed to sync linked calendar event:', error);
    }
  }

  private static async syncContactCalendarEvents(contact: Contact): Promise<void> {
    await Promise.all([
      this.upsertLinkedCalendarEvent(contact, 'appointment'),
      this.upsertLinkedCalendarEvent(contact, 'follow_up'),
    ]);
  }

  static async fetchContacts(userId: string, workspaceId?: string | null, filters?: {
    status?: string;
    campaignId?: string;
    farmId?: string;
  }): Promise<Contact[]> {
    const contacts = await this.fetchContactRows(userId, workspaceId, filters);

    // iOS compatibility: if legacy field_leads still receives writes, merge it so Leads remains populated.
    try {
      let legacyQuery = this.client.from('field_leads').select('*');

      if (workspaceId) {
        legacyQuery = legacyQuery.eq('workspace_id', workspaceId);
      } else {
        legacyQuery = legacyQuery.eq('user_id', userId);
      }

      if (filters?.campaignId) {
        legacyQuery = legacyQuery.eq('campaign_id', filters.campaignId);
      }
      if (filters?.farmId) {
        legacyQuery = legacyQuery.eq('farm_id', filters.farmId);
      }

      const { data: legacyData, error: legacyError } = await legacyQuery
        .order('created_at', { ascending: false })
        .limit(500);

      if (legacyError || !legacyData || legacyData.length === 0) {
        return contacts;
      }

      const mappedLegacy = (legacyData as unknown as LegacyFieldLead[])
        .map((row) => this.mapLegacyFieldLead(row))
        .filter((row) => (filters?.status ? row.status === filters.status : true));

      if (mappedLegacy.length === 0) {
        return contacts;
      }

      const merged: Contact[] = [...contacts];
      const seenSignatures = new Set(contacts.map((row) => this.contactSignature(row)));

      for (const legacy of mappedLegacy) {
        const signature = this.contactSignature(legacy);
        if (seenSignatures.has(signature)) continue;
        seenSignatures.add(signature);
        merged.push(legacy);
      }

      return merged;
    } catch {
      // Ignore legacy fallback errors (table may not exist in all environments).
      return contacts;
    }
  }

  static async fetchContact(id: string): Promise<Contact | null> {
    const { data, error } = await this.client
      .from('contacts')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async createContact(
    userId: string,
    payload: CreateContactPayload,
    workspaceId?: string | null
  ): Promise<Contact> {
    // Concatenate first_name and last_name into full_name
    const full_name = payload.last_name
      ? `${payload.first_name.trim()} ${payload.last_name.trim()}`.trim()
      : payload.first_name.trim();

    const insertPayload = {
      user_id: userId,
      workspaceId: workspaceId ?? undefined,
      full_name: full_name,
      phone: payload.phone,
      email: payload.email,
      address: payload.address ?? '',
      campaign_id: payload.campaign_id,
      farm_id: payload.farm_id,
      status: payload.status,
      source: payload.source ?? undefined,
      last_contacted: payload.last_contacted ?? undefined,
      notes: payload.notes,
      follow_up_at: payload.follow_up_at ?? undefined,
      appointment_at: payload.appointment_at ?? undefined,
      tags: payload.tags ?? undefined,
      address_id: payload.address_id ?? undefined,
    };

    const response = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(insertPayload),
    });
    const responseText = await response.text().catch(() => '');
    const data = this.parseJsonResponse(responseText);

    if (!response.ok) {
      throw new Error(this.getErrorMessage(data) || this.getResponseFallbackMessage(response, responseText));
    }

    const contact = data as Contact;
    await this.syncContactCalendarEvents(contact);
    return contact;
  }

  private static getAddressOutcomeForContact(
    payload: Pick<CreateContactPayload, 'appointment_at' | 'follow_up_at'>
  ): 'appointment' | 'follow_up' | null {
    if (payload.appointment_at) return 'appointment';
    if (payload.follow_up_at) return 'follow_up';
    return null;
  }

  private static async syncContactTimingToAddressOutcome(
    payload: Pick<CreateContactPayload, 'campaign_id' | 'appointment_at' | 'follow_up_at'> & { address_id?: string }
  ): Promise<void> {
    const status = this.getAddressOutcomeForContact(payload);
    if (!status || !payload.campaign_id || !payload.address_id) return;

    const { error } = await this.client.rpc('record_campaign_address_outcome', {
      p_campaign_id: payload.campaign_id,
      p_campaign_address_id: payload.address_id,
      p_status: status,
      p_notes: '',
      p_occurred_at: payload.appointment_at ?? payload.follow_up_at ?? new Date().toISOString(),
    });

    if (error) {
      console.warn('[ContactsService] Failed to sync contact timing to address status:', error);
    }
  }

  static async updateContact(id: string, updates: Partial<Contact>): Promise<void> {
    const { data, error } = await this.client
      .from('contacts')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    await this.syncContactCalendarEvents(data as Contact);
  }

  static async deleteContact(id: string): Promise<void> {
    await Promise.all([
      this.softDeleteLinkedCalendarEvent('contact_appointment', id, 'appointment'),
      this.softDeleteLinkedCalendarEvent('contact_follow_up', id, 'follow_up'),
    ]);

    const { error } = await this.client
      .from('contacts')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  static async logActivity(payload: {
    contactId: string;
    type: string;
    note?: string;
  }): Promise<ContactActivity> {
    const { data, error } = await this.client
      .from('contact_activities')
      .insert({
        contact_id: payload.contactId,
        type: payload.type,
        note: payload.note,
        timestamp: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Update contact's last_contacted
    await this.client
      .from('contacts')
      .update({ last_contacted: new Date().toISOString() })
      .eq('id', payload.contactId);

    return data;
  }

  static async fetchActivities(contactId: string): Promise<ContactActivity[]> {
    const { data, error } = await this.client
      .from('contact_activities')
      .select('*')
      .eq('contact_id', contactId)
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Link a contact to an address by address_id
   * This automatically sets both address_id and gers_id (from campaign_addresses.gers_id)
   * @param contactId - The contact ID to link
   * @param addressId - The campaign_addresses.id to link to
   * @returns The updated contact with address_id and gers_id set
   */
  static async linkContactToAddress(contactId: string, addressId: string): Promise<Contact> {
    // First, fetch the address to get its gers_id
    const { data: address, error: addressError } = await this.client
      .from('campaign_addresses')
      .select('id, gers_id, campaign_id')
      .eq('id', addressId)
      .single();

    if (addressError) {
      throw new Error(`Failed to fetch address: ${addressError.message}`);
    }

    if (!address) {
      throw new Error(`Address not found: ${addressId}`);
    }

    // Update contact with both address_id and gers_id
    const updates: Partial<Contact> = {
      address_id: addressId,
      gers_id: address.gers_id || undefined,
      campaign_id: address.campaign_id || undefined,
    };

    const { data: updatedContact, error: updateError } = await this.client
      .from('contacts')
      .update(updates)
      .eq('id', contactId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to link contact to address: ${updateError.message}`);
    }

    return updatedContact;
  }

  static async createContactWithAddress(
    userId: string,
    payload: CreateContactPayload & { address_id?: string },
    workspaceId?: string | null
  ): Promise<Contact> {
    const contact = await this.createContact(userId, payload, workspaceId);

    if (payload.address_id) {
      await this.syncContactTimingToAddressOutcome({
        ...payload,
        campaign_id: contact.campaign_id ?? payload.campaign_id,
        address_id: contact.address_id ?? payload.address_id,
      });
    }

    return contact;
  }
}
