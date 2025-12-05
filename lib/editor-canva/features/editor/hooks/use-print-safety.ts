import { useState, useEffect } from "react";
import { fabric } from "fabric";
import { FLYER_PRINT_CONSTANTS_HALF_LETTER } from "@/lib/flyers/printConstants";

interface UsePrintSafetyProps {
  canvas: fabric.Canvas | null;
  workspace: fabric.Rect | undefined;
  showBleed: boolean;
}

export type PrintSafetyStatus = "safe" | "unsafe" | "bleed";

/**
 * Hook to calculate print safety status in real-time
 */
export const usePrintSafety = ({
  canvas,
  workspace,
  showBleed,
}: UsePrintSafetyProps): PrintSafetyStatus => {
  const [status, setStatus] = useState<PrintSafetyStatus>("safe");

  useEffect(() => {
    if (!canvas || !workspace) {
      setStatus("safe");
      return;
    }

    const calculateSafety = () => {
      const {
        TRIM_RECT,
        SAFE_RECT,
        BLEED_INSET,
      } = FLYER_PRINT_CONSTANTS_HALF_LETTER;

      const workspaceLeft = workspace.left || 0;
      const workspaceTop = workspace.top || 0;
      const workspaceWidth = workspace.width || 0;
      const isBleedSize = workspaceWidth >= FLYER_PRINT_CONSTANTS_HALF_LETTER.BLEED_WIDTH - 10;

      // Get all objects except workspace and overlay objects
      const objects = canvas.getObjects().filter((obj: fabric.Object) => {
        const name = obj.name || "";
        return name !== "clip" && 
               !name.includes("bleed-zone") && 
               !name.includes("crop-mark") && 
               !name.includes("safe-zone");
      });

      if (objects.length === 0) {
        setStatus("safe");
        return;
      }

      // Calculate trim and safe zone boundaries
      const trimLeft = workspaceLeft + (isBleedSize ? BLEED_INSET : 0);
      const trimRight = trimLeft + TRIM_RECT.width;
      const trimTop = workspaceTop + (isBleedSize ? BLEED_INSET : 0);
      const trimBottom = trimTop + TRIM_RECT.height;

      const safeLeft = workspaceLeft + (isBleedSize ? SAFE_RECT.x : SAFE_RECT.x - BLEED_INSET);
      const safeRight = safeLeft + SAFE_RECT.width;
      const safeTop = workspaceTop + (isBleedSize ? SAFE_RECT.y : SAFE_RECT.y - BLEED_INSET);
      const safeBottom = safeTop + SAFE_RECT.height;

      // Check if any object extends into bleed zone
      const hasBleedContent = objects.some((obj: fabric.Object) => {
        const bounds = obj.getBoundingRect();
        return (
          bounds.left < trimLeft ||
          bounds.left + bounds.width > trimRight ||
          bounds.top < trimTop ||
          bounds.top + bounds.height > trimBottom
        );
      });

      if (hasBleedContent) {
        setStatus("bleed");
        return;
      }

      // Check if any object extends beyond safe zone
      const hasUnsafeContent = objects.some((obj: fabric.Object) => {
        const bounds = obj.getBoundingRect();
        return (
          bounds.left < safeLeft ||
          bounds.left + bounds.width > safeRight ||
          bounds.top < safeTop ||
          bounds.top + bounds.height > safeBottom
        );
      });

      setStatus(hasUnsafeContent ? "unsafe" : "safe");
    };

    calculateSafety();

    // Listen to canvas events to update safety status
    const handleUpdate = () => {
      calculateSafety();
    };

    canvas.on("object:added", handleUpdate);
    canvas.on("object:removed", handleUpdate);
    canvas.on("object:modified", handleUpdate);
    canvas.on("object:moving", handleUpdate);

    return () => {
      canvas.off("object:added", handleUpdate);
      canvas.off("object:removed", handleUpdate);
      canvas.off("object:modified", handleUpdate);
      canvas.off("object:moving", handleUpdate);
    };
  }, [canvas, workspace, showBleed]);

  return status;
};

