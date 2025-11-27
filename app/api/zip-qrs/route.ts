import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { createAdminClient } from '@/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function checkProStatus(userId: string) {
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('pro_active')
    .eq('user_id', userId)
    .single();

  return profile?.pro_active || false;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const campaignId = searchParams.get('campaignId');

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    // Get current user
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnNud3F5bHNkc2JnbndneHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5MjY3MzEsImV4cCI6MjA3NjUwMjczMX0.k2TZKPi3VxAVpEGggLiROYvfVu2nV_oSqBt2GM4jX-Y';
    const cleanUrl = supabaseUrl ? supabaseUrl.trim().replace(/\/$/, '') : 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
    
    const supabase = createServerClient(
      cleanUrl,
      supabaseAnonKey,
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
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if Pro (optional check for ZIP)
    const isPro = await checkProStatus(user.id);
    if (!isPro) {
      // You can choose to gate ZIP downloads
      // return NextResponse.json({ needsUpgrade: true }, { status: 402 });
    }

    const adminSupabase = createAdminClient();
    const { data: recipients } = await adminSupabase
      .from('campaign_recipients')
      .select('*')
      .eq('campaign_id', campaignId)
      .not('qr_png_url', 'is', null);

    if (!recipients || recipients.length === 0) {
      return NextResponse.json({ error: 'No QR codes found' }, { status: 404 });
    }

    const zip = new JSZip();

    for (const recipient of recipients) {
      try {
        // Extract the file path from the public URL
        const url = new URL(recipient.qr_png_url);
        const filePath = url.pathname.split('/storage/v1/object/public/qr/')[1];

        // Download from Supabase Storage
        const { data, error } = await adminSupabase.storage
          .from('qr')
          .download(filePath);

        if (error || !data) {
          console.error(`Error downloading ${filePath}:`, error);
          continue;
        }

        // Add to ZIP
        const fileName = `${(recipient.address_line || 'address').replace(/[^a-z0-9]/gi, '_')}_${recipient.id}.png`;
        zip.file(fileName, data);
      } catch (error) {
        console.error(`Error processing recipient ${recipient.id}:`, error);
      }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });

    return new NextResponse(zipBlob, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="campaign-${campaignId}-qr-codes.zip"`,
      },
    });
  } catch (error) {
    console.error('Error creating ZIP:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'ZIP creation failed' },
      { status: 500 }
    );
  }
}

