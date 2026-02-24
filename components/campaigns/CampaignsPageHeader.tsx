'use client';

interface CampaignsPageHeaderProps {
  title: string;
}

export function CampaignsPageHeader({ title }: CampaignsPageHeaderProps) {
  return (
    <header className="shrink-0 bg-card border-b border-border sticky top-0 z-10">
      <div className="flex items-center justify-center px-4 sm:px-6 py-2.5">
        <h1 className="text-lg font-semibold text-foreground truncate min-w-0">
          {title}
        </h1>
      </div>
    </header>
  );
}
