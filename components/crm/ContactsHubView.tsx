'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContactsView } from './ContactsView';
import { ContactFiltersView } from './ContactFiltersView';
import { ContactDetailSheet } from './ContactDetailSheet';
import { ContactsService } from '@/lib/services/ContactsService';
import type { Contact, ContactStatus } from '@/types/database';
import { createClient } from '@/lib/supabase/client';

export function ContactsHubView() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [filters, setFilters] = useState<{ status?: ContactStatus; campaignId?: string; farmId?: string }>({});
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
      if (user?.id) {
        loadContacts();
      }
    });
  }, [filters]);

  const loadContacts = async () => {
    if (!userId) return;
    try {
      const data = await ContactsService.fetchContacts(userId, filters);
      setContacts(data);
    } catch (error) {
      console.error('Error loading contacts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateContact = () => {
    // Navigate to create contact page or open modal
    setSelectedContact(null);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Contacts</h2>
        <Button onClick={handleCreateContact}>
          <Plus className="w-4 h-4 mr-2" />
          Add Contact
        </Button>
      </div>

      <ContactFiltersView filters={filters} onFiltersChange={setFilters} />

      <ContactsView
        contacts={contacts}
        loading={loading}
        onContactSelect={setSelectedContact}
      />

      {selectedContact && (
        <ContactDetailSheet
          contact={selectedContact}
          open={!!selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdate={loadContacts}
        />
      )}
    </div>
  );
}

