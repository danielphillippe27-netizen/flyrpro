'use client';

import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type HelpMeSellFlyrDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type SalesHelpSection = {
  id: string;
  label: string;
  title: string;
  lines: string[];
};

const sections: SalesHelpSection[] = [
  {
    id: 'what',
    label: 'What',
    title: 'What is FLYR?',
    lines: [
      'FLYR is a door-knocking and territory management platform for real estate teams.',
      'It lets team leads assign areas, track which doors agents knocked, see activity in real time, and organize every lead from the field in one place.',
      'Instead of agents working randomly, your team works a system.',
    ],
  },
  {
    id: 'why',
    label: 'Why',
    title: 'Why do teams love it?',
    lines: [
      'Teams love FLYR because it gives leaders visibility.',
      'You can see who is working, what streets are covered, what doors were knocked, and where leads are coming from.',
      'It keeps agents accountable and helps the team stop missing opportunities after listings, sales, open houses, or farming campaigns.',
    ],
  },
  {
    id: 'use',
    label: 'Use',
    title: 'How do you use it?',
    lines: [
      'You create a campaign, choose the area you want your team to cover, and assign it to your agents.',
      'Agents use the mobile app in the field to mark doors, add notes, save leads, and track follow-ups.',
      'Team leads manage everything from the dashboard.',
    ],
  },
  {
    id: 'pricing',
    label: 'Pricing',
    title: 'How much is it?',
    lines: [
      'FLYR is currently available with early access pricing.',
      'Teams can start at $30 USD per user/month, which is about $40 CAD.',
      'The goal is simple: if FLYR helps your team create even one extra deal, it more than pays for itself.',
    ],
  },
  {
    id: 'questions',
    label: 'Questions',
    title: 'Questions to ask',
    lines: [
      'How many agents are on your team?',
      'Are your agents currently door knocking or farming?',
      'How do you track which doors have been knocked?',
      'Do you know which areas your team has already covered?',
      'What happens when an agent gets a lead at the door?',
      'How do you make sure follow-ups do not get missed?',
      'After a sale or listing, does your team canvas the surrounding area?',
      'Would it be useful to see every agent field activity in one dashboard?',
    ],
  },
  {
    id: 'objections',
    label: 'Objections',
    title: 'Objection answers',
    lines: [
      'Busy: No worries. I will be quick. FLYR helps real estate team leads track door knocking, agent activity, and leads from the field. Would it be okay if I text you a 90-second demo?',
      'Not interested: Totally understand. Before I let you go, would it be okay if I sent the 90-second demo just so you can see the concept?',
      'Already track it: Makes sense. Most teams have some kind of system. FLYR is built specifically for real estate field prospecting, so it is more visual and team-focused than spreadsheets or scattered notes.',
      'Using another tool: Totally. A lot of tools are general canvassing platforms. FLYR is focused on real estate teams: territories, agent accountability, neighbourhood coverage, and lead follow-up.',
    ],
  },
];

function sectionText(section: SalesHelpSection): string {
  return [section.title, '', ...section.lines].join('\n');
}

async function copyText(value: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(value);
  return true;
}

export function HelpMeSellFlyrDialog({ open, onOpenChange }: HelpMeSellFlyrDialogProps) {
  const [activeSectionId, setActiveSectionId] = useState(sections[0].id);
  const [copied, setCopied] = useState(false);

  const activeSection = useMemo(
    () => sections.find((section) => section.id === activeSectionId) ?? sections[0],
    [activeSectionId]
  );

  const handleCopy = async () => {
    const didCopy = await copyText(sectionText(activeSection)).catch(() => false);
    if (!didCopy) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(88vh,720px)] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>Help Me Sell FLYR</DialogTitle>
          <DialogDescription>
            Quick 30-second answers reps can use without rambling.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeSectionId}
          onValueChange={(value) => {
            setActiveSectionId(value);
            setCopied(false);
          }}
          className="min-h-0 gap-0"
        >
          <div className="border-b border-border px-3 py-3 sm:px-5">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/70 p-1 sm:grid-cols-3 lg:grid-cols-6">
              {sections.map((section) => (
                <TabsTrigger key={section.id} value={section.id} className="min-h-9 text-xs sm:text-sm">
                  {section.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="max-h-[54vh] overflow-y-auto px-5 py-4">
            {sections.map((section) => (
              <TabsContent key={section.id} value={section.id} className="mt-0 focus-visible:outline-none">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
                    <p className="mt-1 text-xs font-medium uppercase text-muted-foreground">
                      30-second talk track
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="self-start">
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>

                <div className="mt-5 space-y-3">
                  {section.lines.map((line, index) => (
                    <p
                      key={`${section.id}-${index}`}
                      className={cn(
                        'rounded-md border border-border bg-card px-4 py-3 text-sm leading-6 text-card-foreground',
                        section.id === 'questions' && 'font-medium',
                        section.id === 'objections' && 'text-[13px]'
                      )}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
