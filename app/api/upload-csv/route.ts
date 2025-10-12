import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';

const RecipientSchema = z.object({
  address_line: z.string().min(1),
  city: z.string().min(1),
  region: z.string().min(1),
  postal_code: z.string().min(1),
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

    // Validate records
    const validatedRecords = records.map((record) => {
      const validated = RecipientSchema.parse(record);
      return {
        campaign_id: campaignId,
        ...validated,
      };
    });

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('campaign_recipients')
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

