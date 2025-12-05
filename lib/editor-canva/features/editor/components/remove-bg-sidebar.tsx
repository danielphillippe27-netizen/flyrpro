import Image from "next/image";
import { AlertTriangle } from "lucide-react";

import { usePaywall } from "@/lib/editor-canva/features/subscriptions/hooks/use-paywall";

import { ActiveTool, Editor } from "@/lib/editor-canva/features/editor/types";
import { ToolSidebarClose } from "@/lib/editor-canva/features/editor/components/tool-sidebar-close";
import { ToolSidebarHeader } from "@/lib/editor-canva/features/editor/components/tool-sidebar-header";

import { useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/editor-canva/lib/utils";
import { Button } from "@/lib/editor-canva/components/ui/button";
import { ScrollArea } from "@/lib/editor-canva/components/ui/scroll-area";

interface RemoveBgSidebarProps {
  editor: Editor | undefined;
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
};

export const RemoveBgSidebar = ({
  editor,
  activeTool,
  onChangeActiveTool,
}: RemoveBgSidebarProps) => {
  const { shouldBlock, triggerPaywall } = usePaywall();
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedObject = editor?.selectedObjects[0];

  // @ts-ignore
  const imageSrc = selectedObject?._originalElement?.currentSrc || selectedObject?.src;

  const onClose = () => {
    onChangeActiveTool("select");
  };

  const onClick = async () => {
    if (shouldBlock) {
      triggerPaywall();
      return;
    }

    if (!imageSrc) {
      setError("No image selected");
      return;
    }

    setIsRemoving(true);
    setError(null);

    try {
      const response = await fetch('/api/background-remover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: imageSrc }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove background');
      }

      // Add the new image with transparent background
      editor?.addImage(data.url);
      editor?.save();
      toast.success('Background removed – new image added.');
    } catch (err: any) {
      const errorMessage = err?.message || 'We couldn\'t remove the background. Please try another image.';
      setError(errorMessage);
      console.error('Background removal error:', err);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <aside
      className={cn(
        "bg-white relative border-r z-[40] w-[360px] h-full flex flex-col",
        activeTool === "remove-bg" ? "visible" : "hidden",
      )}
    >
      <ToolSidebarHeader
        title="Background Remover"
        description="Erase the background from your photo in one click. Works best on clear subjects."
      />
      {!imageSrc && (
        <div className="flex flex-col gap-y-4 items-center justify-center flex-1">
          <AlertTriangle className="size-4 text-muted-foreground" />
          <p className="text-muted-foreground text-xs">
            Feature not available for this object
          </p>
        </div>
      )}
      {imageSrc && (
        <ScrollArea>
          <div className="p-4 space-y-4">
            <div className={cn(
              "relative aspect-square rounded-md overflow-hidden transition bg-muted",
              isRemoving && "opacity-50",
            )}>
              <Image
                src={imageSrc}
                fill
                alt="Image"
                className="object-cover"
              />
            </div>
            <Button
              disabled={isRemoving}
              onClick={onClick}
              className="w-full"
            >
              {isRemoving ? 'Removing...' : 'Remove background'}
            </Button>
            {error && (
              <p className="text-xs text-red-500 mt-2">{error}</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              We'll create a new image with a transparent background so you can keep the original.
            </p>
          </div>
        </ScrollArea>
      )}
      <ToolSidebarClose onClick={onClose} />
    </aside>
  );
};
