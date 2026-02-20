import { createClient } from '@/lib/supabase/client';
import type { Contact, ContactActivity } from '@/types/database';
import type { CreateContactPayload } from '@/types/contacts';

export class ContactsService {
  private static client = createClient();

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
    return data || [];
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

