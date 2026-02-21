import { createClient } from '@/lib/supabase/client';
import type { Contact, ContactActivity } from '@/types/database';
import type { CreateContactPayload } from '@/types/contacts';

export interface AddressStatusLead {
  id: string;
  campaign_id: string;
  campaign_name: string;
  address: string;
  postal_code?: string | null;
  locality?: string | null;
  region?: string | null;
  address_status?: string | null;
  visited?: boolean | null;
  scans?: number | null;
  status_updated_at?: string | null;
}

export class ContactsService {
  private static client = createClient();

  private static async resolveEffectiveScope(
    userId: string,
    workspaceId?: string | null,
    requestedScope?: 'mine' | 'team'
  ): Promise<'mine' | 'team'> {
    if (!workspaceId) return 'mine';
    if (requestedScope !== 'team') return 'mine';

    const { data: membership } = await this.client
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    const role = membership?.role;
    if (role === 'owner' || role === 'admin') return 'team';
    return 'mine';
  }

  static async fetchContacts(userId: string, workspaceId?: string | null, filters?: {
    status?: string;
    campaignId?: string;
    farmId?: string;
    /** When set with workspaceId: 'mine' = only this user's leads, 'team' = all workspace leads */
    scope?: 'mine' | 'team';
  }): Promise<Contact[]> {
    const effectiveScope = await this.resolveEffectiveScope(userId, workspaceId, filters?.scope);

    let query = this.client
      .from('contacts')
      .select('*');

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
      if (effectiveScope === 'mine') {
        query = query.eq('user_id', userId);
      }
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

  static async fetchAddressStatusLeads(
    userId: string,
    workspaceId?: string | null,
    opts?: {
      statuses?: string[];
      scope?: 'mine' | 'team';
    }
  ): Promise<AddressStatusLead[]> {
    const effectiveScope = await this.resolveEffectiveScope(userId, workspaceId, opts?.scope);
    const statuses = opts?.statuses?.filter(Boolean) || [];
    if (statuses.length === 0) return [];

    let campaignsQuery = this.client
      .from('campaigns')
      .select('id, name');

    if (workspaceId) {
      campaignsQuery = campaignsQuery.eq('workspace_id', workspaceId);
      if (effectiveScope === 'mine') {
        campaignsQuery = campaignsQuery.eq('owner_id', userId);
      }
    } else {
      campaignsQuery = campaignsQuery.eq('owner_id', userId);
    }

    const { data: campaigns, error: campaignsError } = await campaignsQuery;
    if (campaignsError) throw campaignsError;
    if (!campaigns || campaigns.length === 0) return [];

    const campaignIds = campaigns.map((c) => c.id);
    const campaignNameById = new Map(campaigns.map((c) => [c.id, c.name || 'Campaign']));

    const { data, error } = await this.client
      .from('campaign_addresses_geojson')
      .select('id, campaign_id, address, formatted, postal_code, locality, region, address_status, visited, scans')
      .in('campaign_id', campaignIds)
      .in('address_status', statuses)
      .order('scans', { ascending: false, nullsFirst: false });

    if (error) throw error;

    const rows = (data || []) as Array<Record<string, unknown>>;
    const addressIds = rows.map((row) => String(row.id || '')).filter(Boolean);

    const statusUpdatedByAddressId = new Map<string, string | null>();
    if (addressIds.length > 0) {
      const { data: statusRows, error: statusError } = await this.client
        .from('address_statuses')
        .select('campaign_address_id, updated_at, status')
        .in('campaign_address_id', addressIds)
        .in('status', statuses);

      if (!statusError) {
        ((statusRows || []) as Array<Record<string, unknown>>).forEach((statusRow) => {
          const addressId = String(statusRow.campaign_address_id || '');
          if (!addressId) return;
          statusUpdatedByAddressId.set(addressId, (statusRow.updated_at as string | null) ?? null);
        });
      } else {
        // Backward-compatible fallback for environments where address_statuses uses address_id.
        const { data: legacyRows, error: legacyError } = await this.client
          .from('address_statuses')
          .select('address_id, updated_at, status')
          .in('address_id', addressIds)
          .in('status', statuses);

        if (legacyError) throw legacyError;

        ((legacyRows || []) as Array<Record<string, unknown>>).forEach((statusRow) => {
          const addressId = String(statusRow.address_id || '');
          if (!addressId) return;
          statusUpdatedByAddressId.set(addressId, (statusRow.updated_at as string | null) ?? null);
        });
      }
    }

    return rows.map((row) => {
      const id = String(row.id || '');
      const rawAddress = (row.formatted as string | null) || (row.address as string | null) || '';
      return {
        id,
        campaign_id: String(row.campaign_id || ''),
        campaign_name: campaignNameById.get(String(row.campaign_id || '')) || 'Campaign',
        address: rawAddress,
        postal_code: (row.postal_code as string | null) ?? null,
        locality: (row.locality as string | null) ?? null,
        region: (row.region as string | null) ?? null,
        address_status: (row.address_status as string | null) ?? null,
        visited: (row.visited as boolean | null) ?? false,
        scans: Number(row.scans ?? 0) || 0,
        status_updated_at: statusUpdatedByAddressId.get(id) ?? null,
      } as AddressStatusLead;
    });
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
