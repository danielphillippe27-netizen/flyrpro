"use client";

import { Copy, Plus } from "lucide-react";
import { Button } from "@/lib/editor-canva/components/ui/button";
import { Hint } from "@/lib/editor-canva/components/hint";
import { cn } from "@/lib/editor-canva/lib/utils";

interface PageControlsProps {
  onDuplicatePage?: () => void;
  onAddPage?: () => void;
  className?: string;
};

export const PageControls = ({
  onDuplicatePage,
  onAddPage,
  className,
}: PageControlsProps) => {
  return (
    <div className={cn("flex items-center gap-x-2", className)}>
      <Hint label="Duplicate page" side="bottom" sideOffset={10}>
        <Button
          size="icon"
          variant="ghost"
          onClick={onDuplicatePage}
          className="h-8 w-8"
        >
          <Copy className="size-4" />
        </Button>
      </Hint>
      <Hint label="Add page" side="bottom" sideOffset={10}>
        <Button
          size="icon"
          variant="ghost"
          onClick={onAddPage}
          className="h-8 w-8"
        >
          <Plus className="size-4" />
        </Button>
      </Hint>
    </div>
  );
};

