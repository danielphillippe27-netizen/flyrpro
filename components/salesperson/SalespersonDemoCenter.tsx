'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BarChart3,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  Phone,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type DemoCenterPayload = {
  salesperson: {
    id: string;
    fullName: string | null;
    email: string | null;
    referralCode: string;
    demoEmailAddress: string;
    assignedPhoneNumber: string | null;
    phoneForwardTo: string | null;
  };
  links: {
    individualAgentListingUrl?: string;
    realEstateAgentUrl: string;
    realEstateTeamUrl: string;
    roofingUrl: string;
    solarUrl: string;
    homeServiceUrl: string;
  };
  stats: {
    clicks: number;
    demoViews: number;
    videoStarts: number;
    trials: number;
    emailOpens?: number;
    emailOpenTrackingEnabled?: boolean;
  };
  error?: string;
};

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function LinkCard({
  icon,
  title,
  value,
  onCopy,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  onCopy: (value: string, label: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input value={value} readOnly className="h-10 font-mono text-xs" />
          <Button type="button" variant="outline" onClick={() => onCopy(value, title)}>
            <Copy className="h-4 w-4" />
            Copy
          </Button>
        </div>
        {value.startsWith('http') ? (
          <Button asChild variant="ghost" size="sm" className="px-0">
            <a href={value} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open link
            </a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SalespersonDemoCenter() {
  const [payload, setPayload] = useState<DemoCenterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const response = await fetch('/api/salesperson/demo-center', { credentials: 'include' });
        const data = (await response.json().catch(() => ({}))) as DemoCenterPayload;
        if (!response.ok) throw new Error(data.error || 'Could not load Demo.');
        if (!cancelled) setPayload(data);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Could not load Demo.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const linkCards = useMemo(() => {
    if (!payload) return [];
    return [
      {
        title: 'Individual Agent - Listing LINK',
        value: payload.links.individualAgentListingUrl ?? payload.links.realEstateAgentUrl,
        icon: <Link2 className="h-4 w-4" />,
      },
      {
        title: 'Real Estate Team LINK',
        value: payload.links.realEstateTeamUrl,
        icon: <Link2 className="h-4 w-4" />,
      },
      {
        title: 'Roofing LINK',
        value: payload.links.roofingUrl,
        icon: <Link2 className="h-4 w-4" />,
      },
      {
        title: 'Solar LINK',
        value: payload.links.solarUrl,
        icon: <Link2 className="h-4 w-4" />,
      },
      {
        title: 'Home Service LINK',
        value: payload.links.homeServiceUrl,
        icon: <Link2 className="h-4 w-4" />,
      },
    ];
  }, [payload]);

  const contactCards = useMemo(() => {
    if (!payload) return [];
    return [
      {
        title: 'Sales email',
        value: payload.salesperson.demoEmailAddress,
        icon: <Mail className="h-4 w-4" />,
      },
      {
        title: 'Sales number',
        value: payload.salesperson.assignedPhoneNumber || 'No number assigned yet',
        icon: <Phone className="h-4 w-4" />,
      },
    ];
  }, [payload]);

  const handleCopy = async (value: string, label: string) => {
    if (!value || value === 'No number assigned yet') {
      setMessage(`${label} is not ready yet.`);
      return;
    }
    const copied = await copyText(value);
    setMessage(copied ? `${label} copied.` : `Could not copy ${label}.`);
  };

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">Demo</h1>
            {payload?.salesperson.fullName ? (
              <Badge variant="outline">{payload.salesperson.fullName}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Copy the right link for each prospect segment.
          </p>
        </div>
      </header>

      {message ? <div className="rounded-md border bg-background p-3 text-sm">{message}</div> : null}

      {payload ? (
        <>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {[
              ['Clicks', payload.stats.clicks],
              ['Demo views', payload.stats.demoViews],
              ['Video starts', payload.stats.videoStarts],
              ['Trials', payload.stats.trials],
              [
                'Email opens',
                payload.stats.emailOpenTrackingEnabled ? (payload.stats.emailOpens ?? 0) : 'Not tracked',
              ],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="space-y-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-xl">{value}</CardTitle>
                  <CardDescription>{label}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {linkCards.map((card) => (
              <LinkCard
                key={card.title}
                icon={card.icon}
                title={card.title}
                value={card.value}
                onCopy={handleCopy}
              />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {contactCards.map((card) => (
              <LinkCard
                key={card.title}
                icon={card.icon}
                title={card.title}
                value={card.value}
                onCopy={handleCopy}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
