import { CloudLightning, Sprout } from 'lucide-react';

export function CampaignKindBadge({ kind }: { kind: 'campaign' | 'farm' | 'storm' }) {
  if (kind === 'campaign') return null;
  const farm = kind === 'farm';
  const Icon = farm ? Sprout : CloudLightning;
  const label = farm ? 'Farm' : 'Storm';
  return <span role="img" aria-label={label} title={label} className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-black ${farm ? 'border-emerald-200/60 text-emerald-300' : 'border-cyan-200/60 text-cyan-300'}`}>
    <Icon className="h-3 w-3" aria-hidden="true" />
  </span>;
}
