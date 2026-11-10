'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookingTrigger } from '@/components/appointments/RoofingAppointments';
import { Button } from '@/components/ui/button';
import { appointmentRpc, appointmentsChanged } from '@/lib/field-sales/appointments';
import { salesChanged } from '@/lib/field-sales/client';
import { useWorkspace } from '@/lib/workspace-context';

type ContactSales = {
  enabled: boolean;
  can_book: boolean;
  can_sell: boolean;
  appointments: { id: string; start_at: string; status: string; appointment_type: string }[];
  opportunities: { id: string; job_label?: string; stage_label: string }[];
  sales: { id: string; product: string; status: string; sold_on: string }[];
};

export function RoofingContactPanel({ contactId, contactName }: { contactId: string; contactName: string }) {
  const { currentWorkspaceId } = useWorkspace();
  if (!currentWorkspaceId) return null;
  return <ContactSalesContent key={`${currentWorkspaceId}:${contactId}`}
    workspace={currentWorkspaceId} contactId={contactId} contactName={contactName} />;
}

function ContactSalesContent({ workspace, contactId, contactName }: { workspace: string; contactId: string; contactName: string }) {
  const [data, setData] = useState<ContactSales>();
  useEffect(() => {
    let active = true;
    const reload = () => {
      void appointmentRpc<ContactSales>('field_sales_roofing_contact', { p_workspace: workspace, p_contact: contactId })
        .then(value => { if (active) setData(value); })
        .catch(() => { if (active) setData(undefined); });
    };
    reload();
    window.addEventListener(appointmentsChanged, reload);
    window.addEventListener(salesChanged, reload);
    return () => {
      active = false;
      window.removeEventListener(appointmentsChanged, reload);
      window.removeEventListener(salesChanged, reload);
    };
  }, [workspace, contactId]);
  if (!data?.enabled) return null;

  return <section className="space-y-3 rounded-xl border bg-card p-4 text-sm" aria-label="Appointments and sales">
    <h2 className="font-semibold">Appointments and sales</h2>
    <div className="flex flex-wrap gap-2">
      {data.can_book ? <BookingTrigger workspace={workspace} context={{ contact: { id: contactId, name: contactName } }} /> : null}
      {data.can_sell ? <Button size="sm" asChild>
        <Link href={`/sales?source=door&lead=${contactId}`}>Record sale</Link>
      </Button> : null}
    </div>
    <div>
      <h3 className="font-medium">Appointments</h3>
      {data.appointments.length ? <ul>{data.appointments.map(row => <li key={row.id}>
        <Link className="underline" href={`/appointments?booking=${row.id}`}>{row.appointment_type}</Link>
        {' · '}{new Date(row.start_at).toLocaleDateString()}{' · '}{row.status.replaceAll('_', ' ')}
      </li>)}</ul> : <p className="text-muted-foreground">No appointments.</p>}
    </div>
    <div>
      <h3 className="font-medium">Opportunities</h3>
      {data.opportunities.length ? <ul>{data.opportunities.map(row => <li key={row.id}>
        <Link className="underline" href="/sales/opportunities">{row.job_label ?? 'Opportunity'}</Link>
        {' · '}{row.stage_label}
      </li>)}</ul> : <p className="text-muted-foreground">No opportunities.</p>}
    </div>
    {data.sales.length ? <div>
      <h3 className="font-medium">Sales</h3>
      <ul>{data.sales.map(row => <li key={row.id}>
        <Link className="underline" href={`/sales/${row.id}`}>{row.product || 'Sale'}</Link>
        {' · '}{row.sold_on}{' · '}{row.status.replaceAll('_', ' ')}
      </li>)}</ul>
    </div> : null}
  </section>;
}
