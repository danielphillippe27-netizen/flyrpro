import Link from 'next/link';
import { NewCampaignDialog } from '@/components/NewCampaignDialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function DashboardPage() {
  // For now, show empty state - campaigns will be added later
  const campaigns: any[] = [];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">FLYR PRO</h1>
          <Button variant="outline" asChild>
            <Link href="/login">Back to Login</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold">Campaigns</h2>
            <p className="text-gray-600 mt-1">Manage your direct mail campaigns</p>
          </div>
          <NewCampaignDialog />
        </div>

        <div className="bg-white rounded-2xl border p-12 text-center">
          <h3 className="text-xl font-semibold mb-2">Welcome to FLYR PRO!</h3>
          <p className="text-gray-600 mb-6">Your dashboard is ready. Create your first campaign to get started.</p>
          <NewCampaignDialog />
        </div>

        <div className="mt-8 bg-white rounded-2xl border p-6">
          <h3 className="text-lg font-semibold mb-4">Quick Start Guide</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <p>1. Click "New Campaign" to create your first campaign</p>
            <p>2. Upload a CSV file with recipient addresses</p>
            <p>3. Generate QR codes for tracking</p>
            <p>4. Download QR codes and track opens</p>
          </div>
        </div>
      </main>
    </div>
  );
}

