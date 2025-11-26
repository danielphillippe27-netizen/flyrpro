'use client';

import type { Contact } from '@/types/database';
import { ContactCardView } from './ContactCardView';

export function ContactsView({
  contacts,
  loading,
  onContactSelect,
}: {
  contacts: Contact[];
  loading: boolean;
  onContactSelect: (contact: Contact) => void;
}) {
  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading contacts...</div>;
  }

  if (contacts.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border">
        <p className="text-gray-600 mb-2">No contacts found</p>
        <p className="text-sm text-gray-500">Add your first contact to get started</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {contacts.map((contact) => (
        <ContactCardView
          key={contact.id}
          contact={contact}
          onClick={() => onContactSelect(contact)}
        />
      ))}
    </div>
  );
}

