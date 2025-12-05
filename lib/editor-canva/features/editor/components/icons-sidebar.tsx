"use client";

import { ActiveTool, Editor } from "@/lib/editor-canva/features/editor/types";
import { ToolSidebarClose } from "@/lib/editor-canva/features/editor/components/tool-sidebar-close";
import { ToolSidebarHeader } from "@/lib/editor-canva/features/editor/components/tool-sidebar-header";

import { cn } from "@/lib/editor-canva/lib/utils";
import { ScrollArea } from "@/lib/editor-canva/components/ui/scroll-area";

interface IconsSidebarProps {
  editor: Editor | undefined;
  activeTool: ActiveTool;
  onChangeActiveTool: (tool: ActiveTool) => void;
};

export const IconsSidebar = ({
  editor,
  activeTool,
  onChangeActiveTool,
}: IconsSidebarProps) => {
  const onClose = () => {
    onChangeActiveTool("select");
  };

  const handleIconClick = (iconUrl: string) => {
    editor?.addImage(iconUrl);
  };

  // TODO: Integrate Freepik icons API/library
  // For now, this is a placeholder that can be expanded
  const placeholderIcons: string[] = [];

  return (
    <aside
      className={cn(
        "bg-white relative border-r z-[40] w-[360px] h-full flex flex-col",
        activeTool === "icons" ? "visible" : "hidden",
      )}
    >
      <ToolSidebarHeader
        title="Icons"
        description="Add icons from Freepik to your canvas"
      />
      <ScrollArea>
        <div className="p-4">
          {placeholderIcons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Freepik Icons Integration
              </p>
              <p className="text-xs text-muted-foreground">
                Icon library will be available here once integrated.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {placeholderIcons.map((iconUrl, index) => (
                <button
                  key={index}
                  onClick={() => handleIconClick(iconUrl)}
                  className="aspect-square border rounded-lg hover:bg-muted transition-colors flex items-center justify-center"
                >
                  <img
                    src={iconUrl}
                    alt={`Icon ${index + 1}`}
                    className="w-full h-full object-contain p-2"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
      <ToolSidebarClose onClick={onClose} />
    </aside>
  );
};

