'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Maximize, Minimize, X } from 'lucide-react';
import { CampaignsFarmsDropdown } from './CampaignsFarmsDropdown';

interface MapControlsProps {
  onCampaignSelect?: (campaignId: string | null) => void;
  selectedCampaignId?: string | null;
  selectedCampaignName?: string | null;
}

export function MapControls({ onCampaignSelect, selectedCampaignId, selectedCampaignName }: MapControlsProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(
        !!(
          document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement ||
          (document as any).msFullscreenElement
        )
      );
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      const doc = document.documentElement as any;
      const isFullscreen =
        document.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement;

      if (!isFullscreen) {
        if (doc.requestFullscreen) {
          await doc.requestFullscreen();
        } else if (doc.webkitRequestFullscreen) {
          await doc.webkitRequestFullscreen();
        } else if (doc.mozRequestFullScreen) {
          await doc.mozRequestFullScreen();
        } else if (doc.msRequestFullscreen) {
          await doc.msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      }
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <CampaignsFarmsDropdown onCampaignSelect={onCampaignSelect} />
        {selectedCampaignName && (
          <div className="bg-white/90 backdrop-blur-sm rounded-md px-2 py-1 text-xs font-medium text-gray-700 text-center border border-gray-200 shadow-sm">
            {selectedCampaignName}
          </div>
        )}
      </div>
      {selectedCampaignId && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCampaignSelect?.(null)}
          className="bg-white"
          title="Clear campaign selection"
        >
          <X className="w-4 h-4 mr-2" />
          Clear
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleFullscreen}
        className="bg-white"
      >
        {isFullscreen ? (
          <>
            <Minimize className="w-4 h-4 mr-2" />
            Exit
          </>
        ) : (
          <>
            <Maximize className="w-4 h-4 mr-2" />
            Fullscreen
          </>
        )}
      </Button>
    </>
  );
}

