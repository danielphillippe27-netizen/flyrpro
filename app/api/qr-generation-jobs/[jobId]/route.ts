import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/qr-generation-jobs/[jobId]
 * 
 * Get status of a QR generation job
 * Returns progress information for large batch QR generation
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required' },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient();

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const adminSupabase = createAdminClient();

    // Fetch job
    const { data: job, error: jobError } = await adminSupabase
      .from('qr_generation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (job.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have access to this job' },
        { status: 403 }
      );
    }

    // Calculate progress percentage
    const progress = job.total_addresses > 0
      ? Math.round((job.processed_addresses / job.total_addresses) * 100)
      : 0;

    return NextResponse.json({
      id: job.id,
      campaign_id: job.campaign_id,
      status: job.status,
      total_addresses: job.total_addresses,
      processed_addresses: job.processed_addresses,
      failed_addresses: job.failed_addresses,
      progress,
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at,
    });
  } catch (error) {
    console.error('Error fetching QR generation job:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
