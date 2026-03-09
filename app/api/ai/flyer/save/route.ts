import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { FlyerEditorService } from "@/lib/services/FlyerEditorService";
import { convertAITemplateToFlyerData } from "@/lib/flyers/aiTemplateConverter";
import type { FlyerTemplate, FlyerListingData } from "@/types/flyer";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

export async function POST(req: NextRequest) {
  try {
    const { template, listing, campaignId, name } = await req.json();

    if (!template || !listing) {
      return NextResponse.json(
        { error: "Missing template or listing data" },
        { status: 400 }
      );
    }

    // Get authenticated user
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      getSupabaseUrl(),
      getSupabaseAnonKey(),
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // If campaignId is provided, verify user owns it
    let finalCampaignId = campaignId;
    if (campaignId) {
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("id, owner_id")
        .eq("id", campaignId)
        .single();

      if (!campaign || campaign.owner_id !== user.id) {
        return NextResponse.json(
          { error: "Campaign not found or access denied" },
          { status: 403 }
        );
      }
      finalCampaignId = campaignId;
    } else {
      // Create a default campaign for AI flyers if none provided
      const { data: defaultCampaign, error: campaignError } = await supabase
        .from("campaigns")
        .insert({
          owner_id: user.id,
          name: "AI Flyers",
          type: "flyer",
          address_source: "import_list",
          total_flyers: 0,
          scans: 0,
          conversions: 0,
          status: "draft",
        })
        .select()
        .single();

      if (campaignError) {
        // Try to find existing "AI Flyers" campaign
        const { data: existing } = await supabase
          .from("campaigns")
          .select("id")
          .eq("owner_id", user.id)
          .eq("name", "AI Flyers")
          .single();

        if (existing) {
          finalCampaignId = existing.id;
        } else {
          return NextResponse.json(
            { error: "Failed to create campaign" },
            { status: 500 }
          );
        }
      } else {
        finalCampaignId = defaultCampaign.id;
      }
    }

    // Convert AI template to database format
    const flyerData = convertAITemplateToFlyerData(
      template as FlyerTemplate,
      listing as FlyerListingData
    );

    // Create flyer
    const flyer = await FlyerEditorService.createDefaultFlyer(
      finalCampaignId,
      name || template.name || "AI Generated Flyer"
    );

    // Update with actual data
    await FlyerEditorService.updateFlyerData(flyer.id, flyerData);

    return NextResponse.json({
      success: true,
      flyerId: flyer.id,
      campaignId: finalCampaignId,
    });
  } catch (error) {
    console.error("Save AI flyer error", error);
    return NextResponse.json(
      {
        error: "Server error",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
