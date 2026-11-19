'use client';

import {
  STORM_CAMPAIGN_PREVIEW_ENDPOINT,
  type StormAddressCount,
  useStormTerritoryAddressCount,
} from './useStormTerritoryAddressCount';
import { LARGE_STORM_TERRITORY_GUIDANCE } from '@/lib/storm-maps/intelligence/campaign-policy';

type Props = {
  label?: string;
  emptyLabel?: string;
  workspaceId: string;
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  showCampaignPreview?: boolean;
};

export function StormTerritoryAddressCount({
  workspaceId, boundary, label = 'Address pins in this territory', emptyLabel = 'Unknown', showCampaignPreview = false,
}: Props) {
  const current = useStormTerritoryAddressCount(workspaceId, boundary, showCampaignPreview ? STORM_CAMPAIGN_PREVIEW_ENDPOINT : undefined);
  const count = current.data;
  const value = count && count.count > 0
    ? `${count.partial ? 'At least ' : ''}${count.count.toLocaleString()}`
    : count?.partial ? 'Unknown' : emptyLabel;

  return <div className="space-y-2 rounded-lg border border-border bg-background p-2 text-[11px]" aria-live="polite">
    {count ? (
      showCampaignPreview
        ? <CampaignCountBreakdown count={count} label={label} value={value} retry={current.retry} />
        : <>
          <p className="font-semibold">{label}</p>
          <p className="text-lg font-bold text-cyan-800 dark:text-cyan-200">{value}</p>
        </>
    ) : <>
      <p className="font-semibold">{label}</p>
      {current.error ? <>
        <p className="text-lg font-bold">Unknown</p>
        <p role="alert" className="text-amber-800 dark:text-amber-200">{current.error}</p>
        <button type="button" onClick={current.retry} className="text-primary underline">Retry count</button>
      </> : <p className="text-muted-foreground">{showCampaignPreview ? 'Estimating campaign stops…' : 'Counting address pins…'}</p>}
    </>}
    {count && <p className="text-[10px] text-muted-foreground">
      Mapped-address estimate · {count.regions.join(', ')}. Duplicates excluded. Addresses may include businesses.
      {count.partial ? ' Some regional tiles were unavailable.' : ' Tile coverage may omit addresses.'}
    </p>}
  </div>;
}

function CampaignCountBreakdown({ count, label, value, retry }: {
  count: StormAddressCount; label: string; value: string; retry: () => void;
}) {
  const preview = count.campaignPreview;
  if (preview?.status === 'ready') return <>
    <div>
      <p className="font-semibold">{preview.campaignCount > 1 ? 'Estimated total across campaigns' : 'Estimated campaign total'}</p>
      <p className="text-lg font-bold text-cyan-800 dark:text-cyan-200">{preview.total.toLocaleString()} {preview.total === 1 ? 'stop' : 'stops'}</p>
    </div>
    <dl className="space-y-1 border-t border-border pt-2">
      <div className="flex justify-between gap-2"><dt>{label}</dt><dd>{value}</dd></div>
      <div className="flex justify-between gap-2"><dt>Pending parcel stops</dt><dd>{preview.pendingParcelStops.toLocaleString()}</dd></div>
      {preview.addressedParcelStops > 0 && <div className="flex justify-between gap-2"><dt>Parcel stops with street addresses</dt><dd>{preview.addressedParcelStops.toLocaleString()}</dd></div>}
      {preview.buildingStops > 0 && <div className="flex justify-between gap-2"><dt>Additional building stops</dt><dd>{preview.buildingStops.toLocaleString()}</dd></div>}
    </dl>
    <p className="text-[10px] text-muted-foreground">Pending parcels need street address verification. Campaign setup can change the final total.</p>
  </>;

  return <>
    <p className="font-semibold">{label}</p>
    <p className="text-lg font-bold text-cyan-800 dark:text-cyan-200">{value}</p>
    {preview?.status === 'no-mapped-addresses' ? <p className="text-muted-foreground">Choose a zone with mapped addresses to estimate an address campaign.</p>
      : preview?.status === 'territory-only' ? <p className="text-muted-foreground">{LARGE_STORM_TERRITORY_GUIDANCE}</p>
      : <>
        <p className="text-muted-foreground">Campaign total unavailable. The mapped pin count is shown above.</p>
        <button type="button" onClick={retry} className="text-primary underline">Retry estimate</button>
      </>}
  </>;
}
