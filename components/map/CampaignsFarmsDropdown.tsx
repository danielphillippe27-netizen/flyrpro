'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignsListView } from '@/components/home/CampaignsListView';
import { FarmListView } from '@/components/home/FarmListView';
import { List } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface CampaignsFarmsDropdownProps {
  onCampaignSelect?: (campaignId: string | null) => void;
}

export function CampaignsFarmsDropdown({ onCampaignSelect }: CampaignsFarmsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  const handleCampaignSelect = (campaignId: string) => {
    onCampaignSelect?.(campaignId);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-white">
          <List className="w-4 h-4 mr-2" />
          Lists
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Campaigns & Farms</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="campaigns" className="flex-1 overflow-hidden flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 shrink-0">
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="farms">Farms</TabsTrigger>
          </TabsList>
          <TabsContent value="campaigns" className="flex-1 overflow-y-auto mt-4 min-h-0">
            <CampaignsListView userId={userId} onCampaignSelect={handleCampaignSelect} />
          </TabsContent>
          <TabsContent value="farms" className="flex-1 overflow-y-auto mt-4 min-h-0">
            <FarmListView userId={userId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

