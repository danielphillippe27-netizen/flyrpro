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
  status?: string | null;
  notes?: string | null;
  tags?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export class ContactsService {
  private static client = createClient();

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
      status: this.normalizeLegacyStatus(row.status),
      notes: row.notes ?? undefined,
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

  static async fetchContacts(userId: string, workspaceId?: string | null, filters?: {
    status?: string;
    campaignId?: string;
    farmId?: string;
  }): Promise<Contact[]> {
    let query = this.client
      .from('contacts')
      .select('*');

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    } else {
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

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    const contacts = data || [];

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

      const { data: legacyData, error: legacyError } = await legacyQuery.order('created_at', {
        ascending: false,
      });

      if (legacyError || !legacyData || legacyData.length === 0) {
        return contacts;
      }

      const mappedLegacy = (legacyData as LegacyFieldLead[])
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

    const { data, error } = await this.client
      .from('contacts')
      .insert({
        user_id: userId,
        workspace_id: workspaceId ?? undefined,
        full_name: full_name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        campaign_id: payload.campaign_id,
        farm_id: payload.farm_id,
        status: payload.status,
        notes: payload.notes,
        tags: payload.tags ?? undefined,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async updateContact(id: string, updates: Partial<Contact>): Promise<void> {
    const { error } = await this.client
      .from('contacts')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;
  }

  static async deleteContact(id: string): Promise<void> {
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

  /**
   * Update createContact to optionally accept address_id and auto-link
   * This is a wrapper that calls linkContactToAddress after creation if address_id is provided
   */
  static async createContactWithAddress(
    userId: string,
    payload: CreateContactPayload & { address_id?: string },
    workspaceId?: string | null
  ): Promise<Contact> {
    // Create contact first
    const contact = await this.createContact(userId, payload, workspaceId);

    // If address_id is provided, link it
    if (payload.address_id) {
      return await this.linkContactToAddress(contact.id, payload.address_id);
    }

    return contact;
  }
}
