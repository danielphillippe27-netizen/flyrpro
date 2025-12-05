"use client";

import { useState, useEffect } from "react";
import { 
  Minimize, 
  ZoomIn, 
  ZoomOut, 
  Grid3x3, 
  Maximize, 
  HelpCircle,
  LayoutGrid
} from "lucide-react";

import { Editor } from "@/lib/editor-canva/features/editor/types";

import { Hint } from "@/lib/editor-canva/components/hint";
import { Button } from "@/lib/editor-canva/components/ui/button";
import { Slider } from "@/lib/editor-canva/components/ui/slider";

interface FooterProps {
  editor: Editor | undefined;
};

export const Footer = ({ editor }: FooterProps) => {
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isGridView, setIsGridView] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Sync zoom from editor
  useEffect(() => {
    if (!editor) return;
    
    const updateZoom = () => {
      const currentZoom = editor.getZoom();
      setZoom(currentZoom);
    };

    // Update zoom periodically to catch changes from zoom buttons
    const interval = setInterval(updateZoom, 200);
    updateZoom();

    return () => clearInterval(interval);
  }, [editor]);

  const handleZoomChange = (value: number[]) => {
    const newZoom = value[0];
    editor?.setZoom(newZoom);
    setZoom(newZoom);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const zoomPercentage = Math.round(zoom * 100);

  return (
    <footer className="h-[52px] border-t bg-gray-50 w-full flex items-center justify-between z-[49] px-4 shrink-0 gap-x-4">
      {/* Left side - Notes placeholder (for future) */}
      <div className="flex items-center gap-x-2 text-sm text-muted-foreground">
        {/* Notes icon can go here if needed */}
      </div>

      {/* Center - Zoom controls */}
      <div className="flex items-center gap-x-3 flex-1 justify-center max-w-md">
        <Hint label="Zoom out" side="top" sideOffset={10}>
          <Button
            onClick={() => editor?.zoomOut()}
            size="icon"
            variant="ghost"
            className="h-8 w-8"
          >
            <ZoomOut className="size-4" />
          </Button>
        </Hint>
        <div className="flex items-center gap-x-2 flex-1 min-w-[120px]">
          <Slider
            value={[zoom]}
            onValueChange={handleZoomChange}
            min={0.1}
            max={4}
            step={0.01}
            className="flex-1"
          />
        </div>
        <Hint label="Zoom in" side="top" sideOffset={10}>
          <Button
            onClick={() => editor?.zoomIn()}
            size="icon"
            variant="ghost"
            className="h-8 w-8"
          >
            <ZoomIn className="size-4" />
          </Button>
        </Hint>
        <div className="text-sm text-muted-foreground min-w-[40px] text-center">
          {zoomPercentage}%
        </div>
      </div>

      {/* Right side - Pages and controls */}
      <div className="flex items-center gap-x-4">
        <div className="text-sm text-muted-foreground">
          Pages {currentPage}/{totalPages}
        </div>
        <Hint label="Grid view" side="top" sideOffset={10}>
          <Button
            onClick={() => setIsGridView(!isGridView)}
            size="icon"
            variant="ghost"
            className={isGridView ? "bg-gray-200" : ""}
          >
            <LayoutGrid className="size-4" />
          </Button>
        </Hint>
        <Hint label={isFullscreen ? "Exit fullscreen" : "Fullscreen"} side="top" sideOffset={10}>
          <Button
            onClick={toggleFullscreen}
            size="icon"
            variant="ghost"
          >
            <Maximize className="size-4" />
          </Button>
        </Hint>
        <Hint label="Help" side="top" sideOffset={10}>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              // Help functionality can be added later
              window.open('https://help.example.com', '_blank');
            }}
          >
            <HelpCircle className="size-4" />
          </Button>
        </Hint>
      </div>
    </footer>
  );
};
