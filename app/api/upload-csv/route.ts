import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';

const RecipientSchema = z.object({
  address_line: z.string().min(1),
  city: z.string().optional(),
  region: z.string().optional(),
  postal_code: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const campaignId = searchParams.get('campaignId');

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const text = await file.text();
    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Validate records and map to campaign_addresses schema
    const validatedRecords = records.map((record, index) => {
      const validated = RecipientSchema.parse(record);
      
      // Combine address components into formatted address
      const addressParts = [
        validated.address_line,
        validated.city,
        validated.region,
        validated.postal_code,
      ].filter(Boolean);
      
      const formatted = addressParts.join(', ');
      
      return {
        campaign_id: campaignId,
        formatted: formatted,
        address: validated.address_line, // Keep original address_line as address field
        postal_code: validated.postal_code || null,
        source: 'import_list' as const,
        seq: index,
        visited: false,
      };
    });

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('campaign_addresses')
      .insert(validatedRecords);

    if (error) throw error;

    return NextResponse.json({ 
      success: true, 
      count: validatedRecords.length 
    });
  } catch (error) {
    console.error('Error uploading CSV:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}

