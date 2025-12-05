import { useEffect } from "react";
import { fabric } from "fabric";
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from "@/lib/flyers/printConstants";

interface UseSnapToTrimProps {
  canvas: fabric.Canvas | null;
  workspace: fabric.Rect | undefined;
  showBleed: boolean;
}

const SNAP_THRESHOLD = 8; // pixels

/**
 * Hook to implement snap-to-trim-line functionality
 * Snaps objects to trim boundaries and safe zone boundaries when moving
 */
export const useSnapToTrim = ({
  canvas,
  workspace,
  showBleed,
}: UseSnapToTrimProps) => {
  useEffect(() => {
    if (!canvas || !workspace) return;

    const {
      BLEED_INSET,
      TRIM_RECT,
      SAFE_RECT,
    } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

    const workspaceLeft = workspace.left || 0;
    const workspaceTop = workspace.top || 0;
    const workspaceWidth = workspace.width || 0;
    const isBleedSize = workspaceWidth >= FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_WIDTH - 10;

    // Calculate snap points
    const trimLeft = workspaceLeft + (isBleedSize ? BLEED_INSET : 0);
    const trimRight = trimLeft + TRIM_RECT.width;
    const trimTop = workspaceTop + (isBleedSize ? BLEED_INSET : 0);
    const trimBottom = trimTop + TRIM_RECT.height;

    const safeLeft = workspaceLeft + (isBleedSize ? SAFE_RECT.x : SAFE_RECT.x - BLEED_INSET);
    const safeRight = safeLeft + SAFE_RECT.width;
    const safeTop = workspaceTop + (isBleedSize ? SAFE_RECT.y : SAFE_RECT.y - BLEED_INSET);
    const safeBottom = safeTop + SAFE_RECT.height;

    const snapPoints = {
      vertical: [trimLeft, trimRight, safeLeft, safeRight],
      horizontal: [trimTop, trimBottom, safeTop, safeBottom],
    };

    const handleObjectMoving = (e: fabric.IEvent) => {
      const obj = e.target as fabric.Object;
      if (!obj || obj.name === "clip") return; // Don't snap the workspace

      const bounds = obj.getBoundingRect();
      let newLeft = bounds.left;
      let newTop = bounds.top;

      // Snap to vertical lines (left/right edges)
      for (const x of snapPoints.vertical) {
        if (Math.abs(bounds.left - x) < SNAP_THRESHOLD) {
          newLeft = x;
          break;
        }
        if (Math.abs(bounds.left + bounds.width - x) < SNAP_THRESHOLD) {
          newLeft = x - bounds.width;
          break;
        }
        // Snap center
        const centerX = bounds.left + bounds.width / 2;
        if (Math.abs(centerX - x) < SNAP_THRESHOLD) {
          newLeft = x - bounds.width / 2;
          break;
        }
      }

      // Snap to horizontal lines (top/bottom edges)
      for (const y of snapPoints.horizontal) {
        if (Math.abs(bounds.top - y) < SNAP_THRESHOLD) {
          newTop = y;
          break;
        }
        if (Math.abs(bounds.top + bounds.height - y) < SNAP_THRESHOLD) {
          newTop = y - bounds.height;
          break;
        }
        // Snap center
        const centerY = bounds.top + bounds.height / 2;
        if (Math.abs(centerY - y) < SNAP_THRESHOLD) {
          newTop = y - bounds.height / 2;
          break;
        }
      }

      // Apply snapped position if changed
      if (newLeft !== bounds.left || newTop !== bounds.top) {
        obj.set({
          left: newLeft,
          top: newTop,
        });
        canvas.renderAll();
      }
    };

    canvas.on("object:moving", handleObjectMoving);

    return () => {
      canvas.off("object:moving", handleObjectMoving);
    };
  }, [canvas, workspace, showBleed]);
};

