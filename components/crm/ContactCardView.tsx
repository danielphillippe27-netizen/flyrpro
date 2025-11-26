'use client';

import type { Contact } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const statusColors: Record<string, string> = {
  hot: 'bg-red-100 text-red-800',
  warm: 'bg-orange-100 text-orange-800',
  cold: 'bg-blue-100 text-blue-800',
  new: 'bg-green-100 text-green-800',
};

export function ContactCardView({
  contact,
  onClick,
}: {
  contact: Contact;
  onClick: () => void;
}) {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-lg">{contact.full_name}</h3>
        <Badge className={statusColors[contact.status] || 'bg-gray-100 text-gray-800'}>
          {contact.status}
        </Badge>
      </div>
      <p className="text-sm text-gray-600 mb-2">{contact.address}</p>
      <div className="flex gap-4 text-xs text-gray-500">
        {contact.phone && <span>📞 {contact.phone}</span>}
        {contact.email && <span>✉️ {contact.email}</span>}
      </div>
      {contact.last_contacted && (
        <p className="text-xs text-gray-500 mt-2">
          Last contacted: {new Date(contact.last_contacted).toLocaleDateString()}
        </p>
      )}
    </Card>
  );
}

