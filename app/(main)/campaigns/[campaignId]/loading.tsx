export default function CampaignDetailLoading() {
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <div className="border-b border-border bg-background px-4 py-4 sm:px-6">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded bg-muted/70" />
      </div>
      <div className="border-b border-border bg-background px-4 py-3 sm:px-6">
        <div className="flex gap-2 overflow-hidden">
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted/80" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted/70" />
        </div>
      </div>
      <div className="grid flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-[360px] animate-pulse rounded-lg border border-border bg-muted/40" />
        <div className="space-y-4">
          <div className="h-28 animate-pulse rounded-lg border border-border bg-muted/40" />
          <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/30" />
          <div className="h-24 animate-pulse rounded-lg border border-border bg-muted/30" />
        </div>
      </div>
    </div>
  );
}
