"use client";

import { useState } from "react";
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
  const [qrUrl, setQrUrl] = useState("");
  const [qrSize, setQrSize] = useState(200);
  const [isGenerating, setIsGenerating] = useState(false);

  const onClose = () => {
    onChangeActiveTool("select");
  };

  const handleGenerateQR = async () => {
    if (!qrUrl.trim() || !editor) {
      return;
    }

    setIsGenerating(true);
    try {
      const qrDataUrl = await generateQrDataUrl(qrUrl, qrSize);
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
            disabled={!qrUrl.trim() || isGenerating}
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

