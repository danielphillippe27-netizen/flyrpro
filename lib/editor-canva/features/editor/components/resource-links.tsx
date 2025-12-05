"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Loader2, Megaphone, Globe, QrCode } from "lucide-react";
import { Button } from "@/lib/editor-canva/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/lib/editor-canva/components/ui/tooltip";
import { cn } from "@/lib/editor-canva/lib/utils";

interface ResourceLinksProps {
  projectId: string;
}

interface LinkedResources {
  campaign: { id: string; name: string } | null;
  landingPage: { id: string; slug: string; headline?: string } | null;
  qrCodes: { id: string; slug?: string }[];
}

export const ResourceLinks = ({ projectId }: ResourceLinksProps) => {
  const router = useRouter();

  const { data: resources, isLoading, error } = useQuery<LinkedResources>({
    queryKey: ["project-resources", projectId],
    queryFn: async () => {
      const response = await fetch(`/api/editor/projects/${projectId}/resources`);
      if (!response.ok) {
        // Return empty resources if API fails (project might not be linked yet)
        return {
          campaign: null,
          landingPage: null,
          qrCodes: [],
        };
      }
      const result = await response.json();
      return result.data || {
        campaign: null,
        landingPage: null,
        qrCodes: [],
      };
    },
    enabled: !!projectId,
    refetchInterval: 30000, // Refetch every 30 seconds to keep status updated
    retry: 1, // Only retry once on error
  });

  const hasCampaign = !!resources?.campaign;
  const hasLandingPage = !!resources?.landingPage;
  const hasQRCodes = (resources?.qrCodes?.length || 0) > 0;

  const handleCampaignClick = () => {
    if (hasCampaign && resources?.campaign) {
      router.push(`/campaigns/${resources.campaign.id}`);
    }
  };

  const handleLandingPageClick = () => {
    if (hasLandingPage && resources?.landingPage) {
      router.push(`/l/${resources.landingPage.slug}`);
    }
  };

  const handleQRClick = () => {
    if (hasCampaign && resources?.campaign) {
      router.push(`/campaigns/${resources.campaign.id}`);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        {isLoading && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
        {/* Campaign Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                hasCampaign 
                  ? "text-green-600 hover:text-green-700 hover:bg-green-50" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={handleCampaignClick}
            >
              {hasCampaign ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Megaphone className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {hasCampaign
                ? `Campaign: ${resources?.campaign?.name || "Linked"}`
                : "Campaign: Not linked"}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Landing Page Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                hasLandingPage 
                  ? "text-green-600 hover:text-green-700 hover:bg-green-50" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={handleLandingPageClick}
            >
              {hasLandingPage ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Globe className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {hasLandingPage
                ? `Landing Page: ${resources?.landingPage?.headline || resources?.landingPage?.slug || "Linked"}`
                : "Landing Page: Not linked"}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* QR Code Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                hasQRCodes 
                  ? "text-green-600 hover:text-green-700 hover:bg-green-50" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={handleQRClick}
            >
              {hasQRCodes ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <QrCode className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {hasQRCodes
                ? `QR Codes: ${resources?.qrCodes?.length || 0} linked`
                : "QR Code: Not linked"}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};

