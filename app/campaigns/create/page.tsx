'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CampaignsService } from '@/lib/services/CampaignsService';
import type { CampaignType, AddressSource } from '@/types/database';
import { createClient } from '@/lib/supabase/client';

export default function CreateCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [type, setType] = useState<CampaignType>('flyer');
  const [addressSource, setAddressSource] = useState<AddressSource>('import_list');
  const [seedQuery, setSeedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    setLoading(true);
    try {
      const campaign = await CampaignsService.createV2(userId, {
        name,
        type,
        address_source: addressSource,
        seed_query: addressSource === 'closest_home' ? seedQuery : undefined,
      });

      router.push(`/campaigns/${campaign.id}`);
    } catch (error) {
      console.error('Error creating campaign:', error);
      alert('Failed to create campaign');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold">Create Campaign</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-6 space-y-6">
          <div>
            <Label htmlFor="name">Campaign Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Summer Promotion 2025"
            />
          </div>

          <div>
            <Label htmlFor="type">Campaign Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flyer">Flyer</SelectItem>
                <SelectItem value="door_knock">Door Knock</SelectItem>
                <SelectItem value="event">Event</SelectItem>
                <SelectItem value="survey">Survey</SelectItem>
                <SelectItem value="gift">Gift</SelectItem>
                <SelectItem value="pop_by">Pop By</SelectItem>
                <SelectItem value="open_house">Open House</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="addressSource">Address Source</Label>
            <Select value={addressSource} onValueChange={(v) => setAddressSource(v as AddressSource)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="closest_home">Closest Home</SelectItem>
                <SelectItem value="import_list">Import List</SelectItem>
                <SelectItem value="map">Map Selection</SelectItem>
                <SelectItem value="same_street">Same Street</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {addressSource === 'closest_home' && (
            <div>
              <Label htmlFor="seedQuery">Location Query</Label>
              <Input
                id="seedQuery"
                value={seedQuery}
                onChange={(e) => setSeedQuery(e.target.value)}
                placeholder="Main St, Toronto"
              />
            </div>
          )}

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name}>
              {loading ? 'Creating...' : 'Create Campaign'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

