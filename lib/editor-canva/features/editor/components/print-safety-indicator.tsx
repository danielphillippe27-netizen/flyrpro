"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Editor } from "@/lib/editor-canva/features/editor/types";
import { usePrintSafety } from "@/lib/editor-canva/features/editor/hooks/use-print-safety";

interface PrintSafetyIndicatorProps {
  editor: Editor | undefined;
}

/**
 * PrintSafetyIndicator Component
 * 
 * Shows green "Print Safe" when all content is within safe zone,
 * red "Risk of Cutoff" when content extends into bleed.
 */
export const PrintSafetyIndicator = ({ editor }: PrintSafetyIndicatorProps) => {
  if (!editor) return null;

  const canvas = editor.canvas;
  const workspace = editor.getWorkspace() as fabric.Rect | undefined;
  const status = usePrintSafety({
    canvas,
    workspace,
    showBleed: editor.showBleed,
  });

  if (!workspace) return null;

  if (status === "bleed") {
    return (
      <div className="flex items-center gap-2 text-red-500 text-xs">
        <AlertTriangle className="size-4" />
        <span>Risk of Cutoff</span>
      </div>
    );
  }

  if (status === "unsafe") {
    return (
      <div className="flex items-center gap-2 text-amber-500 text-xs">
        <AlertTriangle className="size-4" />
        <span>Near Edge</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-green-500 text-xs">
      <CheckCircle2 className="size-4" />
      <span>Print Safe</span>
    </div>
  );
};

