'use client';

import type { Contact } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const statusColors: Record<string, string> = {
  hot: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200',
  warm: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200',
  cold: 'bg-gray-100 dark:bg-gray-600/40 text-gray-800 dark:text-gray-200',
  new: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200',
};

export function ContactCardView({
  contact,
  onClick,
}: {
  contact: Contact;
  onClick: () => void;
}) {
  return (
    <Card
      className="p-4 hover:shadow-md transition-shadow cursor-pointer bg-gray-900 dark:bg-card border-border text-white dark:text-foreground"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-lg">{contact.full_name}</h3>
        <Badge className={statusColors[contact.status] || 'bg-muted text-muted-foreground'}>
          {contact.status}
        </Badge>
      </div>
      <p className="text-sm text-gray-300 dark:text-muted-foreground mb-2">{contact.address}</p>
      <div className="flex gap-4 text-xs text-gray-400 dark:text-muted-foreground">
        {contact.phone && <span>📞 {contact.phone}</span>}
        {contact.email && <span>✉️ {contact.email}</span>}
      </div>
      {contact.last_contacted && (
        <p className="text-xs text-gray-400 dark:text-muted-foreground mt-2">
          Last contacted: {new Date(contact.last_contacted).toLocaleDateString()}
        </p>
      )}
    </Card>
  );
}

