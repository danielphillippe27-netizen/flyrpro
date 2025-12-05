import { useEffect, useRef } from "react";
import { fabric } from "fabric";
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from "@/lib/flyers/printConstants";

interface UseBleedOverlayProps {
  canvas: fabric.Canvas | null;
  showBleed: boolean;
  showSafeZone: boolean;
  workspace: fabric.Rect | undefined;
}

/**
 * Hook to manage bleed overlay objects in Fabric.js canvas
 * Creates and manages bleed zone, crop marks, and safe zone guides
 */
export const useBleedOverlay = ({
  canvas,
  showBleed,
  showSafeZone,
  workspace,
}: UseBleedOverlayProps) => {
  const overlayObjectsRef = useRef<fabric.Object[]>([]);

  useEffect(() => {
    if (!canvas || !workspace) return;

    // Remove existing overlay objects
    overlayObjectsRef.current.forEach((obj) => {
      canvas.remove(obj);
    });
    overlayObjectsRef.current = [];

    const {
      BLEED_INSET,
      BLEED_WIDTH,
      BLEED_HEIGHT,
      TRIM_RECT,
      SAFE_RECT,
    } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

    // Get workspace position and size
    const workspaceLeft = workspace.left || 0;
    const workspaceTop = workspace.top || 0;
    const workspaceWidth = workspace.width || 0;
    const workspaceHeight = workspace.height || 0;

    // Determine if workspace is at bleed size or trim size
    const isBleedSize = workspaceWidth >= BLEED_WIDTH - 10; // Allow small tolerance

    // Only show bleed overlay if bleed is enabled AND workspace is at bleed size
    if (showBleed && isBleedSize) {
      // Create bleed zone fill (light red in outer 38px zone)
      const bleedZones = [
        // Top bleed zone
        new fabric.Rect({
          left: workspaceLeft,
          top: workspaceTop,
          width: BLEED_WIDTH,
          height: BLEED_INSET,
          fill: "#fee2e2",
          opacity: 0.5,
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "bleed-zone-top",
        }),
        // Bottom bleed zone
        new fabric.Rect({
          left: workspaceLeft,
          top: workspaceTop + BLEED_HEIGHT - BLEED_INSET,
          width: BLEED_WIDTH,
          height: BLEED_INSET,
          fill: "#fee2e2",
          opacity: 0.5,
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "bleed-zone-bottom",
        }),
        // Left bleed zone
        new fabric.Rect({
          left: workspaceLeft,
          top: workspaceTop + BLEED_INSET,
          width: BLEED_INSET,
          height: TRIM_RECT.height,
          fill: "#fee2e2",
          opacity: 0.5,
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "bleed-zone-left",
        }),
        // Right bleed zone
        new fabric.Rect({
          left: workspaceLeft + BLEED_WIDTH - BLEED_INSET,
          top: workspaceTop + BLEED_INSET,
          width: BLEED_INSET,
          height: TRIM_RECT.height,
          fill: "#fee2e2",
          opacity: 0.5,
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "bleed-zone-right",
        }),
      ];

      // Create crop marks (red dashed lines at trim boundary)
      const trimLeft = workspaceLeft + BLEED_INSET;
      const trimRight = workspaceLeft + BLEED_INSET + TRIM_RECT.width;
      const trimTop = workspaceTop + BLEED_INSET;
      const trimBottom = workspaceTop + BLEED_INSET + TRIM_RECT.height;

      const cropMarks = [
        // Top crop line
        new fabric.Line([trimLeft, trimTop, trimRight, trimTop], {
          stroke: "#ef4444",
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "crop-mark-top",
        }),
        // Bottom crop line
        new fabric.Line([trimLeft, trimBottom, trimRight, trimBottom], {
          stroke: "#ef4444",
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "crop-mark-bottom",
        }),
        // Left crop line
        new fabric.Line([trimLeft, trimTop, trimLeft, trimBottom], {
          stroke: "#ef4444",
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "crop-mark-left",
        }),
        // Right crop line
        new fabric.Line([trimRight, trimTop, trimRight, trimBottom], {
          stroke: "#ef4444",
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "crop-mark-right",
        }),
      ];

      overlayObjectsRef.current.push(...bleedZones, ...cropMarks);
      bleedZones.forEach((zone) => canvas.add(zone));
      cropMarks.forEach((mark) => canvas.add(mark));
    }

    if (showSafeZone) {
      // Calculate safe zone position
      // If workspace is at bleed size, safe zone is at BLEED_INSET + SAFE_INSET from workspace edge
      // If workspace is at trim size, safe zone is at SAFE_INSET from workspace edge
      // SAFE_RECT.x and SAFE_RECT.y are already calculated relative to bleed origin
      const safeLeft = workspaceLeft + (isBleedSize ? SAFE_RECT.x : SAFE_RECT.x - BLEED_INSET);
      const safeRight = safeLeft + SAFE_RECT.width;
      const safeTop = workspaceTop + (isBleedSize ? SAFE_RECT.y : SAFE_RECT.y - BLEED_INSET);
      const safeBottom = safeTop + SAFE_RECT.height;

      // Create safe zone guides (blue dashed lines)
      const safeZoneGuides = [
        // Top safe zone line
        new fabric.Line([safeLeft, safeTop, safeRight, safeTop], {
          stroke: "#3b82f6",
          strokeWidth: 1,
          strokeDashArray: [4, 4],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "safe-zone-top",
        }),
        // Bottom safe zone line
        new fabric.Line([safeLeft, safeBottom, safeRight, safeBottom], {
          stroke: "#3b82f6",
          strokeWidth: 1,
          strokeDashArray: [4, 4],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "safe-zone-bottom",
        }),
        // Left safe zone line
        new fabric.Line([safeLeft, safeTop, safeLeft, safeBottom], {
          stroke: "#3b82f6",
          strokeWidth: 1,
          strokeDashArray: [4, 4],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "safe-zone-left",
        }),
        // Right safe zone line
        new fabric.Line([safeRight, safeTop, safeRight, safeBottom], {
          stroke: "#3b82f6",
          strokeWidth: 1,
          strokeDashArray: [4, 4],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          name: "safe-zone-right",
        }),
      ];

      overlayObjectsRef.current.push(...safeZoneGuides);
      safeZoneGuides.forEach((guide) => canvas.add(guide));
    }

    // Bring overlays to front but keep them non-interactive
    overlayObjectsRef.current.forEach((obj) => {
      obj.bringToFront();
    });

    canvas.renderAll();

    return () => {
      // Cleanup on unmount
      overlayObjectsRef.current.forEach((obj) => {
        canvas.remove(obj);
      });
      overlayObjectsRef.current = [];
    };
  }, [canvas, showBleed, showSafeZone, workspace]);
};

