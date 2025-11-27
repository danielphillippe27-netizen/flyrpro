import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
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

async function getMonthlyGeneratedCount(userId: string) {
  const supabase = createAdminClient();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id')
    .eq('user_id', userId);

  if (!campaigns || campaigns.length === 0) return 0;

  const campaignIds = campaigns.map(c => c.id);

  const { count } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .in('campaign_id', campaignIds)
    .not('qr_png_url', 'is', null);

  return count || 0;
}

export async function POST(request: NextRequest) {
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

    // Check if Pro or within limits
    const isPro = await checkProStatus(user.id);
    const monthlyCount = await getMonthlyGeneratedCount(user.id);

    const adminSupabase = createAdminClient();
    const { data: recipients } = await adminSupabase
      .from('campaign_recipients')
      .select('*')
      .eq('campaign_id', campaignId)
      .is('qr_png_url', null);

    if (!recipients || recipients.length === 0) {
      return NextResponse.json({ count: 0, message: 'No recipients need QR codes' });
    }

    // Check limits
    if (!isPro && monthlyCount + recipients.length > 100) {
      return NextResponse.json({ needsUpgrade: true }, { status: 402 });
    }

    let generatedCount = 0;

    for (const recipient of recipients) {
      try {
        const openUrl = `${process.env.APP_BASE_URL}/api/open?id=${recipient.id}`;
        
        // Generate QR code as buffer
        const qrBuffer = await QRCode.toBuffer(openUrl, {
          type: 'png',
          width: 512,
          margin: 2,
        });

        // Upload to Supabase Storage
        const fileName = `qr/${campaignId}/${recipient.id}.png`;
        const { error: uploadError } = await adminSupabase.storage
          .from('qr')
          .upload(fileName, qrBuffer, {
            contentType: 'image/png',
            upsert: true,
          });

        if (uploadError) {
          console.error('Upload error:', uploadError);
          continue;
        }

        // Get public URL
        const { data: { publicUrl } } = adminSupabase.storage
          .from('qr')
          .getPublicUrl(fileName);

        // Update recipient with QR URL
        await adminSupabase
          .from('campaign_recipients')
          .update({ qr_png_url: publicUrl })
          .eq('id', recipient.id);

        generatedCount++;
      } catch (error) {
        console.error(`Error generating QR for recipient ${recipient.id}:`, error);
      }
    }

    return NextResponse.json({ count: generatedCount });
  } catch (error) {
    console.error('Error generating QRs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Generation failed' },
      { status: 500 }
    );
  }
}

