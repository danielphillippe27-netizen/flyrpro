interface Recipient {
  status: string;
}

interface StatsHeaderProps {
  recipients: Recipient[];
}

export function StatsHeader({ recipients }: StatsHeaderProps) {
  const pending = recipients.filter((r) => r.status === 'pending').length;
  const sent = recipients.filter((r) => r.status === 'sent').length;
  const scanned = recipients.filter((r) => r.status === 'scanned').length;
  const total = recipients.length;
  const openRate = sent > 0 ? ((scanned / sent) * 100).toFixed(1) : '0.0';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white p-6 rounded-2xl border">
        <div className="text-sm text-gray-600 mb-1">Total</div>
        <div className="text-3xl font-bold">{total}</div>
      </div>
      <div className="bg-white p-6 rounded-2xl border">
        <div className="text-sm text-gray-600 mb-1">Pending</div>
        <div className="text-3xl font-bold text-gray-600">{pending}</div>
      </div>
      <div className="bg-white p-6 rounded-2xl border">
        <div className="text-sm text-gray-600 mb-1">Sent</div>
        <div className="text-3xl font-bold text-blue-600">{sent}</div>
      </div>
      <div className="bg-white p-6 rounded-2xl border">
        <div className="text-sm text-gray-600 mb-1">Open Rate</div>
        <div className="text-3xl font-bold text-green-600">{openRate}%</div>
        <div className="text-xs text-gray-500 mt-1">{scanned} scanned</div>
      </div>
    </div>
  );
}

