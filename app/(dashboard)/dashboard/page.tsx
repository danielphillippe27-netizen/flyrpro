import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
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

interface CampaignWithRecipients {
  id: string;
  name: string;
  destination_url: string;
  created_at: string;
  campaign_recipients: Array<{
    id: string;
    status: string;
  }>;
}

async function getCampaigns(userId: string) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select(`
      *,
      campaign_recipients (
        id,
        status
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (campaigns || []) as CampaignWithRecipients[];
}

async function getUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) {
    redirect('/login');
  }

  const campaigns = await getCampaigns(user.id);

  const handleSignOut = async () => {
    'use server';
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );
    await supabase.auth.signOut();
    redirect('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">FLYR PRO</h1>
          <form action={handleSignOut}>
            <Button variant="outline" type="submit">Sign Out</Button>
          </form>
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

        {campaigns.length === 0 ? (
          <div className="bg-white rounded-2xl border p-12 text-center">
            <h3 className="text-xl font-semibold mb-2">No campaigns yet</h3>
            <p className="text-gray-600 mb-6">Create your first campaign to get started</p>
            <NewCampaignDialog />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Destination URL</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Open Rate</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => {
                  const recipients = campaign.campaign_recipients || [];
                  const sent = recipients.filter((r) => r.status === 'sent').length;
                  const scanned = recipients.filter((r) => r.status === 'scanned').length;
                  const openRate = sent > 0 ? ((scanned / sent) * 100).toFixed(1) : '0.0';

                  return (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium">{campaign.name}</TableCell>
                      <TableCell className="text-sm text-gray-600">{campaign.destination_url}</TableCell>
                      <TableCell>{recipients.length}</TableCell>
                      <TableCell>{openRate}%</TableCell>
                      <TableCell>{new Date(campaign.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/campaigns/${campaign.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}

