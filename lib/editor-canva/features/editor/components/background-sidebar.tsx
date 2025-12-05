"use client";

import { useEffect, useMemo, useState } from "react";

import { ActiveTool, Editor } from "@/lib/editor-canva/features/editor/types";
import { ToolSidebarClose } from "@/lib/editor-canva/features/editor/components/tool-sidebar-close";
import { ToolSidebarHeader } from "@/lib/editor-canva/features/editor/components/tool-sidebar-header";
import { ColorPicker } from "@/lib/editor-canva/features/editor/components/color-picker";

import { cn } from "@/lib/editor-canva/lib/utils";
import { ScrollArea } from "@/lib/editor-canva/components/ui/scroll-area";

interface BackgroundSidebarProps {
  editor: Editor | undefined;
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
};

export const BackgroundSidebar = ({
  editor,
  activeTool,
  onChangeActiveTool,
}: BackgroundSidebarProps) => {
  const workspace = editor?.getWorkspace();
  const initialBackground = useMemo(() => workspace?.fill ?? "#ffffff", [workspace]);
  const [background, setBackground] = useState(initialBackground);

  useEffect(() => {
    setBackground(initialBackground);
  }, [initialBackground]);

  const changeBackground = (value: string) => {
    setBackground(value);
    editor?.changeBackground(value);
  };

  const onClose = () => {
    onChangeActiveTool("select");
  };

  return (
    <aside
      className={cn(
        "bg-white relative border-r z-[40] w-[360px] h-full flex flex-col",
        activeTool === "background" ? "visible" : "hidden",
      )}
    >
      <ToolSidebarHeader
        title="Background"
        description="Change the background color of your canvas"
      />
      <ScrollArea>
        <div className="p-4">
          <ColorPicker
            value={background as string}
            onChange={changeBackground}
          />
        </div>
      </ScrollArea>
      <ToolSidebarClose onClick={onClose} />
    </aside>
  );
};

