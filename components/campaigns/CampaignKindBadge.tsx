import { CloudLightning, Sprout } from 'lucide-react';

export function CampaignKindBadge({ kind }: { kind: 'campaign' | 'farm' | 'storm' }) {
  if (kind === 'campaign') return null;
  const farm = kind === 'farm';
  const Icon = farm ? Sprout : CloudLightning;
  return <span className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border bg-black px-1.5 text-[10px] font-medium ${farm ? 'border-emerald-200/60 text-emerald-300' : 'border-cyan-200/60 text-cyan-300'}`}>
    <Icon className="h-3 w-3" aria-hidden="true" />{farm ? 'Farm' : 'Storm'}
  </span>;
}
