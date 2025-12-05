import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { FlyerEditorService } from '@/lib/services/FlyerEditorService';
import { createDefaultQRElement } from '@/lib/editor/qrDefaults';
import type { FlyerData } from '@/lib/flyers/types';

/**
 * Add QR endpoint
 * 
 * Adds a default QR element to a flyer design if it doesn't already have one.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ flyerId: string }> }
) {
  try {
    const { flyerId } = await params;

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

    // Fetch the flyer
    const flyer = await FlyerEditorService.getFlyerById(flyerId);
    if (!flyer) {
      return NextResponse.json({ error: 'Flyer not found' }, { status: 404 });
    }

    // Verify user has access to this flyer's campaign
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, owner_id')
      .eq('id', flyer.campaign_id)
      .single();

    if (!campaign || campaign.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Check if flyer already has a QR element
    const hasQR = flyer.data.elements.some((el) => el.type === 'qr');
    if (hasQR) {
      return NextResponse.json({ 
        message: 'Flyer already has a QR element',
        alreadyHasQR: true 
      });
    }

    // Add default QR element
    const qrElement = createDefaultQRElement();
    const updatedData: FlyerData = {
      ...flyer.data,
      elements: [...flyer.data.elements, qrElement],
    };

    // Save updated flyer data
    await FlyerEditorService.updateFlyerData(flyerId, updatedData);

    return NextResponse.json({ 
      success: true,
      message: 'QR element added successfully'
    });
  } catch (error) {
    console.error('Error adding QR to flyer:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add QR element' },
      { status: 500 }
    );
  }
}

