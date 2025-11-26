'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { FarmService, FarmTouchService, FarmLeadService } from '@/lib/services/FarmService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { Farm, FarmTouch, FarmLead } from '@/types/database';

export default function FarmPage() {
  const params = useParams();
  const router = useRouter();
  const farmId = params.id as string;

  const [farm, setFarm] = useState<Farm | null>(null);
  const [touches, setTouches] = useState<FarmTouch[]>([]);
  const [leads, setLeads] = useState<FarmLead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [farmData, touchesData, leadsData] = await Promise.all([
          FarmService.fetchFarm(farmId),
          FarmTouchService.fetchTouches(farmId),
          FarmLeadService.fetchLeads(farmId),
        ]);
        setFarm(farmData);
        setTouches(touchesData);
        setLeads(leadsData);
      } catch (error) {
        console.error('Error loading farm:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [farmId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!farm) {
    return <div className="min-h-screen flex items-center justify-center">Farm not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Button variant="ghost" asChild className="mb-2">
            <Link href="/home">← Back to Home</Link>
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{farm.name}</h1>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={farm.is_active ? 'default' : 'secondary'}>
                  {farm.is_active ? 'Active' : 'Inactive'}
                </Badge>
                {farm.area_label && <span className="text-sm text-gray-600">{farm.area_label}</span>}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="bg-white rounded-2xl border p-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-600">Farm Progress</span>
            <span className="text-sm font-bold">{Math.round((farm.progress || 0) * 100)}%</span>
          </div>
          <Progress value={(farm.progress || 0) * 100} className="h-3" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border p-6">
            <h2 className="text-xl font-bold mb-4">Touches</h2>
            <div className="space-y-2">
              {touches.length === 0 ? (
                <p className="text-sm text-gray-600">No touches scheduled</p>
              ) : (
                touches.map((touch) => (
                  <div key={touch.id} className="border-l-2 pl-3 py-2">
                    <div className="flex justify-between">
                      <span className="font-medium">
                        {new Date(touch.scheduled_date).toLocaleDateString()}
                      </span>
                      <Badge variant={touch.status === 'completed' ? 'default' : 'secondary'}>
                        {touch.status}
                      </Badge>
                    </div>
                    {touch.notes && <p className="text-sm text-gray-600 mt-1">{touch.notes}</p>}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border p-6">
            <h2 className="text-xl font-bold mb-4">Leads</h2>
            <div className="space-y-2">
              {leads.length === 0 ? (
                <p className="text-sm text-gray-600">No leads yet</p>
              ) : (
                leads.map((lead) => (
                  <div key={lead.id} className="border-l-2 pl-3 py-2">
                    <p className="font-medium">{lead.name || 'Unknown'}</p>
                    <p className="text-sm text-gray-600">{lead.lead_source}</p>
                    {lead.phone && <p className="text-xs text-gray-500">{lead.phone}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

