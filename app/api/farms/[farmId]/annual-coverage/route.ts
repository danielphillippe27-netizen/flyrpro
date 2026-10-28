import { buildFarmDoorPlan } from '@/lib/farms/door-plan';
import { outreachDate } from '@/lib/farms/outreach-schedule';
import { forecastOutreach } from '@/lib/farms/outreach-schedule';
import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/app/api/_utils/request-user";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchAllInPages } from "@/lib/supabase/fetchAllInPages";
import {
  selectFarmCampaignRow,
  userCanAccessFarm,
  formatApiError,
} from "@/app/api/farms/_utils/backingCampaign";
import {
  buildAnnualCoveragePlan,
  validateAnnualCoverageSettings,
} from "@/lib/farms/annual-coverage";
import type { DoorPlanHome } from "@/lib/farms/door-plan";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ farmId: string }> };
async function access(request: NextRequest, context: Context) {
  const user = await resolveUserFromRequest(request);
  if (!user)
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  const { farmId } = await context.params;
  const admin = createAdminClient();
  const { farm } = await selectFarmCampaignRow(admin, farmId);
  if (!farm)
    return {
      response: NextResponse.json({ error: "Farm not found" }, { status: 404 }),
    };
  if (!(await userCanAccessFarm(admin, user.id, farm)))
    return {
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    };
  return { admin, farm };
}
export async function GET(request: NextRequest, context: Context) {
  try {
    const result = await access(request, context);
    if ("response" in result) return result.response;
    const { data, error } = await result.admin
      .from("farms")
      .select("annual_coverage_plan")
      .eq("id", result.farm.id)
      .single();
    if (error) throw error;
    return NextResponse.json({ plan: data.annual_coverage_plan ?? null });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error) }, { status: 500 });
  }
}
export async function PUT(request: NextRequest, context: Context) {
  try {
    const result = await access(request, context);
    if ("response" in result) return result.response;
    let settings;
    try {
      settings = validateAnnualCoverageSettings(await request.json());
    } catch (error) {
      return NextResponse.json(
        { error: formatApiError(error) },
        { status: 400 },
      );
    }
    const homes = await fetchAllInPages<DoorPlanHome>(
      async (from, to) =>
        await result.admin
          .from("farm_addresses")
          .select(
            "id, formatted, street_name, house_number, last_outcome_status",
          )
          .eq("farm_id", result.farm.id)
          .order("id")
          .range(from, to),
    );
    const plan = buildAnnualCoveragePlan(homes, settings);
    if (!plan.totalHomes)
      return NextResponse.json(
        { error: "Add eligible farm homes before saving an annual plan." },
        { status: 409 },
      );
    const forecast = settings.outreach ? forecastOutreach(plan.totalHomes, settings.startDate, settings.weeksInPlan, settings.outreach, settings.weeksOff) : null;
    if (forecast && !forecast.fits) return NextResponse.json({ error: `This plan needs ${forecast.daysNeeded} working days, but only ${forecast.availableDays} are available. Increase your daily pace or adjust your rounds and time off.` }, { status: 422 });
    if (plan.unassignedAddressIds.length)
      return NextResponse.json(
        {
          error: `Increase your weekly target to at least ${plan.minimumHomesPerWeek.toLocaleString()} homes to cover the farm in your available weeks.`,
          minimumHomesPerWeek: plan.minimumHomesPerWeek,
        },
        { status: 422 },
      );
    const doorPlan = settings.outreach?.doorPasses ? buildFarmDoorPlan(homes, settings.startDate, settings.outreach.doorsPerDay, {
      workingDays: settings.outreach.workingDays,
      holidays: [...new Set([...settings.outreach.holidays, ...settings.weeksOff.flatMap(date => Array.from({ length: 7 }, (_, i) => outreachDate(date, i)))])],
      rounds: settings.outreach.doorPasses,
    }) : null;
    const { error } = await result.admin
      .from("farms")
      .update({ annual_coverage_plan: plan, ...(doorPlan ? { door_plan: doorPlan } : {}) })
      .eq("id", result.farm.id);
    if (error) throw error;
    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error) }, { status: 500 });
  }
}
