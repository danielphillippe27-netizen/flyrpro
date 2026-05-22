import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { asUuid, canManageRoutes, getWorkspaceRole } from '@/app/api/routes/_lib';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const androidFormat = request.nextUrl.searchParams.get('format') === 'android';

    const { assignmentId: rawAssignmentId } = await context.params;
    const assignmentId = asUuid(rawAssignmentId);
    if (!assignmentId) {
      return NextResponse.json({ error: 'Invalid assignment id' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: assignment, error: assignmentError } = await admin
      .from('route_assignments')
      .select(
        'id, route_plan_id, workspace_id, assigned_to_user_id, assigned_by_user_id, status, priority, due_at, notes, accepted_at, started_at, completed_at, updated_at'
      )
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError || !assignment?.id) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const role = await getWorkspaceRole(assignment.workspace_id, requestUser.id);
    if (!role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!canManageRoutes(role) && assignment.assigned_to_user_id !== requestUser.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [{ data: routePlan, error: routePlanError }, { data: stops, error: stopsError }] =
      await Promise.all([
        admin
          .from('route_plans')
          .select('id, name, campaign_id, total_stops, est_minutes, distance_meters, segments')
          .eq('id', assignment.route_plan_id)
          .maybeSingle(),
        admin
          .from('route_stops')
          .select('id, stop_order, address_id, gers_id, lat, lng, display_address, building_id')
          .eq('route_plan_id', assignment.route_plan_id)
          .order('stop_order', { ascending: true }),
      ]);

    if (routePlanError || !routePlan?.id) {
      return NextResponse.json({ error: 'Route plan not found' }, { status: 404 });
    }
    if (stopsError) {
      return NextResponse.json({ error: stopsError.message }, { status: 500 });
    }

    const stopsList = stops ?? [];
    type StopRow = (typeof stopsList)[number];
    const addressIds = [
      ...new Set(stopsList.map((s) => s.address_id).filter((id): id is string => Boolean(id))),
    ];

    let stopsWithVisited: Array<StopRow & { visited: boolean | null }> = stopsList.map((s) => ({
      ...s,
      visited: null as boolean | null,
    }));

    if (addressIds.length > 0) {
      let caQuery = admin.from('campaign_addresses').select('id, visited').in('id', addressIds);
      if (routePlan.campaign_id) {
        caQuery = caQuery.eq('campaign_id', routePlan.campaign_id);
      }
      const { data: caRows, error: caError } = await caQuery;
      if (!caError && caRows) {
        const visitedById = new Map(
          (caRows as { id: string; visited?: boolean | null }[]).map((row) => [row.id, Boolean(row.visited)])
        );
        stopsWithVisited = stopsList.map((s) => ({
          ...s,
          visited: s.address_id
            ? visitedById.has(s.address_id)
              ? (visitedById.get(s.address_id) as boolean)
              : false
            : null,
        }));
      }
    }

    if (androidFormat) {
      return NextResponse.json({
        id: assignment.id,
        campaignId: routePlan.campaign_id ?? null,
        title: routePlan.name ?? 'Route',
        stopCount: stopsWithVisited.length,
        status: assignment.status ?? 'pending',
        stops: stopsWithVisited.flatMap((stop) => {
          const latitude = typeof stop.lat === 'number' ? stop.lat : null;
          const longitude = typeof stop.lng === 'number' ? stop.lng : null;
          if (latitude == null || longitude == null) return [];
          return [{
            id: stop.id,
            addressId: stop.address_id ?? null,
            addressIds: stop.address_id ? [stop.address_id] : [],
            buildingId: stop.building_id ?? stop.gers_id ?? null,
            label: stop.display_address ?? 'Address',
            latitude,
            longitude,
            visited: Boolean(stop.visited),
            status: Boolean(stop.visited) ? 'delivered' : null,
          }];
        }),
      });
    }

    return NextResponse.json({
      assignment,
      route_plan: routePlan,
      stops: stopsWithVisited,
      role,
    });
  } catch (error) {
    console.error('[api/routes/assignments/[assignmentId]] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
