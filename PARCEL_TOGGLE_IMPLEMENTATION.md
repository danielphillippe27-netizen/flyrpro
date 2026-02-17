# Parcel Toggle Implementation

## Changes Made

Added a toggle button in the campaign map view to show/hide parcel boundaries.

### Files Modified
- `components/campaigns/CampaignDetailMapView.tsx`

### Features

1. **Auto-detects parcels** - Fetches parcels from `campaign_parcels` table when component mounts
2. **Conditional display** - Toggle only appears if parcels exist for the campaign
3. **Visual styling** - Amber/yellow color scheme to distinguish parcels from buildings
4. **Parcel count** - Shows number of parcels in the button

### UI Screenshot

```
┌─────────────────────────────────────────┐
│  [Buildings] [Addresses]               │  ← Existing view toggle
│                                         │
│  [Snap to Roads] [Raw]                 │  ← Existing snap toggle (if map)
│                                         │
│  [📦 Show Parcels (247)]               │  ← NEW: Parcel toggle (if parcels exist)
│       or [📦 Hide Parcels (247)]       │     (amber color when active)
└─────────────────────────────────────────┘
```

### Visual Style

| State | Style |
|-------|-------|
| **Off** | Gray text, no background |
| **On** | Amber background, amber text, parcel icon |
| **Parcel fill** | Semi-transparent amber fill (`#fbbf24`, 10% opacity) |
| **Parcel border** | Amber outline (`#f59e0b`, 1.5px width, 70% opacity) |

### How It Works

1. On mount, fetches parcels: `SELECT * FROM campaign_parcels WHERE campaign_id = ?`
2. If `parcels.length > 0`, shows the toggle button
3. Clicking toggle sets `showParcels` state
4. Effect adds Mapbox layers (GeoJSON source + fill + line layers)
5. Parcels display on top of the base map, under buildings

### Testing

1. Load parcels for a campaign:
   ```bash
   npx tsx scripts/load-parcels-for-campaign.ts <campaign-id>
   ```

2. Open campaign map view

3. You should see the "Show Parcels" toggle if parcels were loaded

4. Click to toggle visibility

### Code Snippet

```typescript
// State
const [parcels, setParcels] = useState<CampaignParcel[]>([]);
const [showParcels, setShowParcels] = useState(false);

// Fetch parcels
useEffect(() => {
  const fetchParcels = async () => {
    const { data } = await supabase
      .from('campaign_parcels')
      .select('*')
      .eq('campaign_id', campaignId);
    setParcels(data || []);
  };
  fetchParcels();
}, [campaignId]);

// Render toggle (only if parcels exist)
{parcels.length > 0 && (
  <button onClick={() => setShowParcels(!showParcels)}>
    {showParcels ? 'Hide' : 'Show'} Parcels ({parcels.length})
  </button>
)}
```
