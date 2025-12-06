"use client";

import { useState, useEffect } from "react";
import { fabric } from "fabric";
import { ActiveTool, Editor } from "@/lib/editor-canva/features/editor/types";
import { ToolSidebarClose } from "@/lib/editor-canva/features/editor/components/tool-sidebar-close";
import { ToolSidebarHeader } from "@/lib/editor-canva/features/editor/components/tool-sidebar-header";

import { cn } from "@/lib/editor-canva/lib/utils";
import { ScrollArea } from "@/lib/editor-canva/components/ui/scroll-area";
import { Input } from "@/lib/editor-canva/components/ui/input";
import { Label } from "@/lib/editor-canva/components/ui/label";
import { Button } from "@/lib/editor-canva/components/ui/button";
import { generateQrDataUrl } from "@/lib/utils/qrCode";
import { createClient } from "@/lib/supabase/client";
import { LandingPageService } from "@/lib/services/LandingPageService";
import { CampaignsService } from "@/lib/services/CampaignsService";
import type { CampaignLandingPage } from "@/types/database";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QRSidebarProps {
  editor: Editor | undefined;
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
};

export const QRSidebar = ({
  editor,
  activeTool,
  onChangeActiveTool,
}: QRSidebarProps) => {
  const [qrSource, setQrSource] = useState<"url" | "landing-page">("url");
  const [qrUrl, setQrUrl] = useState("");
  const [selectedLandingPageId, setSelectedLandingPageId] = useState<string>("");
  const [landingPages, setLandingPages] = useState<CampaignLandingPage[]>([]);
  const [loadingLandingPages, setLoadingLandingPages] = useState(false);
  const [qrSize, setQrSize] = useState(200);
  const [isGenerating, setIsGenerating] = useState(false);

  // Fetch landing pages when component mounts or when landing page option is selected
  useEffect(() => {
    const fetchLandingPages = async () => {
      if (qrSource !== "landing-page") return;

      setLoadingLandingPages(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoadingLandingPages(false);
          return;
        }

        // Fetch all campaigns for the user
        const campaigns = await CampaignsService.fetchCampaignsV2(user.id);
        
        // Fetch landing pages for all campaigns
        const allLandingPages: CampaignLandingPage[] = [];
        for (const campaign of campaigns) {
          try {
            const lpData = await LandingPageService.fetchCampaignLandingPages(campaign.id);
            allLandingPages.push(...lpData);
          } catch (error) {
            console.error(`Error loading landing pages for campaign ${campaign.id}:`, error);
          }
        }

        setLandingPages(allLandingPages);
      } catch (error) {
        console.error("Failed to fetch landing pages:", error);
      } finally {
        setLoadingLandingPages(false);
      }
    };

    fetchLandingPages();
  }, [qrSource]);

  const onClose = () => {
    onChangeActiveTool("select");
  };

  const handleGenerateQR = async () => {
    let finalUrl = "";

    if (qrSource === "url") {
      if (!qrUrl.trim() || !editor) {
        return;
      }
      finalUrl = qrUrl.trim();
    } else {
      if (!selectedLandingPageId || !editor) {
        return;
      }
      const selectedLandingPage = landingPages.find(lp => lp.id === selectedLandingPageId);
      if (!selectedLandingPage || !selectedLandingPage.slug) {
        console.error("Selected landing page not found or missing slug");
        return;
      }
      // Generate landing page URL
      const baseUrl = window.location.origin;
      finalUrl = `${baseUrl}/l/${selectedLandingPage.slug}`;
    }

    setIsGenerating(true);
    try {
      const qrDataUrl = await generateQrDataUrl(finalUrl, qrSize);
      const workspace = editor.getWorkspace();
      const center = workspace?.getCenterPoint();

      fabric.Image.fromURL(
        qrDataUrl,
        (image) => {
          // Set the size without scaling to workspace
          image.set({
            scaleX: 1,
            scaleY: 1,
            width: qrSize,
            height: qrSize,
          });

          // Center on workspace
          if (center) {
            image.set({
              left: center.x - qrSize / 2,
              top: center.y - qrSize / 2,
            });
          }

          editor.canvas.add(image);
          editor.canvas.setActiveObject(image);
          editor.canvas.renderAll();
          setQrUrl("");
          setSelectedLandingPageId("");
        },
        {
          crossOrigin: "anonymous",
        }
      );
    } catch (error) {
      console.error("Failed to generate QR code:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <aside
      className={cn(
        "bg-white relative border-r z-[40] w-[360px] h-full flex flex-col",
        activeTool === "qr" ? "visible" : "hidden",
      )}
    >
      <ToolSidebarHeader
        title="QR Code"
        description="Generate and add QR codes to your canvas"
      />
      <ScrollArea>
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="qr-source">Source Type</Label>
            <Select
              value={qrSource}
              onValueChange={(value) => {
                setQrSource(value as "url" | "landing-page");
                setQrUrl("");
                setSelectedLandingPageId("");
              }}
            >
              <SelectTrigger id="qr-source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="url">URL or Text</SelectItem>
                <SelectItem value="landing-page">Landing Page</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {qrSource === "url" ? (
            <div className="space-y-2">
              <Label htmlFor="qr-url">URL or Text</Label>
              <Input
                id="qr-url"
                placeholder="https://example.com or any text"
                value={qrUrl}
                onChange={(e) => setQrUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleGenerateQR();
                  }
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="qr-landing-page">Landing Page</Label>
              {loadingLandingPages ? (
                <div className="text-sm text-gray-500 py-2">Loading landing pages...</div>
              ) : landingPages.length === 0 ? (
                <div className="text-sm text-gray-500 py-2">No landing pages available</div>
              ) : (
                <Select
                  value={selectedLandingPageId}
                  onValueChange={setSelectedLandingPageId}
                >
                  <SelectTrigger id="qr-landing-page" className="w-full">
                    <SelectValue placeholder="Select a landing page" />
                  </SelectTrigger>
                  <SelectContent>
                    {landingPages.map((lp) => (
                      <SelectItem key={lp.id} value={lp.id}>
                        {lp.headline || lp.slug || "Untitled Landing Page"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="qr-size">Size (pixels)</Label>
            <Input
              id="qr-size"
              type="number"
              min="50"
              max="1000"
              value={qrSize}
              onChange={(e) => setQrSize(parseInt(e.target.value) || 200)}
            />
          </div>
          <Button
            onClick={handleGenerateQR}
            disabled={
              isGenerating ||
              (qrSource === "url" && !qrUrl.trim()) ||
              (qrSource === "landing-page" && !selectedLandingPageId)
            }
            className="w-full"
          >
            {isGenerating ? "Generating..." : "Add QR Code"}
          </Button>
        </div>
      </ScrollArea>
      <ToolSidebarClose onClick={onClose} />
    </aside>
  );
};

